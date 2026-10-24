"""Config flow: discover a Head Device and pair with it (open-farm-link/docs/22-security.md §22.4)."""

from __future__ import annotations

from collections.abc import Mapping
import logging
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.const import CONF_HOST, CONF_PASSWORD, CONF_PORT, CONF_USERNAME
from homeassistant.core import callback
from homeassistant.helpers.service_info.zeroconf import ZeroconfServiceInfo

from .api import (
    OflApiError,
    OflAuthError,
    OflClient,
    OflConnectionError,
    OflError,
    OflPinMismatch,
    OflProofMismatch,
    OflThrottled,
    fingerprint_to_bytes,
    garden_id_from_spki,
)
from .const import (
    CLIENT_NAME,
    CONF_AUTH_METHOD,
    CONF_CLIENT_ID,
    CONF_FINGERPRINT,
    CONF_GARDEN_ID,
    CONF_SYNC_TIME,
    CONF_TOKEN,
    CONF_WATER_SECONDS,
    DEFAULT_PORT,
    DEFAULT_SYNC_TIME,
    DEFAULT_WATER_SECONDS,
    DOMAIN,
)

_LOGGER = logging.getLogger(__name__)

CONF_SETUP_CODE = "setup_code"
PAIR_MENU = ["pair_button", "pair_setup_code", "pair_credentials"]


def _error_key(err: Exception) -> str:
    if isinstance(err, OflProofMismatch):
        return "setup_code_mismatch"
    if isinstance(err, OflPinMismatch):
        return "identity_mismatch"
    if isinstance(err, OflThrottled):
        return "too_many_attempts"
    if isinstance(err, OflAuthError):
        return "invalid_auth"
    if isinstance(err, OflApiError) and err.error in (
        "pairing_closed",
        "invalid_setup_code",
        "no_free_slots",
        "username_taken",
    ):
        return err.error
    if isinstance(err, OflConnectionError):
        return "cannot_connect"
    return "unknown"


class OflConfigFlow(ConfigFlow, domain=DOMAIN):
    VERSION = 1

    def __init__(self) -> None:
        self._host: str | None = None
        self._port: int = DEFAULT_PORT
        self._garden_id: str | None = None
        self._pair_hint: str | None = None  # mDNS TXT pair=, §16.4
        self._entry_data: dict[str, Any] = {}
        self._clients: list[dict[str, Any]] = []
        self._reauth_entry: ConfigEntry | None = None

    # ---- Discovery ----------------------------------------------------------

    async def async_step_zeroconf(self, discovery_info: ZeroconfServiceInfo) -> ConfigFlowResult:
        garden_id = discovery_info.properties.get("garden_id")
        if not garden_id:
            return self.async_abort(reason="not_ofl_device")
        await self.async_set_unique_id(garden_id)
        # ofl-peer{N} and the IP aren't stable identities (§16.4) — follow the
        # Garden to wherever it is now. TXT is unauthenticated, but that only
        # redirects polling: the pinned key still has to match.
        self._abort_if_unique_id_configured(updates={CONF_HOST: discovery_info.host, CONF_PORT: discovery_info.port})
        self._host = discovery_info.host
        self._port = discovery_info.port or DEFAULT_PORT
        self._garden_id = garden_id
        self._pair_hint = discovery_info.properties.get("pair")
        self.context["title_placeholders"] = {"name": garden_id}
        return await self.async_step_pair()

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            self._host = user_input[CONF_HOST]
            self._port = user_input[CONF_PORT]
            # Nothing is authenticated yet; just learn the device's key so the
            # Garden can be identified (garden_id derives from it, §22.2).
            client = OflClient(self._host, self._port)
            try:
                await client.get_garden()
            except OflAuthError:
                pass  # expected — 401 still completed a TLS handshake
            except OflError as err:
                errors["base"] = _error_key(err)
            finally:
                await client.close()
            if not errors and client.pin.expected:
                self._garden_id = garden_id_from_spki(client.pin.expected)
                await self.async_set_unique_id(self._garden_id)
                self._abort_if_unique_id_configured(updates={CONF_HOST: self._host, CONF_PORT: self._port})
                return await self.async_step_pair()
            errors.setdefault("base", "cannot_connect")

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {vol.Required(CONF_HOST): str, vol.Required(CONF_PORT, default=DEFAULT_PORT): int}
            ),
            errors=errors,
        )

    # ---- Pairing ------------------------------------------------------------

    async def async_step_pair(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        options = PAIR_MENU
        if self._pair_hint == "code":
            options = ["pair_setup_code", "pair_button", "pair_credentials"]
        return self.async_show_menu(
            step_id="pair",
            menu_options=options,
            description_placeholders={"garden_id": self._garden_id or "?", "host": self._host or "?"},
        )

    def _new_client(self, **auth: Any) -> OflClient:
        assert self._host is not None
        # Re-auth keeps the key pinned at first pairing; a new pairing pins on
        # first use (button) or after the challenge proves it (setup code).
        fingerprint = self._reauth_entry.data[CONF_FINGERPRINT] if self._reauth_entry else None
        return OflClient(self._host, self._port, fingerprint=fingerprint, **auth)

    async def async_step_pair_button(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            client = self._new_client()
            try:
                resp = await client.pair({"method": "token", "name": CLIENT_NAME})
                return await self._paired(client, resp, {CONF_AUTH_METHOD: "token", CONF_TOKEN: resp["token"]})
            except OflError as err:
                errors["base"] = _error_key(err)
            finally:
                await client.close()
        return self.async_show_form(step_id="pair_button", data_schema=vol.Schema({}), errors=errors)

    async def async_step_pair_setup_code(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            code = user_input[CONF_SETUP_CODE]
            client = self._new_client()
            try:
                # MUST for an official Control Panel on this path (§22.4 step 1):
                # never hand the code to a peer that can't prove it knows it.
                await client.verify_setup_code(code)
                resp = await client.pair({"method": "token", "name": CLIENT_NAME, "setup_code": code})
                return await self._paired(client, resp, {CONF_AUTH_METHOD: "token", CONF_TOKEN: resp["token"]})
            except OflError as err:
                errors["base"] = _error_key(err)
            finally:
                await client.close()
        return self.async_show_form(
            step_id="pair_setup_code",
            data_schema=vol.Schema({vol.Required(CONF_SETUP_CODE): str}),
            errors=errors,
        )

    async def async_step_pair_credentials(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Use a login/password created elsewhere (app, curl) — trust on first use of the key."""
        errors: dict[str, str] = {}
        if user_input is not None:
            username, password = user_input[CONF_USERNAME], user_input[CONF_PASSWORD]
            client = self._new_client(username=username, password=password)
            try:
                garden = await client.get_garden()
                clients = await client.list_clients()
                own = next((c for c in clients if c.get("username") == username), None)
                resp = {
                    "client_id": own["client_id"] if own else None,
                    "garden_id": garden["garden_id"],
                    "fingerprint": client.observed_fingerprint,
                }
                auth = {CONF_AUTH_METHOD: "password", CONF_USERNAME: username, CONF_PASSWORD: password}
                return await self._paired(client, resp, auth, clients=clients)
            except OflError as err:
                errors["base"] = _error_key(err)
            finally:
                await client.close()
        return self.async_show_form(
            step_id="pair_credentials",
            data_schema=vol.Schema({vol.Required(CONF_USERNAME): str, vol.Required(CONF_PASSWORD): str}),
            errors=errors,
        )

    async def _paired(
        self,
        client: OflClient,
        resp: dict[str, Any],
        auth: dict[str, Any],
        *,
        clients: list[dict[str, Any]] | None = None,
    ) -> ConfigFlowResult:
        fingerprint = client.observed_fingerprint
        assert fingerprint is not None
        garden_id = garden_id_from_spki(fingerprint_to_bytes(fingerprint))
        if resp.get("garden_id") != garden_id or (self._garden_id and garden_id != self._garden_id):
            # Key doesn't belong to the Garden we set out to pair with.
            raise OflPinMismatch(f"expected garden {self._garden_id}, key belongs to {garden_id}")

        self._entry_data = {
            CONF_HOST: self._host,
            CONF_PORT: self._port,
            CONF_GARDEN_ID: garden_id,
            CONF_FINGERPRINT: fingerprint,
            CONF_CLIENT_ID: resp.get("client_id"),
            **auth,
        }

        if self._reauth_entry:
            return self.async_update_reload_and_abort(self._reauth_entry, data=self._entry_data)

        if clients is None:
            # Same client (one connection, same pinned key), now with the new token.
            client.use_token(auth[CONF_TOKEN])
            clients = await client.list_clients()
        self._clients = clients
        return await self.async_step_paired()

    async def async_step_paired(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """§22.4: show the credential list prominently right after pairing."""
        if user_input is not None:
            return self.async_create_entry(title=f"Garden {self._entry_data[CONF_GARDEN_ID]}", data=self._entry_data)
        own = self._entry_data.get(CONF_CLIENT_ID)
        lines = [
            f"- **{c['name']}** ({c['method']}{', ' + c['username'] if c.get('username') else ''})"
            + (" ← Home Assistant" if c["client_id"] == own else "")
            for c in self._clients
        ]
        return self.async_show_form(
            step_id="paired",
            data_schema=vol.Schema({}),
            description_placeholders={"clients": "\n".join(lines), "garden_id": self._entry_data[CONF_GARDEN_ID]},
        )

    # ---- Re-auth --------------------------------------------------------------

    async def async_step_reauth(self, entry_data: Mapping[str, Any]) -> ConfigFlowResult:
        self._reauth_entry = self._get_reauth_entry()
        self._host = entry_data[CONF_HOST]
        self._port = entry_data[CONF_PORT]
        self._garden_id = entry_data[CONF_GARDEN_ID]

        # A changed key is a factory reset (§22.8): it's a new Garden now, and
        # re-pairing it into this entry would silently merge two Gardens.
        probe = OflClient(self._host, self._port, fingerprint=entry_data[CONF_FINGERPRINT])
        try:
            await probe.get_garden()
        except OflPinMismatch:
            return self.async_abort(reason="device_reset")
        except OflError:
            pass  # 401 (what triggered re-auth) or unreachable — pairing step will tell
        finally:
            await probe.close()
        return await self.async_step_pair()

    # ---- Options --------------------------------------------------------------

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OflOptionsFlow:
        return OflOptionsFlow()


class OflOptionsFlow(OptionsFlow):
    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(data=user_input)
        opts = self.config_entry.options
        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        CONF_WATER_SECONDS, default=opts.get(CONF_WATER_SECONDS, DEFAULT_WATER_SECONDS)
                    ): vol.All(int, vol.Range(min=1, max=120)),
                    vol.Required(CONF_SYNC_TIME, default=opts.get(CONF_SYNC_TIME, DEFAULT_SYNC_TIME)): bool,
                }
            ),
        )
