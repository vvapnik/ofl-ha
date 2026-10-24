// Simulated physical changes — what a real Head Device's hardware layer
// would detect on its own bus. Driven only from the 127.0.0.1 control
// server (control.ts), never through the OFL API: a Plant is never created
// or deleted through the API (docs/16 §16.1), and sensor readings come from
// the hardware, not from a client.
//
// Every module change triggers capability revalidation (docs/14 §14.4).

import { blueprint } from "./library.js";
import { buildModule, defaultSettings, newPlant, owners, state, type ModuleState, type OwnerState, type PlantState } from "./state.js";
import { revalidateScenarios } from "./scenarios.js";

export class HardwareError extends Error {}

function ownerByName(name: string): OwnerState {
  const owner = name === "system" ? state.system : state.plants.get(name);
  if (!owner) throw new HardwareError(`no plant ${name}`);
  return owner;
}

function locate(moduleId: string): { owner: OwnerState; mod: ModuleState } {
  for (const owner of owners()) {
    const mod = owner.modules.find((m) => m.id === moduleId);
    if (mod) return { owner, mod };
  }
  throw new HardwareError(`no module ${moduleId}`);
}

/** A new anchor appears: the Head Device detects a new Plant with the standard kit. */
export function connectPlant(): string {
  let id: string;
  do id = `plant-${state.nextPlantId++}`;
  while (state.plants.has(id));
  state.plants.set(id, newPlant(id));
  revalidateScenarios();
  return id;
}

/** The anchor goes away, and the Plant with it. Its Scenarios stay, as `noop`. */
export function disconnectPlant(plantId: string): void {
  if (!state.plants.delete(plantId)) throw new HardwareError(`no plant ${plantId}`);
  revalidateScenarios();
}

export function connectModule(ownerName: string, blueprintId: string): ModuleState {
  const owner = ownerByName(ownerName);
  if (!blueprint(blueprintId)) throw new HardwareError(`unknown blueprint ${blueprintId}`);
  const mod = buildModule(`mod-${state.nextModuleId++}`, blueprintId, false);
  owner.modules.push(mod);
  const settings = defaultSettings(mod);
  if (settings) owner.settings.push(settings);
  revalidateScenarios();
  return mod;
}

/** Removing a Plant's anchor removes the Plant itself. */
export function disconnectModule(moduleId: string): void {
  const { owner, mod } = locate(moduleId);
  if (mod.is_anchor && owner.scope === "plant") return disconnectPlant((owner as PlantState).plant_id);
  owner.modules.splice(owner.modules.indexOf(mod), 1);
  owner.settings = owner.settings.filter((s) => s.module_id !== moduleId);
  revalidateScenarios();
}

/** A module's own reading changes — e.g. a sensor sees drier soil. */
export function setEndpoint(moduleId: string, index: number, value: unknown): void {
  const { mod } = locate(moduleId);
  const ep = mod.endpoints.find((e) => e.index === index);
  if (!ep) throw new HardwareError(`no endpoint ${index} on ${moduleId}`);
  if (typeof value !== "number" && typeof value !== "boolean") throw new HardwareError("value must be a number or boolean");
  ep.value = value;
}

export function setFault(moduleId: string, faulted: boolean): void {
  locate(moduleId).mod.faulted = faulted;
}

/** Reboot without an uplink (`none`, clock back at the epoch) or a successful NTP sync. */
export function setTimeSource(source: unknown): void {
  if (source === "none") state.time = { source: "none", offsetMs: -Date.now() };
  else if (source === "ntp") state.time = { source: "ntp", offsetMs: 0 };
  else throw new HardwareError('source must be "none" or "ntp"');
}
