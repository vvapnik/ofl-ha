"""Non-binary Actuators (dimmer, pump, vibro, ...) as numbers, in physical units (§17.3)."""

from __future__ import annotations

from homeassistant.components.number import NumberEntity, NumberMode, RestoreNumber
from homeassistant.const import LIGHT_LUX, EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .api import OflError
from .const import BINARY_ACTUATOR_UNIT
from .coordinator import OflConfigEntry, OflCoordinator, raw_unit
from .entity import OflEntity, scopes, track_entities
from .sensor import UNIT_MAP

# Without a Hardware Calibration curve there is no known maximum for an
# open-ended physical unit like lux; this only bounds the slider.
FALLBACK_MAX = {"percent": 100.0, "lux": 10000.0}


async def async_setup_entry(
    hass: HomeAssistant, entry: OflConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    def build(c: OflCoordinator):
        factories = {}
        for scope, data in scopes(c.data):
            for cap, act in data.actuators.items():
                if act.get("unit") != BINARY_ACTUATOR_UNIT:
                    factories[f"{scope}/{cap}"] = lambda s=scope, k=cap: ActuatorNumber(c, s, k)
        for pid, plant in c.data.plants.items():
            if plant.moisture_cal is not None:
                for point in ("dry", "wet"):
                    factories[f"{pid}/moisture_{point}_raw"] = lambda p=pid, k=point: MoisturePointNumber(c, p, k)
            if plant.light_cal is not None:
                factories[f"{pid}/measured_lux"] = lambda p=pid: MeasuredLuxNumber(c, p)
                factories[f"{pid}/light_pwm"] = lambda p=pid: LightPwmNumber(c, p)
        return factories

    track_entities(entry, async_add_entities, build)


class ActuatorNumber(OflEntity, NumberEntity):
    _attr_mode = NumberMode.SLIDER
    _attr_native_min_value = 0
    _attr_native_step = 1

    def __init__(self, coordinator: OflCoordinator, scope: str, capability: str) -> None:
        super().__init__(coordinator, scope, "actuator", capability)
        self._attr_translation_key = capability if capability in ("dimmer", "pump", "vibro") else "actuator"
        self._attr_translation_placeholders = {"capability": capability}

    def _entry(self) -> dict:
        return (self.scope_data.actuators.get(self.key) if self.scope_data else None) or {}

    def _raw(self) -> tuple[str | None, float | None]:
        return raw_unit(self.scope_data, self.key, self._entry().get("unit"))

    # Unit and range come from the device on every poll: a light switches
    # from percent PWM to lux (with the measured range) once calibrated.
    @property
    def native_unit_of_measurement(self) -> str | None:
        unit, _ = self._raw()
        return UNIT_MAP.get(unit, unit)

    @property
    def native_min_value(self) -> float:
        return float(self._entry().get("min", 0))

    @property
    def native_max_value(self) -> float:
        entry = self._entry()
        if "max" in entry:
            return float(entry["max"])
        unit, raw_max = self._raw()
        return self.scope_data.actuator_max.get(self.key) or raw_max or FALLBACK_MAX.get(unit, 100.0)

    @property
    def available(self) -> bool:
        return super().available and self.key in self.scope_data.actuators

    @property
    def native_value(self) -> float | None:
        act = self.scope_data.actuators.get(self.key) if self.scope_data else None
        return None if act is None else float(act["value"])

    async def async_set_native_value(self, value: float) -> None:
        payload = int(value) if value.is_integer() else value
        resp = await self._write(lambda: self.coordinator.client.put_actuator(self.scope_path, self.key, payload))
        if isinstance(resp, dict) and "value" in resp:
            # Merge: a device may answer with just {capability, value}.
            self.scope_data.actuators[self.key] = {**self.scope_data.actuators[self.key], **resp}
        self.coordinator.async_update_listeners()
        if self.plant is not None and self.plant.light_cal is not None and self.key == "dimmer":
            await self.coordinator.async_request_refresh()  # raw PWM changed too


class MoisturePointNumber(OflEntity, NumberEntity):
    """A pot's dry/wet point in raw sensor units (OGR Raw16), for manual edits."""

    _attr_entity_category = EntityCategory.CONFIG
    _attr_mode = NumberMode.BOX
    _attr_native_min_value = 0
    _attr_native_max_value = 65535
    _attr_native_step = 1

    def __init__(self, coordinator: OflCoordinator, plant_id: str, point: str) -> None:
        super().__init__(coordinator, plant_id, "number", f"moisture_{point}_raw")
        self._point = point
        self._attr_translation_key = f"moisture_{point}_raw"

    @property
    def available(self) -> bool:
        return super().available and self.plant.moisture_cal is not None

    @property
    def native_value(self) -> float | None:
        cal = self.plant.moisture_cal if self.plant else None
        value = getattr(cal, self._point) if cal else None
        return None if value is None else float(value)

    async def async_set_native_value(self, value: float) -> None:
        try:
            await self.coordinator.async_set_moisture_points(self.scope, **{self._point: int(value)})
        except OflError as err:
            raise HomeAssistantError(f"Head Device rejected the calibration: {err}") from err


class MeasuredLuxNumber(OflEntity, RestoreNumber):
    """Lux meter reading typed in by the user; "Add light calibration point"
    pairs it with the light's current PWM. Kept in HA only (restored on restart)."""

    _attr_entity_category = EntityCategory.CONFIG
    _attr_mode = NumberMode.BOX
    _attr_native_min_value = 0
    _attr_native_max_value = 200000
    _attr_native_step = 1
    _attr_native_unit_of_measurement = LIGHT_LUX
    _attr_translation_key = "measured_lux"

    def __init__(self, coordinator: OflCoordinator, plant_id: str) -> None:
        super().__init__(coordinator, plant_id, "number", "measured_lux")
        self._attr_native_value: float | None = None

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        if (last := await self.async_get_last_number_data()) is not None:
            self._attr_native_value = last.native_value

    @property
    def available(self) -> bool:
        return super().available and self.plant.light_cal is not None

    @property
    def native_value(self) -> float | None:
        return self._attr_native_value

    async def async_set_native_value(self, value: float) -> None:
        self._attr_native_value = value
        self.async_write_ha_state()


class LightPwmNumber(OflEntity, NumberEntity):
    """Raw light PWM (0-100 %) written straight to the module, bypassing the lux
    curve — set it, measure, then "Add light calibration point"."""

    _attr_entity_category = EntityCategory.CONFIG
    _attr_mode = NumberMode.BOX
    _attr_native_min_value = 0
    _attr_native_max_value = 100
    _attr_native_step = 1
    _attr_native_unit_of_measurement = "%"
    _attr_translation_key = "light_pwm"

    def __init__(self, coordinator: OflCoordinator, plant_id: str) -> None:
        super().__init__(coordinator, plant_id, "number", "light_pwm")

    @property
    def available(self) -> bool:
        return super().available and self.plant.light_cal is not None

    @property
    def native_value(self) -> float | None:
        cal = self.plant.light_cal if self.plant else None
        return None if cal is None or cal.pwm is None else float(cal.pwm)

    @property
    def extra_state_attributes(self) -> dict:
        cal = self.plant.light_cal if self.plant else None
        return {"calibration_points": cal.curve if cal else []}

    async def async_set_native_value(self, value: float) -> None:
        try:
            await self.coordinator.async_set_light_pwm(self.scope, value)
        except OflError as err:
            raise HomeAssistantError(f"Head Device rejected the change: {err}") from err
