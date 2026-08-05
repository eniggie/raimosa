# ADR-002: Ship the macOS Shell as AppKit + WKWebView

**Status:** Accepted and shipped
**Date:** August 5, 2026
**Supersedes:** ADR-001 (Tauri 2), for the shipped shell only

## Context

ADR-001 chose Tauri 2, and its reasoning was sound: small binaries, a Rust
trusted core, capability-scoped IPC, signed updates.

It was never built. Tauri requires a Rust toolchain, and the build machine has
no `cargo` — installing one is roughly 1.5 GB of dependencies before a single
line of shell code compiles. Meanwhile the product had a harder problem: for
weeks the entire adapter API lived inside a Vite dev-server plugin, so RAIMOSA
could not be installed at all, let alone shelled.

The trusted-core argument also weakened in practice. RAIMOSA's security
boundary did not end up living in the shell. It lives in the Node service:
loopback-only routing, the capability registry enforced server-side, a durable
append-only hash-chained ledger, hash-only credential storage, and a durable
emergency-stop latch. A Rust shell would have wrapped that boundary, not
provided it.

## Decision

Ship the macOS shell as a native **AppKit application hosting WKWebView**,
compiled with `swiftc` from the Xcode Command Line Tools.

- `native/macos/RAIMOSA.swift` — window, native menu bar, dock icon, runtime
  supervision.
- `native/macos/build.sh` — assembles `RAIMOSA.app` with `Info.plist`, a
  generated `.icns`, the bundled runtime, and ad-hoc signing.

Two contracts the shell must hold:

1. **It shows the product only after `/health` answers.** A shell that renders
   a blank frame and hopes would be claiming the app started when it had not.
2. **It terminates the child runtime on quit**, with a `SIGKILL` backstop. An
   orphaned runtime would mean an All Access session still live after the
   window that displayed it was gone.

## Consequences

**Gained**

- Zero new toolchain: Swift ships with the Command Line Tools already present.
- A genuinely native macOS app — real window, menu bar, dock icon — buildable
  and verifiable in one session.
- No Electron: no bundled browser, no second JavaScript runtime.

**Lost**

- No Rust trusted core. Accepted: the boundary is enforced in the Node service
  and covered by tests, not by the shell.
- No cross-platform shell from one codebase. Windows gets a WebView2 PowerShell
  host and Linux a launcher plus `.desktop` entry — both written, **neither yet
  run on real hardware**, and both labelled as such in their own files.
- No built-in signed-update channel. Updates are reinstalls today.

**Not closed**

- The app is **ad-hoc signed, not notarized**. Gatekeeper will warn on first
  launch until it is signed with an Apple Developer ID and notarized, which
  needs credentials only the owner holds.

## Revisiting

Adopt Tauri if any of these become true: a Rust toolchain is a normal part of
the build environment; signed auto-updates become a requirement; or a capability
genuinely needs to live below the Node service. Nothing in this decision blocks
that — the shell is thin by design and the runtime it launches is unchanged.
