"""Polling coordinator — one per Head Device / Garden.

OFL has no push channel (open-farm-link/docs/01-philosophy.md §1.2), so this
polls. All requests of one refresh run sequentially over the client's single
kept-alive connection (§16.3) — no gather(), which would only queue on the
one-slot connector anyway.

Optional parts of the API (Preferences, Grow Profile, Hardware Calibration)
may be missing on simpler firmware: a 404 there means "not supported", the
matching entities are simply not created. In bench mode (no docs/22
security — such firmware is the only kind we know) that is remembered for a
minute, so the device isn't asked on every poll.

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
import os
import time
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


# Settings fields holding a pot's moisture dry/wet points (docs/07 §7.3): the
# Head Device maps the module's raw reading to % between them (docs/06 §6.1).
DRY_RAW = "moisture_dry_raw"
WET_RAW = "moisture_wet_raw"


@dataclass
class MoistureCalibration:
    module_id: str
    settings: dict[str, Any]  # the module's whole Settings entry (PUT replaces it)
    raw: int | None  # current raw reading from Modules, what a "capture" stores

    @property
    def dry(self) -> int | None:
        return self.settings.get(DRY_RAW)

    @property
    def wet(self) -> int | None:
        return self.settings.get(WET_RAW)


LUX_CURVE = "dimmer_lux_curve"


@dataclass
class LightCalibration:
    """A Plant's light module: its PWM -> lux points (docs/07 §7.3) and current PWM."""

    module_id: str
    endpoint: int  # the dimmer endpoint's index, for raw PWM writes while calibrating
    settings: dict[str, Any]
    pwm: float | None  # raw command (0-100 %), what "Add point" pairs with the measured lux

    @property
    def curve(self) -> list[dict[str, float]]:
        return list(self.settings.get(LUX_CURVE) or [])


@dataclass
class PlantData(ScopeData):
    plant_id: str = ""
    name: str = ""
    description: str = ""
    status: str = "ok"
    grow_profile: dict[str, Any] = field(default_factory=dict)
    moisture_cal: MoistureCalibration | None = None  # None: no raw-moisture module
    light_cal: LightCalibration | None = None  # None: no dimmer module


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


def posix_tz(name: str) -> str | None:
    """IANA zone name -> its POSIX TZ rule: the footer line of the TZif file."""
    import zoneinfo

    paths = [os.path.join(base, name) for base in zoneinfo.TZPATH]
    try:
        import tzdata  # bundled with HA when the OS has no zoneinfo

        paths.append(os.path.join(os.path.dirname(tzdata.__file__), "zoneinfo", *name.split("/")))
    except ImportError:
        pass
    for path in paths:
        try:
            with open(path, "rb") as f:
                data = f.read()
        except OSError:
            continue
        footer = data.rstrip(b"\n").rsplit(b"\n", 1)[-1]
        if data.startswith(b"TZif") and footer and not footer.startswith(b"TZif"):
            return footer.decode("ascii")
    return None


UNSUPPORTED_RETRY_S = 60

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
        # Optional endpoints found missing (bench mode only, see module doc):
        # feature -> monotonic time it may be asked again. Not forever: a
        # Plant-scoped path also answers 404 while the Plant is briefly gone
        # (module re-enumeration, reboot), and that must not hide Settings —
        # i.e. both calibrations — until HA restarts.
        self._unsupported: dict[str, float] = {}

    async def _optional[T](self, feature: str, call: Callable[[], Awaitable[T]]) -> T | None:
        """Call an optional endpoint; ``None`` if the device doesn't have it (404)."""
        if self._unsupported.get(feature, 0) > time.monotonic():
            return None
        try:
            return await call()
        except OflApiError as err:
            if err.status != 404:
                raise
            if self.client.insecure:
                _LOGGER.info(
                    "%s: no %s on the device; asking again in %d s",
                    self.config_entry.title, feature, UNSUPPORTED_RETRY_S,
                )
                self._unsupported[feature] = time.monotonic() + UNSUPPORTED_RETRY_S
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
        if preferences is not None:
            preferences = await self._maybe_sync_timezone(preferences)
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
            plant.moisture_cal, plant.light_cal = await self._module_calibrations(f"plants/{pid}")
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

    async def _module_calibrations(
        self, scope: str
    ) -> tuple[MoistureCalibration | None, LightCalibration | None]:
        """Pot dry/wet points and light PWM->lux points, with the raw readings they pair with."""
        entries = await self._optional("settings", lambda: self.client.get_settings(scope))
        if entries is None:
            return None, None
        by_module = {e["module_id"]: dict(e.get("settings") or {}) for e in entries}
        moisture = light = None
        for module in await self.client.get_modules(scope):
            mid = module.get("id")
            for ep in module.get("endpoints", []):
                if ep.get("type") == "moisture" and DRY_RAW in by_module.get(mid, {}):
                    moisture = MoistureCalibration(mid, by_module[mid], ep.get("value"))
                elif ep.get("type") == "dimmer" and light is None:
                    light = LightCalibration(mid, ep.get("index", 0), by_module.get(mid, {}), ep.get("value"))
        return moisture, light

    async def async_set_light_pwm(self, plant_id: str, pwm: float) -> None:
        """Raw PWM, bypassing the lux curve — for measuring calibration points."""
        plant = self.data.plants.get(plant_id)
        cal = plant.light_cal if plant else None
        if cal is None:
            raise OflError(f"plant {plant_id} has no light module")
        async with self.client.batch():
            await self.client.put_endpoint(f"plants/{plant_id}", cal.module_id, cal.endpoint, int(round(pwm)))
        await self.async_refresh()

    async def async_set_light_curve(self, plant_id: str, curve: list[dict[str, float]]) -> None:
        """Replace the light module's PWM->lux points, keeping its other Settings."""
        plant = self.data.plants.get(plant_id)
        cal = plant.light_cal if plant else None
        if cal is None:
            raise OflError(f"plant {plant_id} has no light module")
        settings = {**cal.settings, LUX_CURVE: sorted(curve, key=lambda p: p["command"])}
        async with self.client.batch():
            resp = await self.client.put_settings(f"plants/{plant_id}", cal.module_id, settings)
        cal.settings = dict(resp.get("settings") or settings)
        await self.async_refresh()  # Actuators switch unit and range with the curve

    async def async_set_moisture_points(
        self, plant_id: str, dry: int | None = None, wet: int | None = None
    ) -> None:
        """Write one or both points, keeping the rest of the module's Settings."""
        plant = self.data.plants.get(plant_id)
        cal = plant.moisture_cal if plant else None
        if cal is None:
            raise OflError(f"plant {plant_id} has no raw moisture sensor")
        settings = dict(cal.settings)
        if dry is not None:
            settings[DRY_RAW] = int(dry)
        if wet is not None:
            settings[WET_RAW] = int(wet)
        async with self.client.batch():
            resp = await self.client.put_settings(f"plants/{plant_id}", cal.module_id, settings)
        cal.settings = dict(resp.get("settings") or settings)
        self.async_update_listeners()
        await self.async_request_refresh()  # Vitals change with the points

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

    async def _maybe_sync_timezone(self, preferences: dict[str, Any]) -> dict[str, Any]:
        """Push HA's time zone as a POSIX TZ rule, so quiet hours and the light
        window run in local time on the device. Only for firmware that has the
        ``timezone`` preference; follows the same option as the clock sync."""
        if "timezone" not in preferences or not self.config_entry.options.get(CONF_SYNC_TIME, DEFAULT_SYNC_TIME):
            return preferences
        posix = await self.hass.async_add_executor_job(posix_tz, self.hass.config.time_zone)
        if not posix or preferences.get("timezone") == posix:
            return preferences
        _LOGGER.info("Setting Head Device %s time zone to %s (%s)", self.config_entry.title, posix, self.hass.config.time_zone)
        return await self.client.put_preferences({"timezone": posix})

    async def _maybe_sync_time(self, time: dict[str, Any]) -> dict[str, Any]:
        """§16.6: a Control Panel MAY push its clock when the device has none."""
        if time.get("source") != "none" or not self.config_entry.options.get(CONF_SYNC_TIME, DEFAULT_SYNC_TIME):
            return time
        now = datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")
        _LOGGER.info("Head Device %s has no clock source; setting it to %s", self.config_entry.title, now)
        return await self.client.put_time(now)
