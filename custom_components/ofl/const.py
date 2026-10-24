"""Constants for the Open Farm Link integration."""

from __future__ import annotations

from datetime import timedelta
from typing import Final

DOMAIN: Final = "ofl"

CONF_FINGERPRINT: Final = "fingerprint"  # "sha256//<base64 SPKI hash>", docs/22-security.md §22.2
CONF_GARDEN_ID: Final = "garden_id"
CONF_CLIENT_ID: Final = "client_id"
CONF_TOKEN: Final = "token"
CONF_AUTH_METHOD: Final = "auth_method"  # "token" | "password"
CONF_WATER_SECONDS: Final = "water_seconds"
CONF_SYNC_TIME: Final = "sync_time"

DEFAULT_PORT: Final = 443  # docs/16-rest-api.md §16.1
DEFAULT_SCAN_INTERVAL: Final = timedelta(seconds=30)
DEFAULT_WATER_SECONDS: Final = 5
DEFAULT_SYNC_TIME: Final = True

# Name this integration's own credential carries on the Head Device
# (visible in GET /garden/clients, §22.6).
CLIENT_NAME: Final = "Home Assistant"

ZEROCONF_TYPE: Final = "_ofl._tcp.local."

# Capability Catalog (open-farm-link/docs/20-capability-catalog.md §20.2):
# actuators whose unit is "binary" become switches; the rest become numbers.
BINARY_ACTUATOR_UNIT: Final = "binary"

FRONTEND_URL_BASE: Final = "/ofl_static"
CARD_FILENAME: Final = "ofl-garden-card.js"
