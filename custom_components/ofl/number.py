"""Non-binary Actuators (dimmer, pump, vibro, ...) as numbers, in physical units (§17.3)."""

from __future__ import annotations

from homeassistant.components.number import NumberEntity, NumberMode
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .const import BINARY_ACTUATOR_UNIT
from .coordinator import OflConfigEntry, OflCoordinator
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
        unit = self.scope_data.actuators[capability].get("unit")
        self._attr_native_unit_of_measurement = UNIT_MAP.get(unit, unit)
        self._attr_native_max_value = self.scope_data.actuator_max.get(capability) or FALLBACK_MAX.get(unit, 100.0)

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
            self.scope_data.actuators[self.key] = resp
        self.coordinator.async_update_listeners()
