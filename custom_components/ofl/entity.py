"""Shared entity plumbing.

Device layout: the Head Device / Garden is one HA device (System's shared
resources hang off it too — there is exactly one System per Garden, §10);
every Plant is its own device ``via_device`` the Garden.

Plants appear and disappear with hardware (docs/16-rest-api.md §16.1), and a
Plant's Vitals/Actuators only list what's currently available (§4.2, §17.2),
so entities are added dynamically as new keys show up in coordinator data
and go unavailable when their key disappears.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Iterable
from typing import Any

from homeassistant.core import callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity import Entity
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .api import OflError
from .const import DOMAIN
from .coordinator import GardenData, OflConfigEntry, OflCoordinator, PlantData, ScopeData

GARDEN = "garden"
SYSTEM = "system"


def plant_device_identifier(garden_id: str, plant_id: str) -> str:
    return f"{garden_id}:plant:{plant_id}"


def unique_id_for(garden_id: str, scope: str, kind: str, key: str) -> str:
    """Stable ``unique_id``: also what websocket.py uses to find entities for the card."""
    return f"{garden_id}_{scope}_{kind}_{key}"


class OflEntity(CoordinatorEntity[OflCoordinator]):
    """``scope`` is GARDEN, SYSTEM, or a plant_id."""

    _attr_has_entity_name = True

    def __init__(self, coordinator: OflCoordinator, scope: str, kind: str, key: str) -> None:
        super().__init__(coordinator)
        self.scope = scope
        self.key = key
        garden_id = coordinator.config_entry.unique_id or ""
        self._attr_unique_id = unique_id_for(garden_id, scope, kind, key)
        if scope in (GARDEN, SYSTEM):
            garden = coordinator.data.garden
            self._attr_device_info = DeviceInfo(
                identifiers={(DOMAIN, garden_id)},
                name=garden.get("name") or f"Garden {garden_id}",
                manufacturer="Open Farm Link",
                model=f"Head Device ({garden.get('type', 'unknown')})",
                sw_version=f"OFL {garden.get('protocol_version', '?')}",
                serial_number=garden_id,
            )
        else:
            plant = coordinator.data.plants[scope]
            self._attr_device_info = DeviceInfo(
                identifiers={(DOMAIN, plant_device_identifier(garden_id, scope))},
                name=plant.name,
                manufacturer="Open Farm Link",
                model=f"Plant ({plant.grow_profile.get('species') or 'unknown species'})",
                via_device=(DOMAIN, garden_id),
            )

    @property
    def scope_path(self) -> str:
        """API path segment for this scope's sub-resources (§16.5)."""
        return SYSTEM if self.scope == SYSTEM else f"plants/{self.scope}"

    @property
    def scope_data(self) -> ScopeData | None:
        data = self.coordinator.data
        if self.scope == SYSTEM:
            return data.system
        return data.plants.get(self.scope)

    @property
    def plant(self) -> PlantData | None:
        return self.coordinator.data.plants.get(self.scope)

    @property
    def available(self) -> bool:
        return super().available and (self.scope == GARDEN or self.scope_data is not None)

    async def _write(self, call: Callable[[], Awaitable[Any]]) -> Any:
        try:
            async with self.coordinator.client.batch():
                return await call()
        except OflError as err:
            raise HomeAssistantError(f"Head Device rejected the change: {err}") from err


def scopes(data: GardenData) -> Iterable[tuple[str, ScopeData]]:
    """System plus every Plant — the scopes sharing the vitals/actuators shape."""
    yield SYSTEM, data.system
    yield from data.plants.items()


def track_entities(
    entry: OflConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
    build: Callable[[OflCoordinator], dict[str, Callable[[], Entity]]],
) -> None:
    """Add entities for keys present in coordinator data, now and on every later poll.

    ``build`` maps a unique key to a factory, so entities are only constructed
    for keys not seen before.
    """
    coordinator = entry.runtime_data
    known: set[str] = set()

    @callback
    def _add_new() -> None:
        factories = build(coordinator)
        new = [factory() for key, factory in factories.items() if key not in known]
        known.update(factories)
        if new:
            async_add_entities(new)

    _add_new()
    entry.async_on_unload(coordinator.async_add_listener(_add_new))
