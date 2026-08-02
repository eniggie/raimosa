# RAIMOSA Information Architecture

**Status:** Proposed for MVP validation  
**Primary model:** Missions, not chats

## Global structure

| Destination | Purpose | Primary objects |
|---|---|---|
| Command Center | Start a goal and see decisions needing attention | Mission drafts, active missions, approval queue |
| OVIA AI | Chat, plan, operate, scan RAIMOSA, diagnose issues, and verify repairs | Threads, plans, access sessions, scans, findings |
| Missions | Inspect current and historical work | Missions, plans, steps, receipts |
| Workflows | Configure reusable, bounded work | Templates, parameters, triggers, approval rules |
| Ledger | Review immutable operational history | Events, actions, actors, evidence, exports |
| Permissions | See, grant, narrow, pause, or revoke authority | Capabilities, scopes, grants, observers |
| Devices | Manage enrolled desktops and their security state | Devices, sessions, versions, health |
| Settings | Personal, notification, provider, privacy, and appearance preferences | Account and app configuration |

`Devices` can live under Settings for a single-device MVP but must remain a distinct domain object.

## Command Center hierarchy

1. OVIA AI chat box and global command field.
2. Active authority strip, including an unmistakable All Access session indicator.
3. Decisions requiring attention.
4. Active missions with last meaningful event.
5. Recently verified missions.
6. System trust strip: active observers, paused authority, sync status, update/security state.

The screen does not show vanity statistics, generic AI suggestions, or empty charts.

## OVIA AI

RAIMOSA contains one persistent OVIA AI. The same conversation can move from understanding a goal to planning, operating, scanning RAIMOSA, debugging, fixing, and verifying without switching agents or losing context.

- Lives in a persistent, collapsible chat box on the Command Center.
- Translates conversation into mission drafts and versioned plans.
- Answers product and operational questions without creating a mission when no action is needed.
- Supports `Ask`, `Operate`, and `Scan & Debug` modes inside the same thread.
- In `Scan & Debug`, runs versioned diagnostic checks against application health, configuration, integrations, permissions, logs, database migrations, update state, and supported runtimes.
- Diagnostic scans begin read-only. OVIA AI can propose a repair mission and, when the user explicitly approves the required action, execute and verify the repair without handing the conversation to another agent.
- Can request an **All Access session**, but cannot grant or extend one itself.
- Shows its current authority in the composer at all times: `Advice only`, `Read-only scan`, `Scoped access`, or `All Access session`.
- Marks each diagnostic finding as Confirmed, Suspected, Unable to verify, Resolved, or Accepted risk.
- Routes every executable proposal through the same plan, policy, approval, receipt, and ledger model as the rest of RAIMOSA.

## All Access session

`All Access` is a user-initiated, temporary operating session—not a permanent superuser mode.

- Entry requires re-authentication, a duration, device selection, a capability summary, and an explicit confirmation.
- The maximum duration is policy-controlled; the MVP default is 15 minutes.
- An always-visible purple-and-gold authority bar shows expiry, current mission, active capability families, `Narrow access`, and `End now`.
- High-risk and destructive actions still require step-up approval even during All Access.
- Emergency stop remains available and immediately blocks consumption of unused authority.
- Expiry, pause, revocation, policy denial, and every use of the session are ledger events.
- No model prompt, workflow, plugin, MCP server, scan, or remote message can enable or extend All Access.

## Mission detail hierarchy

1. Mission title and state.
2. Contract strip: intent, scope, authority, approval rule.
3. Current decision or active step.
4. Mission ledger.
5. Evidence drawer.
6. Related workflow and source trigger.
7. Technical details, diagnostics, and export.

## Mission state model

| State | Meaning | Allowed next states |
|---|---|---|
| Draft | Intent captured; no plan is authoritative | Planning, Cancelled |
| Planning | RAIMOSA is gathering permitted context and proposing steps | Awaiting approval, Needs attention, Cancelled |
| Awaiting approval | Exact plan is frozen for review | Scheduled, Running, Draft, Rejected, Cancelled |
| Scheduled | Approved plan waits for time/condition | Running, Paused, Cancelled, Needs attention |
| Running | One or more allowed steps are active | Paused, Verifying, Needs attention, Failed, Cancelled |
| Paused | New steps are stopped | Running, Cancelled, Needs attention |
| Verifying | Post-conditions and receipts are being checked | Completed, Completed with warning, Failed, Needs attention |
| Needs attention | User input, permission, conflict resolution, or external recovery is required | Planning, Awaiting approval, Running, Failed, Cancelled |
| Completed | Required post-conditions verified | Archived |
| Completed with warning | Goal completed but noncritical evidence/side effect needs review | Archived, Needs attention |
| Failed | Goal did not meet required post-conditions | Planning, Cancelled, Archived |
| Rejected | User rejected the proposed plan | Draft, Archived |
| Cancelled | User or policy ended the mission | Archived |

## Core object relationships

```text
User / Organization
  ├─ Device
  │   ├─ Observer
  │   └─ Capability Grant
  ├─ OVIA AI Thread
  │   ├─ OVIA AI Mode (Ask | Operate | Scan & Debug)
  │   ├─ Access Session
  │   └─ Diagnostic Scan
  ├─ Mission
  │   ├─ Observation Event
  │   ├─ Plan Version
  │   │   ├─ Approval
  │   │   └─ Step
  │   │       └─ Receipt
  │   └─ Ledger Event
  └─ Workflow Template
      ├─ Trigger
      ├─ Parameter Schema
      └─ Approval Policy
```

## Naming rules

- Use **Mission** for one goal with start, state, and completion.
- Use **Workflow** for a reusable mission template.
- Use **Observer** for a source RAIMOSA watches within an approved scope.
- Use **Permission** in user-facing navigation and **Capability Grant** in technical architecture.
- Use **Ledger** for the chronological record and **Receipt** for evidence from one step.
- Use **Plan version** when a material change invalidates prior approval.
- Use **OVIA AI** for the single assistant across conversation, operations, scanning, debugging, repair, and verification.
- Use **Scan & Debug** for OVIA AI's diagnostic mode, not as a separate agent or destination.
- Use **All Access session**, never `unrestricted mode`, `god mode`, or `always allow`.
- Do not call every automated action an “agent.” Agent/provider details belong in technical evidence.

## Navigation behavior

- Expanded sidebar shows labels; compact mode shows icons with accessible names and tooltips.
- `Command Center` is always first.
- Active mission state persists when switching destinations.
- Back navigation returns to the prior list/filter and scroll position.
- Cmd/Ctrl+K focuses the global command field.
- Cmd/Ctrl+Shift+P opens permissions; Escape closes transient layers without cancelling work.
- Emergency stop has a separate shortcut that requires a confirming key sequence to prevent accidental activation.

## Responsive behavior

### Wide desktop: 1366px and above

- Expanded navigation or compact rail by preference.
- Mission ledger plus evidence rail.
- Approval dock remains visible without covering ledger rows.

### Compact desktop: 1024–1365px

- Compact navigation rail.
- Evidence becomes a collapsible drawer.
- Contract strip becomes two rows.
- Approval dock uses the full content width.

### Narrow companion/mobile

- Approval queue is the home surface.
- Plan summary, scope, authority, risk, expiry, and affected targets appear before approval controls.
- Technical evidence is a secondary sheet.
- No desktop file browsing or general remote-control surface.

## Search and filtering

Global search can find missions, workflows, files already present in ledger evidence, receipts, and settings. Search must respect permissions and redaction. Default mission filters are Attention, Active, Completed, Failed, and All. No search result grants access to a file or scope the user cannot otherwise access.

## Empty states

- Command Center: explain one safe first mission and offer an approved demo folder.
- Missions: describe what a mission is and link to the command field.
- Workflows: show how a completed mission can become a reusable workflow after review.
- Ledger: explain that events appear after the first observation or action; do not generate sample activity in a real account.
- Permissions: show `No access granted` as a secure, valid state.
