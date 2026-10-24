"""Switches: binary Actuators, Grow Profile ``*_enabled`` flags, vacation mode."""

from __future__ import annotations

from typing import Any

from homeassistant.components.switch import SwitchEntity
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .const import BINARY_ACTUATOR_UNIT
from .coordinator import OflConfigEntry, OflCoordinator
from .entity import GARDEN, OflEntity, scopes, track_entities


async def async_setup_entry(
    hass: HomeAssistant, entry: OflConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback
) -> None:
    def build(c: OflCoordinator):
        factories = {"vacation_mode": lambda: VacationModeSwitch(c)}
        for scope, data in scopes(c.data):
            for cap, act in data.actuators.items():
                if act.get("unit") == BINARY_ACTUATOR_UNIT:
                    factories[f"{scope}/act/{cap}"] = lambda s=scope, k=cap: ActuatorSwitch(c, s, k)
        for pid, plant in c.data.plants.items():
            for flag, value in plant.grow_profile.items():
                if flag.endswith("_enabled") and isinstance(value, bool):
                    factories[f"{pid}/flag/{flag}"] = lambda p=pid, f=flag: GrowFlagSwitch(c, p, f)
        return factories

    track_entities(entry, async_add_entities, build)


class ActuatorSwitch(OflEntity, SwitchEntity):
    """A binary Actuator (docs/17-actuators.md): relay, valve, light_switch, ..."""

    def __init__(self, coordinator: OflCoordinator, scope: str, capability: str) -> None:
        super().__init__(coordinator, scope, "actuator", capability)
        self._attr_translation_key = capability if capability in ("relay", "valve", "light_switch") else "actuator"
        self._attr_translation_placeholders = {"capability": capability}

    @property
    def available(self) -> bool:
        return super().available and self.key in self.scope_data.actuators

    @property
    def is_on(self) -> bool | None:
        act = self.scope_data.actuators.get(self.key) if self.scope_data else None
        return None if act is None else bool(act["value"])

    async def _set(self, value: int) -> None:
        resp = await self._write(lambda: self.coordinator.client.put_actuator(self.scope_path, self.key, value))
        if isinstance(resp, dict) and "value" in resp:
            self.scope_data.actuators[self.key] = resp
        self.coordinator.async_update_listeners()

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self._set(1)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self._set(0)


class GrowFlagSwitch(OflEntity, SwitchEntity):
    """One generic-Scenario category on/off (docs/08-grow-profile.md §8.3)."""

    _attr_entity_category = EntityCategory.CONFIG

    def __init__(self, coordinator: OflCoordinator, plant_id: str, flag: str) -> None:
        super().__init__(coordinator, plant_id, "grow_flag", flag)
        known = ("watering_enabled", "lighting_enabled", "climate_enabled")
        self._attr_translation_key = flag if flag in known else "grow_flag"
        self._attr_translation_placeholders = {"category": flag.removesuffix("_enabled")}

    @property
    def is_on(self) -> bool | None:
        return self.plant.grow_profile.get(self.key) if self.plant else None

    async def _set(self, value: bool) -> None:
        profile = {**self.plant.grow_profile, self.key: value}
        resp = await self._write(lambda: self.coordinator.client.put_grow_profile(self.scope, profile))
        self.plant.grow_profile = resp if isinstance(resp, dict) and self.key in resp else profile
        self.coordinator.async_update_listeners()

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self._set(True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self._set(False)


class VacationModeSwitch(OflEntity, SwitchEntity):
    """docs/13-preferences.md ``vacation_mode``."""

    _attr_entity_category = EntityCategory.CONFIG
    _attr_translation_key = "vacation_mode"

    def __init__(self, coordinator: OflCoordinator) -> None:
        super().__init__(coordinator, GARDEN, "pref", "vacation_mode")

    @property
    def is_on(self) -> bool | None:
        return self.coordinator.data.preferences.get("vacation_mode")

    async def _set(self, value: bool) -> None:
        prefs = {**self.coordinator.data.preferences, "vacation_mode": value}
        resp = await self._write(lambda: self.coordinator.client.put_preferences(prefs))
        self.coordinator.data.preferences = resp if isinstance(resp, dict) else prefs
        self.coordinator.async_update_listeners()

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self._set(True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self._set(False)
