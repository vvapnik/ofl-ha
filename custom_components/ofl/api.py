"""Async client for a Head Device's local OFL binding.

Implements the transport rules a Control Panel has to live with
(open-farm-link/docs/16-rest-api.md §16.3, docs/22-security.md):

- HTTPS to a self-signed certificate, trusted by **pinning** the SHA-256 of
  its SubjectPublicKeyInfo (§22.2) — checked right after the TLS handshake,
  before any request (and so before any credential) is written.
- Exactly one connection at a time: one connector with ``limit=1``, and a
  keep-alive shorter than the device's 5 s idle timeout (§22.7), so a pooled
  connection is never reused just as the device closes it. Callers group
  requests in ``async with client.batch():`` — batches run one at a time,
  and the connection is dropped as soon as one ends, so the device's only
  slot isn't held idle while other clients (the official app) wait for it.
- A second connection is refused by the device while another client holds
  the slot, so connection failures are retried with backoff.
"""

from __future__ import annotations

import asyncio
import base64
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
import hashlib
import hmac
import logging
import os
from typing import Any

import aiohttp
from aiohttp import Fingerprint
from cryptography import x509
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

_LOGGER = logging.getLogger(__name__)

REQUEST_TIMEOUT = aiohttp.ClientTimeout(total=15, sock_connect=5)
KEEPALIVE_SECONDS = 3  # < device idle timeout of 5 s, §22.7
# Spans > the device idle timeout (5 s, §22.7): even a silent connection
# hogging the slot is closed by the device before the last retry.
RETRY_DELAYS = (0.3, 1.0, 2.0, 3.0)
FINGERPRINT_PREFIX = "sha256//"


class OflError(Exception):
    """Base error."""


class OflConnectionError(OflError):
    """Device unreachable (or its single connection slot stayed busy)."""


class OflPinMismatch(OflError):
    """TLS key doesn't match the pinned fingerprint — another device, or a factory-reset one (§22.2)."""


class OflProofMismatch(OflPinMismatch):
    """Setup-code challenge failed: a typo in the code, or a peer that doesn't know it (§22.4).

    The two are indistinguishable by design — either way the code is not sent.
    """


class OflAuthError(OflError):
    """401 — credentials missing, wrong or revoked."""


class OflThrottled(OflError):
    """429 — brute-force limit engaged (§22.5)."""


class OflApiError(OflError):
    """Any other error response in the docs/16-rest-api.md §16.2 shape."""

    def __init__(self, status: int, error: str, body: dict[str, Any] | None = None) -> None:
        super().__init__(f"{status} {error}")
        self.status = status
        self.error = error
        self.body = body or {}


def spki_sha256(der_cert: bytes) -> bytes:
    """SHA-256 over the certificate's DER-encoded SubjectPublicKeyInfo."""
    cert = x509.load_der_x509_certificate(der_cert)
    spki = cert.public_key().public_bytes(Encoding.DER, PublicFormat.SubjectPublicKeyInfo)
    return hashlib.sha256(spki).digest()


def fingerprint_to_bytes(fingerprint: str) -> bytes:
    if not fingerprint.startswith(FINGERPRINT_PREFIX):
        raise ValueError(f"not a sha256// fingerprint: {fingerprint!r}")
    return base64.b64decode(fingerprint[len(FINGERPRINT_PREFIX) :])


def bytes_to_fingerprint(digest: bytes) -> str:
    return FINGERPRINT_PREFIX + base64.b64encode(digest).decode()


def garden_id_from_spki(digest: bytes) -> str:
    """docs/22-security.md §22.2: lowercase RFC 4648 base32 of the first 10 bytes."""
    return base64.b32encode(digest[:10]).decode().lower()


def normalize_setup_code(code: str) -> str:
    """docs/22-security.md §22.3."""
    return (
        code.replace("-", "").replace(" ", "").upper().replace("O", "0").replace("I", "1").replace("L", "1")
    )


def challenge_proof(setup_code: str, nonce: bytes, spki_digest: bytes) -> str:
    """docs/22-security.md §22.4 step 1, computed on the client side."""
    key = normalize_setup_code(setup_code).encode("ascii")
    return base64.b64encode(hmac.new(key, nonce + spki_digest, hashlib.sha256).digest()).decode()


class SpkiPin(Fingerprint):
    """aiohttp fingerprint hook that pins the public key instead of the whole certificate.

    aiohttp's own ``Fingerprint`` hashes the full DER certificate; OFL pins the
    SPKI so the key, not one particular certificate for it, is the trust
    anchor. aiohttp calls ``check()`` right after the handshake and before the
    request is sent, and uses an unverified SSL context for the CA part.

    With ``expected=None`` it pins on first use and holds every later
    connection of the same client to that key — used only while pairing,
    where nothing has been pinned yet.
    """

    def __init__(self, expected: bytes | None) -> None:
        super().__init__(expected or bytes(32))
        self.expected = expected

    def check(self, transport: asyncio.Transport) -> None:
        sslobj = transport.get_extra_info("ssl_object")
        if sslobj is None:
            return
        der = sslobj.getpeercert(binary_form=True)
        got = spki_sha256(der)
        if self.expected is None:
            self.expected = got
            return
        if not hmac.compare_digest(got, self.expected):
            # aiohttp closes the transport on this exception, before any request is written.
            raise aiohttp.ServerFingerprintMismatch(self.expected, got, "head-device", 0)


class OflClient:
    """One Head Device. Owns its aiohttp session — a dedicated single-slot connector."""

    def __init__(
        self,
        host: str,
        port: int,
        *,
        fingerprint: str | None = None,
        token: str | None = None,
        username: str | None = None,
        password: str | None = None,
    ) -> None:
        self.host = host
        self.port = port
        self.pin = SpkiPin(fingerprint_to_bytes(fingerprint) if fingerprint else None)
        self._auth_header: str | None = None
        if token:
            self._auth_header = f"Bearer {token}"
        elif username is not None and password is not None:
            self._auth_header = aiohttp.BasicAuth(username, password).encode()
        self._session: aiohttp.ClientSession | None = None
        self._batch_lock = asyncio.Lock()

    @property
    def base_url(self) -> str:
        host = f"[{self.host}]" if ":" in self.host else self.host
        return f"https://{host}:{self.port}"

    @property
    def observed_fingerprint(self) -> str | None:
        """The key seen in the TLS handshake (pinned, or captured on first use)."""
        return bytes_to_fingerprint(self.pin.expected) if self.pin.expected else None

    def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            connector = aiohttp.TCPConnector(limit=1, ssl=self.pin, keepalive_timeout=KEEPALIVE_SECONDS)
            self._session = aiohttp.ClientSession(connector=connector, timeout=REQUEST_TIMEOUT)
        return self._session

    async def close(self) -> None:
        if self._session is not None:
            await self._session.close()
            self._session = None

    @asynccontextmanager
    async def batch(self) -> AsyncIterator[OflClient]:
        """Run a group of requests exclusively, then free the device's connection slot.

        Closing the session is the only public way to drop aiohttp's pooled
        connection right away; the next batch simply opens a new one.
        """
        async with self._batch_lock:
            try:
                yield self
            finally:
                await self.close()

    def use_token(self, token: str) -> None:
        """Switch to the token a pairing just returned (same client, same pinned key)."""
        self._auth_header = f"Bearer {token}"

    async def request(
        self, method: str, path: str, *, json: Any = None, params: dict[str, str] | None = None, auth: bool = True
    ) -> Any:
        headers = {}
        if auth and self._auth_header:
            headers["Authorization"] = self._auth_header

        # The device refuses a second connection at the TCP level (§16.3), so
        # "couldn't connect" usually means some other client holds the slot —
        # worth retrying. Once a request may have reached the device, only
        # idempotent methods are retried.
        idempotent = method in ("GET", "PUT", "DELETE")
        for attempt, delay in enumerate((0.0, *RETRY_DELAYS)):
            if delay:
                await asyncio.sleep(delay)
            try:
                async with self._get_session().request(
                    method, self.base_url + path, json=json, params=params, headers=headers
                ) as resp:
                    return await self._handle(resp)
            except aiohttp.ServerFingerprintMismatch as err:
                raise OflPinMismatch(str(err)) from err
            except aiohttp.ClientConnectorError as err:
                last: Exception = err
            except (aiohttp.ClientConnectionError, asyncio.TimeoutError) as err:
                if not idempotent:
                    raise OflConnectionError(f"{method} {path}: {err!r}") from err
                last = err
            _LOGGER.debug("%s %s attempt %d failed: %r", method, path, attempt + 1, last)
        raise OflConnectionError(f"{method} {path}: {last!r}") from last

    @staticmethod
    async def _handle(resp: aiohttp.ClientResponse) -> Any:
        if resp.status == 204:
            return None
        try:
            body = await resp.json(content_type=None)
        except ValueError:
            body = None
        if resp.status < 400:
            return body
        error = body.get("error", "unknown") if isinstance(body, dict) else "unknown"
        if resp.status == 401:
            raise OflAuthError(error)
        if resp.status == 429:
            raise OflThrottled(error)
        raise OflApiError(resp.status, error, body if isinstance(body, dict) else None)

    # ---- Pairing (docs/22-security.md §22.4) ------------------------------

    async def verify_setup_code(self, setup_code: str) -> dict[str, Any]:
        """Step 1: make sure the TLS peer knows ``setup_code`` before revealing it.

        The proof is checked against the key this client *actually saw* in
        the handshake, not the fingerprint the device claims in the body.
        """
        nonce = os.urandom(16)
        resp = await self.request(
            "POST", "/garden/pair/challenge", json={"nonce": base64.b64encode(nonce).decode()}, auth=False
        )
        seen = self.pin.expected
        if seen is None or not hmac.compare_digest(resp["proof"], challenge_proof(setup_code, nonce, seen)):
            raise OflProofMismatch("setup code proof mismatch — wrong code, or the device doesn't know it")
        return resp

    async def pair(self, body: dict[str, Any]) -> dict[str, Any]:
        resp = await self.request("POST", "/garden/pair", json=body, auth=False)
        if resp.get("fingerprint") != self.observed_fingerprint:
            raise OflPinMismatch("fingerprint in pairing response differs from the TLS key")
        return resp

    # ---- Credentials (§22.6) ----------------------------------------------

    async def list_clients(self) -> list[dict[str, Any]]:
        return await self.request("GET", "/garden/clients")

    async def delete_client(self, client_id: str) -> None:
        await self.request("DELETE", f"/garden/clients/{client_id}")

    # ---- Garden -----------------------------------------------------------

    async def get_garden(self) -> dict[str, Any]:
        return await self.request("GET", "/garden")

    async def get_preferences(self) -> dict[str, Any]:
        return await self.request("GET", "/garden/preferences")

    async def put_preferences(self, prefs: dict[str, Any]) -> dict[str, Any]:
        return await self.request("PUT", "/garden/preferences", json=prefs)

    async def get_time(self) -> dict[str, Any]:
        return await self.request("GET", "/garden/time")

    async def put_time(self, iso_utc: str) -> dict[str, Any]:
        return await self.request("PUT", "/garden/time", json={"time": iso_utc})

    async def get_plants(self) -> list[dict[str, Any]]:
        return await self.request("GET", "/garden/plants")

    # ---- Plant / System sub-resources ---------------------------------------
    # ``scope`` is "plants/<id>" or "system" — same sub-resource shape (§16.5).

    async def get_vitals(self, scope: str) -> list[dict[str, Any]]:
        return (await self.request("GET", f"/garden/{scope}/vitals"))["vitals"]

    async def get_actuators(self, scope: str) -> list[dict[str, Any]]:
        return (await self.request("GET", f"/garden/{scope}/actuators"))["actuators"]

    async def put_actuator(self, scope: str, capability: str, value: Any) -> dict[str, Any]:
        return await self.request("PUT", f"/garden/{scope}/actuators/{capability}", json={"value": value})

    async def get_hardware_calibration(self, scope: str) -> list[dict[str, Any]]:
        return (await self.request("GET", f"/garden/{scope}/hardware-calibration"))["calibrations"]

    async def get_grow_profile(self, plant_id: str) -> dict[str, Any]:
        return await self.request("GET", f"/garden/plants/{plant_id}/grow-profile")

    async def put_grow_profile(self, plant_id: str, profile: dict[str, Any]) -> dict[str, Any]:
        return await self.request("PUT", f"/garden/plants/{plant_id}/grow-profile", json=profile)

    async def import_culture_pack(self, plant_id: str, pack: dict[str, Any]) -> Any:
        return await self.request("POST", f"/garden/plants/{plant_id}/culture-packs", json=pack)
