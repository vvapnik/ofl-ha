// The local transport binding's connection rules, enforced for real so a
// Control Panel (the HA integration) is tested against them from day one:
//
// - HTTPS with the device's self-signed identity — docs/22-security.md §22.2.
// - One connection at a time; a second one is dropped right after accept —
//   docs/16-rest-api.md §16.3. (A real device refuses at the TCP level; Node
//   can only close immediately after accept, which a client sees the same
//   way: connection reset before any HTTP exchange.)
// - A connection with no complete request within 5 s — from accept, and
//   again from the end of each response — is closed — §22.7.
//
// Each rule has an escape hatch flag for debugging (see index.ts), but the
// defaults are strict on purpose.

import http from "node:http";
import https from "node:https";
import type { Socket } from "node:net";
import type { RequestListener } from "node:http";
import type { DeviceIdentity } from "./security/identity.js";

export interface TransportOptions {
  tls: boolean;
  singleConnection: boolean;
  idleTimeoutMs: number;
}

export interface DeviceServer {
  server: http.Server;
  /** Swap the TLS identity in place (factory reset, §22.8). */
  setIdentity(identity: DeviceIdentity): void;
}

const idleTimer = Symbol("oflIdleTimer");
type TimedSocket = Socket & { [idleTimer]?: NodeJS.Timeout };

export function createDeviceServer(app: RequestListener, identity: DeviceIdentity, opts: TransportOptions): DeviceServer {
  const server: http.Server = opts.tls
    ? https.createServer({ key: identity.key, cert: identity.cert, handshakeTimeout: opts.idleTimeoutMs }, app)
    : http.createServer(app);

  if (opts.singleConnection) {
    server.maxConnections = 1;
    server.on("drop", () => console.log("[transport] refused a second concurrent connection (§16.3)"));
  }

  const arm = (socket: TimedSocket) => {
    clearTimeout(socket[idleTimer]);
    socket[idleTimer] = setTimeout(() => socket.destroy(), opts.idleTimeoutMs);
  };
  server.on(opts.tls ? "secureConnection" : "connection", arm);
  server.on("request", (req, res) => {
    const socket = req.socket as TimedSocket;
    clearTimeout(socket[idleTimer]);
    res.on("finish", () => {
      if (!socket.destroyed) arm(socket);
    });
  });
  server.keepAliveTimeout = opts.idleTimeoutMs;
  server.requestTimeout = opts.idleTimeoutMs;
  server.headersTimeout = opts.idleTimeoutMs;

  return {
    server,
    setIdentity(next) {
      if (opts.tls) (server as https.Server).setSecureContext({ key: next.key, cert: next.cert });
    },
  };
}
