# RAIMOSA AI Full Desktop Audit — 2026-07-26

## Outcome

The former frontend-only preview now has a real local desktop runtime. OVIA AI Core selects only registered adapters, classifies risk, requires server-validated All Access for controls, returns receipts, and reports unavailable capabilities without action buttons.

Mobile is implemented only as a paired local-network remote for this desktop. Pairing requires a six-digit code generated on the desktop while OVIA AI All Access is active. Ending All Access or activating Emergency Stop invalidates unused pairing codes and paired phone sessions.

## Audit Scope

- Product identity, naming, desktop-only scope, and OVIA AI terminology
- Navigation, persistent OVIA AI panel, Missions, Workflows, Ledger, Permissions, Settings
- Live Intelligence, Tools, and Mobile Remote surfaces
- Capability truthfulness and unavailable-state behavior
- Filesystem scope protection and path traversal resistance
- All Access expiry, revocation, and Emergency Stop
- Mobile remote pairing and local-network enforcement
- Accessibility semantics, labels, focus trapping, keyboard controls, reduced motion
- Dependency security, automated tests, production build, browser console, and responsive phone layout

## Findings and Repairs

### [P1] UI claimed desktop authority without a desktop runtime — fixed

Baseline All Access copy advertised file operations, application status, and notifications even though the app was frontend-only.

Repair:

- Added a local Vite middleware runtime at `/api/raimosa`.
- Added a live capability registry; UI controls are rendered only for available adapters.
- Replaced the unverified “Device secure” claim with live adapter status.
- Added receipts with tool, exact scope, timestamp, result, and verification state.

### [P1] All Access existed only in React state — fixed

Baseline All Access could not govern device actions because no backend session existed.

Repair:

- Added random server-issued tokens with 5, 10, or 15 minute expiry.
- Read-only inspection works without All Access.
- File writes, file moves, application launch/quit, document opening, and notifications require a valid server token.
- Ending All Access invalidates linked phone pairings and sessions.

### [P1] Mobile remote could have implied silent inherited control — fixed

Repair:

- Mobile is a remote, not a separate RAIMOSA product.
- Pairing is local-network only, six-digit, single-use, short-lived, and bound to the current desktop All Access session.
- The remote exposes an explicit allowlist only.
- Credentials, money, publishing, deletion, arbitrary shell, system power, and unrestricted computer control are absent.
- Emergency Stop was browser-tested to invalidate a fresh code before pairing.

### [P1] Missing or placeholder desktop tools — fixed where a safe adapter exists

Implemented and browser-tested:

- Find approved files by name/path and bounded text content.
- Summarize approved folder counts, bytes, types, and recent files.
- Plan file organization, show every move, require exact `MOVE` confirmation, execute with rollback-on-error, verify destinations, and delete nothing.
- Create new Markdown, CSV, and HTML presentation files without overwrite.
- Inspect bounded process status without exposing arbitrary shell.
- Record and compare folder snapshots.
- Discover installed macOS applications.
- Launch and quit an exact selected application.
- Open one exact document inside an approved folder.
- Send one visible local macOS notification.
- Pair and operate the phone remote over the LAN.

### [P2] Intent compiler misrouted “shut down the desktop” — fixed

The first automated run selected file organization because “desktop” was an overly broad organization keyword. The keyword was removed. Power language now resolves to `system-power`, which is clearly unavailable and exposes no action control.

### [P2] Permission and status copy mixed sample and live state — fixed

Permissions now identifies itself as a live registry. Sample Missions and the sample Scan & Debug finding remain visibly labeled as sample data; live Tools, Intelligence, All Access, and Remote surfaces use live status copy.

### [P2] Mobile countdown did not visibly advance — fixed

The paired remote now updates its countdown and polls server status every three seconds. Desktop revocation or expiry returns the phone to the pairing screen.

## Security Boundaries Verified

- Desktop adapter routes accept loopback requests only.
- Remote routes accept private local-network or loopback addresses only.
- Desktop origins are restricted to `localhost` or `127.0.0.1`.
- Filesystem root and the user home directory are rejected as scopes.
- Real paths and contained paths prevent scope escape.
- Hidden files are ignored by folder traversal.
- Traversal is bounded to 1,000 entries, six levels, and 64 KB per text file.
- New work products use create-only writes and do not overwrite.
- Organization plans expire after ten minutes and are single-use.
- Remote sessions cannot invoke organization execution.
- All unavailable tools have explanatory copy and no action control.

## End-to-End Browser Results

All of the following completed in the current run:

1. OVIA AI Core compiled a read-only folder plan with the correct adapter and scope.
2. File search found two real content matches and returned receipt `RC-3B4EA04E`.
3. A Markdown work product was created and verified with receipt `RC-2AC05522`.
4. Process inspection returned a verified receipt.
5. Folder snapshot baseline was recorded.
6. Installed applications were discovered.
7. Calculator was launched and then quit through the selected-app adapter.
8. An approved `README.md` document was opened.
9. A local macOS notification was sent.
10. A two-move, zero-deletion organization plan was generated, confirmed with `MOVE`, executed, and verified with receipt `RC-EEC10E94`.
11. A mobile remote paired through the real LAN address `http://192.168.100.236:4173/remote`.
12. Remote process inspection, folder summary, application discovery, and phone-to-desktop notification returned receipts.
13. The remote layout passed at a 390 × 844 CSS viewport.
14. Emergency Stop revoked All Access; the previously generated pairing code then failed with “invalid or expired.”

The LAN address is environment-specific and may change when the desktop changes networks.

## Automated Results

- `npm run test`: 7/7 passing.
- `npm run build`: passing with Vite 6.4.3.
- `npm audit --audit-level=moderate`: 0 vulnerabilities.
- Browser console: no current application errors after the fresh server run; one stale Vite WebSocket error came from the earlier stopped preview and did not recur.

## Evidence

- Baseline Ledger: `01-ledger-baseline.png`
- Baseline All Access: `05-all-access-baseline.png`
- Desktop Remote pairing: `08-desktop-remote-pairing.png`
- Paired phone remote at 390 × 844: `12-mobile-remote-390x844.png`
- OVIA AI Core: `10-ovia-ai-core-final.png`
- Live desktop tools: `11-desktop-tools-final.png`
- Final matched Ledger: `13-ledger-final-1486x1058.png`
- Source-versus-final comparison: `14-ledger-source-vs-final.png`
- Focused source-versus-final comparison: `15-ledger-focused-source-vs-final.png`

## Honest Limitations

The following remain unavailable because no verified adapter exists; the UI provides no action control for them:

- Sleep, restart, and shutdown
- Screen capture and Screen Recording permission flow
- External model-powered reasoning
- Credentials, payment, publishing, security changes, arbitrary shell, and unrestricted computer control

The local OVIA AI Core is an explicit deterministic planning and governance layer. It is not represented as a clone of a proprietary model.
