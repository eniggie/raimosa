# RAIMOSA UX Foundation

**Research horizon:** MVP through first commercial release  
**Primary surface:** Desktop command center  
**Companion surface:** Authenticated mobile/web approval and monitoring

## Primary audience

RAIMOSA first serves professionals who manage work that spans files, applications, long-running jobs, and external tools but who do not want to author scripts or complex RPA flows. Initial discovery should recruit creators, operators, founders, analysts, and project leads who frequently wait for exports, organize deliverables, monitor downloads/uploads, or repeat multi-step handoffs.

## Core jobs to be done

### Monitor and finish long-running work

> When an export, render, download, upload, or local process takes time, I want RAIMOSA to watch the approved signal, tell me when the meaningful state changes, and perform the exact follow-up I approved.

### Organize deliverables safely

> When files accumulate across approved folders, I want a clear proposed plan with before/after names and destinations so I can approve reversible organization without fearing data loss.

### Coordinate supported tools

> When a job crosses applications or services, I want one mission record that shows what each supported integration did and where the result went.

### Stay in control away from the computer

> When I step away, I want to see progress and approve a bound, time-limited plan from my phone without granting general remote control.

### Understand and revoke access

> At any moment, I want to know what RAIMOSA can currently see and do, why it has that access, and how to pause or revoke it.

## Mental model

RAIMOSA is a **trusted operator with a written work order**, not an omniscient assistant.

| Product concept | User meaning |
|---|---|
| Mission | One goal with durable state and a completion definition |
| Observer | A user-approved source of state, such as a folder or process |
| Plan | Versioned proposed steps for one mission |
| Capability | A narrowly named thing RAIMOSA may observe or do |
| Grant | Permission for a capability within a specific scope and time |
| Approval | Consent bound to an exact plan version |
| Step | One executable operation with pre- and post-conditions |
| Receipt | Evidence that an operation completed or failed |
| Workflow | A reusable mission template with explicit parameters and approval rules |
| Device | An enrolled computer that can observe and execute within local policy |

## Trust model shown in the interface

Every mission answers seven questions without requiring technical expertise:

1. What did I ask for?
2. What can RAIMOSA see?
3. What does it propose?
4. What new authority does it need?
5. What is happening now?
6. What changed?
7. What proves the outcome?

## Experience principles

### Make permission local and contextual

Ask for folder, application, notification, or accessibility permission at the moment its value is clear. Do not begin onboarding with a wall of system dialogs. Explain the exact signal needed and offer a safe demo folder when possible.

### Separate observation from action

“Watching a folder” does not imply permission to move its contents. The product must show read/observe access and write/action access separately.

### Earn automation gradually

The progression is:

1. Suggest only.
2. Approve every plan.
3. Approve a reusable plan within fixed parameters.
4. Allow low-risk automatic runs with notifications.

Higher autonomy is never inferred from repetition alone.

### Preserve orientation

The user should return after minutes or hours and understand the mission in under ten seconds: current state, last meaningful event, next decision, and expected completion.

### Design failure as a first-class path

If a step fails, show what ran, what did not run, what may have changed, what was verified, and the safest recovery action. Never collapse a partial failure into a generic red banner.

## Primary success measures

No fake metrics appear in the product. These are measurement definitions for real instrumentation:

- Mission plan comprehension: percent of first-time users who correctly predict what an approved plan will change.
- Safe completion rate: missions that reach verified completion without manual repair.
- Approval correction rate: approvals edited because scope or authority was wrong.
- Recovery rate: failed missions resolved through the provided recovery path.
- Notification quality: meaningful notifications acted on versus dismissed.
- Permission trust: grants retained, narrowed, or revoked after first value.
- Time to orientation: time to identify current state and required next action after returning to a mission.

## MVP research questions

1. Which three long-running desktop jobs occur often enough to justify persistent monitoring?
2. What evidence makes users trust file organization and handoff operations?
3. Which approval details are essential versus overwhelming?
4. When do users want mobile approval, and what information must be visible on the phone?
5. What is the right language for “mission,” “workflow,” “observer,” and “authority” for non-technical users?
6. Which operations feel safe enough for reusable approval rules?

## Research plan

### Round 1: problem interviews

- 8–12 participants across creators, operators, founders, analysts, and project leads.
- Ask for recent examples and artifacts, not feature opinions.
- Capture triggers, tools, wait times, failure consequences, current workarounds, and trust boundaries.

### Round 2: concept comprehension

- Test the selected Mission Ledger image plus low-fidelity state variants.
- Ask participants to explain what RAIMOSA can see, what it will change, and what approving means.
- Revise labels before implementation.

### Round 3: vertical-slice usability

- Test one folder-observer → file-verification → approval → archive workflow.
- Measure orientation, plan comprehension, successful approval/edit/rejection, and recovery from a simulated conflict.

## Initial usability acceptance gates

- At least 80% of participants identify the affected files and destination before approval without prompting.
- At least 80% distinguish observation permission from action permission.
- All participants can find pause/stop and revoke access.
- No participant believes completed actions are automatically undone by emergency stop.
- Keyboard-only users can complete the primary mission flow.

