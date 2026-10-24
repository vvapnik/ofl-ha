// Scenario storage rules — docs/11-scenarios.md, docs/14-capabilities.md §14.4.
//
// - One collection (`state.scenarios`); the Plant/System paths are views
//   scoped by `target` (generic ones by `applies_to`), so a Scenario is
//   only reachable through the path of the target it belongs to (§16.5).
// - `id`, `target` and `status` belong to the device: ids are assigned
//   here (a Culture Pack imported into two Plants would otherwise bring the
//   same library id twice), `target` comes from the path, `status` from
//   capability validation.
// - At most 32 Scenarios per Garden (§11.4); the spec names no error for
//   a full store, so the mock reuses credential storage's `no_free_slots`.

import type { Scenario, ScenarioTarget } from "@ofl-panel/shared";
import { state, type OwnerState, type PlantState } from "./state.js";
import { moduleCapabilities } from "./derive.js";
import { badRequest, missingCapabilities, noFreeSlots, notFound, notWritable } from "./http.js";
import { MAX_SCENARIOS, parseScenario, type ScenarioInput } from "./validate.js";

/** A Scenario's evaluation scope: one Plant, the System, or the Garden. */
export type Scope = { type: "plant"; plant: PlantState } | { type: "system" } | { type: "garden" };

export function scopeOf(owner: OwnerState): Scope {
  return owner.scope === "plant" ? { type: "plant", plant: owner as PlantState } : { type: "system" };
}

export function targetOf(scope: Scope): ScenarioTarget {
  return scope.type === "plant" ? { type: "plant", id: scope.plant.plant_id } : { type: scope.type };
}

export function scopeOfTarget(target: ScenarioTarget): Scope | undefined {
  if (target.type === "plant") {
    const plant = target.id ? state.plants.get(target.id) : undefined;
    return plant && { type: "plant", plant };
  }
  return { type: target.type };
}

/**
 * docs/14 §14.1: a Plant's available capabilities are its own module flags
 * ∪ engine flags; System's and the Garden's are System's flags ∪ engine.
 * A `system.`-prefixed key (docs/20 §20.3) is checked against System.
 */
export function missingFor(required: string[], scope: Scope): string[] {
  const engine = state.engine_capabilities;
  const system = new Set([...moduleCapabilities(state.system), ...engine]);
  const own = scope.type === "plant" ? new Set([...moduleCapabilities(scope.plant), ...engine]) : system;
  return required.filter((key) => (key.startsWith("system.") ? !system.has(key.slice(7)) : !own.has(key)));
}

function belongsTo(s: Scenario, owner: OwnerState): boolean {
  if (s.kind === "generic") return s.applies_to === owner.scope;
  if (owner.scope === "system") return s.target.type === "system";
  return s.target.type === "plant" && s.target.id === (owner as PlantState).plant_id;
}

export function scenariosOf(owner: OwnerState): Scenario[] {
  return state.scenarios.filter((s) => belongsTo(s, owner));
}

/** By id, optionally only within one owner's view — anything else is 404. */
export function findScenario(id: string, owner?: OwnerState): Scenario {
  const scenario = state.scenarios.find((s) => s.id === id);
  if (!scenario || (owner && !belongsTo(scenario, owner))) throw notFound();
  return scenario;
}

function nextId(): string {
  let id: string;
  do id = `scn-${state.nextScenarioId++}`;
  while (state.scenarios.some((s) => s.id === id));
  return id;
}

function build(input: ScenarioInput, id: string, target: ScenarioTarget): Scenario {
  return { id, ...input, target, status: "active" } as Scenario;
}

/** Validates (422) and builds without storing — so a Culture Pack can check everything first. */
export function prepare(input: ScenarioInput, scope: Scope): Scenario {
  const missing = missingFor(input.required_capabilities, scope);
  if (missing.length > 0) throw missingCapabilities(missing);
  return build(input, nextId(), targetOf(scope));
}

export function ensureRoom(count: number): void {
  if (state.scenarios.length + count > MAX_SCENARIOS) throw noFreeSlots();
}

export function addScenario(body: unknown, scope: Scope): Scenario {
  const input = parseScenario(body);
  ensureRoom(1);
  const scenario = prepare(input, scope);
  state.scenarios.push(scenario);
  return scenario;
}

/** PUT replaces the client-owned part; `id`/`kind`/`target` can't be changed (400). */
export function replaceScenario(existing: Scenario, body: unknown): Scenario {
  if (existing.kind === "generic") throw notWritable();
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.id !== undefined && b.id !== existing.id) throw badRequest();
  if (b.target !== undefined && JSON.stringify(b.target) !== JSON.stringify(existing.target)) throw badRequest();
  const input = parseScenario({ kind: existing.kind, ...b });
  if (input.kind !== existing.kind) throw badRequest();
  const scope = scopeOfTarget(existing.target);
  if (!scope) throw notFound();
  const missing = missingFor(input.required_capabilities, scope);
  if (missing.length > 0) throw missingCapabilities(missing);
  const updated = build(input, existing.id, existing.target);
  state.scenarios[state.scenarios.indexOf(existing)] = updated;
  return updated;
}

export function deleteScenario(existing: Scenario): void {
  if (existing.kind === "generic") throw notWritable();
  state.scenarios.splice(state.scenarios.indexOf(existing), 1);
}

/**
 * docs/14 §14.4 revalidation, run after every physical reconfiguration:
 * a specialized/script Scenario whose target lost a required capability —
 * or whose Plant disappeared with its anchor — becomes `noop`, and comes
 * back `active` once it validates again.
 */
export function revalidateScenarios(): void {
  for (const s of state.scenarios) {
    if (s.kind === "generic") continue;
    const scope = scopeOfTarget(s.target);
    const next = scope && missingFor(s.required_capabilities, scope).length === 0 ? "active" : "noop";
    if (s.status !== next) {
      console.log(`[scenarios] ${s.id} → ${next}`);
      s.status = next;
    }
  }
}
