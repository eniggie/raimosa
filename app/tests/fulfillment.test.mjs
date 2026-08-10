import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { verifyLicenseKey } from "../server/licensing.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const mintUrl = path.join(repoRoot, "tools/mint-license.mjs");
const fulfillUrl = path.join(repoRoot, "store/fulfillment/server.mjs");

// The shared minting core produces keys the app accepts as genuine Pro.
test("mint-license core mints a key the app verifies as Pro", async () => {
  const { mintLicenseKey } = await import(mintUrl);
  const { key, payload } = mintLicenseKey("buyer@example.com", {
    issuedAt: "2026-08-10",
  });
  assert.equal(payload.t, "pro");
  const verdict = verifyLicenseKey(key);
  assert.equal(verdict.valid, true, verdict.reason);
  assert.equal(verdict.tier, "pro");
  assert.equal(verdict.holder, "buyer@example.com");
});

test("mint-license refuses an empty holder", async () => {
  const { mintLicenseKey } = await import(mintUrl);
  assert.throws(() => mintLicenseKey("   "), /holder/);
});

// Importing the fulfillment server must sign it can boot (it exits at import if
// it cannot load a signing key), and its verifiers must reject forged calls and
// accept genuinely-signed ones.
test("fulfillment verifiers reject bad signatures, accept good ones", async () => {
  process.env.LEMONSQUEEZY_SIGNING_SECRET = "test-secret";
  process.env.STRIPE_WEBHOOK_SECRET = "test-stripe";
  const mod = await import(fulfillUrl);
  const { verifyLemonSqueezy, verifyStripe, buyerFromLemonSqueezy } = mod;

  const body = Buffer.from(
    JSON.stringify({
      meta: { event_name: "order_created" },
      data: { id: "1", attributes: { user_email: "sale@example.com" } },
    }),
  );

  // Lemon Squeezy: HMAC-SHA256 hex over the raw body in x-signature.
  const goodSig = createHmac("sha256", "test-secret")
    .update(body)
    .digest("hex");
  assert.equal(verifyLemonSqueezy(body, { "x-signature": goodSig }), true);
  assert.equal(verifyLemonSqueezy(body, { "x-signature": "deadbeef" }), false);
  assert.equal(verifyLemonSqueezy(body, {}), false);

  // Buyer extraction pulls the email and ignores non-order events.
  assert.equal(
    buyerFromLemonSqueezy(JSON.parse(body)).email,
    "sale@example.com",
  );
  assert.ok(
    buyerFromLemonSqueezy({ meta: { event_name: "subscription_created" } })
      .skip,
  );

  // Stripe: HMAC over "<t>.<body>" in the v1 field.
  const t = "1700000000";
  const sBody = Buffer.from(
    JSON.stringify({
      type: "checkout.session.completed",
      data: { object: { id: "cs_1", customer_details: { email: "s@x.com" } } },
    }),
  );
  const sSig = createHmac("sha256", "test-stripe")
    .update(`${t}.${sBody.toString("utf8")}`)
    .digest("hex");
  assert.equal(
    verifyStripe(sBody, { "stripe-signature": `t=${t},v1=${sSig}` }),
    true,
  );
  assert.equal(
    verifyStripe(sBody, { "stripe-signature": `t=${t},v1=deadbeef` }),
    false,
  );
});
