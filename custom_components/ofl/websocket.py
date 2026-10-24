"""Websocket API for the Lovelace card.

``ofl/gardens`` returns each Garden's *structure* — Plants, species, targets,
and which HA entity backs each value. Live values the card reads from
``hass.states`` like any card does, and writes go through ordinary entity
services, so the card never talks OFL itself and never holds a credential.
"""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er

from .const import DOMAIN
from .entity import GARDEN, SYSTEM, unique_id_for


@callback
def async_register(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, ws_gardens)


def _entities(registry: er.EntityRegistry, garden_id: str, scope: str, kinds: dict[str, list[str]]) -> dict[str, str]:
    """``{"<kind>/<key>": entity_id}`` for every entity of this scope that exists."""
    out: dict[str, str] = {}
    for kind_platform, keys in kinds.items():
        kind, platform = kind_platform.split("@")
        for key in keys:
            entity_id = registry.async_get_entity_id(platform, DOMAIN, unique_id_for(garden_id, scope, kind, key))
            if entity_id:
                out[f"{kind}/{key}"] = entity_id
    return out


def _actuator_kinds(actuators: dict[str, dict[str, Any]]) -> dict[str, list[str]]:
    return {"actuator@switch": list(actuators), "actuator@number": list(actuators)}


@websocket_api.websocket_command({vol.Required("type"): "ofl/gardens"})
@callback
def ws_gardens(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    registry = er.async_get(hass)
    gardens = []
    for entry in hass.config_entries.async_loaded_entries(DOMAIN):
        coordinator = entry.runtime_data
        data = coordinator.data
        garden_id = entry.unique_id or ""
        gardens.append(
            {
                "entry_id": entry.entry_id,
                "garden_id": garden_id,
                "name": data.garden.get("name") or entry.title,
                "type": data.garden.get("type"),
                "online": coordinator.last_update_success,
                "entities": _entities(
                    registry,
                    garden_id,
                    GARDEN,
                    {"status@binary_sensor": ["status"], "pref@switch": ["vacation_mode"], "diag@sensor": ["time_source"]},
                ),
                "system": {
                    "vitals": list(data.system.vitals),
                    "entities": _entities(
                        registry,
                        garden_id,
                        SYSTEM,
                        {"vital@sensor": list(data.system.vitals), **_actuator_kinds(data.system.actuators)},
                    ),
                },
                # API list order; the protocol guarantees no physical order (§21.4).
                "plants": [
                    {
                        "plant_id": pid,
                        "name": plant.name,
                        "description": plant.description,
                        "status": plant.status,
                        "species": plant.grow_profile.get("species"),
                        "targets": plant.grow_profile.get("targets", {}),
                        "entities": _entities(
                            registry,
                            garden_id,
                            pid,
                            {
                                "status@binary_sensor": ["status"],
                                "vital@sensor": list(plant.vitals),
                                **_actuator_kinds(plant.actuators),
                                "grow_flag@switch": [k for k in plant.grow_profile if k.endswith("_enabled")],
                                "button@button": ["water_now"],
                            },
                        ),
                    }
                    for pid, plant in data.plants.items()
                ],
            }
        )
    connection.send_result(msg["id"], {"gardens": gardens})
