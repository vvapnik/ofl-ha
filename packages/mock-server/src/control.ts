// Stand-in for the Head Device's physical pairing button
// (docs/22-security.md §22.4, §22.8) — the mock has no BOOT button, so this
// is a separate plain-HTTP server bound to 127.0.0.1 only. It is NOT part of
// the OFL API: no auth, never advertised, unreachable from the LAN — the
// equivalent of physically touching the device.
//
//   POST /button/short  → open the 2-minute pairing window
//   POST /button/long   → factory reset (≥ 10 s press)
//   GET  /status        → what a serial console on a DIY build would show
//
// Root package.json wraps these as `npm run button` / `npm run factory-reset`.

import http from "node:http";
import type { DeviceSecurity } from "./security/device.js";
import { formatSetupCode } from "./security/device.js";

export function startControlServer(device: DeviceSecurity, port: number, onFactoryReset: () => void): void {
  const server = http.createServer((req, res) => {
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body, null, 2) + "\n");
    };
    const status = () => ({
      garden_id: device.identity.garden_id,
      fingerprint: device.identity.fingerprint,
      setup_code: device.setupCode ? formatSetupCode(device.setupCode) : null,
      claimed: device.claimed,
      pairing_window_closes_at: device.pairingWindowOpen ? new Date(device.windowClosesAt!).toISOString() : null,
      clients: device.listClients(),
    });

    if (req.method === "POST" && req.url === "/button/short") {
      device.openPairingWindow();
      console.log("[button] short press — pairing window open for 2 minutes");
      return reply(200, status());
    }
    if (req.method === "POST" && req.url === "/button/long") {
      onFactoryReset();
      console.log(`[button] long press — factory reset, new garden_id=${device.identity.garden_id}`);
      return reply(200, status());
    }
    if (req.method === "GET" && req.url === "/status") return reply(200, status());
    reply(404, { error: "not_found" });
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    console.error(`[button] control server could not bind 127.0.0.1:${port} (${err.code}) — button simulation unavailable`);
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`[button] hardware simulator on http://127.0.0.1:${port} (POST /button/short, /button/long; GET /status)`);
  });
}
