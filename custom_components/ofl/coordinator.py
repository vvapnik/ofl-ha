"""Polling coordinator — one per Head Device / Garden.

OFL has no push channel (open-farm-link/docs/01-philosophy.md §1.2), so this
polls. All requests of one refresh run sequentially over the client's single
kept-alive connection (§16.3) — no gather(), which would only queue on the
one-slot connector anyway.

Optional parts of the API (Preferences, Grow Profile, Hardware Calibration)
may be missing on simpler firmware: a 404 there means "not supported", the
matching entities are simply not created. In bench mode (no docs/22
security — such firmware is the only kind we know) that is remembered, so
the device isn't asked again on every poll.

Without Hardware Calibration a device reports raw endpoint values (§6) under
the catalog's physical unit — e.g. a raw16 moisture reading as "percent".
Then the module's endpoint ``format`` from ``/modules`` is the honest unit:
see ``raw_unit``.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
import logging
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import OflApiError, OflAuthError, OflClient, OflError, OflPinMismatch
from .const import CONF_SYNC_TIME, DEFAULT_SCAN_INTERVAL, DEFAULT_SYNC_TIME, DOMAIN

_LOGGER = logging.getLogger(__name__)


@dataclass
class ScopeData:
    """A Plant or the System: the shared sub-resource shape (§16.5)."""

    vitals: dict[str, dict[str, Any]] = field(default_factory=dict)  # type → {value, unit}
    actuators: dict[str, dict[str, Any]] = field(default_factory=dict)  # capability → {value, unit}
    # capability → max physical value from the Hardware Calibration curve, if any (§6)
    actuator_max: dict[str, float] = field(default_factory=dict)
    # Only when the device has no Hardware Calibration: endpoint type → the
    # module endpoint's raw ``format`` ("percent", "binary", "raw16", ...).
    raw_formats: dict[str, str] = field(default_factory=dict)


@dataclass
class PlantData(ScopeData):
    plant_id: str = ""
    name: str = ""
    description: str = ""
    status: str = "ok"
    grow_profile: dict[str, Any] = field(default_factory=dict)


@dataclass
class GardenData:
    garden: dict[str, Any]
    preferences: dict[str, Any] | None  # None: the device has no Preferences
    time: dict[str, Any]
    system: ScopeData
    plants: dict[str, PlantData]  # API list order — not physical order (§21.4)


# Raw endpoint format → (unit in the Capability Catalog's names or None for a
# bare count, slider max). Used only for uncalibrated devices.
RAW_FORMATS: dict[str, tuple[str | None, float]] = {
    "percent": ("percent", 100.0),
    "binary": ("binary", 1.0),
    "raw8": (None, 255.0),
    "raw16": (None, 65535.0),
}


def raw_unit(data: ScopeData, key: str, declared: str | None) -> tuple[str | None, float | None]:
    """The unit a value is really in, and its max if known from the raw format.

    Calibrated devices (no ``raw_formats``) report in the declared unit.
    """
    fmt = data.raw_formats.get(key)
    if fmt is None:
        return declared, None
    return RAW_FORMATS.get(fmt, (None, None))


type OflConfigEntry = ConfigEntry[OflCoordinator]


class OflCoordinator(DataUpdateCoordinator[GardenData]):
    config_entry: OflConfigEntry

    def __init__(self, hass: HomeAssistant, entry: OflConfigEntry, client: OflClient) -> None:
        super().__init__(
            hass, _LOGGER, config_entry=entry, name=f"{DOMAIN} {entry.title}", update_interval=DEFAULT_SCAN_INTERVAL
        )
        self.client = client
        self.garden_device_id: str | None = None  # set in async_setup_entry
        # Hardware Calibration is library data that only changes with the
        # hardware itself, so it's fetched once per scope, not every poll.
        self._calibration_max: dict[str, dict[str, float] | None] = {}  # None: no calibration
        # Optional endpoints found missing (bench mode only, see module doc).
        self._unsupported: set[str] = set()

    async def _optional[T](self, feature: str, call: Callable[[], Awaitable[T]]) -> T | None:
        """Call an optional endpoint; ``None`` if the device doesn't have it (404)."""
        if feature in self._unsupported:
            return None
        try:
            return await call()
        except OflApiError as err:
            if err.status != 404:
                raise
            if self.client.insecure:
                _LOGGER.info("%s: device has no %s; not asking again", self.config_entry.title, feature)
                self._unsupported.add(feature)
            return None

    async def _async_update_data(self) -> GardenData:
        try:
            async with self.client.batch():
                return await self._fetch()
        except OflAuthError as err:
            raise ConfigEntryAuthFailed("Head Device rejected the stored credential") from err
        except OflPinMismatch as err:
            # §22.2: a different key means another device or a factory-reset
            # one. Never send credentials to it; re-pairing is the only way on.
            raise ConfigEntryAuthFailed("Head Device key changed (factory reset?) — re-pair it") from err
        except OflError as err:
            raise UpdateFailed(str(err)) from err

    async def _fetch(self) -> GardenData:
        c = self.client
        garden = await c.get_garden()
        preferences = await self._optional("preferences", c.get_preferences)
        time = await self._maybe_sync_time(await c.get_time())

        system = ScopeData()
        await self._fill_scope(system, "system")

        plants: dict[str, PlantData] = {}
        for summary in await c.get_plants():
            pid = summary["plant_id"]
            plant = PlantData(
                plant_id=pid,
                name=summary.get("name", pid),
                description=summary.get("description", ""),
                status=summary.get("status", "ok"),
            )
            await self._fill_scope(plant, f"plants/{pid}")
            plant.grow_profile = await self._optional("grow_profile", lambda p=pid: c.get_grow_profile(p)) or {}
            plants[pid] = plant

        return GardenData(garden=garden, preferences=preferences, time=time, system=system, plants=plants)

    async def _fill_scope(self, data: ScopeData, scope: str) -> None:
        data.vitals = {v["type"]: v for v in await self.client.get_vitals(scope)}
        data.actuators = {a["capability"]: a for a in await self.client.get_actuators(scope)}
        if scope not in self._calibration_max:
            self._calibration_max[scope] = await self._calibration_maxima(scope)
        maxima = self._calibration_max[scope]
        if maxima is not None:
            data.actuator_max = maxima
            return
        # Uncalibrated: values are raw, so learn each endpoint's raw format.
        # Modules come and go with hardware, hence every poll.
        data.raw_formats = {
            ep["type"]: ep["format"]
            for module in await self.client.get_modules(scope)
            for ep in module.get("endpoints", [])
            if "type" in ep and "format" in ep
        }

    async def _calibration_maxima(self, scope: str) -> dict[str, float] | None:
        calibrations = await self._optional("hardware_calibration", lambda: self.client.get_hardware_calibration(scope))
        if calibrations is None:
            return None
        maxima: dict[str, float] = {}
        for entry in calibrations:
            curve = (entry.get("calibration") or {}).get("curve") or []
            physical = [p["physical"] for p in curve if isinstance(p.get("physical"), (int, float))]
            if physical:
                maxima[entry["endpoint_type"]] = max(physical)
        return maxima

    async def _maybe_sync_time(self, time: dict[str, Any]) -> dict[str, Any]:
        """§16.6: a Control Panel MAY push its clock when the device has none."""
        if time.get("source") != "none" or not self.config_entry.options.get(CONF_SYNC_TIME, DEFAULT_SYNC_TIME):
            return time
        now = datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")
        _LOGGER.info("Head Device %s has no clock source; setting it to %s", self.config_entry.title, now)
        return await self.client.put_time(now)
