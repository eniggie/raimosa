import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
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
  const t = String(Math.floor(Date.now() / 1000));
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

  // Replay protection: a correctly signed webhook with a stale timestamp is
  // refused (Stripe's 5-minute tolerance).
  const stale = "1700000000";
  const staleSig = createHmac("sha256", "test-stripe")
    .update(`${stale}.${sBody.toString("utf8")}`)
    .digest("hex");
  assert.equal(
    verifyStripe(sBody, { "stripe-signature": `t=${stale},v1=${staleSig}` }),
    false,
  );

  // A Stripe customer id is not an email and must never become a holder.
  const { buyerFromStripe } = mod;
  assert.ok(
    buyerFromStripe({
      type: "checkout.session.completed",
      data: { object: { id: "cs_2", customer: "cus_ABC123" } },
    }).skip,
  );
});

test("verifyLicenseKey refuses oversized and junk input", () => {
  assert.equal(verifyLicenseKey("RAIMOSA-" + "A".repeat(9000)).valid, false);
  assert.equal(verifyLicenseKey(null).valid, false);
});

// A hosted fulfillment server has no home directory to read a .pem from, so the
// signing key must be loadable straight from the environment — including the
// escaped-newline form every secrets dashboard produces on paste.
test("the signing key can be supplied by environment, not only by file", async () => {
  const {
    generateKeyPairSync,
    sign: edSign,
    verify: edVerify,
  } = await import("node:crypto");
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });

  const previousPem = process.env.RAIMOSA_LICENSE_KEY_PEM;
  const previousPath = process.env.RAIMOSA_LICENSE_KEY;
  try {
    // Escaped newlines, and a deliberately unusable file path, so this can only
    // pass by reading the environment.
    process.env.RAIMOSA_LICENSE_KEY_PEM = pem.replace(/\n/g, "\\n");
    process.env.RAIMOSA_LICENSE_KEY = "/nonexistent/never.pem";

    const { loadSigningKey } = await import(`${mintUrl}?env-key-${Date.now()}`);
    const loaded = loadSigningKey();
    const message = Buffer.from("raimosa");
    assert.ok(
      edVerify(null, message, publicKey, edSign(null, message, loaded)),
      "the key loaded from the environment must actually sign",
    );
  } finally {
    if (previousPem === undefined) delete process.env.RAIMOSA_LICENSE_KEY_PEM;
    else process.env.RAIMOSA_LICENSE_KEY_PEM = previousPem;
    if (previousPath === undefined) delete process.env.RAIMOSA_LICENSE_KEY;
    else process.env.RAIMOSA_LICENSE_KEY = previousPath;
  }
});

// Payment providers retry a webhook until they get a 2xx. A retry must not send
// the buyer a second key email. Asserted by actually running the server: source
// ordering proves nothing about behaviour.
test("a repeated webhook delivery is answered, not fulfilled twice", async () => {
  const { spawn } = await import("node:child_process");
  const { generateKeyPairSync, createHmac } = await import("node:crypto");
  const { mkdtempSync, readFileSync, existsSync } = await import("node:fs");
  const os = await import("node:os");

  const dir = mkdtempSync(path.join(os.tmpdir(), "raimosa-fulfil-"));
  const outbox = path.join(dir, "sales.jsonl");
  const { privateKey } = generateKeyPairSync("ed25519");
  const secret = "retry-test-secret";
  const port = 8788;

  const child = spawn("node", [fulfillUrl], {
    env: {
      ...process.env,
      PORT: String(port),
      RAIMOSA_LICENSE_KEY_PEM: privateKey.export({
        type: "pkcs8",
        format: "pem",
      }),
      RAIMOSA_LICENSE_KEY: "/nonexistent/never.pem",
      LEMONSQUEEZY_SIGNING_SECRET: secret,
      RAIMOSA_OUTBOX: outbox,
      RESEND_API_KEY: "",
    },
    stdio: "ignore",
  });

  try {
    // Wait for it to answer /health rather than guessing at a sleep.
    let up = false;
    for (let attempt = 0; attempt < 50 && !up; attempt += 1) {
      up = await fetch(`http://127.0.0.1:${port}/health`)
        .then((r) => r.ok)
        .catch(() => false);
      if (!up) await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(up, "the fulfillment server should start");

    const body = JSON.stringify({
      meta: { event_name: "order_created" },
      data: {
        id: "ord_retry_1",
        attributes: { user_email: "retry@example.com" },
      },
    });
    const signature = createHmac("sha256", secret).update(body).digest("hex");
    const deliver = () =>
      fetch(`http://127.0.0.1:${port}/webhook/lemonsqueezy`, {
        method: "POST",
        headers: {
          "x-signature": signature,
          "content-type": "application/json",
        },
        body,
      }).then((r) => r.json());

    const first = await deliver();
    const second = await deliver();
    assert.equal(first.ok, true);
    assert.ok(!first.duplicate, "the first delivery is a real fulfilment");
    assert.equal(second.duplicate, true, "the retry must be recognised");

    assert.ok(existsSync(outbox), "the sale is recorded");
    const lines = readFileSync(outbox, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean);
    assert.equal(lines.length, 1, "a retry must not append a second key");
  } finally {
    child.kill();
  }
});
