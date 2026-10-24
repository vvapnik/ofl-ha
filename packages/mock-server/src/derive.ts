// Derives the normalized layer (Vitals/Actuators/Capabilities, docs 4/14/17)
// from a module list (docs/09). Real Hardware Calibration curve application
// is not implemented here — the mock passes raw endpoint values through
// unchanged, since exercising the panel's API surface matters more for this
// mock than numerically accurate calibration. Good enough to develop the UI
// against; not a stand-in for a real Head Device's calibration behavior.

import type { ModuleEntry, Vitals, Actuators, Capabilities } from "@ofl-panel/shared";
import { capabilityCatalogEntry } from "@ofl-panel/shared";

const SENSOR_MODES = new Set(["read", "rw"]);
const ACTUATOR_MODES = new Set(["write", "rw"]);

export function deriveVitals(modules: ModuleEntry[]): Vitals {
  const vitals: Vitals["vitals"] = [];
  for (const mod of modules) {
    for (const ep of mod.endpoints) {
      if (!SENSOR_MODES.has(ep.mode)) continue;
      const entry = capabilityCatalogEntry(ep.type);
      if (!entry || entry.kind !== "sensor") continue;
      vitals.push({ type: entry.key, value: Number(ep.value), unit: entry.unit });
    }
  }
  return { vitals };
}

export function deriveActuators(modules: ModuleEntry[]): Actuators {
  const actuators: Actuators["actuators"] = [];
  for (const mod of modules) {
    for (const ep of mod.endpoints) {
      if (!ACTUATOR_MODES.has(ep.mode)) continue;
      const entry = capabilityCatalogEntry(ep.type);
      if (!entry || entry.kind !== "actuator") continue;
      actuators.push({ capability: entry.key, value: ep.value as number | boolean, unit: entry.unit });
    }
  }
  return { actuators };
}

export function deriveCapabilities(modules: ModuleEntry[]): Capabilities {
  const keys = new Set<string>();
  for (const mod of modules) {
    for (const ep of mod.endpoints) {
      const entry = capabilityCatalogEntry(ep.type);
      if (entry) keys.add(entry.key);
    }
  }
  return { modules: Array.from(keys) };
}

// Resolves a capability write back to the underlying module/endpoint,
// mirroring what a real Head Device does for an Actuators PUT or a
// Scenario action (docs/17 §17.3).
export function findEndpointForCapability(
  modules: ModuleEntry[],
  capability: string
): { module: ModuleEntry; endpointIndex: number } | undefined {
  for (const mod of modules) {
    const idx = mod.endpoints.findIndex((ep) => {
      const entry = capabilityCatalogEntry(ep.type);
      return entry?.key === capability;
    });
    if (idx >= 0) return { module: mod, endpointIndex: idx };
  }
  return undefined;
}
