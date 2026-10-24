import { css } from "lit";

// Built on Home Assistant's theme variables so the card follows the user's
// theme (light/dark/custom). The rack hardware itself — dark head unit with
// its copper band, warm light strips — keeps fixed colors, like the old
// Simple mode, because it depicts a physical object rather than UI chrome.
export const cardStyles = css`
  :host {
    --ofl-good: var(--success-color, #4caf6f);
    --ofl-warn: var(--warning-color, #e0a23b);
    --ofl-wet: var(--info-color, #4f8cff);
    --ofl-idle: var(--disabled-text-color, #9e9e9e);
    --ofl-radius: var(--ha-card-border-radius, 12px);
  }
  ha-card {
    padding: 16px;
  }
  button {
    font: inherit;
    color: inherit;
    cursor: pointer;
  }
  .empty {
    color: var(--secondary-text-color);
    text-align: center;
    padding: 16px 0;
  }

  /* ---- header ---- */
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 12px;
  }
  .title {
    font-size: 1.25em;
    font-weight: 500;
    color: var(--primary-text-color);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chip {
    flex: none;
    font-size: 0.8em;
    padding: 2px 10px;
    border-radius: 999px;
    white-space: nowrap;
  }
  .chip-ok {
    color: var(--ofl-good);
    background: color-mix(in srgb, var(--ofl-good) 15%, transparent);
  }
  .chip-warn {
    color: var(--ofl-warn);
    background: color-mix(in srgb, var(--ofl-warn) 15%, transparent);
  }
  .chip-off {
    color: var(--error-color, #db4437);
    background: color-mix(in srgb, var(--error-color, #db4437) 15%, transparent);
  }
  .chip-info {
    color: var(--ofl-wet);
    background: color-mix(in srgb, var(--ofl-wet) 20%, transparent);
  }

  /* ---- rack ---- */
  .rack {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .head-unit {
    position: relative;
    height: 56px;
    border: none;
    border-radius: var(--ofl-radius);
    background: linear-gradient(180deg, #3a3f45, #1d2124);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    padding: 0 12px;
  }
  .head-band {
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    height: 5px;
    transform: translateY(-50%);
    background: linear-gradient(90deg, #b98a5a, #e0b988, #b98a5a);
  }
  .head-label {
    position: relative;
    display: flex;
    gap: 12px;
    align-items: center;
    font-size: 0.8em;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #e3e6e8;
    white-space: nowrap;
    background: rgba(0, 0, 0, 0.55);
    padding: 3px 12px;
    border-radius: 999px;
  }
  .head-meta {
    display: flex;
    gap: 8px;
    align-items: center;
    text-transform: none;
    letter-spacing: normal;
  }
  .tray {
    border: 1px solid var(--divider-color);
    border-left: 4px solid var(--ofl-good);
    border-radius: var(--ofl-radius);
    background: var(--secondary-background-color, transparent);
    padding: 8px 12px 10px;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 6px;
    transition: background 0.15s;
  }
  .tray:hover {
    background: color-mix(in srgb, var(--primary-color) 6%, var(--secondary-background-color, transparent));
  }
  .tray-problem {
    border-left-color: var(--ofl-warn);
  }
  .tray-lights {
    display: flex;
    gap: 6px;
    justify-content: center;
  }
  .tray-lights span {
    width: 22px;
    height: 4px;
    border-radius: 2px;
    background: var(--divider-color);
  }
  .tray-lights.lit span {
    background: #fff3c4;
    box-shadow: 0 0 6px #ffd95a;
  }
  .tray-body {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .tray-text {
    flex: 1;
    min-width: 0;
  }
  .tray-name {
    font-weight: 500;
    color: var(--primary-text-color);
  }
  .tray-sub {
    font-size: 0.85em;
    color: var(--secondary-text-color);
  }
  .warn-icon {
    color: var(--ofl-warn);
  }

  /* ---- plant icon / tones ---- */
  .plant-icon {
    width: 40px;
    height: 40px;
    flex: none;
  }
  .tone-good {
    color: var(--ofl-good);
  }
  .tone-warn {
    color: var(--ofl-warn);
  }
  .tone-wet {
    color: var(--ofl-wet);
  }
  .tone-idle {
    color: var(--ofl-idle);
  }
  .tone-border-good {
    border-color: var(--ofl-good) !important;
  }
  .tone-border-warn {
    border-color: var(--ofl-warn) !important;
  }
  .tone-border-wet {
    border-color: var(--ofl-wet) !important;
  }
  .tone-bg-good {
    background: var(--ofl-good);
  }
  .tone-bg-warn {
    background: var(--ofl-warn);
  }
  .tone-bg-wet {
    background: var(--ofl-wet);
  }

  /* ---- plant / head views ---- */
  .plant-view {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .back {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: none;
    border: none;
    padding: 4px 0;
    color: var(--primary-color);
  }
  .hero {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .hero .plant-icon {
    width: 56px;
    height: 56px;
  }
  .hero-name {
    font-size: 1.3em;
    font-weight: 500;
    color: var(--primary-text-color);
  }
  .hero-species {
    color: var(--secondary-text-color);
    text-transform: capitalize;
  }
  .alert {
    border-radius: var(--ofl-radius);
    padding: 8px 12px;
    color: var(--ofl-warn);
    background: color-mix(in srgb, var(--ofl-warn) 12%, transparent);
  }
  .status-card {
    border: 2px solid var(--ofl-idle);
    border-radius: var(--ofl-radius);
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    cursor: pointer;
  }
  .status-label {
    font-weight: 500;
    color: var(--primary-text-color);
  }
  .bar-track {
    position: relative;
    height: 10px;
    background: var(--divider-color);
    border-radius: 999px;
    overflow: hidden;
  }
  .bar-range {
    position: absolute;
    top: 0;
    bottom: 0;
    background: color-mix(in srgb, var(--ofl-good) 30%, transparent);
  }
  .bar-fill {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    border-radius: 999px;
    opacity: 0.85;
  }
  .bar-label {
    display: flex;
    justify-content: space-between;
    margin-top: 6px;
    font-size: 0.85em;
    color: var(--secondary-text-color);
  }
  .big-action,
  .secondary-action {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 48px;
    border-radius: var(--ofl-radius);
    padding: 10px 14px;
  }
  .big-action {
    border: none;
    background: var(--primary-color);
    color: var(--text-primary-color, #fff);
    font-weight: 500;
    font-size: 1.05em;
  }
  .big-action[disabled] {
    opacity: 0.6;
    cursor: progress;
  }
  .secondary-action {
    border: 1px solid var(--divider-color);
    background: none;
    color: var(--primary-text-color);
  }
  .secondary-action.on ha-icon {
    color: #f4b400;
  }
  .rows {
    display: flex;
    flex-direction: column;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 44px;
    border-top: 1px solid var(--divider-color);
    color: var(--primary-text-color);
    cursor: pointer;
  }
  .row-value {
    color: var(--secondary-text-color);
    text-align: right;
  }
`;
