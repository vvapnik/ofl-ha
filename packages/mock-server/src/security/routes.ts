// HTTP surface of open-farm-link/docs/22-security.md: the auth gate in front
// of every endpoint (§22.5), pairing (§22.4) and credential management (§22.6).

import { Router, type NextFunction, type Request, type Response } from "express";
import type { ApiError, PairChallengeResponse, PairResponse } from "@ofl-panel/shared";
import type { DeviceSecurity, CredentialError } from "./device.js";

const UNAUTHENTICATED = new Set(["/garden/pair/challenge", "/garden/pair"]);

function fail(res: Response, status: number, error: string) {
  res.status(status).json({ error } satisfies ApiError);
}

function credentialError(res: Response, err: CredentialError) {
  fail(res, err === "bad_request" ? 400 : 409, err);
}

/** §22.5 — every request except the two pairing endpoints must authenticate. */
export function authGate(device: DeviceSecurity) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method === "POST" && UNAUTHENTICATED.has(req.path)) return next();

    const header = req.get("authorization");
    const result = header ? device.authenticate(header) : "invalid";
    if (result === "throttled") return fail(res, 429, "too_many_attempts");
    if (result === "invalid") {
      res.set("WWW-Authenticate", 'Bearer realm="ofl", Basic realm="ofl"');
      return fail(res, 401, "unauthorized");
    }
    res.locals.clientId = result;
    next();
  };
}

export function securityRoutes(device: DeviceSecurity): Router {
  const r = Router();

  // ---- §22.4 step 1 -------------------------------------------------------
  r.post("/garden/pair/challenge", (req, res) => {
    if (!device.setupCodePathOpen) return fail(res, 403, "pairing_closed");
    const nonce = typeof req.body?.nonce === "string" ? Buffer.from(req.body.nonce, "base64") : Buffer.alloc(0);
    if (nonce.length < 16) return fail(res, 400, "bad_request");
    res.json({
      proof: device.challengeProof(nonce),
      fingerprint: device.identity.fingerprint,
      garden_id: device.identity.garden_id,
    } satisfies PairChallengeResponse);
  });

  // ---- §22.4 step 2 -------------------------------------------------------
  r.post("/garden/pair", (req, res) => {
    const viaButton = device.pairingWindowOpen;
    if (!viaButton && !device.setupCodePathOpen) return fail(res, 403, "pairing_closed");

    const parsed = device.parseNewCredential(req.body);
    if (!parsed) return fail(res, 400, "bad_request");

    if (!viaButton) {
      if (req.body.setup_code === undefined) return fail(res, 400, "bad_request");
      const check = device.checkSetupCode(req.body.setup_code);
      if (check === "throttled") return fail(res, 429, "too_many_attempts");
      if (check === "invalid") return fail(res, 403, "invalid_setup_code");
    }

    const created = device.addCredential(parsed);
    if (typeof created === "string") return credentialError(res, created);
    if (viaButton) device.closePairingWindow(); // closes on the first successful pairing
    res.status(201).json({
      ...created,
      garden_id: device.identity.garden_id,
      fingerprint: device.identity.fingerprint,
    } satisfies PairResponse);
  });

  // ---- §22.6 --------------------------------------------------------------
  r.get("/garden/clients", (_req, res) => res.json(device.listClients()));

  r.post("/garden/clients", (req, res) => {
    const parsed = device.parseNewCredential(req.body);
    if (!parsed) return fail(res, 400, "bad_request");
    const created = device.addCredential(parsed);
    if (typeof created === "string") return credentialError(res, created);
    res.status(201).json({
      ...created,
      garden_id: device.identity.garden_id,
      fingerprint: device.identity.fingerprint,
    } satisfies PairResponse);
  });

  r.put("/garden/clients/:clientId", (req, res) => {
    const result = device.updateCredential(req.params.clientId, req.body);
    if (result === "not_found") return fail(res, 404, "not_found");
    if (result === "bad_request") return fail(res, 400, "bad_request");
    res.json(device.listClients().find((c) => c.client_id === req.params.clientId));
  });

  r.delete("/garden/clients/:clientId", (req, res) => {
    if (!device.deleteCredential(req.params.clientId)) return fail(res, 404, "not_found");
    res.status(204).end();
  });

  return r;
}
