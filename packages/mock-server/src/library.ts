// The hardware-model library a real Head Device seeds from (docs/06 §6.4,
// docs/07 §7.2), keyed by `blueprint_id`. Each blueprint describes the
// module (class + endpoints with their power-on values), its Hardware
// Calibration entries (library-owned forever), and its Default Settings
// (seeded once per module, then user-owned). Modules are only ever built
// from here — the mock's "hardware" can't contain a model it doesn't know.

import type { EndpointEntry, HardwareCalibrationEntry } from "@ofl-panel/shared";

export interface Blueprint {
  class: string;
  endpoints: Omit<EndpointEntry, "index">[];
  calibrations?: Omit<HardwareCalibrationEntry, "blueprint_id">[];
  default_settings?: Record<string, unknown>;
}

export const HARDWARE_LIBRARY: Record<string, Blueprint> = {
  "acme-moisture-v1": {
    class: "plant_container",
    endpoints: [{ type: "moisture", mode: "read", format: "percent", value: 58 }],
  },
  "acme-light-v2": {
    class: "light",
    endpoints: [{ type: "dimmer", mode: "rw", format: "0-100", value: 40 }],
    calibrations: [
      {
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
    default_settings: { mount_height_mm: 300 },
  },
  "acme-valve-v1": {
    class: "water_supply",
    endpoints: [{ type: "valve", mode: "rw", format: "binary", value: 0 }],
  },
  "acme-pump-v1": {
    class: "water_supply",
    endpoints: [{ type: "pump", mode: "rw", format: "0-100", value: 0 }],
  },
  "acme-tank-v1": {
    class: "water_supply",
    endpoints: [{ type: "water_level", mode: "read", format: "percent", value: 82 }],
  },
  "acme-climate-v1": {
    class: "climate",
    endpoints: [
      { type: "temp", mode: "read", format: "celsius", value: 21.5 },
      { type: "humidity", mode: "read", format: "percent", value: 48 },
    ],
  },
  "acme-scale-v1": {
    class: "plant_container",
    endpoints: [{ type: "weight", mode: "read", format: "gram", value: 950 }],
  },
};

export function blueprint(id: string): Blueprint | undefined {
  return HARDWARE_LIBRARY[id];
}

export function calibrationFor(blueprintId: string, endpointType: string): HardwareCalibrationEntry | undefined {
  const entry = blueprint(blueprintId)?.calibrations?.find((c) => c.endpoint_type === endpointType);
  return entry && { blueprint_id: blueprintId, ...entry };
}
