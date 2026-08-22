# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Durable RAIMOSA decisions

- Current visual truth: `../docs/ux/raimosa-command-center-ovia-unified-v2.png`.
- Product identity is **RAIMOSA AI** with the approved R emblem in `public/assets/raimosa-r-emblem.png`.
- There is one unified **OVIA AI**, not separate Commander and Inspector agents.
- Always use the full user-facing name **OVIA AI**; never shorten the name in product copy.
- OVIA AI has three visible modes inside one persistent chat: **Ask**, **Operate**, and **Scan & Debug**.
- The composer always shows the current mode and authority.
- **All Access** is one visible, time-limited, revocable session; it never removes high-risk step-up approvals.
- Scan & Debug starts read-only, can propose a repair mission, and verifies the result in the same conversation.
- RAIMOSA AI is designed to find and organize approved files, launch or close supported apps, open documents, monitor long-running work, create verified work products, and prepare sleep/restart/shutdown actions.
- Sign-in assistance may open and guide an approved authentication surface, but credentials remain system- or browser-managed and the user completes authentication.
- Broad desktop operation means supported, named adapters under visible policy; it never means hidden arbitrary control, silent credential use, or unlogged execution.
- Do not expose a desktop action, tool card, or CTA until its real adapter exists and the result can be verified end to end. Roadmap capabilities belong in documentation, not as clickable product controls.
- RAIMOSA AI is desktop-first. Mobile is supported only as a paired local-network remote for the active desktop session, not as a separate mobile product.
- Mobile remote pairing requires a fresh desktop-generated code plus an active OVIA AI All Access session. Revoking All Access or using Emergency stop must invalidate paired remote sessions immediately.
- Read-only adapters may run without All Access. Writes, application control, document opening, and visible notifications require a server-validated All Access token and a verification receipt.
- Tool and Permission UI must be derived from the live capability registry. Unavailable capabilities may be explained but must never expose action controls.
- OVIA AI Core is a local intent, capability-selection, risk, approval, receipt, and verification layer. Do not imply an external model provider or proprietary-model clone unless one is actually configured and verified.
- Use Mission, Workflow, Ledger, Permission, Plan, Receipt, and Finding language from the product docs.
- Royal purple is the primary interaction color, gold is structural/evidence emphasis, warm ivory is primary text, and near-black is the product field.
- Keep the Emergency stop visible across the desktop shell.
- Global commands must populate the visible OVIA AI Core compiler and return the real compiled plan; acknowledgements must not imply a plan was created when no adapter call ran.
- OVIA AI Scan & Debug must call the live read-only runtime scan. Sample findings must never masquerade as current diagnostic evidence.
- Adapter, All Access, and paired-remote events are recorded in a durable append-only SQLite receipt ledger (`server/ledger.mjs`, stored at `local-workspace/.raimosa/ledger.db`). Receipts survive a runtime restart.
- Every receipt is hash-chained to its predecessor, and UPDATE/DELETE are rejected by database triggers. The ledger is evidence, not a log: never add a code path that rewrites, prunes, or reorders it.
- The Ledger UI must report durability and chain integrity from the live API, never as static copy. A broken chain must be shown as a failure and must fail the health scan, never be softened or hidden.
- Approvals and authority live in a durable store (`server/state-store.mjs`, `local-workspace/.raimosa/state.db`). Access tokens, remote tokens, and pairing codes are persisted **only as SHA-256 hashes**; `putSession` throws rather than write a raw credential. Never add a code path that stores a usable secret at rest.
- **All Access never silently survives a restart.** All Access is defined as a *visible* session, and a stopped runtime takes its countdown with it. On startup, any session that outlived the process is revoked and recorded as an `access-interrupted` receipt. Paired remotes and pairing codes die with it. Never "resume" authority.
- Approvals *do* survive a restart, because a plan is inert until executed under live authority. An approval is single-use: it is claimed durably **before** the first file moves, so a crash mid-execution can never replay it into duplicate side effects.
- **Emergency stop is a durable server-side latch**, not a UI state. While latched, every adapter dispatch, All Access grant, and pairing action is refused at the server; the latch survives restarts and is cleared only by an explicit owner action. Both latch and clear are ledger receipts. A fresh tab must restore the active-stop state from `/health`.
- OVIA AI Core must never default an unrecognized command to a capability. No keyword match → `decision: "clarification-needed"`, no adapter, no execution control. Defaulting would be a fail-open normalizer on an intent.
- Hidden folders (any path segment starting with `.`) can never be approved as adapter roots — they hold credentials and private state (`~/.ssh`, `~/.aws`).
- **The capability registry is the authority, not UI state.** `handle()` resolves each tool through `TOOL_CAPABILITY` and refuses anything whose capability is not `available` on this platform. Adding a tool means adding its catalog entry *and* its map entry — otherwise the catalog would only hide buttons while the route still executed.
- A receipt must never claim an action succeeded when nothing happened. Windows `close-application` reports `windowsAsked` and returns `no-matching-window` when no process matched, because a Start Menu shortcut name can differ from the process name.
- Ledger exports always carry the live integrity verdict and an attestation string. An export must never look trustworthy when the chain underneath it is broken.
- **The ledger is permanent, so never write user content into it.** Any adapter returning file contents must publish a redacted projection via `LEDGER_REDACTORS` in `server/desktop-tools.mjs`: the caller gets the bytes, the ledger gets path, size, and a SHA-256. Evidence that a read happened, never the bytes read.
- Every scanning adapter must be bounded *and* say when a bound was hit. `find-duplicates` reports `complete`, `bytesHashed`, and an explicit `limitation` string. Never return a partial result that looks complete.
- The ambient field is painted on `body::before`, outside the `.shell` subtree that carries `.reduced-motion`. `App.jsx` mirrors the setting onto `<body class="reduced-motion-field">`. Any new animation outside `.shell` must be covered the same way.
- Pairing codes come from `crypto.randomInt`, and 5 failed pairing attempts revoke every outstanding code (`remote-pairing-lockout` receipt). Never weaken the attempt limit or switch to `Math.random`.
- RAIMOSA AI must never claim an action, agent dispatch, or repair ran without a verified adapter receipt. Every detected issue and failed check must be surfaced; findings cannot be silently skipped.
- Local AI agent discovery is read-only process and executable metadata. Commanding Codex, Claude, Grok, Gemini, or another agent requires a named, authenticated, revocable provider adapter and must never inherit credentials or authority.
- Monetization is offline and cryptographic — never add accounts, telemetry, or a license server. A license key is an Ed25519-signed token verified locally in `server/licensing.mjs` against the embedded public key; the private signing key lives only at `~/.raimosa-keys/` and must never be committed. Never add a Pro bypass/backdoor (no `_proForTests` option, no env override): tests unlock Pro by minting a real key via `tools/sign-license.mjs`.
- Pro gating is server-enforced in `handle()` (via `PRO_TOOLS`) and at `startRemotePairing` (via `PRO_FEATURES`), not just hidden in the UI — the same principle as every other RAIMOSA gate. Free must stay genuinely useful (the full governed loop + ledger); that free value is what converts to Pro.
- **There is exactly one minting path**: `tools/mint-license.mjs`. The manual CLI (`tools/sign-license.mjs`) and the purchase webhook (`store/fulfillment/server.mjs`) both import it, so a key minted by a sale is byte-identical to one minted by hand. Never add a second place that constructs a key.
- The fulfillment server **verifies every webhook signature** with a constant-time HMAC compare and **exits at boot** if it cannot load the signing key — it must never accept an unverified call or hand out a key it could not really sign. A missing provider secret is a `500` (misconfiguration), never a silent trust.
- Every mint is appended to `~/.raimosa-keys/sales-outbox.jsonl` **before** the response, so a failed email can never lose a paid-for key. The outbox holds real license keys: it lives beside the signing key, outside the repo, and is never committed.
- A server that binds a port must guard `listen()` behind an `import.meta.url === file://${process.argv[1]}` check, so importing it in tests does not occupy a port.
- **No prototype surfaces ship.** The Home/Missions/Workflows/Mission "interactive preview" screens were removed on 2026-08-10: a `PrototypeNotice` banner does not make fabricated receipt IDs, canned findings, or `setTimeout` fake progress acceptable in a paid product. Home now reads the live capability registry, the durable latch, and the real receipt ledger. `tests/no-fake-features.test.mjs` pins this — every nav entry must route to a real view, and the fabricated identifiers must never reappear.
- **A switch that writes state nothing reads is a fake control.** Settings only renders preferences that actually change behaviour.
- **A recovery/status claim must be derived from the server response, not asserted by the UI.** `emergencyStop()` returns the counts it actually revoked and the dialog renders those numbers; when the response is missing it says so instead of showing a checklist.
- **Never let one generic word select a high-impact capability.** Intent matching is whole-word (`includes("move")` also fires inside "remove"), and ambiguous everyday words live in `weakWords`, scoring only when a `context` word shows the sentence refers to the machine — so "how do I sleep better" cannot select `system-power`.
- **String prefix checks cannot see through symlinks.** Both the read walk and the organize destination must resolve the REAL path and confirm it is inside the approved root. A link planted inside an approved folder was proven to move the owner's files out of it under a receipt that still claimed success (`tests/containment-and-evidence.test.mjs`). `walk()` skips any symlink whose target escapes the root, so listings never report files the owner did not approve.
- **`verified` means observed, not "the call returned".** `receipt()` takes an explicit flag and `dispatchReceipt()` records `verified: false` for adapters that hand a request to the OS and cannot see the outcome (launch/close app, open document, notification, power). `write-clipboard` reads the clipboard back so its `verified: true` is earned. The UI shows those as **Dispatched**, never as a failure, and the ledger banner says the chain checks out — not that every action was verified.
- **A published fingerprint must be enforced, or it is decoration.** `execute-organization` recomputes the approved plan hash and refuses a plan whose operations no longer match it.
- **A lockout that resets on the owner's next attempt is a DoS.** Pairing failures now impose a cooldown and are NOT cleared by generating a fresh code, so a guesser on the LAN cannot lock the owner out forever by burning the limit repeatedly.
- **Release artifacts are version-stamped, so the landing page can silently 404.** `tools/sync-web-version.mjs` rewrites the download links from `app/package.json`, and `tests/release-consistency.test.mjs` fails if the page, the MSIX manifest, or the winget manifest drift from the shipped version.

