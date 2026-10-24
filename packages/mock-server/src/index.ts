import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { Router, type Request } from "express";
import { state, deviceNow, eraseUserData, serializeModule, type OwnerState, type PlantState } from "./state.js";
import {
  deriveActuators,
  deriveCapabilities,
  deriveHardwareCalibration,
  deriveVitals,
  gardenStatus,
  getActuator,
  ownerStatus,
  writeActuator,
} from "./derive.js";
import { advertiseHeadDevice, type Advertisement } from "./mdns.js";
import { DeviceSecurity, formatSetupCode } from "./security/device.js";
import { authGate, securityRoutes } from "./security/routes.js";
import { createDeviceServer } from "./transport.js";
import { startControlServer } from "./control.js";
import { errorHandler, missingCapabilities, notFound, notFoundFallback, notWritable, requireJson } from "./http.js";
import {
  parseCulturePack,
  parseEndpointValue,
  parseGrowProfile,
  parseHistoryQuery,
  parseNameDescription,
  parsePreferences,
  parseSettings,
  parseTime,
} from "./validate.js";
import {
  addScenario,
  deleteScenario,
  ensureRoom,
  findScenario,
  missingFor,
  prepare,
  replaceScenario,
  scenariosOf,
  scopeOf,
} from "./scenarios.js";
import { queryHistory, startHistory } from "./history.js";
import { startEngine } from "./engine.js";

// ---- Configuration ------------------------------------------------------
// Defaults follow the spec strictly (HTTPS on 443, auth, one connection at a
// time, 5 s idle timeout); the flags exist only as debugging escape hatches.
// macOS lets unprivileged processes bind ports < 1024, so 443 needs no sudo.

const PORT = Number(process.env.PORT) || 443;
const TLS = process.env.OFL_TLS !== "0";
const SINGLE_CONNECTION = process.env.OFL_SINGLE_CONNECTION !== "0";
const IDLE_TIMEOUT_MS = Number(process.env.OFL_IDLE_TIMEOUT_MS) || 5000;
const CONTROL_PORT = Number(process.env.OFL_CONTROL_PORT) || 4380;
const CREDENTIAL_SLOTS = Number(process.env.OFL_CREDENTIAL_SLOTS) || 4;
const ENGINE_TICK_MS = Number(process.env.OFL_ENGINE_TICK_MS) || 1000;
const HISTORY_PERIOD_MS = (Number(process.env.OFL_HISTORY_PERIOD_S) || 60) * 1000;
// Per-port default, so two instances (PORT=4311 alongside the default) are
// two independent devices with their own keys and credentials.
const DATA_DIR =
  process.env.OFL_DATA_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".data", String(PORT));

const device = new DeviceSecurity(DATA_DIR, CREDENTIAL_SLOTS, process.env.OFL_SETUP_CODE);

const app = express();
app.disable("x-powered-by");
app.disable("etag");
// Auth first, so an unauthenticated request learns nothing — not even that its body was malformed.
app.use(authGate(device));
app.use(express.json());
app.use(requireJson);
app.use(securityRoutes(device));

// ---- Garden -----------------------------------------------------------

const gardenSummary = () => ({
  garden_id: device.identity.garden_id,
  name: state.name,
  description: state.description,
  protocol_version: state.protocol_version,
  status: gardenStatus(),
  type: state.type,
  plant_ids: Array.from(state.plants.keys()),
});

app.get("/garden", (_req, res) => res.json(gardenSummary()));
app.put("/garden", (req, res) => {
  const { name, description } = parseNameDescription(req.body);
  if (name !== undefined) state.name = name;
  if (description !== undefined) state.description = description;
  res.json(gardenSummary());
});

app.get("/garden/preferences", (_req, res) => res.json(state.preferences));
app.put("/garden/preferences", (req, res) => {
  state.preferences = parsePreferences(req.body, state.preferences);
  res.json(state.preferences);
});

app.get("/garden/capabilities", (_req, res) => res.json({ engine: state.engine_capabilities }));

// docs/16-rest-api.md §16.6
const timeBody = () => ({ time: new Date(deviceNow()).toISOString(), source: state.time.source });
app.get("/garden/time", (_req, res) => res.json(timeBody()));
app.put("/garden/time", (req, res) => {
  state.time = { source: "manual", offsetMs: parseTime(req.body) - Date.now() };
  res.json(timeBody());
});

// ---- Plant / System sub-resources (same shape, docs/10 §10.2) -------------

function plantOf(req: Request): PlantState {
  const plant = state.plants.get(req.params.id);
  if (!plant) throw notFound();
  return plant;
}

function settingsEntry(owner: OwnerState, moduleId: string) {
  if (!owner.modules.some((m) => m.id === moduleId)) throw notFound();
  return owner.settings.find((s) => s.module_id === moduleId) ?? { module_id: moduleId, settings: {} };
}

function endpointOf(owner: OwnerState, moduleId: string, index: string) {
  const mod = owner.modules.find((m) => m.id === moduleId);
  const ep = mod?.endpoints.find((e) => String(e.index) === index);
  if (!ep) throw notFound();
  return ep;
}

function ownerRoutes(ownerOf: (req: Request) => OwnerState): Router {
  const r = Router({ mergeParams: true });

  r.get("/vitals", (req, res) => res.json(deriveVitals(ownerOf(req))));
  r.get("/vitals/history", (req, res) => {
    const owner = ownerOf(req);
    const { since, limit } = parseHistoryQuery(req.query);
    res.json(queryHistory(owner, since, limit));
  });
  r.get("/hardware-calibration", (req, res) => res.json({ calibrations: deriveHardwareCalibration(ownerOf(req)) }));

  r.get("/settings", (req, res) => res.json({ settings: ownerOf(req).settings }));
  r.get("/settings/:moduleId", (req, res) => res.json(settingsEntry(ownerOf(req), req.params.moduleId)));
  r.put("/settings/:moduleId", (req, res) => {
    const owner = ownerOf(req);
    const entry = settingsEntry(owner, req.params.moduleId);
    entry.settings = parseSettings(req.body);
    if (!owner.settings.includes(entry)) owner.settings.push(entry);
    res.json(entry);
  });

  r.get("/modules", (req, res) => res.json({ modules: ownerOf(req).modules.map(serializeModule) }));
  r.get("/modules/:moduleId/endpoints/:index", (req, res) => {
    res.json(endpointOf(ownerOf(req), req.params.moduleId, req.params.index));
  });
  // docs/09 §9.3: raw passthrough, no range check — but a read-only endpoint can't be written.
  r.put("/modules/:moduleId/endpoints/:index", (req, res) => {
    const ep = endpointOf(ownerOf(req), req.params.moduleId, req.params.index);
    if (ep.mode === "read") throw notWritable();
    ep.value = parseEndpointValue(req.body);
    res.json(ep);
  });

  r.get("/capabilities", (req, res) => res.json(deriveCapabilities(ownerOf(req))));

  r.get("/actuators", (req, res) => res.json(deriveActuators(ownerOf(req))));
  r.get("/actuators/:capability", (req, res) => {
    const entry = getActuator(ownerOf(req), req.params.capability);
    if (!entry) throw notFound();
    res.json(entry);
  });
  r.put("/actuators/:capability", (req, res) => {
    const entry = writeActuator(ownerOf(req), req.params.capability, (req.body as { value?: unknown }).value);
    if (!entry) throw notFound();
    res.json(entry);
  });

  r.get("/scenarios", (req, res) => res.json(scenariosOf(ownerOf(req))));
  r.post("/scenarios", (req, res) => res.status(201).json(addScenario(req.body, scopeOf(ownerOf(req)))));
  r.get("/scenarios/:scenarioId", (req, res) => res.json(findScenario(req.params.scenarioId, ownerOf(req))));
  r.put("/scenarios/:scenarioId", (req, res) => {
    res.json(replaceScenario(findScenario(req.params.scenarioId, ownerOf(req)), req.body));
  });
  r.delete("/scenarios/:scenarioId", (req, res) => {
    deleteScenario(findScenario(req.params.scenarioId, ownerOf(req)));
    res.status(204).end();
  });

  return r;
}

// ---- Plants -------------------------------------------------------------

const plantSummary = (p: PlantState) => ({
  plant_id: p.plant_id,
  name: p.name,
  description: p.description,
  status: ownerStatus(p),
});

app.get("/garden/plants", (_req, res) => res.json(Array.from(state.plants.values(), plantSummary)));
app.get("/garden/plants/:id", (req, res) => res.json(plantSummary(plantOf(req))));
app.put("/garden/plants/:id", (req, res) => {
  const plant = plantOf(req);
  const { name, description } = parseNameDescription(req.body);
  if (name !== undefined) plant.name = name;
  if (description !== undefined) plant.description = description;
  res.json(plantSummary(plant));
});

app.get("/garden/plants/:id/grow-profile", (req, res) => res.json(plantOf(req).grow_profile));
app.put("/garden/plants/:id/grow-profile", (req, res) => {
  const plant = plantOf(req);
  const profile = parseGrowProfile(req.body);
  const missing = missingFor(profile.required_capabilities, scopeOf(plant));
  if (missing.length > 0) throw missingCapabilities(missing);
  plant.grow_profile = profile;
  res.json(plant.grow_profile);
});

// docs/15 §15.3: validated as a whole — the pack, its Grow Profile and every
// bundled Scenario (§14.5) — then applied in one step, or not at all.
app.post("/garden/plants/:id/culture-packs", (req, res) => {
  const plant = plantOf(req);
  const pack = parseCulturePack(req.body);
  const scope = scopeOf(plant);
  const missing = new Set([
    ...missingFor(pack.required_capabilities, scope),
    ...missingFor(pack.grow_profile.required_capabilities, scope),
    ...pack.scenarios.flatMap((s) => missingFor(s.required_capabilities, scope)),
  ]);
  if (missing.size > 0) throw missingCapabilities(Array.from(missing));
  ensureRoom(pack.scenarios.length);
  const scenarios = pack.scenarios.map((s) => prepare(s, scope));

  const profile: Record<string, unknown> = { ...pack.grow_profile };
  for (const flag of pack.disables) profile[flag] = false;
  plant.grow_profile = profile as unknown as PlantState["grow_profile"];
  state.scenarios.push(...scenarios);
  res.status(201).json({ grow_profile: plant.grow_profile, scenarios });
});

app.use("/garden/plants/:id", ownerRoutes(plantOf));

// ---- System ---------------------------------------------------------------

app.get("/garden/system", (_req, res) => res.json({ name: state.system.name }));
app.use("/garden/system", ownerRoutes(() => state.system));

// ---- Scenarios (Garden-wide view, docs/16 §16.5) ---------------------------

app.get("/garden/scenarios", (_req, res) => res.json(state.scenarios));
app.get("/garden/scenarios/:id", (req, res) => res.json(findScenario(req.params.id)));
app.put("/garden/scenarios/:id", (req, res) => res.json(replaceScenario(findScenario(req.params.id), req.body)));
app.delete("/garden/scenarios/:id", (req, res) => {
  deleteScenario(findScenario(req.params.id));
  res.status(204).end();
});

app.use(notFoundFallback);
app.use(errorHandler);

// ---- Startup ----------------------------------------------------------------

const transport = createDeviceServer(app, device.identity, {
  tls: TLS,
  singleConnection: SINGLE_CONNECTION,
  idleTimeoutMs: IDLE_TIMEOUT_MS,
});

let advertisement: Advertisement | undefined;
const txt = () => ({ garden_id: device.identity.garden_id, pair: device.pairAdvert });
device.on("changed", () => advertisement?.update(txt()));

// §22.8: erases credentials + every user-supplied data item, new key pair.
// Hardware, library-sourced data (Hardware Calibration, generic Scenarios)
// and Vitals History stay.
function factoryReset() {
  eraseUserData(state);
  device.factoryReset();
  transport.setIdentity(device.identity);
}

transport.server.listen(PORT, () => {
  const scheme = TLS ? "https" : "http";
  console.log(`OFL mock Head Device on ${scheme}://localhost:${PORT}`);
  console.log(`  garden_id    ${device.identity.garden_id}`);
  console.log(`  fingerprint  ${device.identity.fingerprint}`);
  console.log(`  setup code   ${device.setupCode ? formatSetupCode(device.setupCode) : "(none — button pairing only)"}`);
  console.log(`  claimed      ${device.claimed ? `yes (${device.listClients().length} credential(s))` : "no"}`);
  console.log(`  clock        ${state.time.source}`);
  console.log(`  data dir     ${DATA_DIR}`);
  if (!TLS) console.warn("  WARNING: OFL_TLS=0 — plain HTTP, violates docs/22-security.md §22.2 (debug only)");
  if (!SINGLE_CONNECTION) console.warn("  WARNING: OFL_SINGLE_CONNECTION=0 — concurrent connections allowed (debug only)");
  advertiseHeadDevice(PORT, txt())
    .then((ad) => (advertisement = ad))
    .catch((err) => console.error("mDNS self-advertisement failed (continuing without it):", err));
});

startControlServer(device, CONTROL_PORT, factoryReset);
startEngine(ENGINE_TICK_MS);
startHistory(HISTORY_PERIOD_MS);
