// Device identity — open-farm-link/docs/22-security.md §22.2.
//
// An ECDSA P-256 key pair + self-signed certificate, generated on first boot
// and again on factory reset (§22.8). `fingerprint` and `garden_id` are both
// derived from the SHA-256 of the certificate's SubjectPublicKeyInfo, so the
// Garden's identity and its trust anchor can't drift apart.
//
// Node's crypto can make the key but not an X.509 certificate, so this shells
// out to the system `openssl` (LibreSSL on macOS is fine) — the key/cert pair
// is persisted in the data dir, so the fingerprint a Control Panel pinned
// survives mock restarts just like it would survive a real device reboot.

import { execFileSync } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

export interface DeviceIdentity {
  key: string; // PEM
  cert: string; // PEM
  spkiSha256: Buffer;
  fingerprint: string; // "sha256//<base64>", curl --pinnedpubkey format
  garden_id: string; // 16 chars lowercase RFC 4648 base32 of spkiSha256[0..10)
}

const RFC4648 = "abcdefghijklmnopqrstuvwxyz234567";

function base32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += RFC4648[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += RFC4648[(value << (5 - bits)) & 31];
  return out;
}

function derive(key: string, cert: string): DeviceIdentity {
  const spki = new X509Certificate(cert).publicKey.export({ type: "spki", format: "der" });
  const spkiSha256 = createHash("sha256").update(spki).digest();
  return {
    key,
    cert,
    spkiSha256,
    fingerprint: `sha256//${spkiSha256.toString("base64")}`,
    garden_id: base32(spkiSha256.subarray(0, 10)),
  };
}

function generate(dir: string): void {
  mkdirSync(dir, { recursive: true });
  const keyPath = path.join(dir, "device-key.pem");
  const certPath = path.join(dir, "device-cert.pem");
  execFileSync("openssl", ["ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", keyPath]);
  execFileSync("openssl", [
    "req", "-new", "-x509", "-sha256", "-days", "36500",
    "-key", keyPath, "-out", certPath, "-subj", "/CN=OFL Head Device",
  ]);
}

export function loadOrCreateIdentity(dir: string): DeviceIdentity {
  const keyPath = path.join(dir, "device-key.pem");
  const certPath = path.join(dir, "device-cert.pem");
  if (!existsSync(keyPath) || !existsSync(certPath)) generate(dir);
  return derive(readFileSync(keyPath, "utf8"), readFileSync(certPath, "utf8"));
}

/** §22.8: factory reset discards the key pair; the device comes back as a new Garden. */
export function regenerateIdentity(dir: string): DeviceIdentity {
  rmSync(path.join(dir, "device-key.pem"), { force: true });
  rmSync(path.join(dir, "device-cert.pem"), { force: true });
  return loadOrCreateIdentity(dir);
}
