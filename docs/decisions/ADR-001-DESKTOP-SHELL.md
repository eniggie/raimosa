# ADR-001: Use Tauri 2 for the RAIMOSA Desktop Shell

**Status:** Accepted for MVP  
**Date:** July 20, 2026  
**Decision owners:** Product and engineering

## Context

RAIMOSA is a security-sensitive desktop commander. Its renderer must show missions, approvals, diagnostics, and evidence while a smaller trusted core handles local capabilities such as approved filesystem observation and reversible file operations.

The shell decision was evaluated against:

- capability granularity;
- renderer isolation;
- IPC validation;
- secure secret storage;
- signed updates;
- binary size and memory profile;
- access to native operating-system APIs;
- frontend development speed;
- cross-platform behavior;
- supply-chain and operational complexity.

## Decision

Use **Tauri 2** with:

- React, Vite, and TypeScript in the renderer;
- a Rust policy and execution core;
- Tauri capabilities and permissions as an outer IPC allowlist;
- explicit typed commands with input validation and caller validation;
- SQLite for the local operational ledger and outbox;
- operating-system keychain or Stronghold-backed secret storage;
- signed, TLS-delivered updates;
- no general shell command exposed to the renderer or model.

Use Next.js only for the separate web/mobile approval companion, not inside the desktop shell.

## Why

Tauri's process model keeps full operating-system access in the core process and uses IPC to broker the webview. Its capability and permission model provides a natural outer boundary for a product built around explicit authority. It also supports signed updates and narrowly scoped sidecars when a native binary is genuinely necessary.

This is a product-specific inference from the official platform models, not a claim that Tauri is automatically secure. Tauri permissions do not protect RAIMOSA from unsafe Rust commands, overly broad path scopes, incorrect symlink handling, or a bad policy engine. Those controls remain RAIMOSA's responsibility.

## Rejected alternative: Electron for the MVP

Electron can be hardened with context isolation, sandboxing, a strict Content Security Policy, sender validation, and a minimal preload bridge. It also offers a mature Chromium and Node ecosystem. It is not selected because RAIMOSA would have to recreate more of its capability boundary around a runtime whose main process can directly access Node and operating-system primitives.

Electron remains a viable fallback if a mandatory, high-value capability cannot run reliably through Tauri without introducing a broad sidecar or if WebView differences block core product behavior.

## Sidecar policy

A sidecar is allowed only after a written decision records:

- why native Rust or a remote service cannot meet the requirement;
- the exact binary and version;
- signature and update provenance;
- allowed arguments and input schema;
- filesystem and network scopes;
- timeout, cancellation, output limits, and redaction;
- receipt and audit behavior.

The renderer and OVIA AI never receive `spawn(binary, arbitrary_args)` or equivalent access.

## Consequences

Positive:

- a small, explicit trusted core;
- capability-aligned IPC;
- efficient signed desktop distribution;
- first-class Rust access to native adapters;
- clear separation between UI, planning, policy, and execution.

Costs:

- Rust expertise and additional test strategy are required;
- platform WebView differences require visual and behavioral QA;
- accessibility and operating-system adapters require per-platform implementations;
- some JavaScript-only libraries may need a narrow sidecar or cloud service.

## Re-evaluation gates

Revisit this decision before public beta if:

- a mandatory integration requires broad Node access on the desktop;
- supported WebViews cannot deliver the required accessibility or rendering quality;
- signed updater behavior cannot satisfy release requirements;
- Rust adapter delivery materially threatens the roadmap;
- a security review finds the chosen command boundary harder to constrain than the Electron alternative.
