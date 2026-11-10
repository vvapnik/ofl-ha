"""Bench mode: firmware without docs/22 security (open-farm-link-esp32 as of 2026-11).

The fake device below answers the way that firmware does (captured from the
real rig on 2026-11-10): plain HTTP, no auth, no TXT ``pair=``, ``garden_id``
from the MAC, 404 on Preferences / Grow Profile / Hardware Calibration,
raw endpoint values under the catalog unit, and an Actuators PUT that
answers with only ``{capability, value}``.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from ipaddress import ip_address
import socket

from aiohttp import web
import pytest

from homeassistant.config_entries import SOURCE_USER, SOURCE_ZEROCONF, ConfigEntryState
from homeassistant.const import CONF_HOST, CONF_PORT
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.helpers.service_info.zeroconf import ZeroconfServiceInfo

from custom_components.ofl.const import CONF_GARDEN_ID, CONF_INSECURE, DOMAIN

GARDEN_ID = "garden-f07bb0f7a608"
PLANT = "plant-9dd48a0f"


@dataclass
class FakeFirmware:
    port: int = 0
    valve: int = 0
    dimmer: int = 25
    moisture: int = 8981
    requests: list[tuple[str, str, str | None]] = field(default_factory=list)  # method, path, Authorization

    def count(self, path: str) -> int:
        return sum(1 for _, p, _ in self.requests if p == path)

    def app(self) -> web.Application:
        @web.middleware
        async def log(request: web.Request, handler):
            self.requests.append((request.method, request.path, request.headers.get("Authorization")))
            return await handler(request)

        app = web.Application(middlewares=[log])
        ok = web.json_response

        def get(path: str, respond) -> None:
            async def handler(request: web.Request) -> web.Response:
                return respond(request)

            app.router.add_get(path, handler)

        async def not_found(_request: web.Request) -> web.Response:
            return web.json_response({"error": "not_found"}, status=404)

        get(
            "/garden",
            lambda _r: ok(
                {
                    "garden_id": GARDEN_ID,
                    "name": "Real Reack",
                    "description": "Real test rig",
                    "protocol_version": "0.1",
                    "type": "ogr",
                    "status": "ok",
                    "plant_ids": [PLANT],
                }
            ),
        )
        get("/garden/time", lambda _r: ok({"time": "2026-11-10T09:46:45Z", "source": "ntp"}))
        get(
            "/garden/plants", lambda _r: ok([{"plant_id": PLANT, "name": PLANT, "description": "", "status": "ok"}])
        )
        get("/garden/system/vitals", lambda _r: ok({"vitals": []}))
        get("/garden/system/actuators", lambda _r: ok({"actuators": []}))
        get("/garden/system/modules", lambda _r: ok({"modules": []}))
        get(
            f"/garden/plants/{PLANT}/vitals",
            lambda _r: ok({"vitals": [{"type": "moisture", "value": self.moisture, "unit": "percent"}]}),
        )
        get(
            f"/garden/plants/{PLANT}/actuators",
            lambda _r: ok(
                {
                    "actuators": [
                        {"capability": "valve", "value": self.valve, "unit": "binary"},
                        {"capability": "dimmer", "value": self.dimmer, "unit": "lux"},
                    ]
                }
            ),
        )
        get(
            f"/garden/plants/{PLANT}/modules",
            lambda _r: ok(
                {
                    "modules": [
                        {
                            "id": "0x09",
                            "class": "plant_container",
                            "is_anchor": True,
                            "blueprint_id": "0x00000000",
                            "endpoints": [
                                {"index": 0, "type": "moisture", "mode": "read", "format": "raw16", "value": self.moisture},
                                {"index": 1, "type": "valve", "mode": "rw", "format": "binary", "value": self.valve},
                            ],
                        },
                        {
                            "id": "0x0A",
                            "class": "light",
                            "is_anchor": False,
                            "blueprint_id": "0x00000000",
                            "endpoints": [
                                {"index": 0, "type": "dimmer", "mode": "rw", "format": "percent", "value": self.dimmer}
                            ],
                        },
                    ]
                }
            ),
        )

        async def put_actuator(request: web.Request) -> web.Response:
            cap = request.match_info["cap"]
            value = int((await request.json())["value"])
            if cap not in ("valve", "dimmer"):
                return web.json_response({"error": "not_found"}, status=404)
            setattr(self, cap, value)
            return ok({"capability": cap, "value": value})

        app.router.add_put(f"/garden/plants/{PLANT}/actuators/{{cap}}", put_actuator)
        app.router.add_route("*", "/{tail:.*}", not_found)
        return app


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture
async def fake_firmware(socket_enabled) -> AsyncIterator[FakeFirmware]:
    device = FakeFirmware(port=_free_port())
    runner = web.AppRunner(device.app())
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", device.port)
    await site.start()
    yield device
    await runner.cleanup()


def _zeroconf(port: int) -> ZeroconfServiceInfo:
    return ZeroconfServiceInfo(
        ip_address=ip_address("127.0.0.1"),
        ip_addresses=[ip_address("127.0.0.1")],
        hostname="ofl-peer1.local.",
        name="ofl-peer1._ofl._tcp.local.",
        port=port,
        type="_ofl._tcp.local.",
        properties={"garden_id": GARDEN_ID},  # no pair= — firmware without security
    )


async def _add_via_zeroconf(hass: HomeAssistant, device: FakeFirmware):
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_ZEROCONF}, data=_zeroconf(device.port)
    )
    assert result["type"] is FlowResultType.FORM and result["step_id"] == "insecure_confirm", result
    assert result["description_placeholders"]["name"] == "Real Reack"
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    await hass.async_block_till_done()
    return result["result"]


async def test_zeroconf_bench_mode_entities_and_writes(hass: HomeAssistant, fake_firmware: FakeFirmware) -> None:
    entry = await _add_via_zeroconf(hass, fake_firmware)
    assert entry.state is ConfigEntryState.LOADED
    assert entry.unique_id == GARDEN_ID
    assert entry.title == "Real Reack"
    assert entry.data[CONF_INSECURE] is True and entry.data[CONF_GARDEN_ID] == GARDEN_ID
    # Nothing secret is ever sent to an unauthenticated device.
    assert all(auth is None for _, _, auth in fake_firmware.requests)

    reg = er.async_get(hass)

    def eid(platform: str, unique_id: str) -> str | None:
        return reg.async_get_entity_id(platform, DOMAIN, f"{GARDEN_ID}_{unique_id}")

    # Raw16 moisture: a bare count, not "8981 %".
    moisture = hass.states.get(eid("sensor", f"{PLANT}_vital_moisture"))
    assert moisture.state == "8981"
    assert "unit_of_measurement" not in moisture.attributes
    assert "device_class" not in moisture.attributes

    # Dimmer: the module's raw format is percent, so that is the unit and the max.
    dimmer = eid("number", f"{PLANT}_actuator_dimmer")
    assert hass.states.get(dimmer).attributes["max"] == 100
    assert hass.states.get(dimmer).attributes["unit_of_measurement"] == "%"
    await hass.services.async_call("number", "set_value", {"entity_id": dimmer, "value": 60}, blocking=True)
    assert fake_firmware.dimmer == 60

    valve = eid("switch", f"{PLANT}_actuator_valve")
    await hass.services.async_call("switch", "turn_on", {"entity_id": valve}, blocking=True)
    assert fake_firmware.valve == 1 and hass.states.get(valve).state == "on"
    await hass.services.async_call("switch", "turn_off", {"entity_id": valve}, blocking=True)
    assert fake_firmware.valve == 0
    # The device's terse PUT answer (no unit) must not turn the valve into a number too.
    await entry.runtime_data.async_refresh()
    await hass.async_block_till_done()
    assert eid("number", f"{PLANT}_actuator_valve") is None

    # No Preferences on the device → no vacation / quiet-hours entities.
    assert eid("switch", "garden_pref_vacation_mode") is None
    assert eid("time", "garden_pref_quiet_hours_from") is None

    # Missing optional endpoints are asked once, not on every poll.
    await entry.runtime_data.async_refresh()
    await hass.async_block_till_done()
    assert fake_firmware.count("/garden/preferences") == 1
    assert fake_firmware.count(f"/garden/plants/{PLANT}/grow-profile") == 1
    # Calibration is a device feature: one 404 (System comes first) settles it for every scope.
    calibration = [p for _, p, _ in fake_firmware.requests if p.endswith("/hardware-calibration")]
    assert calibration == ["/garden/system/hardware-calibration"]

    # Water now works the same way (valve open, then closed by HA).
    button = eid("button", f"{PLANT}_button_water_now")
    assert button is not None and hass.states.get(button) is not None

    # Plant device hangs off the Garden device (set via the registry, not DeviceInfo.via_device).
    devices = dr.async_get(hass)
    garden_dev = devices.async_get_device(identifiers={(DOMAIN, GARDEN_ID)})
    plant_dev = devices.async_get_device(identifiers={(DOMAIN, f"{GARDEN_ID}:plant:{PLANT}")})
    assert garden_dev and plant_dev and plant_dev.via_device_id == garden_dev.id

    await hass.config_entries.async_remove(entry.entry_id)
    await hass.async_block_till_done()


async def test_manual_bench_mode(hass: HomeAssistant, fake_firmware: FakeFirmware) -> None:
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_HOST: "127.0.0.1", CONF_PORT: fake_firmware.port, CONF_INSECURE: True}
    )
    assert result["type"] is FlowResultType.FORM and result["step_id"] == "insecure_confirm", result
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    await hass.async_block_till_done()

    # Re-announced over mDNS later → same Garden, no second entry.
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_ZEROCONF}, data=_zeroconf(fake_firmware.port)
    )
    assert result["type"] is FlowResultType.ABORT and result["reason"] == "already_configured"


async def test_manual_bench_mode_unreachable(hass: HomeAssistant, socket_enabled) -> None:
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_HOST: "127.0.0.1", CONF_PORT: _free_port(), CONF_INSECURE: True}
    )
    assert result["type"] is FlowResultType.FORM and result["step_id"] == "user"
    assert result["errors"] == {"base": "cannot_connect"}
