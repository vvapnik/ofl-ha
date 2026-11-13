"""'Water now' — open a Plant's valve for a few seconds.

The Actuators API has no duration (docs/17-actuators.md: ``PUT {value}``
only), so the close is timed here in Home Assistant. If HA dies mid-pulse,
nothing closes the valve until a Scenario or a person does — the closing
write is attempted on unload, but a crash skips that. A device-side
``duration_s`` on Actuator writes (like Scenario actions already have,
§11.4) would remove this gap; flagged in the integration README.
"""

from __future__ import annotations

from homeassistant.components.button import ButtonEntity
from homeassistant.const import EntityCategory
from homeassistant.core import CALLBACK_TYPE, HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.event import async_call_later

from .api import OflError
from .const import CONF_WATER_SECONDS, DEFAULT_WATER_SECONDS, DOMAIN
from .coordinator import OflConfigEntry, OflCoordinator
from .entity import OflEntity, track_entities

VALVE = "valve"


async def async_setup_entry(
    hass: HomeAssistant, entry: OflConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    def build(c: OflCoordinator):
        factories = {
            pid: (lambda p=pid: WaterNowButton(c, p)) for pid, plant in c.data.plants.items() if VALVE in plant.actuators
        }
        for pid, plant in c.data.plants.items():
            if plant.moisture_cal is not None:
                for point in ("dry", "wet"):
                    factories[f"{pid}/calibrate_{point}"] = lambda p=pid, k=point: CalibrateMoistureButton(c, p, k)
            if plant.light_cal is not None:
                factories[f"{pid}/light_cal_add"] = lambda p=pid: AddLightPointButton(c, p)
                factories[f"{pid}/light_cal_reset"] = lambda p=pid: ResetLightCalibrationButton(c, p)
        return factories

    track_entities(entry, async_add_entities, build)


class WaterNowButton(OflEntity, ButtonEntity):
    _attr_translation_key = "water_now"

    def __init__(self, coordinator: OflCoordinator, plant_id: str) -> None:
        super().__init__(coordinator, plant_id, "button", "water_now")
        self._cancel_close: CALLBACK_TYPE | None = None

    @property
    def available(self) -> bool:
        return super().available and VALVE in self.plant.actuators

    @property
    def extra_state_attributes(self) -> dict[str, bool]:
        return {"watering": self._cancel_close is not None}

    async def async_press(self) -> None:
        seconds = self.coordinator.config_entry.options.get(CONF_WATER_SECONDS, DEFAULT_WATER_SECONDS)
        await self._write(lambda: self.coordinator.client.put_actuator(self.scope_path, VALVE, 1))
        self.plant.actuators[VALVE] = {**self.plant.actuators[VALVE], "value": 1}
        if self._cancel_close:
            self._cancel_close()
        self._cancel_close = async_call_later(self.hass, seconds, self._close)
        self.coordinator.async_update_listeners()

    async def _close(self, _now=None) -> None:
        self._cancel_close = None
        try:
            async with self.coordinator.client.batch():
                resp = await self.coordinator.client.put_actuator(self.scope_path, VALVE, 0)
            if self.plant and isinstance(resp, dict) and VALVE in self.plant.actuators:
                self.plant.actuators[VALVE] = {**self.plant.actuators[VALVE], **resp}
        except OflError:
            # Don't leave water running on a transient failure: keep retrying.
            self._cancel_close = async_call_later(self.hass, 5, self._close)
        self.coordinator.async_update_listeners()

    async def async_will_remove_from_hass(self) -> None:
        if self._cancel_close:
            self._cancel_close()
            await self._close()
            if self._cancel_close:  # retry got scheduled; we're going away
                self._cancel_close()
                self._cancel_close = None


class CalibrateMoistureButton(OflEntity, ButtonEntity):
    """Store the pot's current raw moisture reading as its dry (in air) or wet
    (in water) point — the Head Device maps raw to % between them."""

    _attr_entity_category = EntityCategory.CONFIG

    def __init__(self, coordinator: OflCoordinator, plant_id: str, point: str) -> None:
        super().__init__(coordinator, plant_id, "button", f"calibrate_{point}")
        self._point = point
        self._attr_translation_key = f"calibrate_{point}"

    @property
    def available(self) -> bool:
        return super().available and self.plant.moisture_cal is not None

    async def async_press(self) -> None:
        # Fresh reading, not the one from the last poll (up to 30 s old).
        await self.coordinator.async_refresh()
        cal = self.plant.moisture_cal if self.plant else None
        if cal is None or cal.raw is None:
            raise HomeAssistantError("No raw moisture reading from the pot right now")
        try:
            await self.coordinator.async_set_moisture_points(
                self.scope, **{self._point: cal.raw}
            )
        except OflError as err:
            raise HomeAssistantError(f"Head Device rejected the calibration: {err}") from err


class AddLightPointButton(OflEntity, ButtonEntity):
    """Pair the light's current PWM with the lux typed into "Measured lux"
    and add it to the curve (replacing a point at the same PWM)."""

    _attr_entity_category = EntityCategory.CONFIG
    _attr_translation_key = "light_cal_add"

    def __init__(self, coordinator: OflCoordinator, plant_id: str) -> None:
        super().__init__(coordinator, plant_id, "button", "light_cal_add")

    @property
    def available(self) -> bool:
        return super().available and self.plant.light_cal is not None

    async def async_press(self) -> None:
        from homeassistant.helpers import entity_registry as er

        from .entity import unique_id_for

        uid = unique_id_for(self._garden_id, self.scope, "number", "measured_lux")
        entity_id = er.async_get(self.hass).async_get_entity_id("number", DOMAIN, uid)
        state = self.hass.states.get(entity_id) if entity_id else None
        try:
            lux = float(state.state)
        except (AttributeError, TypeError, ValueError):
            raise HomeAssistantError("Enter the lux meter reading in \"Measured lux\" first") from None
        await self.coordinator.async_refresh()
        cal = self.plant.light_cal if self.plant else None
        if cal is None or cal.pwm is None:
            raise HomeAssistantError("No PWM reading from the light module right now")
        curve = [p for p in cal.curve if p["command"] != cal.pwm] + [{"command": cal.pwm, "lux": lux}]
        try:
            await self.coordinator.async_set_light_curve(self.scope, curve)
        except OflError as err:
            raise HomeAssistantError(
                f"Head Device rejected the point (lux must rise with PWM, up to 8 points): {err}"
            ) from err


class ResetLightCalibrationButton(OflEntity, ButtonEntity):
    """Clear the PWM->lux curve: the light slider goes back to raw 0-100 % PWM."""

    _attr_entity_category = EntityCategory.CONFIG
    _attr_translation_key = "light_cal_reset"

    def __init__(self, coordinator: OflCoordinator, plant_id: str) -> None:
        super().__init__(coordinator, plant_id, "button", "light_cal_reset")

    @property
    def available(self) -> bool:
        return super().available and self.plant.light_cal is not None

    async def async_press(self) -> None:
        try:
            await self.coordinator.async_set_light_curve(self.scope, [])
        except OflError as err:
            raise HomeAssistantError(f"Head Device rejected the change: {err}") from err
