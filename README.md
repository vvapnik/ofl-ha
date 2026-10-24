# Open Farm Link — Home Assistant Control Panel

Home Assistant as a Control Panel for the
[Open Farm Link](https://github.com/vvapnik/open-farm-link) protocol (spec in
the sibling repo `~/Garden/Code/open-farm-link`), plus a mock Head Device to
develop it against without hardware.

## Structure

| Path | What |
|---|---|
| `custom_components/ofl` | The Home Assistant integration (Python). Discovers Head Devices over mDNS, pairs with them (button / setup code / existing login, [docs/22-security.md](../open-farm-link/docs/22-security.md)), pins each device's key, polls it, and exposes Vitals/Actuators/Grow Profile flags/Preferences as entities. Ships the card below and registers it on every dashboard by itself. |
| `packages/ha-card` | `ofl-garden-card`, a Lovelace card (Lit + TypeScript): the rack at a glance — head unit + one tray per Plant — and a friendly per-plant view with moisture status, **Water now** and the light. Built into `custom_components/ofl/frontend/`. |
| `packages/mock-server` | A mock Head Device (Express) following the protocol strictly: the full REST API with validation and Hardware Calibration, a Scenario engine, Vitals History, and the security/transport rules (HTTPS with a self-signed pinned key, auth on every request, pairing, credential management, brute-force limit, one connection at a time, 5 s idle timeout, mDNS with `pair=` in TXT). Simulated hardware changes go through a localhost-only control server. |
| `packages/shared` | TypeScript types mirroring the spec entities, used by the mock. Hand-maintained against the spec. |
| `tests/` | End-to-end tests: Home Assistant's own test harness driving the integration against a real mock server process. |

The original React browser panel was archived to
`../open-farm-link-panel-legacy` — a browser can't pin a self-signed device
key, so it can't be a compliant Control Panel on its own.

## Mock Head Device

Requires Node 18+ (`nvm use 20`).

```sh
npm install
npm run dev:mock        # https://localhost:443 — prints garden_id, fingerprint, setup code
npm run button          # "short press": open the 2-minute pairing window
npm run factory-reset   # "long press": wipe credentials + user data, new key → new garden_id
npm run mock:status     # what a serial console would show (fingerprint, setup code, clients)
```

The control server (`127.0.0.1:4380`) also stands in for the hardware —
what a real device would detect on its own bus:

```sh
H=http://127.0.0.1:4380
curl -X POST $H/hw/plants                                   # a new pot/anchor appears → new Plant
curl -X DELETE $H/hw/plants/plant-3                         # …and is pulled again
curl -X POST $H/hw/modules -d '{"owner":"plant-1","blueprint_id":"acme-scale-v1"}'  # see library.ts
curl -X DELETE $H/hw/modules/plant-1-valve                  # Scenarios needing it turn noop
curl -X PUT $H/hw/modules/plant-1-container/endpoints/0 -d '{"value":40}'  # soil dries → watering fires
curl -X PUT $H/hw/modules/sys-tank/fault -d '{"faulted":true}'             # status: problem
curl -X PUT $H/hw/time -d '{"source":"none"}'               # reboot with no uplink
```

Its key, setup code and credentials persist in `packages/mock-server/.data/<port>/`
like a real device's flash, so pairings survive restarts. Talk to it with curl
the way [§22.5](../open-farm-link/docs/22-security.md#225-authenticating-requests) shows:

```sh
curl -k --pinnedpubkey 'sha256//…' -u user:'password' https://localhost/garden/plants
```

| Env var | Default | |
|---|---|---|
| `PORT` | `443` | macOS lets unprivileged processes bind < 1024; no sudo needed. |
| `OFL_SETUP_CODE` | generated on first boot | A code, or `none` for a button-only device. |
| `OFL_CREDENTIAL_SLOTS` | `4` | |
| `OFL_CONTROL_PORT` | `4380` | The localhost-only "physical button" server. |
| `OFL_DATA_DIR` | `.data/<port>` | |
| `OFL_TLS=0` | — | Debug only: plain HTTP (violates §22.2). |
| `OFL_SINGLE_CONNECTION=0` | — | Debug only: allow concurrent connections. |
| `OFL_IDLE_TIMEOUT_MS` | `5000` | |
| `OFL_TIME_SOURCE` | `ntp` | `none`: boot with no clock, like a device with no uplink (§16.6). |
| `OFL_ENGINE_TICK_MS` | `1000` | Scenario engine period. |
| `OFL_HISTORY_PERIOD_S` | `60` | Raw Vitals History sample period. |

## Home Assistant integration

Install: copy (or symlink) `custom_components/ofl` into your HA config's
`custom_components/` — or add this repo to HACS as a custom repository — and
restart. Minimum Home Assistant 2025.4.

A Head Device on the LAN shows up under **Settings → Devices & services** as
discovered. Pair it one of three ways:

- **Pairing button** — press it on the device (or `npm run button` for the mock), then submit.
- **Setup code** — for a device nobody has paired yet. HA first verifies the
  device knows the code (challenge, §22.4 step 1) and never sends it otherwise.
- **Existing login** — a username/password created elsewhere.

HA then shows every credential the device holds, as the spec recommends.
Removing the integration revokes HA's own credential on the device.

Entities per Garden device: problem, clock source, vacation mode, quiet hours
start/end, System vitals/actuators. Per Plant device: problem, each Vital as a
sensor, binary Actuators as switches, others (light, pump) as numbers in
physical units, Grow Profile `*_enabled` flags as config switches, **Water now**
button (duration in the integration's options).

Add the card to a dashboard: **Add card → Open Farm Link garden**, or

```yaml
type: custom:ofl-garden-card
garden_id: spzihdhhcu4ddonm   # optional — defaults to the first Garden
```

## Tests

```sh
python3.13 -m venv .venv && .venv/bin/pip install pytest-homeassistant-custom-component
npm run test:ha          # starts real mock-server processes; needs Node via nvm
npm run build:card       # rebuild the card after editing packages/ha-card
```

## Status

See [AGENTS.md](AGENTS.md) for what's implemented, what's verified and the known gaps.
