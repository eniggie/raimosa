import { createPublicKey, verify as edVerify } from "node:crypto";

// RAIMOSA licensing — offline, cryptographic, no accounts, no phone-home.
//
// A license key is an Ed25519-signed payload. The app verifies it locally
// against the public key below; the matching private key lives only with
// ECONTEUR LLC. This is monetization built the way RAIMOSA builds trust: you
// can verify a key is genuine without asking any server, exactly like the
// receipt ledger. No network, no telemetry, no login — RAIMOSA's promise is
// intact whether you are Free or Pro.
//
// Key format (one line, pasteable):
//   RAIMOSA-<base64url(payload)>.<base64url(signature)>
// where payload is JSON: { p:"raimosa", t:"pro", h:<holder>, i:<ISO date>, v:1 }

const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAETpOfdh35vLCJK9C5oJJ+1oCX/Emb9WhnpAzwbjGEDc=
-----END PUBLIC KEY-----`;

const PUBLIC_KEY = createPublicKey(PUBLIC_KEY_PEM);
const KEY_PREFIX = "RAIMOSA-";

// The Pro line: RAIMOSA is the full desktop commander. Free proves the
// governed loop (inspect, organize with approval, and the tamper-evident
// ledger); Pro unlocks the tools that command the machine itself.
export const PRO_TOOLS = new Set([
  "launch-application",
  "close-application",
  "open-document",
  "read-clipboard",
  "write-clipboard",
  "capture-screen",
  "system-power",
]);

// Feature gates that are not single tools (checked by name at their entry).
export const PRO_FEATURES = new Set(["mobile-remote"]);

function fromBase64Url(text) {
  return Buffer.from(
    String(text).replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  );
}

/**
 * Verify a license key entirely offline.
 *
 * @returns {{valid:boolean, reason?:string, tier?:string, holder?:string,
 *            issuedAt?:string}}
 */
export function verifyLicenseKey(rawKey) {
  const key = String(rawKey ?? "").trim();
  if (!key.startsWith(KEY_PREFIX))
    return { valid: false, reason: "This is not a RAIMOSA license key." };
  const body = key.slice(KEY_PREFIX.length);
  const dot = body.indexOf(".");
  if (dot < 1) return { valid: false, reason: "The license key is malformed." };

  const payloadPart = body.slice(0, dot);
  const signaturePart = body.slice(dot + 1);
  let payloadBytes;
  let signature;
  try {
    payloadBytes = fromBase64Url(payloadPart);
    signature = fromBase64Url(signaturePart);
  } catch {
    return { valid: false, reason: "The license key is malformed." };
  }

  // The signature covers the exact payload bytes. A single altered character
  // fails here — the same tamper-evidence the ledger uses.
  let signatureOk = false;
  try {
    signatureOk = edVerify(null, payloadBytes, PUBLIC_KEY, signature);
  } catch {
    signatureOk = false;
  }
  if (!signatureOk)
    return {
      valid: false,
      reason: "The license key signature is invalid.",
    };

  let payload;
  try {
    payload = JSON.parse(payloadBytes.toString("utf8"));
  } catch {
    return { valid: false, reason: "The license payload is unreadable." };
  }
  if (payload.p !== "raimosa")
    return { valid: false, reason: "This key is not for RAIMOSA." };
  if (payload.t !== "pro")
    return { valid: false, reason: `Unknown license tier "${payload.t}".` };

  return {
    valid: true,
    tier: "pro",
    holder: String(payload.h ?? "").trim() || "licensed user",
    issuedAt: payload.i ?? null,
  };
}

/** A tool or feature name that requires Pro. */
export function requiresPro(name) {
  return PRO_TOOLS.has(name) || PRO_FEATURES.has(name);
}
