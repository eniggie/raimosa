# RAIMOSA Product Roadmap

**Status:** Execution baseline  
**Date:** July 20, 2026  
**Strategy:** Earn authority through verified, reversible value

## Release philosophy

RAIMOSA will not begin as a universal autonomous computer operator. The MVP proves one complete governed loop:

```text
Ask or Scan -> Understand -> Plan -> Approve -> Execute -> Verify -> Report
```

Each phase expands supported capability only after the existing boundary has tests, receipts, and recovery behavior.

## Phase 0 — Foundation and product truth

**Status:** Complete for implementation start

Delivered:

- RAIMOSA brand system and application asset kit;
- Mission Ledger design direction and visual system;
- competitive analysis and market wedge;
- information architecture and critical journeys;
- one unified OVIA AI with Ask, Operate, and Scan & Debug;
- All Access interaction and safety contract;
- Tauri desktop-shell decision;
- local-first system architecture;
- data, API, security, and privacy baselines.

Exit gate:

- no unresolved product ambiguity that changes the MVP trust boundary.

## Phase 1 — Interactive desktop vertical slice

**Goal:** Make the approved Mission Ledger and unified OVIA AI experience real with honest local sample state.

Build:

- Tauri 2 + React + Vite + TypeScript shell;
- design tokens and approved R brand assets;
- Command Center, Missions, Ledger, Permissions, and Settings navigation;
- one persistent OVIA AI panel with functional Ask, Operate, and Scan & Debug switching;
- visible authority badge and local All Access countdown simulation;
- end/narrow access and emergency-stop interactions;
- typed Draft mission and plan review state;
- deterministic sample Quick scan marked as sample data;
- responsive desktop layouts and reduced-motion mode.

Exit gate:

- navigation, modes, approvals, access session, scan finding, and emergency stop work in the prototype;
- no control claims a real OS action or real AI response when mocked;
- reference/prototype visual comparison passes at target viewport;
- keyboard and accessibility smoke checks pass.

## Phase 2 — Local trusted core

**Goal:** Deliver the first real Observe → Plan → Approve → Execute → Verify loop.

Build:

- Rust mission, policy, access-session, approval, and ledger modules;
- SQLite migrations, append-only event API, projections, outbox, and crash recovery;
- operating-system secret-store integration;
- folder scope selection and read-only file metadata observation;
- reversible rename/move adapter within selected scopes;
- target identity and symlink/traversal defenses;
- independent post-condition verification and receipts;
- real emergency-stop latch;
- versioned Quick scan for RAIMOSA's own local database, policy, version, permission, and service health;
- OVIA AI repair proposal into a Draft mission; no unapproved auto-fix.

Exit gate:

- complete file-organization mission succeeds against fixtures on macOS and one additional target OS;
- approval invalidation, access expiry, offline revocation, crash recovery, idempotency, and unknown-state tests pass;
- Quick scan findings are reproducible and evidence-backed;
- security acceptance gates for implemented commands pass.

## Phase 3 — OVIA AI intelligence and cloud control plane

**Goal:** Add real provider-backed planning and mobile approval without making the cloud a local execution authority.

Build:

- Railway Node.js TypeScript API and worker;
- Supabase Auth, Postgres, RLS, private Realtime, and artifact metadata;
- device enrollment and signed identity;
- redacted outbox synchronization and ledger checkpoints;
- OpenAI Responses/Agents provider adapter for typed answers and plan drafts;
- provider-independent schema validation and policy evaluation;
- Next.js companion/PWA approval queue;
- expiring signed approval decisions and push notifications;
- local revalidation and single-use consumption.

Exit gate:

- cross-organization RLS tests pass;
- provider outage and cloud outage leave local work safe and explainable;
- no server or database record alone can trigger a local step;
- replayed, mismatched, expired, and stale mobile approvals are rejected;
- keys and sensitive local evidence are absent from clients and normal logs.

## Phase 4 — Reliable workflows

**Goal:** Convert verified missions into bounded, reusable workflows.

Build:

- workflow templates, typed parameters, triggers, limits, and approval policies;
- simulation against prior receipts;
- disabled-by-default save behavior and manual test;
- folder/process observers and meaningful milestone notifications;
- pause/revoke dependency impact view;
- scheduling, concurrency, retry, compensation, and recovery policy;
- workflow performance and failure receipts.

Exit gate:

- no learned behavior enables itself;
- each workflow lists scope, actions, limits, approval rule, owner, and last verified run;
- trigger storms and retries cannot replay side effects;
- revoke and emergency stop work locally during cloud outage.

## Phase 5 — Supported integrations and enterprise controls

**Goal:** Broaden useful reach through named, least-privilege adapters.

Candidates:

- approved application APIs;
- opt-in MCP connections;
- Apple Accessibility, Windows UI Automation, and Linux AT-SPI adapters;
- enterprise SSO, SCIM, roles, policy bundles, retention, and exports;
- device posture and managed update channels;
- two-person approval for defined risk classes.

Each integration needs its own manifest, threat review, scope model, typed operations, receipts, test matrix, and revoke path.

Exit gate:

- no ambient credentials or All Access propagation;
- platform-specific adapter security tests pass;
- enterprise audit exports remain accurate, redacted, and verifiable.

## Explicitly deferred

- arbitrary shell or terminal execution;
- unrestricted coordinate control;
- hidden/continuous screen recording;
- autonomous purchasing, payments, credential changes, or publication;
- self-modifying policy or silent self-improvement;
- general remote desktop;
- permanent All Access;
- automatic diagnostic repair without a mission and policy evaluation.

## MVP scope

The MVP is Phases 1–3 with one real local file-operation journey and one real RAIMOSA Quick scan journey.

### Primary MVP story

> As an owner, I can ask OVIA AI to organize files inside an approved folder, review the exact reversible plan and authority, approve it, watch the Mission Ledger, and verify the resulting paths and receipts.

### Diagnostic MVP story

> As an owner, I can switch the same OVIA AI conversation to Scan & Debug, run a read-only RAIMOSA health scan, understand one confirmed issue, promote its fix into a Draft mission, approve the repair if needed, and see OVIA AI re-run the check.

### All Access MVP story

> As an owner, I can start one short, visible All Access session for OVIA AI, see its countdown and activity, narrow or end it immediately, and still receive step-up prompts for excluded high-risk actions.

## MVP success measures

- plan approval comprehension: users correctly identify target, action, reversibility, and expiry;
- verified completion rate for supported file missions;
- false-success rate: target zero;
- approval invalidation correctness after material change;
- median time to first safe value;
- scan finding reproducibility and repair verification rate;
- percentage of access sessions ended or expired exactly as displayed;
- emergency-stop dispatch-block latency;
- permission-revocation correctness while offline;
- crash recovery with no duplicate side effects;
- user trust rating after reviewing ledger receipts.

## Build order for the first vertical slice

1. Workspace and Tauri shell.
2. Tokens, typography, icon library, and brand assets.
3. Static Mission Ledger layout at the approved viewport.
4. Functional navigation and responsive shell.
5. Unified OVIA AI modes, thread states, and composer authority.
6. All Access request/countdown/end interactions using explicit sample state.
7. Sample diagnostic scan and finding-to-repair proposal.
8. Mission plan approval/edit/reject and emergency stop.
9. Accessibility, reduced motion, keyboard behavior, and error states.
10. Reference/prototype screenshot comparison and visual corrections.
11. Replace sample state incrementally with Rust commands and SQLite.

## Definition of done for any capability

A capability is not complete until it has:

- named owner and user purpose;
- typed input/output contract;
- explicit scope and risk class;
- policy and approval behavior;
- cancellation, timeout, and crash recovery;
- receipt and independent verification;
- ledger and redaction behavior;
- permission review and revoke path;
- negative and cross-platform tests where applicable;
- accurate UI states for denied, unknown, partial, and failed outcomes;
- documented residual risk.
