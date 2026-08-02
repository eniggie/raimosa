# Selected Product Direction: Mission Ledger

**Status:** Selected for specification  
**Date:** July 20, 2026  
**Visual target:** `raimosa-command-center-ovia-unified-v2.png`

## Decision

RAIMOSA will use the **Mission Ledger** direction as the foundation for its desktop product.

The July 20 unified OVIA AI revision is the current target. It replaces the earlier evidence rail with one persistent OVIA AI panel containing Ask, Operate, and Scan & Debug modes plus one shared access control.

The direction presents a mission as an operational contract:

1. The user’s intent.
2. The exact scope RAIMOSA can observe.
3. The authority needed to act.
4. The approval boundary.
5. A chronological record of what happened.
6. Evidence that the result was verified.

## Why this direction wins

- It turns security and consent into visible product value instead of hidden settings.
- It separates observation, proposal, approval, execution, and verification.
- It supports both quick personal tasks and future enterprise audit requirements.
- It is understandable without chat history or technical logs.
- It makes the primary decision obvious without hiding the affected files, scope, risk, or expiry.
- It can adapt to file operations, long-running jobs, app coordination, and mobile approvals.

## Required refinements before implementation

The image is a design target, not executable truth. Implementation must make these refinements:

- Rename **Tasks** to **Missions** throughout the product.
- Rename **Automations** to **Workflows**.
- Move **Permissions** into the primary navigation rather than only the top bar.
- Keep **Settings** subordinate to account/device controls.
- Replace decorative plan-hash display with a copyable approval ID and an expandable technical detail.
- Show actual platform paths without truncating the safety-critical target; allow copying and revealing the location.
- Ensure “Approved” is a state reached only after approval, never a pending row label.
- Show the requested action, the currently granted authority, and the new authority separately.
- Preserve the always-visible emergency stop, keyboard operability, and low-motion alternative.
- Add one persistent **OVIA AI** chat box whose composer always states its mode and authority level.
- Place `Ask`, `Operate`, and `Scan & Debug` inside the same OVIA AI thread; findings, repair proposals, execution, and verification remain in one continuous experience.
- When All Access is active, show a global authority bar with countdown, capability summary, narrow, and end controls.
- Make mode changes explicit with text labels, descriptions, and ledger events; never rely on color alone.

## Non-negotiable visual constraints

- Royal purple remains the dominant action and focus color.
- Gold identifies structure, evidence, and premium detail; it does not become the main fill color.
- The approved R emblem is used without alteration.
- Dark surfaces are quiet and flat; no star fields, ornamental magic, or gaming effects inside the application.
- Information hierarchy uses spacing, alignment, typography, and row separation before borders and shadows.
- One mission and one decision dominate the main screen.
