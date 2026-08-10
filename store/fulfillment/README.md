# RAIMOSA Pro — automatic license delivery

When someone buys Pro, this turns the sale into a signed license key emailed to
the buyer, with zero manual steps and no account system. It is the automated
version of `node tools/sign-license.mjs "buyer@email"` — same minting core
(`tools/mint-license.mjs`), same offline-verifiable key.

```
Buyer clicks "Get Pro" → Lemon Squeezy checkout → payment
   → Lemon Squeezy webhook → store/fulfillment/server.mjs
      → verify signature → mint Ed25519 key → email it → record in outbox
```

## What you (the owner) do once

Everything below the checkout account is already built and tested.

### 1. Create the product (recommended: Lemon Squeezy)

Lemon Squeezy is the merchant of record — it handles global sales tax/VAT for
you, which Stripe does not. Stripe is supported too if you prefer it.

1. Create a Lemon Squeezy store and a **single-payment** product, **$29** (launch)
   or **$39**. Name it "RAIMOSA Pro — lifetime license".
2. Copy the product's **Buy Now / checkout URL**.
3. Settings → Webhooks → add `https://<your-host>/webhook/lemonsqueezy`,
   subscribe to **`order_created`**, and copy the **signing secret**.

### 2. Get an email sender (optional but recommended)

[Resend](https://resend.com) free tier is enough. Verify your `raimzy.com`
domain, create an API key. Without this the key is still minted and saved to the
outbox — you just send it by hand.

### 3. Run the server

Put the signing key on the host at `~/.raimosa-keys/license-signing-private.pem`
(the same key already on this Mac — **never commit it**), then:

```bash
LEMONSQUEEZY_SIGNING_SECRET=<secret> \
RESEND_API_KEY=<re_...> \
RAIMOSA_FROM_EMAIL="RAIMOSA <hello@raimzy.com>" \
node store/fulfillment/server.mjs
```

Check it: `curl localhost:8791/health` → `canSign:true`, your provider `true`.

Host it anywhere that runs Node 22+ and gives you a public HTTPS URL (Railway
one-service deploy, a small VPS, Fly). Set the webhook URL to match.

### 4. Point the site's "Get Pro" button at checkout

In `web/index.html`, replace the `mailto:` Pro CTA with your Lemon Squeezy
checkout URL, then redeploy the `gh-pages` branch. (Search for
`GET-PRO-CHECKOUT-URL`.)

## Environment variables

| var | required | purpose |
|---|---|---|
| `RAIMOSA_LICENSE_KEY` | no | path to the private signing key (default `~/.raimosa-keys/license-signing-private.pem`) |
| `LEMONSQUEEZY_SIGNING_SECRET` | for LS | verifies the webhook is genuine |
| `STRIPE_WEBHOOK_SECRET` | for Stripe | verifies the Stripe webhook |
| `RESEND_API_KEY` | no | send the key by email; omit to use the outbox only |
| `RAIMOSA_FROM_EMAIL` | no | From header (default `RAIMOSA <hello@raimzy.com>`) |
| `PORT` | no | listen port (default 8791) |

## The outbox is the safety net

Every mint — emailed or not — is appended to
`~/.raimosa-keys/sales-outbox.jsonl` (one JSON line per sale: email, order id,
issue date, the key, whether the email sent). It holds **real license keys**, so
keep it beside the signing key and out of any repo. If an email ever fails, the
key is safe here and you can resend it.

## Security properties (kept, not compromised, by going automatic)

- Keys are **signed locally** — no key server, no phone-home; the app verifies
  offline exactly as before.
- Webhooks are **signature-verified** (constant-time HMAC); a forged call is
  rejected `401`.
- The server **fails to boot** without a signing key rather than hand out
  nothing or a fake.
- No buyer account, no telemetry — the only outbound call is the one email to
  the buyer.
