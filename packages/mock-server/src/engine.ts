// The Head Device's own control loop — docs/01 §1.3, docs/11-scenarios.md.
// Runs with no Control Panel involved: every tick it evaluates each
// generic template against every target it applies to (if that target
// currently has the required capabilities, §11.7) and each `active`
// specialized Scenario against its own target, then executes the actions
// of the ones whose condition holds, as Actuators writes (§11.4).
//
// - An action with `duration_s` is reverted to 0 when it runs out; while
//   any action of an instance is still running, that instance isn't
//   re-fired.
// - Preferences bound what Scenarios may do (docs/13 §13.1): `quiet_hours`
//   through the template's own clause, `max_brightness` as a cap on every
//   light (dimmer) command a Scenario writes. `vacation_mode` has no
//   defined effect yet, so it has none here.
// - `script` Scenarios are never run: this firmware declares no
//   `engine.script_*` capability (§11.6).
// - The `time` pseudo-field is the device's local time of day; unknown
//   (every time clause false) while the clock source is `none` (§16.6).
//
// A minimal "physics" keeps the loop from firing forever on static
// readings: an open valve raises its Plant's moisture, a running pump
// lowers the tank.

import type { ScenarioAction, ScenarioClause, ScenarioCondition } from "@ofl-panel/shared";
import { state, deviceNow, type OwnerState } from "./state.js";
import { deriveVitals, findActuator, physicalValue, writeActuator } from "./derive.js";
import { missingFor, scopeOfTarget, type Scope } from "./scenarios.js";

const MOISTURE_RISE_PER_S = 0.5; // percent while the Plant's valve is open
const TANK_DROP_PER_S = 0.1; // percent while the System pump runs (at 100 %)

type FieldValue = unknown;

function dig(obj: unknown, path: string[]): FieldValue {
  let cur = obj;
  for (const key of path) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function vitalsValue(owner: OwnerState, key: string): number | undefined {
  return deriveVitals(owner).vitals.find((v) => v.type === key)?.value;
}

function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** docs/11 §11.4 field paths, resolved for one evaluating target. */
function resolve(path: string, scope: Scope): FieldValue {
  if (path === "time") {
    if (state.time.source === "none") return undefined;
    const now = new Date(deviceNow());
    return now.getHours() * 60 + now.getMinutes();
  }
  const [head, ...rest] = path.split(".");
  const owner: OwnerState | undefined = scope.type === "plant" ? scope.plant : scope.type === "system" ? state.system : undefined;
  switch (head) {
    case "vitals":
      return owner && rest.length === 1 ? vitalsValue(owner, rest[0]) : undefined;
    case "grow_profile":
      return scope.type === "plant" ? dig(scope.plant.grow_profile, rest) : undefined;
    case "settings": {
      // settings.<module_id>.<field> — Settings is keyed by module (docs/07 §7.1).
      const entry = owner?.settings.find((s) => s.module_id === rest[0]);
      return entry ? dig(entry.settings, rest.slice(1)) : undefined;
    }
    case "garden":
      return rest[0] === "preferences" ? dig(state.preferences, rest.slice(1)) : undefined;
    case "system":
      return rest[0] === "vitals" && rest.length === 2 ? vitalsValue(state.system, rest[1]) : undefined;
    default:
      return undefined;
  }
}

function inWindow(minutes: number, window: { from: string; to: string }): boolean {
  const from = minutesOfDay(window.from);
  const to = minutesOfDay(window.to);
  return from <= to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}

const isWindow = (v: unknown): v is { from: string; to: string } =>
  typeof v === "object" && v !== null && typeof (v as { from?: unknown }).from === "string";

/** Unknown operands make a clause false — never fire on missing data. */
function contains(left: FieldValue, right: FieldValue): boolean | undefined {
  if (Array.isArray(right)) return right.includes(left);
  if (isWindow(right) && typeof left === "number") return inWindow(left, right);
  return undefined;
}

function evaluateClause(clause: ScenarioClause, scope: Scope): boolean {
  const left = resolve(clause.field, scope);
  const v = clause.value;
  const right = typeof v === "object" && v !== null && !Array.isArray(v) && "field" in v ? resolve(v.field, scope) : v;
  if (left === undefined || right === undefined) return false;
  switch (clause.op) {
    case "eq":
      return left === right;
    case "ne":
      return left !== right;
    case "lt":
      return typeof left === "number" && typeof right === "number" && left < right;
    case "lte":
      return typeof left === "number" && typeof right === "number" && left <= right;
    case "gt":
      return typeof left === "number" && typeof right === "number" && left > right;
    case "gte":
      return typeof left === "number" && typeof right === "number" && left >= right;
    case "in":
      return contains(left, right) === true;
    case "not_in": {
      // A `null` window (no quiet hours set) contains nothing.
      if (right === null) return true;
      return contains(left, right) === false;
    }
  }
}

export function evaluate(condition: ScenarioCondition, scope: Scope): boolean {
  const results = condition.clauses.map((c) => evaluateClause(c, scope));
  return condition.combinator === "all" ? results.every(Boolean) : results.some(Boolean);
}

// ---- Execution ----------------------------------------------------------------

const running = new Map<string, number>(); // instance key → until (ms)

function ownerFor(action: ScenarioAction, scope: Scope): { owner: OwnerState; capability: string } {
  if (action.capability.startsWith("system.")) return { owner: state.system, capability: action.capability.slice(7) };
  return { owner: scope.type === "plant" ? scope.plant : state.system, capability: action.capability };
}

function execute(key: string, actions: ScenarioAction[], scope: Scope): void {
  let longest = 0;
  for (const action of actions) {
    const { owner, capability } = ownerFor(action, scope);
    const cap = capability === "dimmer" ? state.preferences.max_brightness : null;
    try {
      if (!writeActuator(owner, capability, action.value, cap)) continue;
    } catch {
      console.warn(`[engine] ${key}: ${action.capability}=${action.value} is not a valid value`);
      continue;
    }
    if (action.duration_s) {
      longest = Math.max(longest, action.duration_s);
      setTimeout(() => writeActuator(owner, capability, 0), action.duration_s * 1000);
    }
  }
  if (longest > 0) running.set(key, Date.now() + longest * 1000);
  console.log(`[engine] ${key} fired`);
}

function consider(key: string, condition: ScenarioCondition, actions: ScenarioAction[], scope: Scope): void {
  if ((running.get(key) ?? 0) > Date.now()) return;
  running.delete(key);
  if (evaluate(condition, scope)) execute(key, actions, scope);
}

function tick(): void {
  for (const s of state.scenarios) {
    if (s.kind === "generic") {
      const scopes: Scope[] =
        s.applies_to === "plant"
          ? Array.from(state.plants.values(), (plant) => ({ type: "plant" as const, plant }))
          : [{ type: s.applies_to }];
      for (const scope of scopes) {
        if (missingFor(s.required_capabilities, scope).length > 0) continue;
        const where = scope.type === "plant" ? scope.plant.plant_id : scope.type;
        consider(`${s.id}@${where}`, s.condition, s.actions, scope);
      }
    } else if (s.kind === "specialized" && s.status === "active") {
      const scope = scopeOfTarget(s.target);
      if (scope) consider(s.id, s.condition, s.actions, scope);
    }
  }
}

// ---- Physics ------------------------------------------------------------------

function isOn(owner: OwnerState, capability: string): number {
  const found = findActuator(owner, capability);
  return found ? physicalValue(found.mod, found.ep) : 0;
}

function adjustSensors(owner: OwnerState, type: string, delta: number): void {
  for (const mod of owner.modules) {
    for (const ep of mod.endpoints) {
      if (ep.type !== type || typeof ep.value !== "number") continue;
      ep.value = Math.round(Math.min(100, Math.max(0, ep.value + delta)) * 10) / 10;
    }
  }
}

function physics(dtS: number): void {
  for (const plant of state.plants.values()) {
    if (isOn(plant, "valve") > 0) adjustSensors(plant, "moisture", MOISTURE_RISE_PER_S * dtS);
  }
  const pump = isOn(state.system, "pump");
  if (pump > 0) adjustSensors(state.system, "water_level", -TANK_DROP_PER_S * (pump / 100) * dtS);
}

export function startEngine(tickMs: number): void {
  let last = Date.now();
  setInterval(() => {
    const now = Date.now();
    physics((now - last) / 1000);
    last = now;
    tick();
  }, tickMs).unref();
}
