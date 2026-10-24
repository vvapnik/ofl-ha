"""Preferences ``quiet_hours`` (open-farm-link/docs/13-preferences.md §13.2) as two time entities."""

from __future__ import annotations

from datetime import time

from homeassistant.components.time import TimeEntity
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .coordinator import OflConfigEntry, OflCoordinator
from .entity import GARDEN, OflEntity

# Used for the other end when quiet hours are currently unset (null) and one end gets set.
DEFAULTS = {"from": "22:00", "to": "07:00"}


async def async_setup_entry(
    hass: HomeAssistant, entry: OflConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    c = entry.runtime_data
    async_add_entities([QuietHoursTime(c, "from"), QuietHoursTime(c, "to")])


class QuietHoursTime(OflEntity, TimeEntity):
    _attr_entity_category = EntityCategory.CONFIG

    def __init__(self, coordinator: OflCoordinator, end: str) -> None:
        super().__init__(coordinator, GARDEN, "pref", f"quiet_hours_{end}")
        self.end = end
        self._attr_translation_key = f"quiet_hours_{end}"

    @property
    def native_value(self) -> time | None:
        window = self.coordinator.data.preferences.get("quiet_hours")
        if not window or not window.get(self.end):
            return None
        return time.fromisoformat(window[self.end])

    async def async_set_value(self, value: time) -> None:
        prefs = self.coordinator.data.preferences
        window = {**DEFAULTS, **(prefs.get("quiet_hours") or {}), self.end: value.strftime("%H:%M")}
        new_prefs = {**prefs, "quiet_hours": window}
        resp = await self._write(lambda: self.coordinator.client.put_preferences(new_prefs))
        self.coordinator.data.preferences = resp if isinstance(resp, dict) else new_prefs
        self.coordinator.async_update_listeners()
