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
- RAIMOSA AI must never claim an action, agent dispatch, or repair ran without a verified adapter receipt. Every detected issue and failed check must be surfaced; findings cannot be silently skipped.
- Local AI agent discovery is read-only process and executable metadata. Commanding Codex, Claude, Grok, Gemini, or another agent requires a named, authenticated, revocable provider adapter and must never inherit credentials or authority.
