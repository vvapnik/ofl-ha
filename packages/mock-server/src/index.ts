import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import type { ApiError, Scenario, GrowProfile } from "@ofl-panel/shared";
import { state, createInitialState, type PlantState, type SystemState } from "./state.js";
import { deriveVitals, deriveActuators, deriveCapabilities, findEndpointForCapability } from "./derive.js";
import { advertiseHeadDevice, type Advertisement } from "./mdns.js";
import { DeviceSecurity, formatSetupCode } from "./security/device.js";
import { authGate, securityRoutes } from "./security/routes.js";
import { createDeviceServer } from "./transport.js";
import { startControlServer } from "./control.js";

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
// Per-port default, so two instances (PORT=4311 alongside the default) are
// two independent devices with their own keys and credentials.
const DATA_DIR =
  process.env.OFL_DATA_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".data", String(PORT));

const device = new DeviceSecurity(DATA_DIR, CREDENTIAL_SLOTS, process.env.OFL_SETUP_CODE);

const app = express();
app.use(express.json());
app.use(authGate(device));
app.use(securityRoutes(device));

function notFound(res: Response, what: string) {
  res.status(404).json({ error: "not_found", detail: what } satisfies ApiError & { detail: string });
}

function missingCapabilities(res: Response, missing: string[]) {
  res.status(422).json({ error: "missing_capabilities", missing } satisfies ApiError);
}

function checkCapabilities(required: string[], available: Set<string>): string[] {
  return required.filter((r) => !available.has(r));
}

function plantOr404(req: Request, res: Response): PlantState | undefined {
  const plant = state.plants.get(req.params.id);
  if (!plant) notFound(res, `plant ${req.params.id}`);
  return plant;
}

function availableCapabilities(modules: PlantState["modules"] | SystemState["modules"]): Set<string> {
  const caps = new Set(deriveCapabilities(modules).modules);
  for (const flag of state.engine_capabilities) caps.add(flag);
  return caps;
}

// ---- Garden -----------------------------------------------------------

app.get("/garden", (_req, res) => {
  const anyProblem = Array.from(state.plants.values()).some((p) => p.status === "problem");
  res.json({
    garden_id: device.identity.garden_id,
    name: state.name,
    description: state.description,
    protocol_version: state.protocol_version,
    status: anyProblem ? "problem" : "ok",
    type: state.type,
    plant_ids: Array.from(state.plants.keys()),
  });
});

app.put("/garden", (req, res) => {
  if (typeof req.body?.name === "string") state.name = req.body.name;
  if (typeof req.body?.description === "string") state.description = req.body.description;
  res.json({ garden_id: device.identity.garden_id, name: state.name, description: state.description });
});

app.get("/garden/preferences", (_req, res) => res.json(state.preferences));
app.put("/garden/preferences", (req, res) => {
  state.preferences = { ...state.preferences, ...req.body };
  res.json(state.preferences);
});

app.get("/garden/capabilities", (_req, res) => res.json({ engine: state.engine_capabilities }));

// docs/16-rest-api.md §16.6
app.get("/garden/time", (_req, res) => {
  res.json({ time: new Date(Date.now() + state.timeOffsetMs).toISOString(), source: state.timeSource });
});
app.put("/garden/time", (req, res) => {
  const requested = typeof req.body?.time === "string" ? Date.parse(req.body.time) : NaN;
  if (Number.isNaN(requested)) return res.status(400).json({ error: "bad_request" } satisfies ApiError);
  state.timeOffsetMs = requested - Date.now();
  state.timeSource = "manual";
  res.json({ time: new Date(Date.now() + state.timeOffsetMs).toISOString(), source: state.timeSource });
});

// ---- Plants -------------------------------------------------------------

app.get("/garden/plants", (_req, res) => {
  res.json(
    Array.from(state.plants.values()).map((p) => ({
      plant_id: p.plant_id,
      name: p.name,
      description: p.description,
      status: p.status,
    })),
  );
});

app.get("/garden/plants/:id", (req, res) => {
  const plant = plantOr404(req, res);
  if (!plant) return;
  res.json({ plant_id: plant.plant_id, name: plant.name, description: plant.description, status: plant.status });
});

app.put("/garden/plants/:id", (req, res) => {
  const plant = plantOr404(req, res);
  if (!plant) return;
  if (typeof req.body?.name === "string") plant.name = req.body.name;
  if (typeof req.body?.description === "string") plant.description = req.body.description;
  res.json({ plant_id: plant.plant_id, name: plant.name, description: plant.description, status: plant.status });
});

app.get("/garden/plants/:id/vitals", (req, res) => {
  const plant = plantOr404(req, res);
  if (!plant) return;
  res.json(deriveVitals(plant.modules));
});

app.get("/garden/plants/:id/vitals/history", (req, res) => {
  const plant = plantOr404(req, res);
  if (!plant) return;
  const since = typeof req.query.since === "string" ? req.query.since : undefined;
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  let records = plant.vitals_history;
  if (since) records = records.filter((r) => r.timestamp >= since);
  res.json(records.slice(0, limit));
});

app.get("/garden/plants/:id/hardware-calibration", (req, res) => {
  const plant = plantOr404(req, res);
  if (!plant) return;
  res.json({ calibrations: plant.hardware_calibration });
});

app.get("/garden/plants/:id/settings", (req, res) => {
  const plant = plantOr404(req, res);
  if (!plant) return;
  res.json({ settings: plant.settings });
});
app.get("/garden/plants/:id/settings/:moduleId", (req, res) => {
  const plant = plantOr404(req, res);
  if (!plant) return;
  const entry = plant.settings.find((s) => s.module_id === req.params.moduleId);
  if (!entry) return notFound(res, `settings for module ${req.params.moduleId}`);
  res.json(entry);
});
app.put("/garden/plants/:id/settings/:moduleId", (req, res) => {
  const plant = plantOr404(req, res);
  if (!plant) return;
  let entry = plant.settings.find((s) => s.module_id === req.params.moduleId);
  if (!entry) {
    entry = { module_id: req.params.moduleId, settings: {} };
    plant.settings.push(entry);
  }
  entry.settings = { ...entry.settings, ...req.body?.settings };
  res.json(entry);
});

app.get("/garden/plants/:id/grow-profile", (req, res) => {
  const plant = plantOr404(req, res);
  if (!plant) return;
  res.json(plant.grow_profile);
});
app.put("/garden/plants/:id/grow-profile", (req, res) => {
  const plant = plantOr404(req, res);
  if (!plant) return;
  const proposed = req.body as GrowProfile;
  const missing = checkCapabilities(proposed.required_capabilities ?? [], availableCapabilities(plant.modules));
  if (missing.length > 0) return missingCapabilities(res, missing);
  plant.grow_profile = proposed;
  res.json(plant.grow_profile);
});

app.get("/garden/plants/:id/modules", (req, res) => {
  const plant = plantOr404(req, res);
  if (!plant) return;
  res.json({ modules: plant.modules });
});

app.get("/garden/plants/:id/modules/:moduleId/endpoints/:index", (req, res) => {
  const plant = plantOr404(req, res);
  if (!plant) return;
  const mod = plant.modules.find((m) => m.id === req.params.moduleId);
  const ep = mod?.endpoints[Number(req.params.index)];
  if (!mod || !ep) return notFound(res, "module/endpoint");
  res.json(ep);
});
app.put("/garden/plants/:id/modules/:moduleId/endpoints/:index", (req, res) => {
  const plant = plantOr404(req, res);
  if (!plant) return;
  const mod = plant.modules.find((m) => m.id === req.params.moduleId);
  const ep = mod?.endpoints[Number(req.params.index)];
  if (!mod || !ep) return notFound(res, "module/endpoint");
  ep.value = req.body?.value;
  res.json(ep);
});

app.get("/garden/plants/:id/capabilities", (req, res) => {
  const plant = plantOr404(req, res);
  if (!plant) return;
  res.json(deriveCapabilities(plant.modules));
});

app.get("/garden/plants/:id/actuators", (req, res) => {
  const plant = plantOr404(req, res);
  if (!plant) return;
  res.json(deriveActuators(plant.modules));
});
app.get("/garden/plants/:id/actuators/:capability", (req, res) => {
  const plant = plantOr404(req, res);
  if (!plant) return;
  const entry = deriveActuators(plant.modules).actuators.find((a) => a.capability === req.params.capability);
  if (!entry) return notFound(res, `actuator ${req.params.capability}`);
  res.json(entry);
});
app.put("/garden/plants/:id/actuators/:capability", (req, res) => {
  const plant = plantOr404(req, res);
  if (!plant) return;
  const found = findEndpointForCapability(plant.modules, req.params.capability);
  if (!found) return notFound(res, `actuator ${req.params.capability}`);
  // Real Hardware Calibration translation not applied — see derive.ts.
  found.module.endpoints[found.endpointIndex].value = req.body?.value;
  const entry = deriveActuators(plant.modules).actuators.find((a) => a.capability === req.params.capability);
  res.json(entry);
});

app.post("/garden/plants/:id/culture-packs", (req, res) => {
  const plant = plantOr404(req, res);
  if (!plant) return;
  const pack = req.body as { grow_profile: GrowProfile; disables: string[]; scenarios: Scenario[]; required_capabilities: string[] };
  const missing = checkCapabilities(pack.required_capabilities ?? [], availableCapabilities(plant.modules));
  if (missing.length > 0) return missingCapabilities(res, missing);
  plant.grow_profile = pack.grow_profile;
  for (const flag of pack.disables ?? []) {
    (plant.grow_profile as unknown as Record<string, unknown>)[flag] = false;
  }
  for (const scenario of pack.scenarios ?? []) {
    state.scenarios.push({ ...scenario, target: { type: "plant", id: plant.plant_id } } as Scenario);
  }
  res.status(201).json(plant.grow_profile);
});

// ---- Scenarios (shared helpers for Plant/System/Garden-wide views) ------

function scenariosForTarget(type: "plant" | "system", id?: string): Scenario[] {
  return state.scenarios.filter((s) => {
    if (s.kind === "generic") return s.applies_to === type;
    return s.target.type === type && (type === "system" || s.target.id === id);
  });
}

app.get("/garden/plants/:id/scenarios", (req, res) => {
  const plant = plantOr404(req, res);
  if (!plant) return;
  res.json(scenariosForTarget("plant", plant.plant_id));
});
app.post("/garden/plants/:id/scenarios", (req, res) => {
  const plant = plantOr404(req, res);
  if (!plant) return;
  const scenario = req.body as Scenario;
  if (scenario.kind === "generic") return res.status(400).json({ error: "bad_request" } satisfies ApiError);
  const missing = checkCapabilities(scenario.required_capabilities ?? [], availableCapabilities(plant.modules));
  if (missing.length > 0) return missingCapabilities(res, missing);
  scenario.target = { type: "plant", id: plant.plant_id };
  state.scenarios.push(scenario);
  res.status(201).json(scenario);
});

function scenarioRoutes(idParam: string) {
  return {
    get: (req: Request, res: Response) => {
      const scenario = state.scenarios.find((s) => s.id === req.params[idParam]);
      if (!scenario) return notFound(res, "scenario");
      res.json(scenario);
    },
    put: (req: Request, res: Response) => {
      const scenario = state.scenarios.find((s) => s.id === req.params[idParam]);
      if (!scenario) return notFound(res, "scenario");
      if (scenario.kind === "generic") return res.status(405).json({ error: "not_writable" } satisfies ApiError);
      Object.assign(scenario, req.body);
      res.json(scenario);
    },
    del: (req: Request, res: Response) => {
      const idx = state.scenarios.findIndex((s) => s.id === req.params[idParam]);
      if (idx < 0) return notFound(res, "scenario");
      if (state.scenarios[idx].kind === "generic") return res.status(405).json({ error: "not_writable" } satisfies ApiError);
      state.scenarios.splice(idx, 1);
      res.status(204).end();
    },
  };
}
const scenarioById = scenarioRoutes("scenarioId");
app.get("/garden/plants/:id/scenarios/:scenarioId", scenarioById.get);
app.put("/garden/plants/:id/scenarios/:scenarioId", scenarioById.put);
app.delete("/garden/plants/:id/scenarios/:scenarioId", scenarioById.del);
app.get("/garden/system/scenarios/:scenarioId", scenarioById.get);
app.put("/garden/system/scenarios/:scenarioId", scenarioById.put);
app.delete("/garden/system/scenarios/:scenarioId", scenarioById.del);
const scenarioByGardenId = scenarioRoutes("id");
app.get("/garden/scenarios/:id", scenarioByGardenId.get);
app.put("/garden/scenarios/:id", scenarioByGardenId.put);
app.delete("/garden/scenarios/:id", scenarioByGardenId.del);

app.get("/garden/scenarios", (_req, res) => res.json(state.scenarios));

// ---- System ---------------------------------------------------------------

app.get("/garden/system", (_req, res) => res.json({ name: state.system.name }));

app.get("/garden/system/vitals", (_req, res) => res.json(deriveVitals(state.system.modules)));
app.get("/garden/system/vitals/history", (req, res) => {
  const since = typeof req.query.since === "string" ? req.query.since : undefined;
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  let records = state.system.vitals_history;
  if (since) records = records.filter((r) => r.timestamp >= since);
  res.json(records.slice(0, limit));
});
app.get("/garden/system/hardware-calibration", (_req, res) => res.json({ calibrations: state.system.hardware_calibration }));
app.get("/garden/system/settings", (_req, res) => res.json({ settings: state.system.settings }));
app.get("/garden/system/settings/:moduleId", (req, res) => {
  const entry = state.system.settings.find((s) => s.module_id === req.params.moduleId);
  if (!entry) return notFound(res, `settings for module ${req.params.moduleId}`);
  res.json(entry);
});
app.put("/garden/system/settings/:moduleId", (req, res) => {
  let entry = state.system.settings.find((s) => s.module_id === req.params.moduleId);
  if (!entry) {
    entry = { module_id: req.params.moduleId, settings: {} };
    state.system.settings.push(entry);
  }
  entry.settings = { ...entry.settings, ...req.body?.settings };
  res.json(entry);
});
app.get("/garden/system/modules", (_req, res) => res.json({ modules: state.system.modules }));
app.get("/garden/system/modules/:moduleId/endpoints/:index", (req, res) => {
  const mod = state.system.modules.find((m) => m.id === req.params.moduleId);
  const ep = mod?.endpoints[Number(req.params.index)];
  if (!mod || !ep) return notFound(res, "module/endpoint");
  res.json(ep);
});
app.put("/garden/system/modules/:moduleId/endpoints/:index", (req, res) => {
  const mod = state.system.modules.find((m) => m.id === req.params.moduleId);
  const ep = mod?.endpoints[Number(req.params.index)];
  if (!mod || !ep) return notFound(res, "module/endpoint");
  ep.value = req.body?.value;
  res.json(ep);
});
app.get("/garden/system/capabilities", (_req, res) => res.json(deriveCapabilities(state.system.modules)));
app.get("/garden/system/actuators", (_req, res) => res.json(deriveActuators(state.system.modules)));
app.put("/garden/system/actuators/:capability", (req, res) => {
  const found = findEndpointForCapability(state.system.modules, req.params.capability);
  if (!found) return notFound(res, `actuator ${req.params.capability}`);
  found.module.endpoints[found.endpointIndex].value = req.body?.value;
  const entry = deriveActuators(state.system.modules).actuators.find((a) => a.capability === req.params.capability);
  res.json(entry);
});
app.get("/garden/system/scenarios", (_req, res) => res.json(scenariosForTarget("system")));
app.post("/garden/system/scenarios", (req, res) => {
  const scenario = req.body as Scenario;
  if (scenario.kind === "generic") return res.status(400).json({ error: "bad_request" } satisfies ApiError);
  const missing = checkCapabilities(scenario.required_capabilities ?? [], availableCapabilities(state.system.modules));
  if (missing.length > 0) return missingCapabilities(res, missing);
  scenario.target = { type: "system" };
  state.scenarios.push(scenario);
  res.status(201).json(scenario);
});

// Malformed JSON from express.json() → the spec's error shape, not Express's HTML page.
app.use((err: { type?: string }, _req: Request, res: Response, next: NextFunction) => {
  if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "bad_request" } satisfies ApiError);
  next(err);
});

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
// Library-sourced data (Hardware Calibration, generic Scenarios) comes back
// from the seed, which is where the mock keeps it anyway.
function factoryReset() {
  Object.assign(state, createInitialState());
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
  console.log(`  data dir     ${DATA_DIR}`);
  if (!TLS) console.warn("  WARNING: OFL_TLS=0 — plain HTTP, violates docs/22-security.md §22.2 (debug only)");
  if (!SINGLE_CONNECTION) console.warn("  WARNING: OFL_SINGLE_CONNECTION=0 — concurrent connections allowed (debug only)");
  advertiseHeadDevice(PORT, txt())
    .then((ad) => (advertisement = ad))
    .catch((err) => console.error("mDNS self-advertisement failed (continuing without it):", err));
});

startControlServer(device, CONTROL_PORT, factoryReset);
