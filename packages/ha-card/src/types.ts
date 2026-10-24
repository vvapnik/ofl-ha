// Shape of the integration's `ofl/gardens` websocket result
// (custom_components/ofl/websocket.py). Entity keys are "<kind>/<key>",
// e.g. "vital/moisture", "actuator/valve", "grow_flag/watering_enabled".

export type EntityMap = Record<string, string>;

export interface OflPlant {
  plant_id: string;
  name: string;
  description: string;
  status: "ok" | "problem";
  species: string | null;
  targets: {
    moisture_percent?: { min: number; max: number };
    light_lux?: number;
    light_flux?: number;
    light_hours_per_day?: number;
    [key: string]: unknown;
  };
  entities: EntityMap;
}

export interface OflGarden {
  entry_id: string;
  garden_id: string;
  name: string;
  type: string | null;
  online: boolean;
  entities: EntityMap;
  system: { vitals: string[]; entities: EntityMap };
  plants: OflPlant[];
}

// The minimal slice of Home Assistant's frontend `hass` object this card uses.
export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, any>;
}

export interface Hass {
  states: Record<string, HassEntity>;
  language: string;
  locale?: { language: string };
  callService(domain: string, service: string, data: Record<string, unknown>): Promise<unknown>;
  callWS<T>(msg: Record<string, unknown>): Promise<T>;
}

export interface CardConfig {
  type: string;
  garden_id?: string;
  title?: string;
}
