// Request body validation — docs/16-rest-api.md §16.2 `400 bad_request`:
// "Malformed JSON or a field fails basic type/shape validation". Every
// parser throws HttpError(400) and returns only the fields the spec
// defines; unknown extra fields are dropped rather than stored.

import type {
  GrowProfile,
  Preferences,
  ScenarioAction,
  ScenarioClause,
  ScenarioCondition,
  ScenarioLiteral,
  ScenarioOp,
} from "@ofl-panel/shared";
import { badRequest } from "./http.js";

type Obj = Record<string, unknown>;

export const isObject = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function object(v: unknown): Obj {
  if (!isObject(v)) throw badRequest();
  return v;
}

function string(v: unknown, { nonEmpty = false } = {}): string {
  if (typeof v !== "string" || (nonEmpty && v.length === 0)) throw badRequest();
  return v;
}

function number(v: unknown, min = -Infinity, max = Infinity): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw badRequest();
  return v;
}

function boolean(v: unknown): boolean {
  if (typeof v !== "boolean") throw badRequest();
  return v;
}

function stringList(v: unknown): string[] {
  if (!Array.isArray(v)) throw badRequest();
  return v.map((s) => string(s, { nonEmpty: true }));
}

const optional = <T>(v: unknown, parse: (v: unknown) => T): T | undefined => (v === undefined ? undefined : parse(v));

// ---- Garden / Plant identity (PUT /garden, PUT /garden/plants/{id}) --------

export function parseNameDescription(body: unknown): { name?: string; description?: string } {
  const o = object(body);
  return { name: optional(o.name, (v) => string(v)), description: optional(o.description, (v) => string(v)) };
}

// ---- Preferences (docs/13 §13.2) --------------------------------------------

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function quietHours(v: unknown): Preferences["quiet_hours"] {
  if (v === null) return null;
  const o = object(v);
  const from = string(o.from);
  const to = string(o.to);
  if (!HHMM.test(from) || !HHMM.test(to)) throw badRequest();
  return { from, to };
}

/** Partial update: each standard field present in the body replaces the stored one. */
export function parsePreferences(body: unknown, current: Preferences): Preferences {
  const o = object(body);
  const next = { ...current };
  if (o.quiet_hours !== undefined) next.quiet_hours = quietHours(o.quiet_hours);
  if (o.max_brightness !== undefined) next.max_brightness = o.max_brightness === null ? null : number(o.max_brightness, 0, 100);
  if (o.vacation_mode !== undefined) next.vacation_mode = boolean(o.vacation_mode);
  return next;
}

// ---- Settings (docs/07 §7.3) ---------------------------------------------------

/** PUT .../settings/{module_id} body `{ settings }` — replaces that module's entry. */
export function parseSettings(body: unknown): Record<string, unknown> {
  const settings = object(object(body).settings);
  for (const [key, value] of Object.entries(settings)) {
    if (key === "mount_height_mm") {
      if (!Number.isInteger(value)) throw badRequest();
      number(value, 0, 0xffffffff);
    } else if (!["number", "string", "boolean"].includes(typeof value)) {
      throw badRequest();
    }
  }
  return settings;
}

// ---- Grow Profile (docs/08 §8.2) ---------------------------------------------

function range(v: unknown, min: number, max: number): { min: number; max: number } {
  const o = object(v);
  const r = { min: number(o.min, min, max), max: number(o.max, min, max) };
  if (r.min > r.max) throw badRequest();
  return r;
}

function targets(v: unknown): GrowProfile["targets"] {
  const o = object(v);
  const out: GrowProfile["targets"] = {};
  for (const [key, value] of Object.entries(o)) {
    if (key === "moisture_percent") out[key] = range(value, 0, 100);
    else if (key === "light_hours_per_day") out[key] = number(value, 0, 24);
    else if (key === "light_lux") out[key] = number(value, 0);
    // Extensible: other targets are a number or a { min, max } range.
    else out[key] = typeof value === "number" ? number(value) : range(value, -Infinity, Infinity);
  }
  return out;
}

function sensorCalibration(v: unknown): NonNullable<GrowProfile["sensor_calibration"]> {
  const out: Record<string, { offset: number }> = {};
  for (const [key, value] of Object.entries(object(v))) out[key] = { offset: number(object(value).offset) };
  return out;
}

/** PUT .../grow-profile replaces the whole profile, so `species`/`targets`/`required_capabilities` are required. */
export function parseGrowProfile(body: unknown): GrowProfile {
  const o = object(body);
  const profile: Obj = { species: string(o.species) };
  for (const [key, value] of Object.entries(o)) {
    if (key.endsWith("_enabled")) profile[key] = boolean(value);
  }
  profile.targets = targets(o.targets);
  if (o.sensor_calibration !== undefined) profile.sensor_calibration = sensorCalibration(o.sensor_calibration);
  profile.required_capabilities = stringList(o.required_capabilities);
  return profile as unknown as GrowProfile;
}

// ---- Scenarios (docs/11 §11.3-§11.6) -------------------------------------------

export const MAX_CLAUSES = 8;
export const MAX_ACTIONS = 4;
export const MAX_SCENARIOS = 32;

const OPS: ScenarioOp[] = ["eq", "ne", "lt", "lte", "gt", "gte", "in", "not_in"];
const primitive = (v: unknown) => ["number", "string", "boolean"].includes(typeof v);

function clauseValue(v: unknown): ScenarioClause["value"] {
  if (primitive(v)) return v as ScenarioLiteral;
  if (Array.isArray(v) && v.every(primitive)) return v as ScenarioLiteral[];
  const o = object(v);
  if ("field" in o) return { field: string(o.field, { nonEmpty: true }) };
  // A literal time window, same shape as Preferences quiet_hours.
  return quietHours(o)!;
}

function condition(v: unknown): ScenarioCondition {
  const o = object(v);
  if (o.combinator !== "all" && o.combinator !== "any") throw badRequest();
  if (!Array.isArray(o.clauses) || o.clauses.length > MAX_CLAUSES) throw badRequest();
  return {
    combinator: o.combinator,
    clauses: o.clauses.map((c) => {
      const clause = object(c);
      if (!OPS.includes(clause.op as ScenarioOp)) throw badRequest();
      return { field: string(clause.field, { nonEmpty: true }), op: clause.op as ScenarioOp, value: clauseValue(clause.value) };
    }),
  };
}

function actions(v: unknown): ScenarioAction[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_ACTIONS) throw badRequest();
  return v.map((a) => {
    const o = object(a);
    if (typeof o.value !== "number" && typeof o.value !== "boolean") throw badRequest();
    const action: ScenarioAction = { capability: string(o.capability, { nonEmpty: true }), value: o.value };
    if (o.duration_s !== undefined) action.duration_s = number(o.duration_s, 0);
    return action;
  });
}

/** The client-owned part of a specialized/script Scenario. `id`, `target` and `status` are the device's. */
export type ScenarioInput =
  | { kind: "specialized"; category: string; condition: ScenarioCondition; actions: ScenarioAction[]; required_capabilities: string[] }
  | { kind: "script"; category: string; language: string; source: string; required_capabilities: string[] };

export function parseScenario(body: unknown): ScenarioInput {
  const o = object(body);
  const category = string(o.category, { nonEmpty: true });
  const required_capabilities = stringList(o.required_capabilities);
  if (o.kind === "specialized") {
    return { kind: "specialized", category, condition: condition(o.condition), actions: actions(o.actions), required_capabilities };
  }
  if (o.kind === "script") {
    return { kind: "script", category, language: string(o.language, { nonEmpty: true }), source: string(o.source), required_capabilities };
  }
  throw badRequest(); // including "generic": firmware-only (§11.1)
}

// ---- Culture Pack (docs/15 §15.1) ---------------------------------------------

export interface CulturePackInput {
  grow_profile: GrowProfile;
  disables: string[];
  scenarios: ScenarioInput[];
  required_capabilities: string[];
}

export function parseCulturePack(body: unknown): CulturePackInput {
  const o = object(body);
  const disables = stringList(o.disables ?? []);
  if (!disables.every((flag) => flag.endsWith("_enabled"))) throw badRequest();
  if (!Array.isArray(o.scenarios)) throw badRequest();
  return {
    grow_profile: parseGrowProfile(o.grow_profile),
    disables,
    scenarios: o.scenarios.map(parseScenario),
    required_capabilities: stringList(o.required_capabilities),
  };
}

// ---- Time (docs/16 §16.6) -----------------------------------------------------

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]00:?00)$/;

export function parseTime(body: unknown): number {
  const time = string(object(body).time);
  const ms = Date.parse(time);
  if (!ISO_UTC.test(time) || Number.isNaN(ms)) throw badRequest();
  return ms;
}

// ---- Vitals History query (docs/16 §16.5) ---------------------------------------

export const HISTORY_LIMIT_CAP = 500;
const HISTORY_LIMIT_DEFAULT = 100;

export function parseHistoryQuery(query: Obj): { since?: number; limit: number } {
  let since: number | undefined;
  if (query.since !== undefined) {
    since = typeof query.since === "string" ? Date.parse(query.since) : NaN;
    if (Number.isNaN(since)) throw badRequest();
  }
  let limit = HISTORY_LIMIT_DEFAULT;
  if (query.limit !== undefined) {
    limit = Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1) throw badRequest();
  }
  return { since, limit: Math.min(limit, HISTORY_LIMIT_CAP) };
}

// ---- Modules raw write (docs/09 §9.3) ---------------------------------------------

/** Raw passthrough — no range check, only that a module can hold the value at all. */
export function parseEndpointValue(body: unknown): number | boolean {
  const value = object(body).value;
  if (typeof value === "boolean") return value;
  return number(value);
}
