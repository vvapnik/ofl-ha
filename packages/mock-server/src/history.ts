// Vitals History — docs/05-vitals-history.md. Retention is the device's own
// business (§5.2); the mock keeps a bounded ring per owner, starts with a
// day of hourly aggregates (so a Control Panel has something to draw right
// away) and then appends a raw sample (`interval: 0`) every period.

import type { VitalsHistoryRecord } from "@ofl-panel/shared";
import { deviceNow, owners, type OwnerState, type PlantState } from "./state.js";
import { deriveVitals } from "./derive.js";

const MAX_RECORDS = 1000;
const BACKFILL_HOURS = 24;

function ownerId(owner: OwnerState): string | null {
  return owner.scope === "plant" ? (owner as PlantState).plant_id : null;
}

function record(owner: OwnerState, timestamp: number, interval: number): VitalsHistoryRecord {
  return {
    owner_id: ownerId(owner),
    timestamp: new Date(timestamp).toISOString().replace(/\.\d{3}Z$/, "Z"),
    interval,
    vitals: deriveVitals(owner).vitals,
  };
}

function append(owner: OwnerState, rec: VitalsHistoryRecord): void {
  owner.vitals_history.push(rec);
  if (owner.vitals_history.length > MAX_RECORDS) owner.vitals_history.splice(0, owner.vitals_history.length - MAX_RECORDS);
}

/** Records after `since`, oldest first: the first `limit` of them when paging from `since`, else the latest `limit`. */
export function queryHistory(owner: OwnerState, since: number | undefined, limit: number): VitalsHistoryRecord[] {
  if (since === undefined) return owner.vitals_history.slice(-limit);
  return owner.vitals_history.filter((r) => Date.parse(r.timestamp) >= since).slice(0, limit);
}

export function startHistory(periodMs: number): void {
  const hour = 3600_000;
  const startOfHour = Math.floor(deviceNow() / hour) * hour;
  for (const owner of owners()) {
    for (let h = BACKFILL_HOURS; h >= 1; h--) append(owner, record(owner, startOfHour - h * hour, 3600));
  }
  setInterval(() => {
    for (const owner of owners()) append(owner, record(owner, deviceNow(), 0));
  }, periodMs).unref();
}
