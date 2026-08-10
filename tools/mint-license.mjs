// Shared license-minting core. ECONTEUR-side only — needs the private signing
// key, which lives OUTSIDE the repo (default ~/.raimosa-keys/) and must never
// be committed. Both the CLI (sign-license.mjs) and the purchase-fulfillment
// webhook (store/fulfillment/server.mjs) import from here so there is exactly
// one place that turns a buyer into a key.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createPrivateKey, sign as edSign } from "node:crypto";

const KEY_PREFIX = "RAIMOSA-";

const toBase64Url = (buf) =>
  Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

export function resolveKeyPath() {
  return (
    process.env.RAIMOSA_LICENSE_KEY ||
    path.join(homedir(), ".raimosa-keys", "license-signing-private.pem")
  );
}

/**
 * Load the Ed25519 private signing key. Throws with a clear message if it is
 * missing — a fulfillment server that cannot sign must fail loud, never mint a
 * fake key.
 */
export function loadSigningKey(keyPath = resolveKeyPath()) {
  return createPrivateKey(readFileSync(keyPath, "utf8"));
}

/**
 * Mint a Pro license key for a holder (an email or name). Returns the pasteable
 * key string and the payload that was signed, so a caller can log/store the
 * issue date. `issuedAt` defaults to today (ISO date) but is injectable for
 * deterministic tests.
 */
export function mintLicenseKey(holder, { privateKey, issuedAt } = {}) {
  const h = String(holder ?? "").trim();
  if (!h) throw new Error("A license holder (email or name) is required.");
  const key = privateKey ?? loadSigningKey();
  const payload = {
    p: "raimosa",
    t: "pro",
    h,
    i: issuedAt ?? new Date().toISOString().slice(0, 10),
    v: 1,
  };
  const payloadBytes = Buffer.from(JSON.stringify(payload), "utf8");
  const signature = edSign(null, payloadBytes, key);
  return {
    key: `${KEY_PREFIX}${toBase64Url(payloadBytes)}.${toBase64Url(signature)}`,
    payload,
  };
}
