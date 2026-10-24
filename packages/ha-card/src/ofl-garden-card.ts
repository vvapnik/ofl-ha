// Open Farm Link garden card — the old panel's Simple mode, rebuilt as a
// Lovelace card on top of the integration's entities.
//
// Structure (Plants, species, targets, which entity backs what) comes from
// the integration's `ofl/gardens` websocket command; live values come from
// `hass.states`, and every action is an ordinary entity service call. The
// card never talks to the Head Device and never sees a credential.
//
// Tray order is the API's list order — the protocol does not guarantee any
// physical order (open-farm-link/docs/21-system-fields.md §21.4).

import { LitElement, html, nothing, svg, type PropertyValues, type TemplateResult } from "lit";
import { strings, type Strings } from "./i18n.js";
import { cardStyles } from "./styles.js";
import type { CardConfig, EntityMap, Hass, OflGarden, OflPlant } from "./types.js";

const STRUCTURE_REFRESH_MS = 60_000;

type View = { kind: "rack" } | { kind: "plant"; plantId: string } | { kind: "head" };
type Tone = "good" | "warn" | "wet" | "idle";

function plantIcon(tone: Tone): TemplateResult {
  return html`<svg class="plant-icon tone-${tone}" viewBox="0 0 48 48" aria-hidden="true">
    ${svg`<path d="M24 40V22" stroke="currentColor" stroke-width="3" stroke-linecap="round" fill="none" />
    <path d="M24 26C24 26 12 24 12 14C22 14 24 22 24 26Z" fill="currentColor" opacity="0.85" />
    <path d="M24 30C24 30 36 28 36 18C26 18 24 26 24 30Z" fill="currentColor" />
    <path d="M24 34C24 34 15 33 15 25C22 25 24 30 24 34Z" fill="currentColor" opacity="0.65" />`}
  </svg>`;
}

class OflGardenCard extends LitElement {
  static styles = cardStyles;
  static properties = {
    hass: { attribute: false },
    _config: { state: true },
    _gardens: { state: true },
    _error: { state: true },
    _view: { state: true },
  };

  hass?: Hass;
  private _config?: CardConfig;
  private _gardens?: OflGarden[];
  private _error?: string;
  private _view: View = { kind: "rack" };
  private _timer?: number;

  // ---- Lovelace card contract -------------------------------------------

  setConfig(config: CardConfig): void {
    this._config = config;
  }

  getCardSize(): number {
    return 2 + (this._garden?.plants.length ?? 2) * 2;
  }

  static getStubConfig(): Partial<CardConfig> {
    return {};
  }

  // ---- Data -----------------------------------------------------------------

  connectedCallback(): void {
    super.connectedCallback();
    this._timer = window.setInterval(() => this._loadStructure(), STRUCTURE_REFRESH_MS);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.clearInterval(this._timer);
  }

  protected willUpdate(changed: PropertyValues): void {
    if (changed.has("hass") && this.hass && this._gardens === undefined && !this._loading) {
      this._loadStructure();
    }
  }

  private _loading = false;

  private async _loadStructure(): Promise<void> {
    if (!this.hass) return;
    this._loading = true;
    try {
      const res = await this.hass.callWS<{ gardens: OflGarden[] }>({ type: "ofl/gardens" });
      this._gardens = res.gardens;
      this._error = undefined;
    } catch (err) {
      this._error = (err as { message?: string }).message ?? String(err);
    } finally {
      this._loading = false;
    }
  }

  private get _garden(): OflGarden | undefined {
    const gardens = this._gardens ?? [];
    return this._config?.garden_id ? gardens.find((g) => g.garden_id === this._config!.garden_id) : gardens[0];
  }

  private get _t(): Strings {
    return strings(this.hass?.locale?.language ?? this.hass?.language);
  }

  private _state(entities: EntityMap, key: string) {
    const id = entities[key];
    return id ? this.hass?.states[id] : undefined;
  }

  private _num(entities: EntityMap, key: string): number | undefined {
    const v = Number(this._state(entities, key)?.state);
    return Number.isFinite(v) ? v : undefined;
  }

  private _isOn(entities: EntityMap, key: string): boolean {
    return this._state(entities, key)?.state === "on";
  }

  private _call(domain: string, service: string, entityId: string | undefined, data: Record<string, unknown> = {}) {
    if (!entityId || !this.hass) return;
    this.hass.callService(domain, service, { entity_id: entityId, ...data });
  }

  private _moreInfo(entityId: string | undefined): void {
    if (!entityId) return;
    this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
  }

  // ---- Plant semantics --------------------------------------------------------

  private _moisture(plant: OflPlant): { value?: number; tone: Tone; label: string } {
    const t = this._t;
    const value = this._num(plant.entities, "vital/moisture");
    const range = plant.targets.moisture_percent;
    if (value === undefined) return { tone: "idle", label: t.no_moisture };
    if (!range) return { value, tone: "good", label: `${value}% ${t.moisture}` };
    if (value < range.min) return { value, tone: "warn", label: t.thirsty };
    if (value > range.max) return { value, tone: "wet", label: t.wet };
    return { value, tone: "good", label: t.watered };
  }

  private _lightOn(e: EntityMap): boolean {
    if (e["actuator/light_switch"]) return this._isOn(e, "actuator/light_switch");
    return (this._num(e, "actuator/dimmer") ?? 0) > 0;
  }

  private _toggleLight(plant: OflPlant): void {
    const e = plant.entities;
    if (e["actuator/light_switch"]) return this._call("switch", "toggle", e["actuator/light_switch"]);
    const dimmer = e["actuator/dimmer"];
    if (!dimmer) return;
    const max = Number(this.hass?.states[dimmer]?.attributes.max) || 100;
    const target = Number(plant.targets.light_lux ?? plant.targets.light_flux) || max / 2;
    this._call("number", "set_value", dimmer, { value: this._lightOn(e) ? 0 : Math.min(target, max) });
  }

  // ---- Rendering -------------------------------------------------------------------

  protected render() {
    const t = this._t;
    if (this._error) return html`<ha-card><div class="empty">${this._error}</div></ha-card>`;
    if (!this._gardens) return html`<ha-card><div class="empty">${t.loading}</div></ha-card>`;
    const garden = this._garden;
    if (!garden) return html`<ha-card><div class="empty">${t.no_garden}</div></ha-card>`;

    const view = this._view;
    const plant = view.kind === "plant" ? garden.plants.find((p) => p.plant_id === view.plantId) : undefined;
    return html`<ha-card>
      ${view.kind === "head" ? this._renderHead(garden) : plant ? this._renderPlant(plant) : this._renderRack(garden)}
    </ha-card>`;
  }

  private _renderHeader(garden: OflGarden) {
    const t = this._t;
    const problem = this._isOn(garden.entities, "status/status");
    return html`<div class="header">
      <div class="title">${this._config?.title ?? garden.name}</div>
      ${!garden.online
        ? html`<span class="chip chip-off">${t.offline}</span>`
        : html`<span class="chip ${problem ? "chip-warn" : "chip-ok"}">${problem ? t.problem : t.ok}</span>`}
    </div>`;
  }

  private _renderRack(garden: OflGarden) {
    const t = this._t;
    const tank = this._num(garden.system.entities, "vital/water_level");
    const vacation = this._isOn(garden.entities, "pref/vacation_mode");
    return html`${this._renderHeader(garden)}
      <div class="rack">
        <button class="head-unit" @click=${() => (this._view = { kind: "head" })}>
          <div class="head-band"></div>
          <div class="head-label">
            <span>${garden.type ?? t.head_unit}</span>
            <span class="head-meta">
              ${vacation ? html`<span title=${t.vacation}>🌴</span>` : nothing}
              ${tank !== undefined ? html`<span>💧 ${tank}%</span>` : nothing}
            </span>
          </div>
        </button>
        ${garden.plants.map((plant) => this._renderTray(plant))}
      </div>`;
  }

  private _renderTray(plant: OflPlant) {
    const m = this._moisture(plant);
    const lit = this._lightOn(plant.entities);
    const problem = plant.status === "problem" || this._isOn(plant.entities, "status/status");
    return html`<button
      class="tray ${problem ? "tray-problem" : ""}"
      @click=${() => (this._view = { kind: "plant", plantId: plant.plant_id })}
    >
      <div class="tray-lights ${lit ? "lit" : ""}"><span></span><span></span><span></span></div>
      <div class="tray-body">
        ${plantIcon(problem ? "warn" : m.tone)}
        <div class="tray-text">
          <div class="tray-name">${plant.name}</div>
          <div class="tray-sub">${m.value !== undefined ? `${m.value}% · ${m.label}` : m.label}</div>
        </div>
        ${problem ? html`<ha-icon class="warn-icon" icon="mdi:alert-circle"></ha-icon>` : nothing}
      </div>
    </button>`;
  }

  private _renderPlant(plant: OflPlant) {
    const t = this._t;
    const e = plant.entities;
    const m = this._moisture(plant);
    const range = plant.targets.moisture_percent;
    const waterButton = this._state(e, "button/water_now");
    const watering = Boolean(waterButton?.attributes.watering) || this._isOn(e, "actuator/valve");
    const hasLight = Boolean(e["actuator/light_switch"] || e["actuator/dimmer"]);
    const lit = this._lightOn(e);
    const otherVitals = Object.keys(e).filter((k) => k.startsWith("vital/") && k !== "vital/moisture");

    return html`<div class="plant-view">
      <button class="back" @click=${() => (this._view = { kind: "rack" })}>
        <ha-icon icon="mdi:arrow-left"></ha-icon>${t.back}
      </button>

      <div class="hero">
        ${plantIcon(m.tone)}
        <div>
          <div class="hero-name">${plant.name}</div>
          ${plant.species ? html`<div class="hero-species">${plant.species}</div>` : nothing}
        </div>
      </div>

      ${plant.status === "problem" ? html`<div class="alert">${t.hw_problem}</div>` : nothing}

      <div class="status-card tone-border-${m.tone}" @click=${() => this._moreInfo(e["vital/moisture"])}>
        <div class="status-label">${m.label}</div>
        ${m.value !== undefined
          ? html`<div class="bar">
                <div class="bar-track">
                  ${range
                    ? html`<div class="bar-range" style="left:${range.min}%;width:${range.max - range.min}%"></div>`
                    : nothing}
                  <div class="bar-fill tone-bg-${m.tone}" style="width:${Math.max(0, Math.min(100, m.value))}%"></div>
                </div>
                <div class="bar-label">
                  <span>${m.value}% ${t.moisture}</span>
                  ${range ? html`<span>${t.target} ${range.min}–${range.max}%</span>` : nothing}
                </div>
              </div>`
          : nothing}
      </div>

      ${e["button/water_now"]
        ? html`<button
            class="big-action"
            ?disabled=${watering}
            @click=${() => this._call("button", "press", e["button/water_now"])}
          >
            <ha-icon icon="mdi:watering-can"></ha-icon>${watering ? t.watering : t.water_now}
          </button>`
        : nothing}
      ${hasLight
        ? html`<button class="secondary-action ${lit ? "on" : ""}" @click=${() => this._toggleLight(plant)}>
            <ha-icon icon=${lit ? "mdi:white-balance-sunny" : "mdi:weather-night"}></ha-icon>
            ${lit ? t.light_on : t.light_off}
          </button>`
        : nothing}

      <div class="rows">
        ${this._toggleRow(e["grow_flag/watering_enabled"], t.auto_watering)}
        ${this._toggleRow(e["grow_flag/lighting_enabled"], t.auto_lighting)}
        ${otherVitals.map((k) => this._valueRow(e[k], t.vitals[k.slice(6)] ?? k.slice(6)))}
      </div>
    </div>`;
  }

  private _renderHead(garden: OflGarden) {
    const t = this._t;
    const sys = garden.system.entities;
    const clock = this._state(garden.entities, "diag/time_source")?.state;
    const sysVitals = Object.keys(sys).filter((k) => k.startsWith("vital/"));
    const sysActuators = Object.keys(sys).filter((k) => k.startsWith("actuator/"));
    return html`<div class="plant-view">
      <button class="back" @click=${() => (this._view = { kind: "rack" })}>
        <ha-icon icon="mdi:arrow-left"></ha-icon>${t.back}
      </button>
      ${this._renderHeader(garden)}
      <div class="rows">
        ${sysVitals.map((k) => this._valueRow(sys[k], k === "vital/water_level" ? t.tank : t.vitals[k.slice(6)] ?? k.slice(6)))}
        ${sysActuators.map((k) => this._valueRow(sys[k], this.hass?.states[sys[k]]?.attributes.friendly_name ?? k))}
        ${this._toggleRow(garden.entities["pref/vacation_mode"], t.vacation)}
        ${clock
          ? html`<div class="row" @click=${() => this._moreInfo(garden.entities["diag/time_source"])}>
              <span>${t.clock}</span><span class="row-value">${t.clock_state[clock] ?? clock}</span>
            </div>`
          : nothing}
      </div>
    </div>`;
  }

  private _toggleRow(entityId: string | undefined, label: string) {
    if (!entityId) return nothing;
    const on = this.hass?.states[entityId]?.state === "on";
    return html`<div class="row">
      <span @click=${() => this._moreInfo(entityId)}>${label}</span>
      <ha-switch .checked=${on} @change=${() => this._call("switch", on ? "turn_off" : "turn_on", entityId)}></ha-switch>
    </div>`;
  }

  private _valueRow(entityId: string | undefined, label: string) {
    if (!entityId) return nothing;
    const st = this.hass?.states[entityId];
    const unit = st?.attributes.unit_of_measurement ?? "";
    return html`<div class="row" @click=${() => this._moreInfo(entityId)}>
      <span>${label}</span><span class="row-value">${st ? `${st.state}${unit ? ` ${unit}` : ""}` : "—"}</span>
    </div>`;
  }
}

if (!customElements.get("ofl-garden-card")) {
  customElements.define("ofl-garden-card", OflGardenCard);
  (window as any).customCards = (window as any).customCards ?? [];
  (window as any).customCards.push({
    type: "ofl-garden-card",
    name: "Open Farm Link garden",
    description: "Your rack at a glance: plants, moisture, water and light.",
    preview: true,
  });
}
