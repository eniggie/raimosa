# RAIMOSA API and Command Contracts

**Status:** MVP contract baseline  
**Date:** July 20, 2026  
**Rule:** No free-form execution interface

## Contract standards

- TypeScript contracts are generated from or checked against versioned JSON Schema.
- Rust types serialize through the same fixtures and contract tests.
- Inputs reject unknown fields.
- Every mutating request has an idempotency key.
- Errors use stable codes, a safe user message, a correlation ID, and optional redacted details.
- No API accepts shell text, executable code, arbitrary binary names, raw SQL, unrestricted URLs, or an unbounded local path glob.
- Paths are selected through an approved scope token and normalized/revalidated locally.
- Model output is never passed directly to local IPC.

## Shared envelopes

```ts
type ApiResult<T> =
  | { ok: true; data: T; correlationId: string }
  | {
      ok: false;
      error: {
        code: ErrorCode;
        message: string;
        retryable: boolean;
        details?: Record<string, unknown>;
      };
      correlationId: string;
    };

type OviaMode = "ask" | "operate" | "scan_debug";
type AccessLevel = "advice_only" | "read_only_scan" | "scoped" | "all_access";
type RiskClass = 0 | 1 | 2 | 3;
```

## Desktop IPC surface

### Read and navigation

- `get_bootstrap_state()`
- `list_missions(filter, cursor)`
- `get_mission(mission_id)`
- `list_ledger_events(aggregate, cursor)`
- `list_capability_grants(filter)`
- `get_access_session_state()`
- `list_ovia_threads(cursor)`
- `get_ovia_thread(thread_id)`

### OVIA AI conversation

```ts
type SendOviaMessageInput = {
  threadId: string;
  mode: OviaMode;
  text: string;
  selectedContextRefs: string[];
  clientMessageId: string;
};

type SendOviaMessageOutput = {
  userMessageId: string;
  responseStreamId: string;
  effectiveAccessLevel: AccessLevel;
};
```

`selectedContextRefs` points to existing policy-filtered records. It is not a raw path or content upload.

Additional commands:

- `cancel_ovia_response(response_stream_id)`
- `set_ovia_mode(thread_id, mode)`
- `create_mission_from_ovia_proposal(proposal_id)`
- `link_thread_to_mission(thread_id, mission_id)`

Mode changes are ledgered and do not alter access.

### All Access

```ts
type RequestAllAccessInput = {
  deviceId: string;
  durationSeconds: 300 | 600 | 900;
  capabilityFamilies: CapabilityFamily[];
  acknowledgedExcludedActions: boolean;
  reauthenticationProofRef: string;
};

type AccessSessionView = {
  id: string;
  level: "all_access";
  startedAt: string;
  expiresAt: string;
  capabilityFamilies: CapabilityFamily[];
  excludedActions: ExcludedAction[];
  state: "active" | "paused" | "ended" | "expired";
};
```

Commands:

- `preview_all_access(input_without_proof)`
- `request_all_access(input)`
- `narrow_access_session(session_id, replacement_scope)`
- `end_access_session(session_id, reason)`
- `list_access_session_activity(session_id, cursor)`

The API never returns a bearer token that can be transferred to another process. The local core resolves the session by opaque ID and current state.

### Scan & Debug

```ts
type StartDiagnosticScanInput = {
  threadId: string;
  scanKind: "quick" | "full" | "subsystem" | "verify_fix";
  subsystem?: DiagnosticSubsystem;
  checkIds?: string[];
  disclosureVersion: string;
};

type DiagnosticFindingView = {
  id: string;
  checkId: string;
  status: "confirmed" | "suspected" | "unable_to_verify" | "resolved" | "accepted_risk";
  severity: "critical" | "high" | "medium" | "low" | "informational";
  confidence: number;
  summary: string;
  impact: string;
  evidenceRefs: ReceiptReference[];
  repairProposalId?: string;
};
```

Commands:

- `preview_diagnostic_scan(input)`
- `start_diagnostic_scan(input)`
- `cancel_diagnostic_scan(scan_id)`
- `list_diagnostic_findings(scan_id, cursor)`
- `get_diagnostic_finding(finding_id)`
- `propose_repair_mission(finding_id)`
- `verify_repair(finding_id, repair_mission_id)`

Scan commands invoke only registered checks from a signed/versioned manifest. No `run_diagnostic(command: string)` exists.

### Mission planning and execution

```ts
type PlanStep = {
  id: string;
  ordinal: number;
  kind: RegisteredStepKind;
  input: RegisteredStepInput;
  requiredCapability: CapabilityRequest;
  riskClass: RiskClass;
  reversibility: "reversible" | "compensatable" | "irreversible";
  preconditions: Condition[];
  postconditions: Condition[];
};

type FrozenPlan = {
  id: string;
  missionId: string;
  version: number;
  intent: string;
  scope: NormalizedScope[];
  steps: PlanStep[];
  canonicalHash: string;
  expiresAt?: string;
};
```

Commands:

- `create_mission_draft(intent, source_ref)`
- `save_plan_draft(plan_draft)`
- `freeze_plan(plan_id)`
- `request_plan_approval(plan_id)`
- `edit_plan_scope(plan_id, edits)`
- `reject_plan(plan_id, reason?)`
- `execute_frozen_plan(plan_id, approval_id, idempotency_key)`
- `pause_mission(mission_id)`
- `resume_mission(mission_id)`
- `cancel_mission(mission_id)`
- `activate_emergency_stop(confirmation_sequence)`
- `clear_emergency_stop(reauthentication_proof_ref, recovery_decision)`

`execute_frozen_plan` re-hashes the plan, evaluates local policy, resolves the access session, validates approval, rechecks targets, and then dispatches registered steps.

## Registered MVP operations

| Step kind | Required input | Risk | Notes |
|---|---|---:|---|
| `folder.observe` | scope token, event filters | 0 | Read-only metadata events |
| `file.metadata.read` | scope token, relative path | 0 | No content by default |
| `file.move.reversible` | source scope/ref, destination scope/ref, collision policy | 1 | Receipt stores before/after identity |
| `file.rename.reversible` | source scope/ref, validated new name | 1 | Same approved parent unless explicitly scoped |
| `process.status.observe` | approved process identity | 0 | No arbitrary arguments |
| `notification.local.send` | template ID, safe parameters | 1 | Registered templates |
| `diagnostic.check.run` | signed check ID/version, declared parameters | 0 | Read-only scan |

Delete, arbitrary write, shell, package installation, accessibility control, upload, external messaging, purchase, and publishing are not MVP registered operations.

## Cloud REST surface

Base: `/v1`. All authenticated requests carry a user or device identity, correlation ID, and supported contract version.

### Device

- `POST /devices/enrollment-challenges`
- `POST /devices`
- `POST /devices/{id}/heartbeats`
- `GET /devices/{id}/policy`
- `POST /devices/{id}/revoke`

### Sync

- `POST /sync/batches` — idempotent redacted event envelopes
- `GET /sync/changes?cursor=` — control-plane changes
- `POST /ledger/checkpoints` — sequence and event hash anchor

### Missions and approvals

- `POST /missions/summaries`
- `GET /missions/{id}/approval-request`
- `POST /approval-requests`
- `POST /approval-requests/{id}/decisions`
- `GET /devices/{id}/approval-decisions?cursor=`

### OVIA AI provider

- `POST /ovia/responses` — typed conversation or plan request
- `POST /ovia/responses/{id}/cancel`
- `POST /ovia/diagnostic-explanations` — redacted finding context

The provider endpoint accepts a purpose, schema version, OVIA AI mode, policy-filtered context blocks, and a desired structured output schema. It does not accept arbitrary local tool definitions.

## Approval decision contract

```ts
type ApprovalDecision = {
  approvalRequestId: string;
  decision: "approved" | "rejected";
  userId: string;
  deviceId: string;
  missionId: string;
  planVersionId: string;
  planHash: string;
  nonce: string;
  decidedAt: string;
  expiresAt: string;
  authenticationContext: {
    assuranceLevel: "aal1" | "aal2";
    sessionId: string;
  };
  signature: string;
};
```

The desktop rejects an otherwise valid cloud approval when local plan, target identity, policy, device, expiry, nonce, emergency stop, or access-session requirements do not match.

## Realtime channels

Production channels are private and organization/device scoped:

- `org:{org_id}:approvals:{user_id}`
- `device:{device_id}:decisions`
- `org:{org_id}:mission-summaries`

Realtime is a wake-up signal, not the source of truth. The receiver fetches the authenticated canonical record and validates it.

## Error codes

Minimum stable set:

- `AUTH_REQUIRED`
- `REAUTHENTICATION_REQUIRED`
- `CAPABILITY_DENIED`
- `SCOPE_MISMATCH`
- `ACCESS_SESSION_EXPIRED`
- `ACCESS_SESSION_ENDED`
- `STEP_UP_APPROVAL_REQUIRED`
- `PLAN_CHANGED`
- `PLAN_EXPIRED`
- `APPROVAL_INVALID`
- `APPROVAL_REPLAYED`
- `TARGET_CHANGED`
- `TARGET_OUTSIDE_SCOPE`
- `SYMLINK_ESCAPE_BLOCKED`
- `EMERGENCY_STOP_ACTIVE`
- `DIAGNOSTIC_CHECK_UNAVAILABLE`
- `DIAGNOSTIC_DISCLOSURE_REQUIRED`
- `PROVIDER_UNAVAILABLE`
- `SYNC_CONFLICT`
- `OPERATION_STATE_UNKNOWN`

Unknown-state errors never imply failure or success. The recovery view presents the last receipt and a safe verification action.

## Contract testing

- Rust and TypeScript round-trip the same canonical fixtures.
- Malformed, oversized, unknown-field, traversal, symlink, stale-plan, replay, expired-session, wrong-window, and emergency-stop cases are negative fixtures.
- Each registered operation has policy-denied, cancelled, crash-recovery, idempotent-retry, and receipt-verification tests.
- Provider responses are fuzzed and treated as untrusted schema input.
