import type {
  ModuleEntry,
  GrowProfile,
  SettingsEntry,
  HardwareCalibrationEntry,
  VitalsHistoryRecord,
  Preferences,
  Scenario,
  PlantStatus,
} from "@ofl-panel/shared";

export interface PlantState {
  plant_id: string;
  name: string;
  description: string;
  status: PlantStatus;
  modules: ModuleEntry[];
  grow_profile: GrowProfile;
  settings: SettingsEntry[];
  hardware_calibration: HardwareCalibrationEntry[];
  vitals_history: VitalsHistoryRecord[];
}

export interface SystemState {
  name: string;
  modules: ModuleEntry[];
  settings: SettingsEntry[];
  hardware_calibration: HardwareCalibrationEntry[];
  vitals_history: VitalsHistoryRecord[];
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
  // docs/16-rest-api.md §16.6 — the mock always "knows" real time (source
  // stays "ntp") until a PUT overrides it; timeOffsetMs is the delta
  // applied to Date.now() so that override actually shows up on GET.
  timeSource: "ntp" | "manual";
  timeOffsetMs: number;
}

function seedPlant(id: string, name: string, species: string): PlantState {
  return {
    plant_id: id,
    name,
    description: "",
    status: "ok",
    modules: [
      {
        id: `${id}-container`,
        class: "plant_container",
        is_anchor: true,
        blueprint_id: "acme-moisture-v1",
        endpoints: [
          { index: 0, type: "moisture", mode: "read", format: "percent", value: 58 },
        ],
      },
      {
        id: `${id}-light`,
        class: "light",
        is_anchor: false,
        blueprint_id: "acme-light-v2",
        endpoints: [
          { index: 0, type: "dimmer", mode: "rw", format: "0-100", value: 40 },
        ],
      },
      {
        id: `${id}-valve`,
        class: "water_supply",
        is_anchor: false,
        blueprint_id: "acme-valve-v1",
        endpoints: [{ index: 0, type: "valve", mode: "rw", format: "binary", value: 0 }],
      },
    ],
    grow_profile: {
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
    },
    settings: [
      { module_id: `${id}-light`, settings: { mount_height_mm: 300 } },
    ],
    hardware_calibration: [
      {
        blueprint_id: "acme-light-v2",
        endpoint_type: "dimmer",
        calibration: {
          curve: [
            { command: 0, physical: 0, unit: "lux_at_reference_distance" },
            { command: 50, physical: 1800, unit: "lux_at_reference_distance" },
            { command: 100, physical: 4200, unit: "lux_at_reference_distance" },
          ],
        },
      },
    ],
    vitals_history: [],
  };
}

export function createInitialState(): GardenState {
  const plants = new Map<string, PlantState>();
  const basil = seedPlant("plant-1", "Basil #1", "basil");
  const mint = seedPlant("plant-2", "Mint #1", "mint");
  plants.set(basil.plant_id, basil);
  plants.set(mint.plant_id, mint);

  const system: SystemState = {
    name: "Main System",
    modules: [
      {
        id: "sys-pump",
        class: "water_supply",
        is_anchor: false,
        blueprint_id: "acme-pump-v1",
        endpoints: [{ index: 0, type: "pump", mode: "rw", format: "0-100", value: 0 }],
      },
      {
        id: "sys-tank",
        class: "water_supply",
        is_anchor: false,
        blueprint_id: "acme-tank-v1",
        endpoints: [
          { index: 0, type: "water_level", mode: "read", format: "percent", value: 82 },
        ],
      },
    ],
    settings: [],
    hardware_calibration: [
      { blueprint_id: "acme-pump-v1", endpoint_type: "pump", calibration: { curve: [] } },
    ],
    vitals_history: [],
  };

  const scenarios: Scenario[] = [
    {
      id: "watering",
      kind: "generic",
      category: "watering",
      applies_to: "plant",
      condition: {
        combinator: "all",
        clauses: [
          { field: "grow_profile.watering_enabled", op: "eq", value: true },
          {
            field: "vitals.moisture",
            op: "lt",
            value: { field: "grow_profile.targets.moisture_percent.min" },
          },
          {
            field: "time",
            op: "not_in",
            value: { field: "garden.preferences.quiet_hours" },
          },
        ],
      },
      actions: [
        { capability: "valve", value: 1, duration_s: 6 },
        { capability: "system.pump", value: 1, duration_s: 5 },
      ],
      required_capabilities: ["valve", "moisture"],
    },
  ];

  return {
    name: "Mock Kitchen Rack",
    description: "",
    protocol_version: "0.1",
    type: "ogr",
    engine_capabilities: ["engine.custom_endpoints"],
    preferences: { quiet_hours: { from: "22:00", to: "07:00" }, max_brightness: null, vacation_mode: false },
    plants,
    system,
    scenarios,
    timeSource: "ntp",
    timeOffsetMs: 0,
  };
}

export const state = createInitialState();
