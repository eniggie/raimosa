# RAIMOSA — Sentinel implementation matrix (Phase 0)

Produced 2026-08-23 from a full inspection of the shipped codebase (three audits
this cycle: adapter/state layer, API/web/docs, monetization; plus live exploit
testing). Status is what the code **does**, not what docs claim.

Legend: **EXISTING** works end to end · **PARTIAL** real but incomplete ·
**MISSING** nothing runs.

| Feature | Status | Current implementation | Problems / risks | Recommended improvement | Depends on | Tests required |
|---|---|---|---|---|---|---|
| Local-first daemon | **EXISTING** | `app/server/standalone.mjs` + `api-router.mjs`; loopback-only control API, LAN-only paired-remote routes, Origin gating | Config-as-code deprecation on Railway (fulfillment only) | Keep. Sentinel mounts on the same router. | — | existing loopback/origin tests |
| Tamper-evident audit log | **EXISTING** | `server/ledger.mjs`: SQLite, append-only via triggers, SHA-256 hash chain, `verify()`; exports carry integrity verdict | None found; proven DELETE/UPDATE rejected at DB | Sentinel writes every verification as a ledger receipt (no second log). | — | chain-intact, tamper-rejected (exist) |
| Honesty: claim ≠ verified | **PARTIAL** | `receipt()` carries explicit `verified`; dispatch-only adapters record `verified:false`; UI shows "Dispatched" | No first-class **task/claim** object; no KNOWN/VERIFIED/INFERRED/UNCERTAIN/UNKNOWN vocabulary | **Build Proof Engine**: tasks with acceptance criteria, agent claims, independent verification runs, final status enum | ledger, state-store | claim never flips to VERIFIED without a verification receipt |
| Emergency stop | **EXISTING** | Durable server latch; blocks dispatch, access, pairing; survives restart; reports what it revoked | — | Extend to "STOP ALL AGENTS": also mark every registered agent `paused` | sentinel registry | latch pauses agents |
| Permission engine | **PARTIAL** | Read-only free; writes need timed **All Access**; high-impact needs typed confirmation; Pro gate server-side | Not expressed as Levels 0–3; not user-customisable per action | Add policy layer mapping tools → L0–L3, owner-editable, enforced in `handle()` | state-store | each level enforced server-side |
| Approvals (single-use, durable) | **EXISTING** | `plan-organization` → hash-bound approval, claimed before first move, rollback | Only for file organisation | Generalise: any L2/L3 action creates an approval record Sentinel can route to mobile | state-store | approval hash enforced (exists) |
| Agent discovery | **PARTIAL** | `agent-runtime-monitor`: finds codex/claude/grok/gemini binaries + processes, read-only | No registry, no task binding, no health/cost/trust | **Build Agent Registry** on state-store; discovery feeds it; explicit register/attach | state-store | register, observe, pause, revoke |
| Multi-agent supervision | **MISSING** | — | — | Sentinel loop: observe registered agents, detect stall/loop/scope drift via file-change + repeated-failure heuristics; escalate to NEEDS_HUMAN | registry, proof engine | stall + repeated-failure detection |
| Task orchestration | **MISSING** | `planCommand` compiles a single intent to one capability (fail-closed) | No multi-step, no dependencies, no budgets | Task graph in state-store: steps, deps, retry, timeout, budget; execution only via existing gated `handle()` | registry, permissions | no step runs without its gate |
| Proof Engine verifiers | **MISSING** | `capture-screen` and `execute-organization` verify their own effect; nothing verifies an *agent's* work | — | Bounded verifier runner: allowlisted commands only (`npm test`, `npm run build`, `git status/diff --stat`, lint) inside an approved root; results → receipts | approvedRoot, ledger | allowlist enforced; escape refused |
| Prompt-injection defence | **PARTIAL** | Intent compiler fails closed; hidden-folder refusal; no external content ever becomes a command today | No provenance tags; nothing ingests email/web yet | Provenance model: USER / POLICY / EXTERNAL / AGENT; external text can never reach `handle()`; detector for credential-request phrasing | — | injected text never dispatches |
| Credential vault | **MISSING** | State store hashes tokens; nothing stores third-party credentials | Building a broker needs OS keychain (macOS `security`, DPAPI, Secret Service) | Phase 2: broker over OS keychain; agents get scoped, single-use grants; never in ledger | permissions L3 | secret never in ledger/logs |
| Email assistant | **MISSING** | — | Needs Gmail/Microsoft OAuth **app registrations** (owner accounts) | Phase 2 after vault; READ-ONLY first; email = EXTERNAL provenance | vault, provenance | injection via email rejected |
| OVIA AI conversation | **PARTIAL** | Ask/Operate/Scan modes; real `/plan` + `/scan`; honestly reports `modelProvider: null` | No voice; no external model | Provider abstraction first; realtime voice via adapter when an API key exists | providers | mode authority enforced server-side |
| AI provider abstraction | **MISSING** | `doctrine.modelProvider: null` | Product must not bind to one vendor | `server/providers.mjs`: registry + routing by task/cost/privacy; ships with **no** provider configured (honest) | — | unconfigured provider never claims output |
| Cost guard | **MISSING** | — | — | Per-agent/day/month counters in registry; warn + block at budget | registry | budget blocks dispatch |
| Memory (structured) | **MISSING** | Ledger is evidence, not memory | Must never hold passwords | Phase 2: user/project/verification memory tables, viewable/editable/exportable | state-store | redaction, export |
| Agent trust score | **MISSING** | — | Must not be sold as truth | Derived from verification history in ledger; labelled "historical reliability" | proof engine | score derives only from receipts |
| Rollback / restore points | **PARTIAL** | Organisation moves roll back on error | No git snapshot before agent work | Verifier records `git rev-parse HEAD` + `status --porcelain` before/after as restore evidence | verifiers | snapshot recorded |
| Sandboxing | **PARTIAL** | Approved-root containment (symlink-safe, proven); command allowlists per adapter | No per-agent boundaries | Registry holds per-agent root + allowlist; verifiers honour it | registry | escape refused |
| Mobile remote | **PARTIAL** | Paired phone over LAN; code + lockout + cooldown; token hashed; revoked with access | Web-based, LAN-only; no push; no biometrics; not a store app | Extend remote UI with Sentinel status + approve/deny; native app is a separate multi-week build | sentinel API | remote approve enforces L3 auth |
| Notifications | **PARTIAL** | Local desktop notification adapter (dispatch-only) | No push | Route Sentinel events to local notifications now; push needs a native app | — | event → notification receipt |
| Realtime events | **PARTIAL** | UI polls `/health`, `/receipts`, `/remote/status` | No SSE/WebSocket | Add SSE stream of ledger + sentinel events (loopback/LAN gated like everything else) | router | stream respects gates |
| Billing / licensing | **EXISTING** | Offline Ed25519 Pro key; server-enforced gates; Lemon Squeezy checkout live; fulfillment webhook deployed | Store in test mode; LS webhook not yet created (owner) | — | exist (86) |
| Privacy dashboard | **PARTIAL** | Permissions view lists capabilities; ledger redactors keep content out | No "what leaves the device" surface | Sentinel view section listing outbound calls (today: none; fulfillment is separate) | — | copy asserts only verified facts |
| Database | **EXISTING** | Two local SQLite stores (`ledger.db`, `state.db`); no Supabase in this product | — | Add Sentinel tables to `state.db` via the same migration style | — | schema round-trips |

## Build order (this pass)

1. **Sentinel core** — Agent Registry + Task/Proof records in `state.db`; every state change is a ledger receipt.
2. **Proof Engine** — allowlisted, root-contained verifier runner; results flip task status only on evidence.
3. **Permission Levels 0–3** — policy layer over the existing gates; STOP ALL AGENTS on the latch.
4. **Provider abstraction** — registry with routing rules and no provider configured.
5. **Sentinel API + desktop view** — real data only; SIMPLE/ADVANCED views.
6. Tests for every gate; docs; AGENTS.md rules.

Deferred with explicit reasons (not silently skipped): native mobile app, email
OAuth, OS-keychain credential broker, realtime voice — each needs owner-held
accounts/keys and is a multi-day build on top of the foundation above.
