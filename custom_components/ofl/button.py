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
from homeassistant.core import CALLBACK_TYPE, HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.event import async_call_later

from .api import OflError
from .const import CONF_WATER_SECONDS, DEFAULT_WATER_SECONDS
from .coordinator import OflConfigEntry, OflCoordinator
from .entity import OflEntity, track_entities

VALVE = "valve"


async def async_setup_entry(
    hass: HomeAssistant, entry: OflConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    def build(c: OflCoordinator):
        return {
            pid: (lambda p=pid: WaterNowButton(c, p)) for pid, plant in c.data.plants.items() if VALVE in plant.actuators
        }

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
            if self.plant and isinstance(resp, dict):
                self.plant.actuators[VALVE] = resp
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
