// Mirrors open-farm-link/docs/18-20 — the standard dictionaries.
// Keep in sync with the spec by hand; there is no codegen yet.

export const MODULE_CLASSES = [
  "plant_container",
  "light",
  "water_supply",
  "climate",
  "custom",
] as const;
export type ModuleClass = (typeof MODULE_CLASSES)[number];

export const ENDPOINT_TYPES = {
  sensors: ["moisture", "temp", "humidity", "light", "weight", "distance", "water_level"],
  actuators: ["relay", "dimmer", "valve", "light_switch", "pump", "vibro"],
  widgets: ["camera"],
} as const;

export interface CapabilityCatalogEntry {
  key: string;
  kind: "sensor" | "actuator";
  unit: string;
}

// docs/20-capability-catalog.md §20.1-20.2 — the shared vocabulary for
// Vitals `type`, Actuators `capability`, and Capabilities' module-derived
// flags.
export const CAPABILITY_CATALOG: CapabilityCatalogEntry[] = [
  { key: "moisture", kind: "sensor", unit: "percent" },
  { key: "temp", kind: "sensor", unit: "celsius" },
  { key: "humidity", kind: "sensor", unit: "percent" },
  { key: "light", kind: "sensor", unit: "lux" },
  { key: "weight", kind: "sensor", unit: "gram" },
  { key: "distance", kind: "sensor", unit: "millimeter" },
  { key: "water_level", kind: "sensor", unit: "percent" },
  { key: "relay", kind: "actuator", unit: "binary" },
  { key: "dimmer", kind: "actuator", unit: "lux" },
  { key: "valve", kind: "actuator", unit: "binary" },
  { key: "light_switch", kind: "actuator", unit: "binary" },
  { key: "pump", kind: "actuator", unit: "percent" },
  { key: "vibro", kind: "actuator", unit: "percent" },
];

export function capabilityCatalogEntry(key: string): CapabilityCatalogEntry | undefined {
  // Strips a Scenario-style `system.` scope prefix (docs/20 §20.3) before lookup.
  const bareKey = key.startsWith("system.") ? key.slice("system.".length) : key;
  return CAPABILITY_CATALOG.find((e) => e.key === bareKey);
}
