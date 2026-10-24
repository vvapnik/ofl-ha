// TypeScript mirror of the Open Farm Link entities (open-farm-link/docs/).
// Hand-maintained — no codegen yet. Keep field names/shapes in sync with
// the spec; when they drift, the spec is the source of truth.

export type PlantStatus = "ok" | "problem";

// docs/04-vitals.md
export interface VitalsEntry {
  type: string; // Capability Catalog key (docs/20)
  value: number;
  unit: string;
}
export interface Vitals {
  vitals: VitalsEntry[];
}

// docs/05-vitals-history.md
export interface VitalsHistoryRecord {
  owner_id: string | null;
  timestamp: string; // ISO 8601 UTC
  interval: number; // seconds; 0 = raw sample
  vitals: VitalsEntry[];
}

// docs/06-hardware-calibration.md — curve shape is explicitly illustrative
// in the spec, not finalized. Keyed by blueprint_id + endpoint_type
// (model-level), NOT stored per-module — see docs/06 §6.3.
export interface HardwareCalibrationCurvePoint {
  command: number;
  physical: number;
  unit: string;
}
export interface HardwareCalibrationEntry {
  blueprint_id: string; // references a module's blueprint_id (docs/09), not owned here
  endpoint_type: string;
  calibration: {
    curve: HardwareCalibrationCurvePoint[];
  };
}
export interface HardwareCalibrationList {
  calibrations: HardwareCalibrationEntry[];
}

// docs/07-settings.md — keyed by module_id (instance-level), NOT
// blueprint_id — see docs/07 §7.1.
export interface SettingsEntry {
  module_id: string;
  settings: {
    mount_height_mm?: number;
    [key: string]: unknown;
  };
}
export interface SettingsList {
  settings: SettingsEntry[];
}

// docs/08-grow-profile.md
export interface GrowProfile {
  species: string;
  watering_enabled: boolean;
  lighting_enabled: boolean;
  climate_enabled: boolean;
  targets: {
    moisture_percent?: { min: number; max: number };
    light_lux?: number;
    light_hours_per_day?: number;
    [key: string]: unknown;
  };
  sensor_calibration?: {
    moisture?: { offset: number };
    [key: string]: unknown;
  };
  required_capabilities: string[];
}

// docs/09-modules.md
export interface EndpointEntry {
  index: number;
  type: string; // Endpoint Type (docs/19), raw
  mode: "read" | "write" | "rw";
  format: string;
  value: number | boolean;
}
export interface ModuleEntry {
  id: string;
  class: string; // Module Class (docs/18)
  is_anchor: boolean;
  blueprint_id: string; // hardware model identity — lives ONLY here (docs/09 §9.2)
  endpoints: EndpointEntry[];
}
export interface Modules {
  modules: ModuleEntry[];
}

// docs/14-capabilities.md
export interface Capabilities {
  modules: string[]; // Capability Catalog keys currently present
}
export interface EngineCapabilities {
  engine: string[]; // engine.* flags, Garden-level only
}

// docs/17-actuators.md
export interface ActuatorEntry {
  capability: string; // Capability Catalog key
  value: number | boolean;
  unit: string;
}
export interface Actuators {
  actuators: ActuatorEntry[];
}

// docs/11-scenarios.md
export type ScenarioOp = "eq" | "ne" | "lt" | "lte" | "gt" | "gte" | "in" | "not_in";
export interface ScenarioFieldRef {
  field: string;
}
// A literal `in`/`not_in` operand: a list, or a time-of-day window shaped
// like Preferences quiet_hours.
export type ScenarioLiteral = number | string | boolean;
export interface ScenarioClause {
  field: string;
  op: ScenarioOp;
  value: ScenarioLiteral | ScenarioLiteral[] | ScenarioFieldRef | { from: string; to: string };
}
export interface ScenarioCondition {
  combinator: "all" | "any";
  clauses: ScenarioClause[];
}
export interface ScenarioAction {
  capability: string;
  value: number | boolean;
  duration_s?: number;
}
export interface ScenarioTarget {
  type: "plant" | "system" | "garden";
  id?: string; // absent for "system"/"garden"
}

interface ScenarioBase {
  id: string;
  category: string;
  required_capabilities: string[];
}
export interface GenericScenario extends ScenarioBase {
  kind: "generic";
  applies_to: "plant" | "system" | "garden";
  condition: ScenarioCondition;
  actions: ScenarioAction[];
}
export interface SpecializedScenario extends ScenarioBase {
  kind: "specialized";
  target: ScenarioTarget;
  status: "active" | "noop";
  condition: ScenarioCondition;
  actions: ScenarioAction[];
}
export interface ScriptScenario extends ScenarioBase {
  kind: "script";
  target: ScenarioTarget;
  status: "active" | "noop";
  language: string;
  source: string;
}
export type Scenario = GenericScenario | SpecializedScenario | ScriptScenario;

// docs/13-preferences.md
export interface Preferences {
  quiet_hours?: { from: string; to: string } | null;
  max_brightness?: number | null;
  vacation_mode?: boolean;
  [key: string]: unknown;
}

// docs/15-culture-pack.md
export interface CulturePack {
  id: string;
  grow_profile: GrowProfile;
  disables: string[];
  scenarios: Scenario[];
  required_capabilities: string[];
}

// docs/21-system-fields.md
export interface GardenSummary {
  garden_id: string;
  name: string;
  description: string;
  protocol_version: string;
  status: PlantStatus;
  type: string; // docs/21-system-fields.md §21.4 — informational, e.g. "ogr"
  plant_ids: string[];
}
export interface PlantSummary {
  plant_id: string;
  name: string;
  description: string;
  status: PlantStatus;
}

// docs/16-rest-api.md §16.6
export interface HeadDeviceTime {
  time: string; // ISO 8601 UTC
  source: "ntp" | "manual" | "none";
}

// docs/16-rest-api.md §16.2
export interface ApiError {
  error: string;
  missing?: string[];
}

// docs/22-security.md §22.4
export interface PairChallengeRequest {
  nonce: string; // base64, >= 16 bytes
}
export interface PairChallengeResponse {
  proof: string; // base64 HMAC-SHA256(setup code, nonce ‖ SHA-256(SPKI))
  fingerprint: string;
  garden_id: string;
}
export type CredentialMethod = "token" | "password";
export type PairRequest =
  | { method: "token"; name: string; setup_code?: string }
  | { method: "password"; name: string; username: string; password: string; setup_code?: string };
export interface PairResponse {
  client_id: string;
  token?: string; // method "token" only
  garden_id: string;
  fingerprint: string;
}

// docs/22-security.md §22.6
export interface ClientEntry {
  client_id: string;
  name: string;
  method: CredentialMethod;
  username?: string;
}
