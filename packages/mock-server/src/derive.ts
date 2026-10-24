// The normalized layer (Vitals/Actuators/Capabilities/Hardware Calibration,
// docs 4/6/14/17) derived from an owner's raw modules (docs/09).
//
// Hardware Calibration is applied on every read and write (§4.2, §17.3):
// the curve is piecewise-linear between its points and clamped at the ends.
// A module with no calibration entry for an endpoint passes the value
// through unchanged. Grow Profile `sensor_calibration` (docs/08 §8.5) is
// applied after it, for Plant Vitals only. Settings' `mount_height_mm` is
// NOT folded in: the spec says it's needed, but doesn't define the formula.

import type {
  Vitals,
  Actuators,
  ActuatorEntry,
  Capabilities,
  EndpointEntry,
  HardwareCalibrationCurvePoint,
  HardwareCalibrationEntry,
} from "@ofl-panel/shared";
import { capabilityCatalogEntry } from "@ofl-panel/shared";
import { calibrationFor } from "./library.js";
import { state, type ModuleState, type OwnerState, type PlantState } from "./state.js";
import { badRequest } from "./http.js";

const SENSOR_MODES = new Set(["read", "rw"]);
const ACTUATOR_MODES = new Set(["write", "rw"]);

const round = (n: number) => Math.round(n * 100) / 100;

function interpolate(points: { x: number; y: number }[], x: number): number {
  const sorted = [...points].sort((a, b) => a.x - b.x);
  if (x <= sorted[0].x) return sorted[0].y;
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    if (x <= b.x) return b.x === a.x ? b.y : a.y + ((x - a.x) * (b.y - a.y)) / (b.x - a.x);
  }
  return sorted[sorted.length - 1].y;
}

const commandToPhysical = (curve: HardwareCalibrationCurvePoint[], command: number) =>
  interpolate(curve.map((p) => ({ x: p.command, y: p.physical })), command);
const physicalToCommand = (curve: HardwareCalibrationCurvePoint[], physical: number) =>
  interpolate(curve.map((p) => ({ x: p.physical, y: p.command })), physical);

function curveFor(mod: ModuleState, ep: EndpointEntry): HardwareCalibrationCurvePoint[] | undefined {
  const curve = calibrationFor(mod.blueprint_id, ep.type)?.calibration.curve;
  return curve && curve.length > 0 ? curve : undefined;
}

const rawNumber = (value: number | boolean) => (typeof value === "boolean" ? Number(value) : value);

/** An endpoint's current value in physical units. */
export function physicalValue(mod: ModuleState, ep: EndpointEntry): number {
  const curve = curveFor(mod, ep);
  const raw = rawNumber(ep.value);
  return round(curve ? commandToPhysical(curve, raw) : raw);
}

/** docs/06 §6.3: one entry per distinct (blueprint_id, endpoint_type) actually present. */
export function deriveHardwareCalibration(owner: OwnerState): HardwareCalibrationEntry[] {
  const entries = new Map<string, HardwareCalibrationEntry>();
  for (const mod of owner.modules) {
    for (const ep of mod.endpoints) {
      const entry = calibrationFor(mod.blueprint_id, ep.type);
      if (entry) entries.set(`${mod.blueprint_id}\0${ep.type}`, entry);
    }
  }
  return Array.from(entries.values());
}

export function deriveVitals(owner: OwnerState): Vitals {
  const substrate = owner.scope === "plant" ? (owner as PlantState).grow_profile.sensor_calibration : undefined;
  const vitals: Vitals["vitals"] = [];
  for (const mod of owner.modules) {
    for (const ep of mod.endpoints) {
      if (!SENSOR_MODES.has(ep.mode)) continue;
      const entry = capabilityCatalogEntry(ep.type);
      if (!entry || entry.kind !== "sensor") continue;
      let value = physicalValue(mod, ep);
      const offset = (substrate?.[entry.key] as { offset?: number } | undefined)?.offset;
      if (typeof offset === "number") {
        value += offset;
        if (entry.unit === "percent") value = Math.min(100, Math.max(0, value));
      }
      vitals.push({ type: entry.key, value: round(value), unit: entry.unit });
    }
  }
  return { vitals };
}

/** The endpoint backing an actuator capability — never a sensor or a read-only endpoint. */
export function findActuator(owner: OwnerState, capability: string): { mod: ModuleState; ep: EndpointEntry } | undefined {
  for (const mod of owner.modules) {
    for (const ep of mod.endpoints) {
      const entry = capabilityCatalogEntry(ep.type);
      if (entry?.kind === "actuator" && entry.key === capability && ACTUATOR_MODES.has(ep.mode)) return { mod, ep };
    }
  }
  return undefined;
}

function actuatorEntry(mod: ModuleState, ep: EndpointEntry): ActuatorEntry {
  const entry = capabilityCatalogEntry(ep.type)!;
  return { capability: entry.key, value: physicalValue(mod, ep), unit: entry.unit };
}

export function deriveActuators(owner: OwnerState): Actuators {
  const actuators: ActuatorEntry[] = [];
  const seen = new Set<string>();
  for (const mod of owner.modules) {
    for (const ep of mod.endpoints) {
      const entry = capabilityCatalogEntry(ep.type);
      if (entry?.kind !== "actuator" || !ACTUATOR_MODES.has(ep.mode) || seen.has(entry.key)) continue;
      seen.add(entry.key);
      actuators.push(actuatorEntry(mod, ep));
    }
  }
  return { actuators };
}

export function getActuator(owner: OwnerState, capability: string): ActuatorEntry | undefined {
  const found = findActuator(owner, capability);
  return found && actuatorEntry(found.mod, found.ep);
}

function commandRange(format: string): [number, number] | undefined {
  const m = /^(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)$/.exec(format);
  return m ? [Number(m[1]), Number(m[2])] : undefined;
}

/**
 * docs/17 §17.3 PUT: validates a physical-unit value for the capability's
 * unit, converts it through Hardware Calibration into the module's command
 * range, and writes it. `maxCommandPercent` is the Preferences brightness
 * cap a Scenario-driven light write is bound by (docs/13 §13.1).
 * Returns undefined if the owner has no such actuator.
 */
export function writeActuator(
  owner: OwnerState,
  capability: string,
  value: unknown,
  maxCommandPercent?: number | null,
): ActuatorEntry | undefined {
  const found = findActuator(owner, capability);
  if (!found) return undefined;
  const { mod, ep } = found;
  const unit = capabilityCatalogEntry(ep.type)!.unit;

  let physical: number;
  if (unit === "binary") {
    if (value === true || value === 1) physical = 1;
    else if (value === false || value === 0) physical = 0;
    else throw badRequest();
  } else {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw badRequest();
    if (unit === "percent" && value > 100) throw badRequest();
    physical = value;
  }

  const curve = curveFor(mod, ep);
  let command = curve ? physicalToCommand(curve, physical) : physical;
  const range = commandRange(ep.format);
  if (range) {
    command = Math.min(range[1], Math.max(range[0], command));
    if (typeof maxCommandPercent === "number") {
      command = Math.min(command, range[0] + ((range[1] - range[0]) * maxCommandPercent) / 100);
    }
    command = Math.round(command); // a module's "0-100" command range is integral
  }
  ep.value = command;
  return actuatorEntry(mod, ep);
}

export function moduleCapabilities(owner: OwnerState): string[] {
  const keys = new Set<string>();
  for (const mod of owner.modules) {
    for (const ep of mod.endpoints) {
      const entry = capabilityCatalogEntry(ep.type);
      if (entry) keys.add(entry.key);
    }
  }
  return Array.from(keys);
}

export function deriveCapabilities(owner: OwnerState): Capabilities {
  return { modules: moduleCapabilities(owner) };
}

/** docs/21 §21.2: `problem` if any module in the group is faulted or unreachable. */
export function ownerStatus(owner: OwnerState): "ok" | "problem" {
  return owner.modules.some((m) => m.faulted) ? "problem" : "ok";
}

/** docs/21 §21.1: `problem` if System or any Plant currently has a faulted module. */
export function gardenStatus(): "ok" | "problem" {
  const all = [state.system, ...state.plants.values()];
  return all.some((o) => ownerStatus(o) === "problem") ? "problem" : "ok";
}
