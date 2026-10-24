// The security-relevant state of a Head Device — open-farm-link/docs/22-security.md.
// Setup code (§22.3), pairing window (§22.4), credentials (§22.6), the
// brute-force limit (§22.5), secret storage (§22.9) and factory reset (§22.8).
//
// Identity + setup code + credentials are persisted to `<dataDir>/device.json`
// (and the key/cert next to it), like a real device's flash: a Control Panel
// that paired once stays paired across mock restarts. The rest of the Garden
// (names, Scenarios, ...) is still in-memory only — see state.ts.

import { EventEmitter } from "node:events";
import { createHash, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ClientEntry, CredentialMethod } from "@ofl-panel/shared";
import { loadOrCreateIdentity, regenerateIdentity, type DeviceIdentity } from "./identity.js";

export const PAIRING_WINDOW_MS = 2 * 60 * 1000;
const THROTTLE_AFTER_FAILURES = 5;
const THROTTLE_INTERVAL_MS = 10_000;
const PBKDF2_ITERATIONS = 100_000;

interface StoredCredential {
  client_id: string;
  name: string;
  method: CredentialMethod;
  username?: string;
  token_sha256?: string; // hex — §22.9: tokens stored only as SHA-256
  salt?: string; // hex
  password_hash?: string; // hex, PBKDF2-HMAC-SHA256
}

interface PersistedSecrets {
  setup_code: string | null; // normalized, no dashes
  credentials: StoredCredential[];
}

export type NewCredential =
  | { method: "token"; name: string }
  | { method: "password"; name: string; username: string; password: string };

export type CredentialError = "bad_request" | "username_taken" | "no_free_slots";

// ---- Setup code (§22.3) ----------------------------------------------------

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function normalizeSetupCode(input: string): string {
  return input.replace(/[-\s]/g, "").toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1");
}

export function formatSetupCode(normalized: string): string {
  return normalized.match(/.{1,4}/g)!.join("-");
}

function generateSetupCode(): string {
  // 80 bits → 16 Crockford base32 characters.
  const bytes = randomBytes(10);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}

// ---- Validation (§22.5) ----------------------------------------------------

const USERNAME_RE = /^[a-z0-9._-]{1,32}$/;

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// ---- Device ----------------------------------------------------------------

export class DeviceSecurity extends EventEmitter {
  identity: DeviceIdentity;
  private secrets: PersistedSecrets;
  private windowTimer: NodeJS.Timeout | null = null;
  windowClosesAt: number | null = null;

  // §22.5 brute-force limit — global across all clients and schemes.
  private consecutiveFailures = 0;
  private lastAttemptAt = 0;

  // §22.9 MAY: RAM cache of already-verified Authorization headers (hashed),
  // so PBKDF2 doesn't run on every request. Dropped on any credential change.
  private verifiedHeaders = new Map<string, string>();

  constructor(
    private readonly dataDir: string,
    private readonly slots: number,
    setupCodeOverride: string | undefined,
  ) {
    super();
    mkdirSync(dataDir, { recursive: true });
    this.identity = loadOrCreateIdentity(dataDir);
    this.secrets = this.load();

    // OFL_SETUP_CODE=none → button-only device; any other value replaces the
    // stored code; unset → keep the stored one, or generate one on first boot
    // (the "DIY build MAY generate one on first boot" case from §22.3).
    if (setupCodeOverride === "none") this.secrets.setup_code = null;
    else if (setupCodeOverride) this.secrets.setup_code = normalizeSetupCode(setupCodeOverride);
    else if (!existsSync(this.secretsPath)) this.secrets.setup_code = generateSetupCode();
    this.save();
  }

  private get secretsPath(): string {
    return path.join(this.dataDir, "device.json");
  }

  private load(): PersistedSecrets {
    if (!existsSync(this.secretsPath)) return { setup_code: null, credentials: [] };
    return JSON.parse(readFileSync(this.secretsPath, "utf8")) as PersistedSecrets;
  }

  private save(): void {
    writeFileSync(this.secretsPath, JSON.stringify(this.secrets, null, 2));
  }

  private changed(): void {
    this.verifiedHeaders.clear();
    this.save();
    this.emit("changed");
  }

  // ---- State queries -------------------------------------------------------

  get setupCode(): string | null {
    return this.secrets.setup_code;
  }

  get claimed(): boolean {
    return this.secrets.credentials.length > 0;
  }

  get pairingWindowOpen(): boolean {
    return this.windowClosesAt !== null && Date.now() < this.windowClosesAt;
  }

  get setupCodePathOpen(): boolean {
    return !this.claimed && this.secrets.setup_code !== null;
  }

  /** mDNS TXT `pair=` value (§22.4), or undefined when not pairable. */
  get pairAdvert(): "button" | "code" | undefined {
    if (this.pairingWindowOpen) return "button";
    if (this.setupCodePathOpen) return "code";
    return undefined;
  }

  // ---- Pairing window (§22.4) ----------------------------------------------

  openPairingWindow(): void {
    if (this.windowTimer) clearTimeout(this.windowTimer);
    this.windowClosesAt = Date.now() + PAIRING_WINDOW_MS;
    this.windowTimer = setTimeout(() => this.closePairingWindow(), PAIRING_WINDOW_MS);
    this.emit("changed");
  }

  closePairingWindow(): void {
    if (this.windowTimer) clearTimeout(this.windowTimer);
    this.windowTimer = null;
    this.windowClosesAt = null;
    this.emit("changed");
  }

  // ---- Brute-force limit (§22.5) -------------------------------------------

  /** False → answer 429 without evaluating the attempt. */
  private admitAttempt(): boolean {
    const now = Date.now();
    if (this.consecutiveFailures >= THROTTLE_AFTER_FAILURES && now - this.lastAttemptAt < THROTTLE_INTERVAL_MS) {
      return false;
    }
    this.lastAttemptAt = now;
    return true;
  }

  private recordAttempt(ok: boolean): void {
    this.consecutiveFailures = ok ? 0 : this.consecutiveFailures + 1;
  }

  // ---- Authentication ------------------------------------------------------

  /** Returns the client_id, or "invalid"/"throttled". */
  authenticate(header: string): string | "invalid" | "throttled" {
    // The cache only skips PBKDF2 — a cached header is still an attempt for
    // the brute-force limit, so legit clients are throttled too while it's
    // engaged, exactly like §22.5 reads ("any scheme, any client").
    if (!this.admitAttempt()) return "throttled";
    const headerKey = sha256Hex(header);
    const clientId = this.verifiedHeaders.get(headerKey) ?? this.verify(header);
    this.recordAttempt(clientId !== null);
    if (!clientId) return "invalid";
    this.verifiedHeaders.set(headerKey, clientId);
    return clientId;
  }

  private verify(header: string): string | null {
    const [scheme, value] = header.split(/\s+/, 2);
    if (!value) return null;

    if (scheme.toLowerCase() === "bearer") {
      const hash = sha256Hex(value);
      const cred = this.secrets.credentials.find((c) => c.method === "token" && safeEqualHex(c.token_sha256!, hash));
      return cred?.client_id ?? null;
    }

    if (scheme.toLowerCase() === "basic") {
      const decoded = Buffer.from(value, "base64").toString("utf8");
      const sep = decoded.indexOf(":");
      if (sep < 0) return null;
      const username = decoded.slice(0, sep);
      const password = decoded.slice(sep + 1);
      const cred = this.secrets.credentials.find((c) => c.method === "password" && c.username === username);
      if (!cred) return null;
      const hash = pbkdf2Sync(password, Buffer.from(cred.salt!, "hex"), PBKDF2_ITERATIONS, 32, "sha256").toString("hex");
      return safeEqualHex(cred.password_hash!, hash) ? cred.client_id : null;
    }

    return null;
  }

  /** Setup-code path of POST /garden/pair. Counts toward the brute-force limit. */
  checkSetupCode(code: unknown): "ok" | "invalid" | "throttled" {
    if (!this.admitAttempt()) return "throttled";
    const ok = typeof code === "string" && this.secrets.setup_code !== null && normalizeSetupCode(code) === this.secrets.setup_code;
    this.recordAttempt(ok);
    return ok ? "ok" : "invalid";
  }

  /** §22.4 step 1: base64 HMAC-SHA256(setup code, nonce ‖ SHA-256(SPKI)). */
  challengeProof(nonce: Buffer): string {
    return createHmac("sha256", Buffer.from(this.secrets.setup_code!, "ascii"))
      .update(Buffer.concat([nonce, this.identity.spkiSha256]))
      .digest("base64");
  }

  // ---- Credential management (§22.6) ---------------------------------------

  listClients(): ClientEntry[] {
    return this.secrets.credentials.map(({ client_id, name, method, username }) =>
      method === "password" ? { client_id, name, method, username } : { client_id, name, method },
    );
  }

  /** Validates a POST /garden/pair or POST /garden/clients body (minus setup_code). */
  parseNewCredential(body: unknown): NewCredential | null {
    const b = body as Record<string, unknown> | null;
    if (!b || typeof b.name !== "string" || b.name.length === 0) return null;
    if (b.method === "token") return { method: "token", name: b.name };
    if (b.method === "password") {
      if (typeof b.username !== "string" || !USERNAME_RE.test(b.username)) return null;
      if (!this.passwordAcceptable(b.password, b.username)) return null;
      return { method: "password", name: b.name, username: b.username, password: b.password as string };
    }
    return null;
  }

  private passwordAcceptable(password: unknown, username: string): password is string {
    if (typeof password !== "string" || password.length < 10 || password.length > 64) return false;
    if (password === username) return false;
    if (this.secrets.setup_code && normalizeSetupCode(password) === this.secrets.setup_code) return false;
    return true;
  }

  addCredential(req: NewCredential): { client_id: string; token?: string } | CredentialError {
    if (this.secrets.credentials.length >= this.slots) return "no_free_slots";
    if (req.method === "password" && this.secrets.credentials.some((c) => c.username === req.username)) {
      return "username_taken";
    }

    let n = 1;
    while (this.secrets.credentials.some((c) => c.client_id === `c${n}`)) n++;
    const client_id = `c${n}`;

    if (req.method === "token") {
      const token = `ofl_${randomBytes(32).toString("base64url")}`;
      this.secrets.credentials.push({ client_id, name: req.name, method: "token", token_sha256: sha256Hex(token) });
      this.changed();
      return { client_id, token };
    }

    this.secrets.credentials.push({ client_id, name: req.name, method: "password", username: req.username, ...this.hashPassword(req.password) });
    this.changed();
    return { client_id };
  }

  private hashPassword(password: string): { salt: string; password_hash: string } {
    const salt = randomBytes(16);
    const hash = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, "sha256");
    return { salt: salt.toString("hex"), password_hash: hash.toString("hex") };
  }

  /** PUT /garden/clients/{id}: { name?, password? }. */
  updateCredential(clientId: string, body: unknown): "ok" | "not_found" | "bad_request" {
    const cred = this.secrets.credentials.find((c) => c.client_id === clientId);
    if (!cred) return "not_found";
    const b = (body ?? {}) as Record<string, unknown>;
    if (b.name !== undefined && (typeof b.name !== "string" || b.name.length === 0)) return "bad_request";
    if (b.password !== undefined) {
      // A token is never changed, only deleted and re-issued.
      if (cred.method !== "password" || !this.passwordAcceptable(b.password, cred.username!)) return "bad_request";
    }
    if (typeof b.name === "string") cred.name = b.name;
    if (typeof b.password === "string") Object.assign(cred, this.hashPassword(b.password));
    this.changed();
    return "ok";
  }

  deleteCredential(clientId: string): boolean {
    const before = this.secrets.credentials.length;
    this.secrets.credentials = this.secrets.credentials.filter((c) => c.client_id !== clientId);
    if (this.secrets.credentials.length === before) return false;
    this.changed();
    return true;
  }

  // ---- Factory reset (§22.8) -----------------------------------------------

  /** Erases credentials and regenerates the key pair. Keeps the setup code. */
  factoryReset(): void {
    this.secrets.credentials = [];
    this.identity = regenerateIdentity(this.dataDir);
    this.consecutiveFailures = 0;
    if (this.windowTimer) clearTimeout(this.windowTimer);
    this.windowTimer = null;
    this.windowClosesAt = null;
    this.changed();
  }
}
