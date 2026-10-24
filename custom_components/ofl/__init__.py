"""Open Farm Link — Home Assistant as an OFL Control Panel.

One config entry per Head Device (= one Garden, open-farm-link/docs/12-garden.md
§12.2). Talks the local HTTPS binding directly; see api.py for the transport
rules and coordinator.py for polling.
"""

from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.const import CONF_HOST, CONF_PASSWORD, CONF_PORT, CONF_USERNAME, Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.typing import ConfigType

from . import websocket
from .api import OflClient, OflError
from .const import CARD_FILENAME, CONF_CLIENT_ID, CONF_FINGERPRINT, CONF_TOKEN, DOMAIN, FRONTEND_URL_BASE
from .coordinator import OflConfigEntry, OflCoordinator

_LOGGER = logging.getLogger(__name__)

PLATFORMS = [
    Platform.BINARY_SENSOR,
    Platform.BUTTON,
    Platform.NUMBER,
    Platform.SENSOR,
    Platform.SWITCH,
    Platform.TIME,
]

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Serve the Lovelace card from the integration itself and load it on every dashboard."""
    websocket.async_register(hass)
    # Both are always loaded in a real install (default_config); a bare
    # test harness has neither the frontend nor its extra-module registry.
    if hass.http is not None and "frontend" in hass.config.components:
        frontend_dir = Path(__file__).parent / "frontend"
        await hass.http.async_register_static_paths(
            [StaticPathConfig(FRONTEND_URL_BASE, str(frontend_dir), cache_headers=False)]
        )
        add_extra_js_url(hass, f"{FRONTEND_URL_BASE}/{CARD_FILENAME}")
    return True


def _client_for(entry: OflConfigEntry) -> OflClient:
    d = entry.data
    return OflClient(
        d[CONF_HOST],
        d[CONF_PORT],
        fingerprint=d[CONF_FINGERPRINT],
        token=d.get(CONF_TOKEN),
        username=d.get(CONF_USERNAME),
        password=d.get(CONF_PASSWORD),
    )


async def async_setup_entry(hass: HomeAssistant, entry: OflConfigEntry) -> bool:
    client = _client_for(entry)
    coordinator = OflCoordinator(hass, entry, client)
    try:
        await coordinator.async_config_entry_first_refresh()
    except Exception:
        await client.close()
        raise
    entry.runtime_data = coordinator
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_async_reload_on_options))
    return True


async def _async_reload_on_options(hass: HomeAssistant, entry: OflConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: OflConfigEntry) -> bool:
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        await entry.runtime_data.client.close()
    return unloaded


async def async_remove_entry(hass: HomeAssistant, entry: OflConfigEntry) -> None:
    """Free our credential slot on the device (§22.6) — best effort, the device may be gone."""
    client_id = entry.data.get(CONF_CLIENT_ID)
    if not client_id:
        return
    client = _client_for(entry)
    try:
        await client.delete_client(client_id)
        _LOGGER.info("Revoked Home Assistant's credential %s on %s", client_id, entry.title)
    except OflError as err:
        _LOGGER.warning("Could not revoke credential %s on %s: %s", client_id, entry.title, err)
    finally:
        await client.close()


async def async_remove_config_entry_device(
    hass: HomeAssistant, entry: OflConfigEntry, device: dr.DeviceEntry
) -> bool:
    """Allow removing a Plant device only once the Plant is gone from the Garden.

    Plants come and go with hardware (docs/16-rest-api.md §16.1); the API can't delete one.
    """
    data = entry.runtime_data.data
    for domain, identifier in device.identifiers:
        if domain != DOMAIN:
            continue
        _, _, plant_id = identifier.partition(":plant:")
        if plant_id and plant_id not in data.plants:
            return True
    return False
