// Stand-in for the Head Device's physical side: the pairing button
// (docs/22-security.md §22.4, §22.8) and the hardware itself — modules
// plugged in or pulled, sensor readings, faults, the clock's uplink. The
// mock has no BOOT button or bus, so this is a separate plain-HTTP server
// bound to 127.0.0.1 only. It is NOT part of the OFL API: no auth, never
// advertised, unreachable from the LAN — the equivalent of physically
// touching the device.
//
//   POST   /button/short                    → open the 2-minute pairing window
//   POST   /button/long                     → factory reset (≥ 10 s press)
//   GET    /status                          → what a serial console on a DIY build would show
//   POST   /hw/plants                       → a new anchor appears (standard kit) → { plant_id }
//   DELETE /hw/plants/{plant_id}            → the anchor is pulled, the Plant disappears
//   POST   /hw/modules  { owner, blueprint_id } → plug a library module into a Plant or "system"
//   DELETE /hw/modules/{id}                 → pull a module
//   PUT    /hw/modules/{id}/endpoints/{i}  { value } → the module itself reports a new reading
//   PUT    /hw/modules/{id}/fault  { faulted }       → module faulted/unreachable → status "problem"
//   PUT    /hw/time  { source: "none" | "ntp" }     → reboot with no uplink / NTP synced
//
// Root package.json wraps the first three as `npm run button` / `factory-reset` / `mock:status`.

import http from "node:http";
import type { DeviceSecurity } from "./security/device.js";
import { formatSetupCode } from "./security/device.js";
import { serializeModule } from "./state.js";
import {
  HardwareError,
  connectModule,
  connectPlant,
  disconnectModule,
  disconnectPlant,
  setEndpoint,
  setFault,
  setTimeSource,
} from "./hardware.js";

type Body = Record<string, unknown>;
type Route = [method: string, pattern: RegExp, handler: (params: string[], body: Body) => unknown];

function readBody(req: http.IncomingMessage): Promise<Body> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(data ? (JSON.parse(data) as Body) : {});
      } catch {
        reject(new HardwareError("body is not JSON"));
      }
    });
  });
}

export function startControlServer(device: DeviceSecurity, port: number, onFactoryReset: () => void): void {
  const status = () => ({
    garden_id: device.identity.garden_id,
    fingerprint: device.identity.fingerprint,
    setup_code: device.setupCode ? formatSetupCode(device.setupCode) : null,
    claimed: device.claimed,
    pairing_window_closes_at: device.pairingWindowOpen ? new Date(device.windowClosesAt!).toISOString() : null,
    clients: device.listClients(),
  });

  const routes: Route[] = [
    ["POST", /^\/button\/short$/, () => {
      device.openPairingWindow();
      console.log("[button] short press — pairing window open for 2 minutes");
      return status();
    }],
    ["POST", /^\/button\/long$/, () => {
      onFactoryReset();
      console.log(`[button] long press — factory reset, new garden_id=${device.identity.garden_id}`);
      return status();
    }],
    ["GET", /^\/status$/, () => status()],
    ["POST", /^\/hw\/plants$/, () => ({ plant_id: connectPlant() })],
    ["DELETE", /^\/hw\/plants\/([^/]+)$/, ([id]) => (disconnectPlant(id), {})],
    ["POST", /^\/hw\/modules$/, (_p, body) => serializeModule(connectModule(String(body.owner), String(body.blueprint_id)))],
    ["DELETE", /^\/hw\/modules\/([^/]+)$/, ([id]) => (disconnectModule(id), {})],
    ["PUT", /^\/hw\/modules\/([^/]+)\/endpoints\/(\d+)$/, ([id, index], body) => (setEndpoint(id, Number(index), body.value), {})],
    ["PUT", /^\/hw\/modules\/([^/]+)\/fault$/, ([id], body) => (setFault(id, body.faulted === true), {})],
    ["PUT", /^\/hw\/time$/, (_p, body) => (setTimeSource(body.source), {})],
  ];

  const server = http.createServer(async (req, res) => {
    const reply = (code: number, body: unknown) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body, null, 2) + "\n");
    };
    const url = (req.url ?? "").split("?")[0];
    for (const [method, pattern, handler] of routes) {
      const match = req.method === method ? pattern.exec(url) : null;
      if (!match) continue;
      try {
        const result = handler(match.slice(1).map(decodeURIComponent), await readBody(req));
        if (url.startsWith("/hw/")) console.log(`[hw] ${req.method} ${url}`);
        return reply(200, result);
      } catch (err) {
        if (err instanceof HardwareError) return reply(400, { error: err.message });
        console.error("[hw] unhandled error:", err);
        return reply(500, { error: "internal_error" });
      }
    }
    reply(404, { error: "not_found" });
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    console.error(`[button] control server could not bind 127.0.0.1:${port} (${err.code}) — button/hardware simulation unavailable`);
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`[button] hardware simulator on http://127.0.0.1:${port} (POST /button/short, /button/long; GET /status; /hw/...)`);
  });
}
