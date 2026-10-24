"""Config flow + entities against the real mock Head Device (see conftest.py)."""

from __future__ import annotations

import socket
import ssl
import threading
import time
from unittest.mock import patch

from homeassistant.config_entries import SOURCE_REAUTH, SOURCE_USER, ConfigEntryState
from homeassistant.const import CONF_HOST, CONF_PORT
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.helpers import entity_registry as er

from custom_components.ofl.api import OflClient
from custom_components.ofl.const import CONF_CLIENT_ID, CONF_FINGERPRINT, CONF_GARDEN_ID, DOMAIN

from .conftest import MockDevice


async def _start_flow(hass: HomeAssistant, device: MockDevice) -> dict:
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    assert result["type"] is FlowResultType.FORM
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {CONF_HOST: "127.0.0.1", CONF_PORT: device.port}
    )
    assert result["type"] is FlowResultType.MENU, result
    return result


async def _pair_with_setup_code(hass: HomeAssistant, device: MockDevice):
    result = await _start_flow(hass, device)
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"next_step_id": "pair_setup_code"})
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"setup_code": device.setup_code})
    assert result["step_id"] == "paired", result
    assert "Home Assistant" in result["description_placeholders"]["clients"]
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    await hass.async_block_till_done()
    return result["result"]


async def test_setup_code_pairing_and_entities(hass: HomeAssistant, mock_device: MockDevice, hass_ws_client) -> None:
    status = mock_device.status()

    # Wrong code first: the challenge proof doesn't verify, so HA stops
    # before ever sending the code to the device (§22.4 step 1).
    result = await _start_flow(hass, mock_device)
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"next_step_id": "pair_setup_code"})
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"setup_code": "0000-0000-0000-0000"})
    assert result["errors"] == {"base": "setup_code_mismatch"}
    hass.config_entries.flow.async_abort(result["flow_id"])

    entry = await _pair_with_setup_code(hass, mock_device)
    assert entry.state is ConfigEntryState.LOADED
    assert entry.unique_id == status["garden_id"]
    assert entry.data[CONF_GARDEN_ID] == status["garden_id"]
    assert entry.data[CONF_FINGERPRINT] == status["fingerprint"]
    assert [c["name"] for c in mock_device.status()["clients"]] == ["Home Assistant"]

    reg = er.async_get(hass)
    gid = status["garden_id"]

    def eid(platform: str, unique_id: str) -> str:
        entity_id = reg.async_get_entity_id(platform, DOMAIN, unique_id)
        assert entity_id, f"no {platform} entity for {unique_id}"
        return entity_id

    moisture = eid("sensor", f"{gid}_plant-1_vital_moisture")
    assert hass.states.get(moisture).state == "58"
    assert hass.states.get(moisture).attributes["unit_of_measurement"] == "%"
    tank = eid("sensor", f"{gid}_system_vital_water_level")
    assert hass.states.get(tank).state == "82"
    assert hass.states.get(eid("binary_sensor", f"{gid}_garden_status_status")).state == "off"
    assert hass.states.get(eid("sensor", f"{gid}_garden_diag_time_source")).state == "ntp"

    # Binary actuator → switch, written through to the device.
    valve = eid("switch", f"{gid}_plant-1_actuator_valve")
    assert hass.states.get(valve).state == "off"
    await hass.services.async_call("switch", "turn_on", {"entity_id": valve}, blocking=True)
    assert hass.states.get(valve).state == "on"

    # Non-binary actuator → number, max taken from the Hardware Calibration curve.
    dimmer = eid("number", f"{gid}_plant-1_actuator_dimmer")
    assert hass.states.get(dimmer).attributes["max"] == 4200
    await hass.services.async_call("number", "set_value", {"entity_id": dimmer, "value": 1800}, blocking=True)

    # Grow Profile flag → config switch.
    flag = eid("switch", f"{gid}_plant-2_grow_flag_watering_enabled")
    await hass.services.async_call("switch", "turn_off", {"entity_id": flag}, blocking=True)

    # A fresh poll reads back what the device now holds.
    await entry.runtime_data.async_refresh()
    await hass.async_block_till_done()
    assert hass.states.get(valve).state == "on"
    assert hass.states.get(dimmer).state == "1800.0"
    assert hass.states.get(flag).state == "off"

    # The card's structure API resolves those same entities.
    ws_client = await hass_ws_client(hass)
    await ws_client.send_json_auto_id({"type": "ofl/gardens"})
    msg = await ws_client.receive_json()
    assert msg["success"], msg
    ws = next(g for g in msg["result"]["gardens"] if g["entry_id"] == entry.entry_id)
    plant1 = next(p for p in ws["plants"] if p["plant_id"] == "plant-1")
    assert plant1["entities"]["actuator/valve"] == valve
    assert plant1["entities"]["actuator/dimmer"] == dimmer
    assert plant1["targets"]["moisture_percent"] == {"min": 55, "max": 70}

    # Removing the entry revokes HA's own credential on the device (§22.6).
    assert entry.data[CONF_CLIENT_ID] == "c1"
    await hass.config_entries.async_remove(entry.entry_id)
    await hass.async_block_till_done()
    after = mock_device.status()
    assert after["clients"] == [] and after["claimed"] is False


async def test_button_pairing(hass: HomeAssistant, mock_device: MockDevice) -> None:
    # Claim it first so the setup-code path is closed — button is then the only way in.
    await _pair_with_setup_code(hass, mock_device)
    entry = hass.config_entries.async_entries(DOMAIN)[0]
    await hass.config_entries.async_unload(entry.entry_id)
    hass.config_entries.async_update_entry(entry, unique_id="moved-aside")

    result = await _start_flow(hass, mock_device)
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"next_step_id": "pair_button"})
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    assert result["errors"] == {"base": "pairing_closed"}

    mock_device.press_button()
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    assert result["step_id"] == "paired", result
    # Both credentials listed prominently (§22.4 "Security considerations").
    assert result["description_placeholders"]["clients"].count("**Home Assistant**") == 2
    hass.config_entries.flow.async_abort(result["flow_id"])
    # Window closes on first successful pairing.
    assert mock_device.status()["pairing_window_closes_at"] is None


async def test_factory_reset_is_a_new_garden(hass: HomeAssistant, mock_device: MockDevice) -> None:
    entry = await _pair_with_setup_code(hass, mock_device)
    coordinator = entry.runtime_data
    mock_device.factory_reset()

    # Key changed → the pin check fails before any credential is sent (§22.2).
    await coordinator.async_refresh()
    await hass.async_block_till_done()
    assert coordinator.last_update_success is False

    # Re-auth refuses to merge the reset device (a new Garden, §22.8) into this entry.
    result = await hass.config_entries.flow.async_init(
        DOMAIN,
        context={"source": SOURCE_REAUTH, "entry_id": entry.entry_id},
        data=dict(entry.data),
    )
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "device_reset"
    await hass.config_entries.async_unload(entry.entry_id)


async def test_waits_out_another_client_holding_the_connection(hass: HomeAssistant, mock_device: MockDevice) -> None:
    """§16.3: the device refuses a second connection; the client retries until the slot frees up."""
    entry = await _pair_with_setup_code(hass, mock_device)
    await hass.config_entries.async_unload(entry.entry_id)

    held = threading.Event()

    def hog() -> None:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        with socket.create_connection(("127.0.0.1", mock_device.port)) as raw, ctx.wrap_socket(raw) as tls:
            held.set()
            time.sleep(1.5)  # hold the slot, send nothing, then let go
            tls.close()

    t = threading.Thread(target=hog)
    t.start()
    held.wait(5)
    client = OflClient("127.0.0.1", mock_device.port, fingerprint=entry.data[CONF_FINGERPRINT], token=entry.data["token"])
    try:
        started = time.monotonic()
        garden = await client.get_garden()
        waited = time.monotonic() - started
    finally:
        await client.close()
        t.join()
    assert garden["garden_id"] == entry.unique_id
    assert waited > 1.0  # had to retry past the hog


async def test_zeroconf_discovery_and_host_follow(hass: HomeAssistant, mock_device: MockDevice) -> None:
    from ipaddress import ip_address

    from homeassistant.config_entries import SOURCE_ZEROCONF
    from homeassistant.helpers.service_info.zeroconf import ZeroconfServiceInfo

    status = mock_device.status()

    def info(host: str, pair: str | None) -> ZeroconfServiceInfo:
        props = {"garden_id": status["garden_id"], **({"pair": pair} if pair else {})}
        return ZeroconfServiceInfo(
            ip_address=ip_address(host),
            ip_addresses=[ip_address(host)],
            hostname="ofl-peer1.local.",
            name="Open Farm Link Head Device (ofl-peer1-local)._ofl._tcp.local.",
            port=mock_device.port,
            type="_ofl._tcp.local.",
            properties=props,
        )

    # Unclaimed device advertising pair=code → setup code is offered first.
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_ZEROCONF}, data=info("127.0.0.1", "code")
    )
    assert result["type"] is FlowResultType.MENU
    assert result["menu_options"][0] == "pair_setup_code"
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"next_step_id": "pair_setup_code"})
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {"setup_code": mock_device.setup_code})
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    entry = result["result"]
    await hass.async_block_till_done()

    # Same Garden re-announced from another address (N/IP aren't stable, §16.4) → entry follows it.
    hass.config_entries.async_update_entry(entry, data={**entry.data, CONF_HOST: "192.0.2.10"})
    with patch("custom_components.ofl.async_setup_entry", return_value=True):
        result = await hass.config_entries.flow.async_init(
            DOMAIN, context={"source": SOURCE_ZEROCONF}, data=info("127.0.0.1", None)
        )
        await hass.async_block_till_done()
    assert result["type"] is FlowResultType.ABORT and result["reason"] == "already_configured"
    assert entry.data[CONF_HOST] == "127.0.0.1"
