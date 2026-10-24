"""Vitals (open-farm-link/docs/04-vitals.md) as sensors, plus the device clock source."""

from __future__ import annotations

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorStateClass
from homeassistant.const import PERCENTAGE, EntityCategory, LIGHT_LUX, UnitOfLength, UnitOfMass, UnitOfTemperature
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .coordinator import OflConfigEntry, OflCoordinator
from .entity import GARDEN, OflEntity, scopes, track_entities

# Capability Catalog sensor keys (docs/20-capability-catalog.md §20.1).
VITAL_DEVICE_CLASS: dict[str, SensorDeviceClass] = {
    "moisture": SensorDeviceClass.MOISTURE,
    "temp": SensorDeviceClass.TEMPERATURE,
    "humidity": SensorDeviceClass.HUMIDITY,
    "light": SensorDeviceClass.ILLUMINANCE,
    "weight": SensorDeviceClass.WEIGHT,
    "distance": SensorDeviceClass.DISTANCE,
}

# OFL carries the unit explicitly per entry (§4.2); map the catalog's names to HA's.
UNIT_MAP: dict[str, str] = {
    "percent": PERCENTAGE,
    "celsius": UnitOfTemperature.CELSIUS,
    "lux": LIGHT_LUX,
    "gram": UnitOfMass.GRAMS,
    "millimeter": UnitOfLength.MILLIMETERS,
}


async def async_setup_entry(
    hass: HomeAssistant, entry: OflConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    def build(c: OflCoordinator):
        factories = {"time_source": lambda: TimeSourceSensor(c)}
        for scope, data in scopes(c.data):
            for vtype in data.vitals:
                factories[f"{scope}/{vtype}"] = lambda s=scope, t=vtype: VitalSensor(c, s, t)
        return factories

    track_entities(entry, async_add_entities, build)


class VitalSensor(OflEntity, SensorEntity):
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(self, coordinator: OflCoordinator, scope: str, vital_type: str) -> None:
        super().__init__(coordinator, scope, "vital", vital_type)
        self._attr_translation_key = vital_type if vital_type in VITAL_DEVICE_CLASS or vital_type == "water_level" else "vital"
        self._attr_translation_placeholders = {"type": vital_type}
        self._attr_device_class = VITAL_DEVICE_CLASS.get(vital_type)
        unit = (self.scope_data.vitals.get(vital_type) or {}).get("unit") if self.scope_data else None
        self._attr_native_unit_of_measurement = UNIT_MAP.get(unit, unit)

    @property
    def available(self) -> bool:
        return super().available and self.key in self.scope_data.vitals

    @property
    def native_value(self) -> float | None:
        entry = self.scope_data.vitals.get(self.key) if self.scope_data else None
        return entry["value"] if entry else None


class TimeSourceSensor(OflEntity, SensorEntity):
    """docs/16-rest-api.md §16.6 — ``none`` means time-window Scenarios can't evaluate."""

    _attr_device_class = SensorDeviceClass.ENUM
    _attr_options = ["ntp", "manual", "none"]
    _attr_entity_category = EntityCategory.DIAGNOSTIC
    _attr_translation_key = "time_source"

    def __init__(self, coordinator: OflCoordinator) -> None:
        super().__init__(coordinator, GARDEN, "diag", "time_source")

    @property
    def native_value(self) -> str | None:
        return self.coordinator.data.time.get("source")
