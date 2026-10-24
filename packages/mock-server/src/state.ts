import type {
  ModuleEntry,
  GrowProfile,
  SettingsEntry,
  VitalsHistoryRecord,
  Preferences,
  Scenario,
  GenericScenario,
} from "@ofl-panel/shared";
import { blueprint } from "./library.js";

// `faulted` is the mock's stand-in for a module the hardware layer reports
// as broken or unreachable (docs/21 §21.2). It is internal — the Modules
// wire format has no such field, so it never leaves the device; it only
// shows up as Plant/Garden `status: "problem"`.
export interface ModuleState extends ModuleEntry {
  faulted: boolean;
}

/** What Plant and System share (docs/10 §10.2): everything but Grow Profile. */
export interface OwnerState {
  scope: "plant" | "system";
  modules: ModuleState[];
  settings: SettingsEntry[];
  vitals_history: VitalsHistoryRecord[];
}

export interface PlantState extends OwnerState {
  scope: "plant";
  plant_id: string;
  name: string;
  description: string;
  grow_profile: GrowProfile;
}

export interface SystemState extends OwnerState {
  scope: "system";
  name: string;
}

// garden_id is not stored here: it is derived from the device key
// (docs/22-security.md §22.2) — see security/identity.ts.
export interface GardenState {
  name: string;
  description: string;
  protocol_version: string;
  type: string;
  engine_capabilities: string[];
  preferences: Preferences;
  plants: Map<string, PlantState>;
  system: SystemState;
  scenarios: Scenario[];
  // docs/16-rest-api.md §16.6 — device clock = Date.now() + offsetMs.
  // "none" boots at the epoch (no RTC, no uplink) until a PUT sets it.
  time: { source: "ntp" | "manual" | "none"; offsetMs: number };
  nextScenarioId: number;
  nextPlantId: number;
  nextModuleId: number;
}

export function serializeModule({ faulted: _faulted, ...entry }: ModuleState): ModuleEntry {
  return entry;
}

export function buildModule(id: string, blueprintId: string, isAnchor: boolean): ModuleState {
  const bp = blueprint(blueprintId);
  if (!bp) throw new Error(`unknown blueprint ${blueprintId}`);
  return {
    id,
    class: bp.class,
    is_anchor: isAnchor,
    blueprint_id: blueprintId,
    endpoints: bp.endpoints.map((ep, index) => ({ index, ...ep })),
    faulted: false,
  };
}

/** docs/07 §7.2: Default Settings, seeded once per module from its library entry. */
export function defaultSettings(mod: ModuleState): SettingsEntry | undefined {
  const defaults = blueprint(mod.blueprint_id)?.default_settings;
  return defaults && { module_id: mod.id, settings: { ...defaults } };
}

export function seedSettings(modules: ModuleState[]): SettingsEntry[] {
  return modules.map(defaultSettings).filter((s): s is SettingsEntry => s !== undefined);
}

/** A Plant with no user configuration yet — what a newly detected anchor gets. */
export function defaultGrowProfile(): GrowProfile {
  return {
    species: "",
    watering_enabled: true,
    lighting_enabled: true,
    climate_enabled: true,
    targets: {},
    required_capabilities: [],
  };
}

export function defaultPreferences(): Preferences {
  return { quiet_hours: null, max_brightness: null, vacation_mode: false };
}

export const DEFAULT_GARDEN_NAME = "Open Farm Link Garden";
export const DEFAULT_SYSTEM_NAME = "System";
export const defaultPlantName = (plantId: string) => `Plant ${plantId.replace(/^plant-/, "")}`;

/** The standard kit a detected Plant comes with in the mock: pot sensor, light, valve. */
export function newPlant(plantId: string): PlantState {
  const modules = [
    buildModule(`${plantId}-container`, "acme-moisture-v1", true),
    buildModule(`${plantId}-light`, "acme-light-v2", false),
    buildModule(`${plantId}-valve`, "acme-valve-v1", false),
  ];
  return {
    scope: "plant",
    plant_id: plantId,
    name: defaultPlantName(plantId),
    description: "",
    grow_profile: defaultGrowProfile(),
    modules,
    settings: seedSettings(modules),
    vitals_history: [],
  };
}

// Library-sourced (docs/22 §22.8): survives a factory reset.
function genericScenarios(): GenericScenario[] {
  return [
    {
      id: "watering",
      kind: "generic",
      category: "watering",
      applies_to: "plant",
      condition: {
        combinator: "all",
        clauses: [
          { field: "grow_profile.watering_enabled", op: "eq", value: true },
          { field: "vitals.moisture", op: "lt", value: { field: "grow_profile.targets.moisture_percent.min" } },
          { field: "time", op: "not_in", value: { field: "garden.preferences.quiet_hours" } },
        ],
      },
      actions: [
        { capability: "valve", value: 1, duration_s: 6 },
        { capability: "system.pump", value: 1, duration_s: 5 },
      ],
      required_capabilities: ["valve", "moisture"],
    },
  ];
}

function bootClock(timeSource: "ntp" | "none"): GardenState["time"] {
  return { source: timeSource, offsetMs: timeSource === "none" ? -Date.now() : 0 };
}

/** The demo Garden: two configured Plants plus a shared pump and tank. */
export function createInitialState(timeSource: "ntp" | "none" = "ntp"): GardenState {
  const plants = new Map<string, PlantState>();
  for (const [id, name, species] of [
    ["plant-1", "Basil #1", "basil"],
    ["plant-2", "Mint #1", "mint"],
  ] as const) {
    const plant = newPlant(id);
    plant.name = name;
    plant.grow_profile = {
      species,
      watering_enabled: true,
      lighting_enabled: true,
      climate_enabled: true,
      targets: {
        moisture_percent: { min: 55, max: 70 },
        light_lux: 4000,
        light_hours_per_day: 14,
      },
      required_capabilities: ["moisture", "dimmer", "valve"],
    };
    plants.set(id, plant);
  }

  const systemModules = [buildModule("sys-pump", "acme-pump-v1", false), buildModule("sys-tank", "acme-tank-v1", false)];

  return {
    name: "Mock Kitchen Rack",
    description: "",
    protocol_version: "0.1",
    type: "ogr",
    engine_capabilities: ["engine.custom_endpoints"],
    preferences: { quiet_hours: { from: "22:00", to: "07:00" }, max_brightness: null, vacation_mode: false },
    plants,
    system: {
      scope: "system",
      name: "Main System",
      modules: systemModules,
      settings: seedSettings(systemModules),
      vitals_history: [],
    },
    scenarios: genericScenarios(),
    time: bootClock(timeSource),
    nextScenarioId: 1,
    nextPlantId: plants.size + 1,
    nextModuleId: 1,
  };
}

/**
 * docs/22 §22.8: erase every user-supplied data item, keep the hardware
 * (Plants exist because their anchors are physically there), library data
 * and Vitals History. Settings fall back to the library defaults.
 */
export function eraseUserData(s: GardenState): void {
  s.name = DEFAULT_GARDEN_NAME;
  s.description = "";
  s.preferences = defaultPreferences();
  s.system.name = DEFAULT_SYSTEM_NAME;
  s.system.settings = seedSettings(s.system.modules);
  for (const plant of s.plants.values()) {
    plant.name = defaultPlantName(plant.plant_id);
    plant.description = "";
    plant.grow_profile = defaultGrowProfile();
    plant.settings = seedSettings(plant.modules);
  }
  s.scenarios = s.scenarios.filter((sc) => sc.kind === "generic");
}

export const state = createInitialState(process.env.OFL_TIME_SOURCE === "none" ? "none" : "ntp");

export function deviceNow(): number {
  return Date.now() + state.time.offsetMs;
}

export function owners(): OwnerState[] {
  return [state.system, ...state.plants.values()];
}
