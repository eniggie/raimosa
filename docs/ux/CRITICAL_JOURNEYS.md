# RAIMOSA Critical Journeys

These journeys define the design and security behavior that must be validated before system implementation expands.

## Journey 1: First safe value

**Goal:** Let a new user experience useful observation without granting broad control.

1. RAIMOSA explains that observation and action permissions are separate.
2. User selects a folder or chooses a RAIMOSA demo folder.
3. RAIMOSA explains the exact operating-system permission required.
4. User grants read/observe access to that one folder.
5. RAIMOSA watches for a file event and shows it in a mission ledger.
6. RAIMOSA proposes a reversible follow-up but cannot run it yet.
7. User can grant narrow write authority, keep suggestion-only mode, or end onboarding.

**Acceptance:** The user can identify what RAIMOSA can see and verify it cannot act outside the scope.

## Journey 2: Command to verified result

**Goal:** Complete an explicit file-organization mission.

1. User enters: `Organize the approved launch assets and move final files into Final.`
2. RAIMOSA creates a Draft mission; nothing executes.
3. RAIMOSA requests or reuses read access to the chosen folder.
4. It observes file names, types, size, and duplicates within scope.
5. It proposes a versioned plan with before/after examples and post-conditions.
6. The approval dock shows affected files, authority, risk, reversibility, and expiry.
7. User approves, edits scope, or rejects.
8. On approval, each step re-validates its target before executing.
9. RAIMOSA verifies final paths, counts, and integrity.
10. The mission ends as Verified, Completed with warning, or Failed—never simply “Done.”

**Acceptance:** Approval is invalidated if targets or plan materially change.

## Journey 3: Observe a long-running job and follow up

**Goal:** Monitor an export without continuous screen recording.

1. User selects a process/application and destination folder.
2. RAIMOSA shows exactly which process and folder it will observe.
3. User defines completion as process exit plus expected file presence/stability.
4. RAIMOSA starts a mission and reports only meaningful milestones.
5. On completion, RAIMOSA verifies the file against required conditions.
6. It requests approval for any upload, move, or notification not already covered by a bounded workflow rule.
7. It records the export evidence and follow-up receipts.

**Acceptance:** The UI states `Screen recording is off` when no screen capture permission is used.

## Journey 4: Edit or reject a plan

**Goal:** Preserve user control without forcing a complete restart.

1. User opens exact plan details.
2. User removes targets, changes destination, or narrows authority.
3. RAIMOSA generates a new plan version and highlights material differences.
4. Prior approval is marked invalid.
5. The new approval dock shows the changed version.
6. Rejection records the reason optionally and returns the mission to Draft or Archived.

**Acceptance:** A changed plan cannot reuse an approval token or mobile approval from an earlier version.

## Journey 5: Emergency stop and recovery

**Goal:** Stop future action and explain residual state honestly.

1. User activates Emergency stop.
2. RAIMOSA immediately blocks new steps and approval consumption.
3. It requests cancellation of cancellable active operations.
4. It waits for non-interruptible operations to report their final state.
5. It opens a recovery view showing stopped, completed, still-running, and unknown steps.
6. It offers safe recovery operations with separate approval.

**Acceptance:** The product never claims emergency stop automatically reverses completed actions.

## Journey 6: Permission review and revocation

**Goal:** Let a user understand and remove access at any time.

1. Permissions lists observers and action grants by device and scope.
2. Each grant shows purpose, source mission/workflow, last used, expiry, and dependent active work.
3. User pauses or revokes a grant.
4. RAIMOSA shows which missions/workflows will pause or fail.
5. User confirms revocation.
6. A ledger event records it; affected work enters Paused or Needs attention.

**Acceptance:** Revocation takes effect locally even when cloud sync is unavailable.

## Journey 7: Mobile approval

**Goal:** Approve a narrowly bound plan without exposing general remote control.

1. Desktop requests approval and sends a redacted notification.
2. User authenticates on the companion surface.
3. Mobile shows device, mission, plan version, affected targets, scope, authority, risk, expiry, and evidence.
4. Sensitive paths can remain redacted until re-authentication.
5. User approves, edits on desktop, or rejects.
6. Signed approval is bound to user, device, mission, plan hash, expiry, and nonce.
7. Desktop re-validates local state before using the approval.

**Acceptance:** Expired, replayed, offline-stale, or mismatched approvals are rejected with a clear reason.

## Journey 8: Convert a successful mission into a workflow

**Goal:** Earn repeat automation from a proven one-time action.

1. A verified mission offers `Create workflow from this mission`.
2. RAIMOSA extracts parameters rather than hard-coding paths or filenames.
3. User chooses trigger, allowed scopes, action limits, approval rule, and notification policy.
4. RAIMOSA shows a simulation using prior evidence.
5. User saves the workflow disabled by default.
6. User runs a manual test before enabling a trigger.

**Acceptance:** Learned behavior is never enabled silently.

## Journey 9: Work with OVIA AI

**Goal:** Turn a natural-language conversation into a governed, inspectable mission.

1. User opens the persistent OVIA AI chat box and sees `Ask · Advice only` in the composer.
2. User describes the desired outcome.
3. OVIA AI distinguishes an answer from an action and asks only for missing, safety-critical context.
4. If action is needed, OVIA AI creates a Draft mission and presents the exact observation and action capabilities it needs.
5. OVIA AI produces a versioned plan with assumptions, affected targets, reversibility, and post-conditions.
6. User approves, edits, narrows, or rejects the plan in the Mission Ledger.
7. OVIA AI reports meaningful progress in the thread while the ledger remains the authoritative record.
8. OVIA AI ends with verification evidence or a precise explanation of what it could not verify.

**Acceptance:** A chat message never becomes executable authority by itself.

## Journey 10: Start and end an OVIA AI All Access session

**Goal:** Let an owner temporarily give OVIA AI broad operating capability without hiding risk.

1. User selects `Request All Access` from OVIA AI.
2. RAIMOSA explains capability families, excluded actions, device, duration, active mission, and residual risk.
3. User re-authenticates and chooses a duration.
4. The local policy engine issues a single-device access session with an expiry and non-exportable session reference.
5. An always-visible authority bar and countdown appear across the product.
6. OVIA AI uses only capabilities needed by the current approved plan; each use is recorded.
7. Destructive or externally consequential steps still pause for step-up approval.
8. User narrows or ends the session, or RAIMOSA expires it automatically.

**Acceptance:** Models, integrations, workflows, diagnostic scans, and remote callers cannot start or extend the session.

## Journey 11: Scan and debug RAIMOSA with OVIA AI

**Goal:** Find product issues without giving a diagnostic agent silent repair authority.

1. User opens OVIA AI, selects `Scan & Debug`, and chooses Quick scan, Full scan, or a named subsystem.
2. OVIA AI shows the exact read-only checks, estimated duration, local data involved, and redaction rules.
3. User starts the scan; findings stream into a dedicated diagnostic ledger.
4. Each finding includes severity, confidence, evidence, impact, and a reproducible check.
5. OVIA AI groups duplicates and distinguishes confirmed defects from hypotheses.
6. User selects a finding and asks for a fix proposal.
7. OVIA AI creates a normal Draft mission with the minimum repair capability required in the same thread.
8. After approval and execution by the mission engine, OVIA AI re-runs the original check and records whether the fix is verified.

**Acceptance:** Scan mode starts read-only; changing into repair execution is explicit and governed by the current visible OVIA AI access session.
