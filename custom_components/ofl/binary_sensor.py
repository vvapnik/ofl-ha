"""Aggregate health (open-farm-link/docs/21-system-fields.md, ``status: ok | problem``)."""

from __future__ import annotations

from homeassistant.components.binary_sensor import BinarySensorDeviceClass, BinarySensorEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .coordinator import OflConfigEntry, OflCoordinator
from .entity import GARDEN, OflEntity, track_entities


async def async_setup_entry(
    hass: HomeAssistant, entry: OflConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    def build(c: OflCoordinator):
        factories = {GARDEN: lambda: ProblemSensor(c, GARDEN)}
        for pid in c.data.plants:
            factories[pid] = lambda p=pid: ProblemSensor(c, p)
        return factories

    track_entities(entry, async_add_entities, build)


class ProblemSensor(OflEntity, BinarySensorEntity):
    _attr_device_class = BinarySensorDeviceClass.PROBLEM
    _attr_translation_key = "status"

    def __init__(self, coordinator: OflCoordinator, scope: str) -> None:
        super().__init__(coordinator, scope, "status", "status")

    @property
    def is_on(self) -> bool | None:
        if self.scope == GARDEN:
            status = self.coordinator.data.garden.get("status")
        else:
            status = self.plant.status if self.plant else None
        return None if status is None else status == "problem"
