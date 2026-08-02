# RAIMOSA Product Design System

**Version:** 0.1 specification  
**Date:** July 20, 2026  
**Foundation:** Approved RAIMOSA brand system + Mission Ledger direction

## Design promise

RAIMOSA should feel powerful because it is clear, not because it is loud. The interface makes authority, scope, live state, risk, and proof easy to understand before asking a person to trust automation.

## Product principles

1. **Authority before autonomy** — show what RAIMOSA may do before it acts.
2. **Exact scope beats vague assurance** — name the process, folder, file count, destination, network access, and expiry.
3. **Proof is part of completion** — a mission is not complete until its post-conditions are verified.
4. **Reversible by default** — prefer copy, move-to-archive, or trash over permanent deletion; state recovery plainly.
5. **Calm during long work** — foreground changes, failures, and decisions; keep stable telemetry quiet.
6. **Progressive disclosure** — plain-language summary first, exact paths and technical evidence one level deeper.
7. **The model is not the authority** — model recommendations and granted permissions are visually and logically separate.

## Visual foundations

### Color

Existing brand tokens remain canonical.

| Role | Token | Value | Product use |
|---|---|---:|---|
| Application field | Royal Black | `#07030D` | Main background and window chrome |
| Raised surface | Obsidian Purple | `#17082E` | Drawers, selected regions, overlays |
| Primary action | Royal Purple | `#6D28D9` | Primary button, active navigation, approved focus |
| Active/focus | Imperial Violet | `#8B5CF6` | Selection, progress, interactive emphasis |
| Focus ring | Electric Lavender | `#A78BFA` | Keyboard focus and restrained glow |
| Structural accent | Royal Gold | `#D6A843` | Evidence, boundaries, labels, emblem details |
| Highlight | Gold Light | `#F6D782` | Rare highlight on dark backgrounds |
| Primary text | Divine Ivory | `#F8F3E7` | Headings and primary body text |
| Secondary text | Muted Ivory | `#C7BEAD` | Metadata and helper text |

Validated contrast examples:

| Foreground/background | Contrast |
|---|---:|
| Divine Ivory on Royal Black | `18.45:1` |
| Muted Ivory on Royal Black | `11.09:1` |
| Electric Lavender on Royal Black | `7.51:1` |
| Royal Gold on Royal Black | `9.28:1` |
| Divine Ivory on Royal Purple | `6.42:1` |

Status cannot rely on color alone. Every state includes text and an icon or shape.

### Semantic status

| State | Visual behavior | Required label |
|---|---|---|
| Observing | Neutral eye + subtle purple activity | `Observing` |
| Proposed | Violet open ring | `Proposed` |
| Awaiting approval | Gold boundary/lock | `Approval required` |
| Scheduled | Clock | `Scheduled` |
| Running | Violet progress + pause/stop | `Running` |
| Verifying | Gold checkpoint | `Verifying` |
| Completed | Success check | `Verified` or `Completed with warning` |
| Paused | Pause symbol | `Paused` plus reason |
| Failed | Error symbol and plain-language cause | `Failed` |
| Cancelled | Strike/stop symbol | `Cancelled` |

### Typography

- Display and product titles: Avenir Next where licensed/available; Inter fallback.
- Interface: Inter, SF Pro Text on macOS, Segoe UI on Windows.
- Monospace: system monospace for paths, IDs, hashes, commands, and technical evidence only.

| Token | Size/line height | Use |
|---|---|---|
| Display 1 | `36/44`, 600 | Mission title on wide screens |
| Heading 1 | `28/36`, 600 | Page title |
| Heading 2 | `20/28`, 600 | Region title |
| Heading 3 | `16/24`, 600 | Row/section title |
| Body | `15/22`, 400 | Default product text |
| Body compact | `14/20`, 400 | Tables and dense metadata |
| Label | `12/16`, 600, +0.06em | Short uppercase operational labels |
| Caption | `12/16`, 400 | Supplemental metadata |

Do not use tracked uppercase for paragraphs or long button labels.

### Spacing and grid

- Base unit: `4px`.
- Common steps: `4, 8, 12, 16, 20, 24, 32, 40, 48, 64`.
- Wide desktop shell: 12-column content grid, 24px gutters, 32px outer margin.
- Navigation rail: 88–104px icon rail or 232–264px expanded rail.
- Minimum main-content width: 720px.
- Evidence rail: 280–360px when space allows; collapses into a drawer below 1180px.
- At narrow desktop widths, preserve the plan and approval action; collapse evidence before hiding critical scope.

Spacing, proximity, and alignment carry hierarchy before surfaces or lines. This follows current Fluent guidance and avoids card-heavy dashboards.

### Shape and elevation

- Small radius: `10px` controls and compact fields.
- Medium radius: `18px` drawers and action docks.
- Large radius: `28px` reserved for branded empty/onboarding moments, not operational tables.
- Default borders: 1px low-contrast neutral/divine-ivory at 10–16% opacity.
- Gold borders appear only on approval boundaries, evidence, and protected scopes.
- Shadows are limited to transient overlays and window separation.

### Icons and imagery

- Use one consistent outline icon family with clear 16, 20, and 24px sizes.
- Operational icons must have accessible text labels in persistent navigation.
- The RAIMOSA emblem appears at 32–48px in chrome; the full medallion ring is not repeated as decoration.
- No emoji, handmade SVG approximations, robot art, mystical filler, or generic AI brain icons.

## Core components

### Global command field

- Accepts a goal, not a raw shell command.
- Placeholder: `What should RAIMOSA coordinate?`
- Before submission, show the active device and data boundary.
- After submission, transition into a mission draft; never execute directly from free text.

### Mission contract strip

Always show four fields:

1. Intent.
2. Scope.
3. Authority.
4. Approval rule.

Each field opens a detail view. Empty authority is labeled `No action authority granted`, not omitted.

### Mission ledger

- One ordered list with row separators.
- Rows show state, event/action, timestamp, actor, and evidence availability.
- Expanded rows contain plan steps, before/after previews, results, and errors.
- The ledger is append-only from the user’s perspective; corrections become new events.

### Approval dock

Pinned within the mission surface, not over unrelated content.

Required content:

- Exact action summary.
- Affected targets and count.
- New authority requested.
- Risk and reversibility.
- Expiry.
- Primary `Approve exact plan`.
- Secondary `Edit scope`.
- Tertiary destructive-colored `Reject` only when rejection has consequences worth emphasizing.

Approval is bound to the displayed plan version. Any material plan change invalidates approval.

### Evidence drawer

- Shows source observations, permission grants, pre-conditions, post-conditions, receipts, and artifact links.
- Technical IDs are copyable.
- Sensitive values are redacted by default.
- “Proof not available” is a visible state; RAIMOSA never fabricates evidence.

### Emergency stop

- Always visible while a mission can act.
- Keyboard accessible.
- Stops new steps and requests cancellation of active cancellable steps.
- Does not claim to undo completed actions.
- Opens a clear result: what stopped, what could not stop, and what remains changed.

## Interaction and motion

- Fast response: `180ms` for hover/focus and control feedback.
- Standard transition: `240–320ms` for drawers and row expansion.
- Reveal: `480–720ms` only for first-load identity or major mission completion.
- Progress reflects actual state; no looping “almost done” animations.
- Reduced motion removes transforms and sequencing while preserving state changes.
- New ledger events announce through an accessible status region without stealing focus.

## Accessibility acceptance criteria

- Target WCAG 2.2 AA; use AAA-sized 44×44px pointer targets for primary actions where practical.
- Full keyboard operation with a logical left-to-right, top-to-bottom focus order.
- Focus indicator at least equivalent to a 2px perimeter with 3:1 contrast.
- Text contrast at least 4.5:1; large text and non-text controls at least 3:1.
- Text zoom to 200% without clipping; layout reflow support for high zoom.
- Do not announce continuous progress more often than useful; announce meaningful milestones.
- Provide accessible names for icons, buttons, paths, plan steps, and status indicators.
- Time limits such as approval expiry can be extended unless a security requirement forbids it; explain the reason.

## Content rules

- Lead with what will happen: `Move 4 verified files to Campaign Archive`.
- State what will not happen when it reduces uncertainty: `No files will be deleted`.
- Replace vague words like “optimize,” “manage,” and “handle” with the exact operation.
- Errors include the failed step, unchanged/changed targets, a safe next action, and support evidence ID.
- Use `RAIMOSA` for the product and `RAIMOSA AI` for formal brand contexts.

## Official design references

- Apple, [Design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles)
- Apple, [Designing for macOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos/)
- Apple, [Windows](https://developer.apple.com/design/human-interface-guidelines/windows)
- Microsoft, [Fluent 2 layout](https://fluent2.microsoft.design/layout)
- Microsoft, [Fluent 2 accessibility](https://fluent2.microsoft.design/accessibility)
- Material Design 3, [Layout](https://m3.material.io/foundations/layout/understanding-layout/overview)
- W3C, [WCAG 2.2](https://www.w3.org/TR/WCAG22/)

