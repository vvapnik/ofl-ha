"""Diagnostics — never leak the credential or let a dump pair someone else."""

from __future__ import annotations

from dataclasses import asdict
from typing import Any

from homeassistant.components.diagnostics import async_redact_data
from homeassistant.const import CONF_PASSWORD
from homeassistant.core import HomeAssistant

from .const import CONF_TOKEN
from .coordinator import OflConfigEntry

TO_REDACT = {CONF_TOKEN, CONF_PASSWORD}


async def async_get_config_entry_diagnostics(hass: HomeAssistant, entry: OflConfigEntry) -> dict[str, Any]:
    data = entry.runtime_data.data
    return {
        "entry": async_redact_data(dict(entry.data), TO_REDACT),
        "options": dict(entry.options),
        "garden": data.garden,
        "preferences": data.preferences,
        "time": data.time,
        "system": asdict(data.system),
        "plants": {pid: asdict(p) for pid, p in data.plants.items()},
    }
