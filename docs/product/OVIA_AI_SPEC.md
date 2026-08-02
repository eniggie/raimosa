# OVIA AI Product Specification

**Status:** Approved product addition  
**Date:** July 20, 2026  
**Applies to:** RAIMOSA desktop MVP and companion approval surface

## Product decision

OVIA AI is one intelligence layer and one persistent assistant inside RAIMOSA. The same OVIA AI conversation handles planning, coordination, operations, product scanning, issue discovery, debugging, repair, verification, and mission reporting.

OVIA AI uses the same plan schema, permission engine, mission ledger, receipts, and provider adapter across all modes. It never pretends that a model response is proof.

## One OVIA AI, three modes

- **Ask** — answers, explains, and retrieves permitted context without creating execution authority.
- **Operate** — creates plans, requests scoped access, executes approved work, and verifies results.
- **Scan & Debug** — runs versioned diagnostic checks, explains findings, proposes fixes, executes approved repairs, and re-runs verification in the same thread.

Changing modes never silently changes access. Mode and authority appear together in the composer.

## Core jobs

- Answer questions about RAIMOSA, connected capabilities, active work, and prior receipts.
- Turn an outcome into a Draft mission.
- Gather only the context permitted for that mission.
- Produce a structured, versioned plan.
- Request the minimum additional authority needed.
- Explain approvals in plain language.
- Narrate meaningful execution state without replacing the mission ledger.
- Summarize verified results, warnings, failures, and safe recovery options.
- Run deterministic Quick, Full, or subsystem diagnostic scans.
- Convert a confirmed finding into a repair mission without changing assistants.
- Re-run the original check after repair and record verification evidence.

### Chat box anatomy

- Identity label: `OVIA AI`.
- Thread title and linked mission, when one exists.
- Context chips for device, selected mission, selected files, and approved sources.
- Conversation stream with clear `Answer`, `Proposal`, `Approval needed`, `Progress`, and `Verified result` message types.
- Composer mode and authority: `Ask · Advice only`, `Scan & Debug · Read-only`, `Operate · Scoped access`, or `Operate · All Access · 08:42`.
- Attachment button limited to supported, explicitly selected sources.
- `Stop` control while a response or mission is active.
- `Open in Mission Ledger` for any actionable proposal.

### All Access session

All Access gives OVIA AI broad access to *approved capability families on one enrolled device for a short period*. It does not bypass the policy engine.

Required properties:

- User initiated and locally enforced.
- Re-authenticated before issue.
- Bound to one user, device, session ID, start time, expiry, and policy version.
- Non-transferable to workflows, integrations, other devices, or background tasks created after expiry.
- Revocable locally while offline.
- Inactive when the desktop is locked, the device identity is invalid, emergency stop is active, or policy state cannot be verified.
- Step-up approval remains required for destructive operations, credential changes, money movement, external publication, security control changes, and policy-defined high-risk actions.
- Every capability use records the session reference and a redacted reason in the ledger.

User-visible controls:

- Request All Access.
- Choose duration.
- Review included and excluded capability families.
- Narrow to Scoped access.
- End now.
- Open session activity.

## Scan & Debug mode

- Run supported, versioned diagnostic checks.
- Inspect RAIMOSA configuration, local database health, migration state, permissions, providers, integrations, update state, background services, observers, recent errors, and ledger consistency.
- Redact secrets and sensitive content before presenting evidence or sending diagnostic context to a cloud model.
- Produce deduplicated findings with severity, confidence, evidence, impact, and reproduction.
- Propose the smallest repair mission.
- Re-run the original checks and verify the outcome after a repair.

### Scan modes

| Mode | Default authority | Scope | Intended duration |
|---|---|---|---|
| Quick scan | Read-only diagnostics | Health, versions, permissions, recent errors, connectivity | Under 60 seconds |
| Full scan | Read-only diagnostics | All supported local subsystems and deeper consistency checks | Several minutes |
| Subsystem scan | Read-only diagnostics | One selected adapter, provider, device, or mission | Varies |
| Verify fix | Read-only diagnostics | Original failing check and declared post-conditions | Under 2 minutes |

### Finding contract

Every finding contains:

- Stable check ID and check version.
- Status: Confirmed, Suspected, Unable to verify, Resolved, or Accepted risk.
- Severity: Critical, High, Medium, Low, or Informational.
- Confidence with a plain-language reason.
- Affected subsystem and versions.
- Redacted evidence references.
- User impact.
- Reproduction or verification procedure.
- Proposed repair, estimated risk, reversibility, and required capability grant.

In Scan & Debug, OVIA AI must not:

- Read arbitrary user files merely because they are reachable by the operating system.
- upload logs, paths, filenames, tokens, prompts, or file contents without the applicable diagnostic disclosure and policy.
- modify configuration, install packages, execute shell text, or restart services in scan mode.
- label a hypothesis as confirmed.
- hide a transition from read-only scanning into repair execution.

## Shared intelligence contract

All OVIA AI modes use a provider-neutral orchestration interface. OpenAI can generate explanations and structured proposals, but deterministic RAIMOSA code performs policy evaluation, path resolution, target re-validation, execution, receipt capture, and result verification.

```text
User message or scan request
  -> context collector (policy-filtered)
  -> OVIA AI provider adapter
  -> validated structured answer / plan / finding draft
  -> deterministic policy and evidence checks
  -> Mission Ledger or Diagnostic Ledger
  -> explicit approval when action is required
```

No provider receives a general operating-system tool. No free-form model output is executed.

## MVP acceptance criteria

- OVIA AI chat can answer locally mocked product questions and create a typed Draft mission.
- The composer always shows current authority.
- All Access can be requested, visibly activated with a countdown, narrowed, ended, and automatically expired in local state.
- High-risk action examples remain approval-blocked during All Access.
- OVIA AI can switch visibly into Scan & Debug, run a deterministic local Quick scan, and show evidence-backed findings.
- OVIA AI can convert one finding into a Draft repair mission in the same thread.
- Scan & Debug starts read-only; repair execution reflects the current visible access session and applicable step-up approvals.
- All transitions create readable local ledger events.
- The prototype never claims a real scan, fix, approval, or action succeeded when it is using sample data.
