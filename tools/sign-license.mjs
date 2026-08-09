#!/usr/bin/env node
// Mint a RAIMOSA Pro license key. ECONTEUR-side only — needs the private
// signing key, which lives OUTSIDE the repo and must never be committed.
//
//   node tools/sign-license.mjs "buyer@email.com"
//
// Private key path resolves from RAIMOSA_LICENSE_KEY or ~/.raimosa-keys/.
// Print the emitted key and email it to the buyer (or wire this into a
// Lemon Squeezy / Gumroad / Stripe purchase webhook for automatic delivery).

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createPrivateKey, sign as edSign } from "node:crypto";

const holder = process.argv[2];
if (!holder) {
  console.error('Usage: node tools/sign-license.mjs "buyer@email.com"');
  process.exit(1);
}

const keyPath =
  process.env.RAIMOSA_LICENSE_KEY ||
  path.join(homedir(), ".raimosa-keys", "license-signing-private.pem");

let privateKey;
try {
  privateKey = createPrivateKey(readFileSync(keyPath, "utf8"));
} catch (error) {
  console.error(`Could not read the signing key at ${keyPath}: ${error.message}`);
  process.exit(1);
}

const toBase64Url = (buf) =>
  Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

// Note: no Date.now() available in some sandboxes, but this is a real CLI.
const payload = {
  p: "raimosa",
  t: "pro",
  h: String(holder).trim(),
  i: new Date().toISOString().slice(0, 10),
  v: 1,
};
const payloadBytes = Buffer.from(JSON.stringify(payload), "utf8");
const signature = edSign(null, payloadBytes, privateKey);
const key = `RAIMOSA-${toBase64Url(payloadBytes)}.${toBase64Url(signature)}`;

console.log(`\n  RAIMOSA Pro license for ${payload.h} (issued ${payload.i})\n`);
console.log(`  ${key}\n`);
