# RAIMOSA — how it makes money

RAIMOSA earns without betraying its promise. No accounts, no telemetry, no
phone-home. Money flows through **offline, cryptographically-signed license
keys** — the same trust-by-verification the receipt ledger uses.

## The line: Free vs Pro

**Free, forever** — the governed loop and the evidence:
- Find, summarize, storage insights, duplicates, preview, device vitals,
  network status, compare folders, process + folder monitoring
- The full **organize → approve → execute → verify** file loop
- Create documents, and the **tamper-evident receipt ledger** with export

Free is not a crippled demo — it fully proves RAIMOSA's unique value (governed,
verifiable action). That is what converts.

**Pro ($39 one-time, launch price $29)** — the desktop commander:
- Launch / quit applications, open documents
- Read / write the clipboard
- Capture the screen
- Sleep / restart / shut down
- Pair a phone as a mobile remote

Enforced **on the server** (`server/licensing.mjs` + `desktop-tools.mjs`), not
just hidden in the UI — a Free user calling a Pro route directly is refused.

## How a license key works

A key is an Ed25519-signed payload:

```
RAIMOSA-<base64url(payload)>.<base64url(signature)>
payload = { p:"raimosa", t:"pro", h:<buyer>, i:<date>, v:1 }
```

The app verifies it **locally** against the public key baked into
`licensing.mjs`. The private signing key lives only with ECONTEUR
(`~/.raimosa-keys/license-signing-private.pem`, mode 600, **never committed**).
A single altered character fails the signature — you cannot forge or edit a key
without the private key. Activation is stored durably and survives restarts.

## Minting a key

```bash
node tools/sign-license.mjs "buyer@email.com"
```

Prints the key to hand the buyer. Guard the private key like the signing
certificate — anyone who has it can mint free Pro.

## Selling it (pick one, all keep the offline model)

1. **Lemon Squeezy / Gumroad / Paddle** — cleanest for a solo founder. On
   purchase, a webhook runs `sign-license.mjs` and emails the key. They handle
   VAT/sales tax and act as merchant of record. **Recommended.**
2. **Stripe Payment Link** — a $29 link; a small webhook signs + emails the key.
   Lower fees, but you handle tax.
3. **Manual (start here today)** — for the first sales, run `sign-license.mjs`
   by hand and email the key. Zero infrastructure, proves demand first.

The Microsoft Store copy of RAIMOSA can also carry a price directly, but the
free direct download undercuts it — so keep the Store listing **free** for
reach and sell **Pro** through your own link.

## The real business (later): Team + cloud

The ledger is a **compliance asset**. The money above consumer Pro is
per-seat recurring sold to IT teams, MSPs, and regulated shops on one promise:
*"every automated action on every machine is approved, logged, and
tamper-proof — provable to an auditor."* That is Phase 3 of the roadmap: local
app free, a paid cloud control plane for fleet audit rollup, remote approval,
policy push, and SSO. Local-free / cloud-paid is the model that scales.

## Sequence

1. **Now:** app stays free everywhere; add GitHub Sponsors as a tip jar; sell
   Pro keys manually to the first buyers.
2. **v0.2:** wire Lemon Squeezy → automatic key delivery. Pro is live revenue.
3. **Later:** Team licenses + the cloud control plane — the recurring business.

© ECONTEUR LLC
