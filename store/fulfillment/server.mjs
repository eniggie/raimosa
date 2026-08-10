#!/usr/bin/env node
// RAIMOSA Pro — purchase fulfillment webhook.
//
// One small, dependency-free HTTP server. A payment provider (Lemon Squeezy or
// Stripe) calls it when someone buys Pro; it verifies the call is genuine,
// mints an Ed25519-signed license key with the same core the CLI uses
// (tools/mint-license.mjs), emails it to the buyer, and records the sale in a
// local append-only outbox so nothing is ever lost.
//
// It phones no home of its own: keys are signed locally, and the only outbound
// call is the one email to the buyer. RAIMOSA's no-account / no-telemetry
// promise survives the checkout.
//
//   RAIMOSA_LICENSE_KEY=~/.raimosa-keys/license-signing-private.pem \
//   LEMONSQUEEZY_SIGNING_SECRET=whsec_... \
//   RESEND_API_KEY=re_...  RAIMOSA_FROM_EMAIL="RAIMOSA <hello@raimzy.com>" \
//   node store/fulfillment/server.mjs
//
// Endpoints:
//   POST /webhook/lemonsqueezy   Lemon Squeezy order webhook  (recommended)
//   POST /webhook/stripe         Stripe checkout.session.completed
//   GET  /health                 readiness (does it have a signing key + secret?)
//
// Every env knob is optional except a way to verify signatures for whichever
// provider you point at it. Missing an email provider degrades gracefully: the
// key is still minted and written to the outbox for manual send.

import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { mintLicenseKey, loadSigningKey } from "../../tools/mint-license.mjs";

const PORT = Number(process.env.PORT || 8791);
const LS_SECRET = process.env.LEMONSQUEEZY_SIGNING_SECRET || "";
const STRIPE_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const FROM_EMAIL =
  process.env.RAIMOSA_FROM_EMAIL || "RAIMOSA <hello@raimzy.com>";
const OUTBOX = path.join(homedir(), ".raimosa-keys", "sales-outbox.jsonl");

// Fail loud at boot if we can't sign — a fulfillment server that can't mint a
// real key must never start and hand out nothing (or worse, a fake).
let SIGNING_KEY;
try {
  SIGNING_KEY = loadSigningKey();
} catch (error) {
  console.error(
    `\n  FATAL: no signing key. Set RAIMOSA_LICENSE_KEY or place it at\n` +
      `  ~/.raimosa-keys/license-signing-private.pem\n  (${error.message})\n`,
  );
  process.exit(1);
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 1_000_000) {
        // A purchase webhook is small; anything huge is not one.
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function safeEqualHex(aHex, bHex) {
  const a = Buffer.from(String(aHex), "hex");
  const b = Buffer.from(String(bHex), "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

// Lemon Squeezy signs the raw body: HMAC-SHA256, hex, in X-Signature.
function verifyLemonSqueezy(raw, headers) {
  if (!LS_SECRET) throw new Error("LEMONSQUEEZY_SIGNING_SECRET is not set");
  const provided = headers["x-signature"];
  if (!provided) return false;
  const expected = createHmac("sha256", LS_SECRET).update(raw).digest("hex");
  return safeEqualHex(provided, expected);
}

// Stripe: header "Stripe-Signature: t=<ts>,v1=<hmac>"; HMAC is over "<t>.<body>".
function verifyStripe(raw, headers) {
  if (!STRIPE_SECRET) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
  const header = headers["stripe-signature"];
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((kv) => kv.split("=").map((s) => s.trim())),
  );
  if (!parts.t || !parts.v1) return false;
  const expected = createHmac("sha256", STRIPE_SECRET)
    .update(`${parts.t}.${raw.toString("utf8")}`)
    .digest("hex");
  return safeEqualHex(parts.v1, expected);
}

function buyerFromLemonSqueezy(event) {
  const name = event?.meta?.event_name;
  if (name !== "order_created") return { skip: `ignored event ${name}` };
  const attrs = event?.data?.attributes || {};
  const email = attrs.user_email || attrs.customer_email;
  if (!email) return { skip: "order_created without an email" };
  return { email, name: attrs.user_name || email, orderId: event?.data?.id };
}

function buyerFromStripe(event) {
  const name = event?.type;
  if (name !== "checkout.session.completed") return { skip: `ignored ${name}` };
  const obj = event?.data?.object || {};
  const email =
    obj.customer_details?.email || obj.customer_email || obj.customer;
  if (!email) return { skip: "checkout.session without an email" };
  return { email, name: obj.customer_details?.name || email, orderId: obj.id };
}

async function deliverEmail(to, key, holder) {
  const subject = "Your RAIMOSA Pro license key";
  const text =
    `Thank you for buying RAIMOSA Pro.\n\n` +
    `Your license key:\n\n  ${key}\n\n` +
    `To activate: open RAIMOSA → Tools → paste the key into "Activate Pro".\n` +
    `It unlocks application control, clipboard, screen capture, power actions, ` +
    `and mobile remote. The key verifies entirely on your machine — no account, ` +
    `no login, nothing phoned home.\n\n— RAIMOSA / ECONTEUR LLC`;

  if (!RESEND_API_KEY) return { sent: false, reason: "no email provider set" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM_EMAIL, to, subject, text }),
    });
    if (!res.ok) return { sent: false, reason: `resend ${res.status}` };
    return { sent: true };
  } catch (error) {
    return { sent: false, reason: error.message };
  }
}

// The outbox is the durable record: every mint lands here, sent or not, so a
// key is never lost to a flaky email call. It is append-only by convention and
// holds real license keys — keep it beside the signing key (chmod 600 dir).
function recordSale(entry) {
  try {
    mkdirSync(path.dirname(OUTBOX), { recursive: true });
    appendFileSync(OUTBOX, JSON.stringify(entry) + "\n", "utf8");
  } catch (error) {
    console.error(`  WARN: could not write outbox: ${error.message}`);
  }
}

async function handlePurchase(buyer) {
  const { key, payload } = mintLicenseKey(buyer.email, {
    privateKey: SIGNING_KEY,
  });
  const delivery = await deliverEmail(buyer.email, key, buyer.name);
  const entry = {
    at: new Date().toISOString(),
    email: buyer.email,
    orderId: buyer.orderId || null,
    issued: payload.i,
    key,
    emailed: delivery.sent,
    emailNote: delivery.reason || null,
  };
  recordSale(entry);
  console.log(
    `  minted Pro for ${buyer.email}` +
      (delivery.sent ? " (emailed)" : ` (NOT emailed: ${delivery.reason})`),
  );
  return entry;
}

const server = createServer(async (req, res) => {
  const send = (code, body) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (req.method === "GET" && req.url === "/health") {
    return send(200, {
      ok: true,
      canSign: Boolean(SIGNING_KEY),
      providers: {
        lemonsqueezy: Boolean(LS_SECRET),
        stripe: Boolean(STRIPE_SECRET),
      },
      email: RESEND_API_KEY ? "resend" : "none (outbox only)",
    });
  }

  if (req.method !== "POST") return send(404, { error: "not found" });

  let raw;
  try {
    raw = await readRawBody(req);
  } catch (error) {
    return send(400, { error: error.message });
  }

  let verify, extract;
  if (req.url === "/webhook/lemonsqueezy") {
    verify = verifyLemonSqueezy;
    extract = buyerFromLemonSqueezy;
  } else if (req.url === "/webhook/stripe") {
    verify = verifyStripe;
    extract = buyerFromStripe;
  } else {
    return send(404, { error: "unknown webhook" });
  }

  let genuine;
  try {
    genuine = verify(raw, req.headers);
  } catch (error) {
    // Misconfiguration (no secret) — refuse rather than trust an unverified call.
    return send(500, { error: error.message });
  }
  if (!genuine) return send(401, { error: "signature verification failed" });

  let event;
  try {
    event = JSON.parse(raw.toString("utf8"));
  } catch {
    return send(400, { error: "invalid JSON" });
  }

  const buyer = extract(event);
  if (buyer.skip) return send(200, { ok: true, skipped: buyer.skip });

  try {
    const entry = await handlePurchase(buyer);
    // 200 so the provider marks it delivered; the key is safe in the outbox
    // even if the email failed.
    return send(200, { ok: true, emailed: entry.emailed });
  } catch (error) {
    console.error(`  ERROR minting for ${buyer.email}: ${error.message}`);
    return send(500, { error: "mint failed" });
  }
});

// Only bind a port when run directly — importing for tests must not listen.
if (import.meta.url === `file://${process.argv[1]}`) {
  server.listen(PORT, () => {
    console.log(`\n  RAIMOSA fulfillment listening on :${PORT}`);
    console.log(`  lemonsqueezy secret: ${LS_SECRET ? "set" : "MISSING"}`);
    console.log(`  stripe secret:       ${STRIPE_SECRET ? "set" : "MISSING"}`);
    console.log(
      `  email provider:      ${RESEND_API_KEY ? "resend" : "outbox only"}`,
    );
    console.log(`  outbox:              ${OUTBOX}\n`);
  });
}

export {
  verifyLemonSqueezy,
  verifyStripe,
  buyerFromLemonSqueezy,
  buyerFromStripe,
};
