# AGENTS.md

Guidance for AI agents working in this repo.

## What this is

Home Assistant as an Open Farm Link Control Panel (`custom_components/ofl` +
the `ofl-garden-card` Lovelace card), and a strict mock Head Device to build
it against — see [README.md](README.md). Sibling repo to
[open-farm-link](../open-farm-link) (the protocol spec) and
[open-garden-rack](../open-garden-rack)/`ogr-*` (an unrelated, independent
protocol — do not conflate the two, see `open-farm-link/AGENTS.md`'s own
guardrail note on this).

HA is product mode 3 in `open-farm-link/AGENTS.md` "Product context" — and
the current test bench for real hardware, so the integration has to behave
like a compliant Control Panel, not just a demo.

## Environment

- Node 18+. The system default `node` may be older (a stray Node 16 sits
  ahead of nvm's in `PATH` outside an interactive shell) — always
  `source ~/.nvm/nvm.sh && nvm use 20` before running anything, and check
  `node --version` if a command mysteriously fails.
- npm workspaces (`packages/*`); run `npm install` at the repo root only.
- Python: `.venv/` (Python 3.13, gitignored) with
  `pytest-homeassistant-custom-component`, which pins **HA 2025.4.4** — the
  newest that harness release supports on 3.13. So 2025.4 is the declared
  minimum (`hacs.json`); don't use HA APIs newer than that without raising it
  (e.g. `ConfigEntry.start_reauth_flow` doesn't exist there — tests start
  re-auth via `flow.async_init(..., source=reauth)`). `home-assistant-frontend`
  is also installed in the venv, only for running a real `hass` instance.

## Mock Head Device (`packages/mock-server`)

Implements the REST surface **and** `open-farm-link/docs/22-security.md` +
the transport rules, strictly by default (user decision 2026-10-16: test the
HA client against real constraints from day one; flags exist only as
debugging escape hatches, see README).

- `security/identity.ts` — ECDSA P-256 key + self-signed cert via the
  system `openssl` (Node can't make X.509 itself). `fingerprint`/`garden_id`
  derived exactly per §22.2; verified against an independent openssl
  pipeline and a Python re-derivation. `garden_id` is **not** in `state.ts`
  any more — it comes from the key.
- `security/device.ts` — setup code (Crockford, normalization), pairing
  window, credentials (SHA-256 tokens, PBKDF2 passwords, RAM cache of
  verified headers per §22.9), brute-force limit, factory reset. The cache
  only skips PBKDF2: a cached header still passes the §22.5 throttle, so
  legit clients get 429 too while it's engaged ("any scheme, any client").
  Missing `Authorization` → 401 but does not count as a failed attempt.
- `security/routes.ts` — auth gate, `/garden/pair/challenge`,
  `/garden/pair`, `/garden/clients`.
- `transport.ts` — HTTPS, `maxConnections = 1` (Node can only drop right
  after accept, not refuse at TCP; clients see a reset either way), 5 s
  idle timer from accept and after each response.
- `control.ts` — the device's physical side as a plain-HTTP server on
  **127.0.0.1 only**: the pairing button (`npm run button` /
  `factory-reset` / `mock:status`) and the hardware (`/hw/...` — plug or
  pull a Plant or module, a sensor's own reading, module faults, clock
  uplink; endpoint list in the file header). Not part of the OFL API;
  never advertised. `hardware.ts` does the changes and triggers
  capability revalidation (`noop`/`active`, §14.4) after each one.
- `mdns.ts` — the naming algorithm (below), plus TXT `pair=button` /
  `pair=code`; bonjour-service can't update TXT in place, so a change
  re-publishes the service. After startup it keeps listening and
  re-probes on a conflict (an A answer for its name from an address that
  isn't this machine's — so two instances on one machine only negotiate
  at startup). Note: bonjour-service turns the `.` in the instance name
  into `-` (`… (ofl-peer1-local)`); the hostname itself is fine.
- REST surface (`index.ts`): Plant and System share one sub-resource
  router (docs/10 §10.2). Every body is validated (`validate.ts`, 400 with
  only spec-defined fields kept), every error — including unknown paths
  and crashes — is the §16.2 JSON shape (`http.ts`), no `ETag`/
  `X-Powered-By`. Scenario rules live in `scenarios.ts`: the
  Plant/System paths are views scoped by `target`, so a Scenario is only
  reachable through its own target's path; `id`/`target`/`status` are the
  device's (ids are `scn-N`, a client-sent `id` is ignored); PUT can't
  change `id`/`kind`/`target` and re-checks capabilities; Culture Pack
  import checks the pack, its Grow Profile and each bundled Scenario
  before applying anything.
- `library.ts` — the hardware-model library: every module is built from a
  blueprint here, with its Hardware Calibration (served for the
  `(blueprint_id, endpoint_type)` pairs actually present) and Default
  Settings (seeded once per module).
- `derive.ts` — Hardware Calibration applied on every Vitals/Actuators
  read and Actuators write (piecewise-linear curve, clamped, command
  rounded to the module's integral range), then Grow Profile
  `sensor_calibration` offsets for Plant Vitals. An Actuators PUT is
  validated against the capability's unit (binary 0/1, percent ≤ 100).
- `engine.ts` — the Scenario engine (docs/11): generic templates per
  matching target, active specialized Scenarios, `duration_s` reverts,
  `max_brightness` caps Scenario-driven dimmer commands, `time` is unknown
  (time clauses false) while the clock source is `none`. A tiny "physics"
  (open valve raises moisture, running pump drains the tank) keeps
  watering from re-firing forever.
- `history.ts` — Vitals History: 24 hourly records backfilled at start,
  then a raw sample every `OFL_HISTORY_PERIOD_S`; without `since` the
  latest `limit` records, with `since` the first `limit` after it.
- Persistence: key/cert + `device.json` (setup code, credential hashes) in
  `.data/<port>/` so pairings survive restarts (tsx watch restarts on every
  edit). The rest of the Garden is still in-memory and re-seeds on restart.
- Factory reset erases user data only (names, Preferences, Grow Profiles,
  Settings back to library defaults, specialized/script Scenarios); the
  hardware, generic Scenarios and history stay.
- Default port 443 — macOS has allowed unprivileged binds below 1024 since
  Mojave, so no sudo (the old "port 81 because 80 needs root" note was
  wrong for macOS; it was about the archived panel anyway).

Verified with curl/openssl end to end on 2026-10-16: pin match/mismatch,
HMAC proof, wrong/right/normalized setup code, `pairing_closed`, Bearer +
Basic, 400/409 cases, 6×401→429→200 after 10 s, second connection reset
while one is held, slot freed by idle timeout, button window opening/closing
(TXT follows), `no_free_slots`, factory reset (old pin and creds rejected,
new `garden_id`, TXT back to `pair=code`), `dns-sd` resolution.

### Self-advertisement (`ofl-peer{N}.local`)

`advertiseHeadDevice` implements the probing algorithm from
`open-farm-link/docs/16-rest-api.md` §16.4 for real: query
`ofl-peer1.local`, `ofl-peer2.local`, ... via `multicast-dns` and claim the
first free one. Two instances (`PORT=4311 OFL_CONTROL_PORT=4381 …`) negotiate
different N — that's two processes over mDNS, not one assigning numbers.

### Interpretations where the spec is silent (user decision 2026-10-24: the mock must follow the protocol fully)

These are choices the spec doesn't make yet — candidates to settle in
`open-farm-link`, not features to rely on:

- Writing a `read` endpoint through Modules → `405 not_writable`.
- A full Scenario store (32, §11.4) → `409 no_free_slots`.
- Scenario `id`s are device-assigned; `settings.<module_id>.<field>` is
  the Scenario field path into Settings.
- A `system.`-prefixed key in `required_capabilities` is checked against
  System (docs/20 §20.3).
- `in`/`not_in` take a list or a `{from, to}` window; a `null` window
  (no quiet hours) contains nothing. `time` uses the host's time zone as
  the device's local time.
- `mount_height_mm` isn't applied (the spec gives no formula);
  `vacation_mode` has no effect (undefined); Grow Profile has no `status`
  to mark `noop` (§14.4 says it should be).
- Vitals don't drift on their own: readings change only through
  `/hw/.../endpoints` or the watering physics.

## Home Assistant integration (`custom_components/ofl`)

Design decisions worth keeping:

- **One `OflClient` per device, owning its own aiohttp session** with
  `TCPConnector(limit=1)` — HA's shared session can't do per-device
  pinning or a one-slot pool. Requests are grouped in
  `async with client.batch():` (poll, each write); batches are serialized by
  a lock and the session is closed at the end of each, so the device's only
  connection slot is freed immediately instead of idling in aiohttp's pool
  while e.g. the official app waits. Don't open a second client to the same
  device while one is mid-flow — the strict mock *will* refuse it (this
  bit the config flow once: `list_clients` on a fresh client after `pair`).
- **Retries** span > 5 s (`RETRY_DELAYS`) so even a silent connection
  hogging the slot is closed by the device's idle timeout before the last
  try. Connect failures are always retried; after a request may have been
  sent, only GET/PUT/DELETE are.
- **Pinning = SPKI, not cert hash**: `SpkiPin` subclasses
  `aiohttp.Fingerprint` (whose own check hashes the whole DER cert).
  aiohttp calls `check()` right after the handshake, before writing the
  request, so a mismatch never leaks a credential. `expected=None` pins on
  first use — only during pairing.
- **Setup-code path always runs the challenge** (MUST for an official
  panel, §22.4). A wrong code therefore fails *client-side* as
  `setup_code_mismatch` and is never sent — indistinguishable from an
  impersonator by design, and it doesn't count toward the device's
  brute-force limit.
- **Factory reset = new Garden** (§22.8): pin mismatch → re-auth → abort
  `device_reset` ("remove and re-add"). Re-auth never re-pins an entry to
  a new key; it only recovers from a revoked/changed credential with the
  same key.
- `unique_id` = `garden_id`. Zeroconf rediscovery updates host/port of the
  existing entry (N and IP aren't stable, §16.4). The stored host is the
  IP from zeroconf, not `ofl-peerN.local` — a plain aiohttp connector uses
  getaddrinfo, which may not resolve `.local` inside HA OS containers.
- Credential type: the flow creates a **token** named "Home Assistant"
  (no PBKDF2 per request, nothing for the user to invent);
  `pair_credentials` accepts an existing login/password instead.
  `async_remove_entry` DELETEs HA's own credential (frees a slot, §22.6).
- After pairing, the `paired` step lists all credentials (§22.4 SHOULD).
- Time: if the device reports `source: "none"`, the coordinator PUTs HA's
  clock (§16.6 MAY; option `sync_time`, default on).
- Entities are added dynamically (`entity.track_entities`) since Plants and
  Vitals/Actuators keys come and go with hardware. Binary-unit actuators →
  switch; others → number with max from the Hardware Calibration curve
  (fetched once per scope). Unique IDs: `{garden_id}_{scope}_{kind}_{key}`
  — `websocket.py` resolves entities for the card by these, so don't change
  the scheme casually.

### Lovelace card (`packages/ha-card`)

Port of the archived panel's Simple mode. Gets *structure* (plants,
species, targets, entity ids) from the integration's `ofl/gardens`
websocket command; live values from `hass.states`; actions are plain entity
service calls — the card never speaks OFL or sees a credential. Built with
`npm run build:card` into `custom_components/ofl/frontend/ofl-garden-card.js`
(committed build artifact — HACS users don't run npm); the integration
serves it at `/ofl_static/` and `add_extra_js_url`s it, so no manual
Lovelace resource. Themed only via HA CSS variables, except the rack
hardware drawing. Strings en/ru in `i18n.ts`. Tray order = API list order,
not physical (§21.4).

### Verified (2026-10-16)

- `tests/test_e2e.py` (5 tests, HA harness ↔ real mock processes, strict
  mode): setup-code pairing incl. wrong code, entities/values, writes
  reaching the device, websocket structure, credential revoked on removal;
  button pairing (`pairing_closed` before press, window closes after);
  factory reset → pin failure → re-auth aborts `device_reset`; retry past
  another client hogging the connection; zeroconf discovery + host follow.
- A real `hass` (2025.4.4) run: config flow via REST, entities created and
  named, card served (200) and present in the dashboard HTML shell,
  `ofl/gardens` over a real websocket, Water now opened the valve on the
  device and closed it 5 s later.
- Card rendered in headless Chrome against a stubbed `hass` (light/dark,
  en/ru, all three views). Not yet looked at inside a real HA dashboard.

## Known gaps / open points

- **Water now times the close in HA.** The Actuators API has no duration
  (`PUT {value}` only), so if HA crashes mid-pulse the valve stays open.
  A device-side `duration_s` on Actuator writes (Scenario actions already
  have one, `docs/11-scenarios.md` §11.4) would fix it — candidate spec
  change, not decided.
- **Polling cost under the one-connection rule**: one refresh is
  `6 + 3·plants` sequential requests (plus Hardware Calibration once per
  scope). This is the
  "bulk read endpoint" input to the concurrent-access open question in
  `open-farm-link/AGENTS.md`.
- Not exposed yet: Scenarios (list/edit), Culture Pack import, Vitals
  History, Settings, raw Modules, `max_brightness`, credential management
  beyond the post-pairing list (no UI to revoke other clients).
- No options-flow/diagnostics tests; card has no visual editor.
- Never run against real hardware (TLS handshake cost on an ESP32-C3 is
  why the client keeps one connection alive within a batch).
- The integration caches Hardware Calibration maxima once per scope, so a
  light plugged in later (`/hw/modules`) keeps a stale slider max until
  reload.
- The mock's engine, `/hw/...` simulation, Vitals History and
  `OFL_TIME_SOURCE=none` (HA's `sync_time` path) have no e2e tests yet —
  checked by hand with curl on 2026-10-24 (every A/B/C item of that day's
  spec audit).
- Open spec gaps found in that audit (to settle in `open-farm-link`):
  creating a `target: garden` Scenario (no POST path); renaming System
  (no `PUT /garden/system`, yet §22.8 erases its name); `light_flux` vs
  `light_lux` in docs/08 §8.2; error codes for the cases listed under
  "Interpretations" above; whether Plant `capabilities` includes `engine`;
  the watering template's `system.pump` value `1` is 1 % in the pump's
  percent unit; `description` in the Plants listing.

## Conventions

- `packages/shared` types are hand-maintained against
  `open-farm-link/docs/*.md` — no generator. Same for the integration's
  catalog mappings (`sensor.py` units/device classes, translation keys).
- When the spec changes: update shared types, the mock, the integration,
  and re-run `npm run test:ha` — the e2e tests are the cross-check.
- The mock follows the spec fully; where the spec is silent it makes the
  choices listed under "Interpretations" — change those together with the spec.
