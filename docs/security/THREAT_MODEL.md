# RAIMOSA Security and Privacy Threat Model

**Status:** MVP baseline; requires external review before public beta  
**Date:** July 20, 2026  
**Scope:** Desktop, unified OVIA AI, cloud control plane, companion approvals, updates, supported integrations

## Security objective

RAIMOSA must help a user observe and operate their computer without allowing a renderer, model, integration, workflow, remote caller, or stale approval to silently gain ambient operating-system control.

## Protected assets

- local files and file metadata;
- account, organization, and device identities;
- device private keys and provider credentials;
- capability grants and All Access sessions;
- frozen plans and approvals;
- mission steps and process state;
- diagnostic logs and findings;
- ledger events, receipts, and evidence artifacts;
- update signing chain and released binaries;
- user trust: the accuracy of displayed state, scope, risk, and verification.

## Trust boundaries

1. User ↔ desktop UI.
2. Webview renderer ↔ Tauri IPC.
3. Tauri IPC ↔ Rust policy/execution core.
4. Policy core ↔ operating-system adapters.
5. Policy core ↔ local SQLite and secret store.
6. Desktop ↔ RAIMOSA cloud API.
7. Cloud API ↔ Supabase, OpenAI, notifications, and integrations.
8. Companion browser ↔ cloud API.
9. Signed updater ↔ installed application.
10. Diagnostic evidence ↔ OVIA AI provider context.

All data crossing a boundary is authenticated where applicable, schema-validated, size-limited, redacted, and treated as untrusted.

## Actors

- legitimate local owner or organization member;
- unauthorized local user with an unlocked session;
- malicious website or compromised web content;
- compromised renderer dependency;
- prompt injection contained in a file, log, webpage, notification, or integration payload;
- malicious or compromised MCP/integration server;
- network attacker;
- attacker with a stolen cloud session or approval notification;
- compromised cloud service or support credential;
- malicious update or supply-chain dependency;
- buggy adapter, diagnostic check, or policy rule;
- model producing incorrect or adversarial structured output.

## Risk classes

| Class | Meaning | Examples | Default gate |
|---:|---|---|---|
| 0 | Read-only, bounded observation | metadata, process status, registered diagnostic check | disclosed capability and scope |
| 1 | Reversible local change | rename/move within approved locations | frozen plan plus scoped or All Access session |
| 2 | External or hard-to-reverse side effect | upload, send message, publish draft, install package | step-up approval immediately before action |
| 3 | Destructive, financial, credential, security, or system-critical | delete, payment, credential change, disable control, system config | denied in MVP; future dual/step-up approval and dedicated adapter |

All Access broadens eligible capability families for a short session. It does not lower the risk class or remove step-up requirements.

## Primary threats and controls

### Prompt injection turns content into action

**Threat:** A file, log, webpage, or integration tells OVIA AI to ignore policy, reveal secrets, request All Access, or execute a hidden action.

**Controls:**

- content is labelled as untrusted evidence, never instruction authority;
- provider output is a schema-validated proposal only;
- deterministic policy evaluates capability, target, principal, risk, and approval;
- no general shell or computer-use tool;
- plan UI shows the user-visible intent and actual resolved targets;
- external content cannot create, extend, or consume All Access;
- high-risk operations remain step-up gated.

**Residual risk:** Social engineering may persuade a user to approve a harmful but accurately displayed plan. Copy and policy must make affected targets and consequences clear.

### Renderer compromise reaches native capability

**Threat:** Cross-site scripting or a compromised frontend dependency invokes native commands.

**Controls:**

- no remote content in privileged windows;
- strict Content Security Policy and locked navigation;
- Tauri capabilities limited by window/webview;
- minimal typed IPC with unknown fields rejected;
- caller/window validation;
- no secrets or direct DB access in renderer;
- local policy re-evaluates every command;
- dependency lockfile, scanning, signed release build, and review.

**Residual risk:** A flawed or overbroad Rust command can still expose capability. Native command review and negative tests are release gates.

### Plan/approval time-of-check to time-of-use

**Threat:** A target changes after the user reviews it; an approval applies to different files or state.

**Controls:**

- immutable frozen plan and canonical hash;
- approval bound to plan, device, user, expiry, nonce, and policy version;
- resolve scope and identity again before execution;
- capture stable file identity when supported;
- reject symlink changes and target substitutions;
- invalidate approval on material change;
- single-use consumption.

**Residual risk:** Platform-specific file identity semantics vary. Adapters must fail closed when identity cannot be established for a risky step.

### Path traversal and symlink escape

**Threat:** Relative path, Unicode ambiguity, junction, mount, hard link, or symlink escapes an approved folder.

**Controls:**

- user selects a platform scope token rather than supplying a path string;
- canonicalize parent and target through platform APIs;
- use relative paths inside a scope;
- reject traversal and disallowed link traversal;
- open/operate using safe handles where available;
- re-check destination and source immediately before action;
- tests cover symlinks, junctions, case folding, Unicode normalization, and race cases.

### All Access becomes permanent ambient control

**Threat:** OVIA AI, a workflow, or an attacker starts, transfers, or silently renews broad access.

**Controls:**

- user-initiated local re-authentication;
- maximum 15-minute MVP duration;
- one user and one device binding;
- visible global authority bar and countdown;
- pause on desktop lock;
- no transferable token;
- no automatic extension;
- local end/narrow/emergency-stop control;
- excluded actions remain step-up or denied;
- every use is ledgered.

**Residual risk:** An authorized user may intentionally grant broad access while distracted. The confirmation shows capability families and active mission, and the session can default to the current mission where practical.

### Scan & Debug leaks secrets or becomes auto-fix

**Threat:** Diagnostic scanning reads excessive data, uploads secrets/logs, or modifies the product under the appearance of a scan.

**Controls:**

- Scan & Debug starts read-only;
- signed/versioned check manifest;
- each check declares data inputs, sensitivity, output, timeout, and redaction;
- secret-pattern and structural redaction before provider calls;
- raw artifacts remain local by default and expire;
- repair is a normal Draft mission with visible capability requirements;
- repair execution is an explicit mode/authority transition;
- original check is re-run to verify a fix.

**Residual risk:** Redaction can miss a novel secret format. Diagnostic provider sharing remains minimal and purpose-bound, with a local-only fallback.

### Malicious integration or MCP server

**Threat:** An integration returns adversarial content, requests unrelated tools, or exfiltrates context.

**Controls:**

- opt-in enrollment and explicit capability manifest;
- no ambient All Access;
- per-integration credentials and egress allowlist;
- bounded request/response schema, size, and timeout;
- content labelled untrusted;
- audit and revoke controls;
- sensitive action policy evaluated by RAIMOSA, not the integration.

### Remote approval replay or phishing

**Threat:** A stolen or stale notification approves a different plan, device, or mission.

**Controls:**

- authenticate the companion and step up based on risk;
- notification contains no approval bearer secret;
- decision bound to user, device, mission, plan hash, nonce, issue/expiry, and session;
- single-use server record;
- desktop fetches canonical record and revalidates local state;
- mismatch, stale, replayed, offline-stale, or emergency-stop decisions are rejected.

### Secret theft

**Threat:** Provider, Supabase, integration, or device credentials leak through renderer, SQLite, logs, crash reports, or repository.

**Controls:**

- server-managed provider keys only in Railway variables;
- no service-role key in any client;
- local secrets in OS keychain/Stronghold by alias;
- structured log redaction and allowlisted fields;
- no secret-bearing IPC responses;
- secret scanning in CI and release process;
- rotation and device revocation runbooks.

### Cloud compromise authorizes local execution

**Threat:** A compromised API or database issues commands or permissions.

**Controls:**

- cloud is a control and transport plane, not the local authority source;
- desktop accepts only recognized signed record types, never arbitrary commands;
- local policy, access session, plan hash, approval, target, and emergency-stop checks are mandatory;
- organization policy can narrow but remote policy cannot silently broaden local OS grants;
- no inbound remote-control listener.

### Update supply-chain compromise

**Threat:** A malicious update obtains RAIMOSA's trusted local privileges.

**Controls:**

- signed update artifacts and TLS transport;
- private signing material isolated from routine CI jobs;
- release provenance and two-person production promotion;
- pinned dependencies and reproducible-build improvements;
- staged channels, rollback plan, and update receipt;
- application refuses missing or invalid signatures.

### Ledger tampering and misleading verification

**Threat:** An attacker or bug changes history or reports success without evidence.

**Controls:**

- append-only application ledger API;
- sequence and hash chain;
- online checkpoint anchoring;
- receipts derived from adapter results and independent post-condition checks;
- `unknown` is a first-class state;
- export includes verification metadata and redaction state.

**Residual risk:** A fully compromised device core can forge future local events. Hash chaining detects editing but is not a trusted hardware attestation system.

### Emergency stop claims too much

**Threat:** UI says work stopped while a non-interruptible operation continues or already completed.

**Controls:**

- stop latch blocks all new step dispatch and approval consumption first;
- cancellation is requested for current cancellable operations;
- recovery inventory distinguishes stopped, completed, still running, and unknown;
- clearing stop requires re-authentication and recovery review;
- no claim that completed effects were reversed.

## Privacy controls

- Purpose and scope disclosure before observation, scanning, provider sharing, and external effects.
- Exact current observers and grants visible in Permissions.
- Raw local file content and screen capture are opt-in, never inferred from All Access.
- Diagnostic sharing preview shows categories and redaction, not just a generic consent dialog.
- User can export and delete eligible records.
- Organization policy and retention are visible to the affected member.
- Telemetry is minimal, documented, and separated from mission evidence.

## Security acceptance gates

Before MVP release:

- threat model reviewed against implemented commands;
- no arbitrary shell, SQL, binary spawn, URL fetch, or file-path command;
- Tauri capability manifest reviewed and minimized;
- CSP/navigation/window validation tested;
- session expiry, lock pause, narrow, end, and emergency stop tested offline;
- plan/approval mismatch, replay, stale target, and policy-version cases tested;
- path traversal, symlink/junction, Unicode, and race fixtures pass on each supported OS;
- provider and diagnostic content is fuzzed;
- RLS tests prove cross-organization isolation;
- service-role and provider keys absent from clients and artifacts;
- signed update verification tested with valid, invalid, missing, and rollback artifacts;
- independent penetration test scheduled before public beta.

## Incident priorities

1. Stop new execution through emergency policy and revoke affected devices/sessions.
2. Preserve and export ledger/checkpoint evidence.
3. Rotate cloud and integration credentials.
4. Identify affected versions, scopes, missions, and receipts.
5. Ship a signed mitigation or disable the affected adapter remotely only to narrow capability.
6. Notify users with verified impact and recovery steps; do not overstate certainty.
