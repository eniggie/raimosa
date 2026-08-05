# RAIMOSA AI

A local, governed desktop commander. One unified **OVIA AI** plans work, asks for
approval, executes through named adapters, and writes a tamper-evident receipt for
everything it does.

RAIMOSA runs entirely on your machine. There is no cloud account, no telemetry, and
no external model provider.

---

## Download

```bash
./release.sh
```

Builds everything in `dist-release/`, after running the full test suite — if the
suite fails, nothing is packaged.

| Artifact | Size | Needs |
|---|---|---|
| `RAIMOSA-<version>-macOS.dmg` | ~87 MB | **Nothing.** Node is bundled; universal (Apple Silicon + Intel) |
| `RAIMOSA-<version>-windows.zip` | ~1.5 MB | Node 22+ |
| `RAIMOSA-<version>-linux.tar.gz` | ~1.5 MB | Node 22+ |

Every build is checksummed. Verify a download with:

```bash
shasum -a 256 -c SHA256SUMS.txt
```

**macOS:** open the `.dmg`, drag RAIMOSA to Applications, then **right-click → Open**
the first time. That prompt appears because the build is ad-hoc signed rather than
notarized with an Apple Developer ID; every later launch is a normal double-click.

## Build from source

```bash
./native/macos/build.sh --install
```

**macOS** — builds `RAIMOSA.app` — a real AppKit application with its own window, menu bar,
and dock icon — and installs it to `/Applications`. It owns the runtime: the
local server starts when the app opens and is terminated when it quits, so no
authority can outlive its window. Needs the Xcode Command Line Tools
(`xcode-select --install`). Ad-hoc signed, not notarized.

**Windows** — `powershell -ExecutionPolicy Bypass -File .\native\windows\RAIMOSA.ps1`
opens a WebView2 window that owns the runtime the same way.

**Linux** — `./native/linux/install-desktop.sh` adds RAIMOSA to your application
menu with its own icon and a dedicated app window.

> The Windows and Linux shells were written on macOS and have **not been run on
> real hardware yet**. Both say so in their own files. The macOS build is the one
> that has been verified end to end.

## Install

**Requirements:** [Node.js 22 or newer](https://nodejs.org). Node 22 is the first
release with the built-in SQLite that the receipt ledger uses.

### macOS and Linux

```bash
./install.sh
```

### Windows

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

The installer checks your Node version, installs dependencies, builds the interface,
**runs the full verification suite**, and only then puts a `raimosa` command on your
PATH. If verification fails, nothing is linked.

### Manual install

```bash
cd app
npm install
npm run build
npm link      # optional: puts `raimosa` on your PATH
```

## Run

```bash
raimosa                  # start and open in your browser
raimosa --port 5000      # use a specific port (default 4173, auto-advances if busy)
raimosa --no-open        # start without opening a browser
raimosa --help
```

Without a global link, run `npm start` from the `app` directory.

## Where your data lives

| What | Location |
|---|---|
| Receipt ledger and authority state | `~/.raimosa/` |
| Default approved folder | `~/RAIMOSA Workspace/` |

Override with `RAIMOSA_HOME` and `RAIMOSA_WORKSPACE`. Running from a source checkout
keeps everything inside `app/local-workspace/` instead, so development never touches
your real history.

## What works on your platform

RAIMOSA only offers a control when a verified adapter for **your** operating system
exists. Anything else is explained but never given a button.

| Capability | macOS | Linux | Windows |
|---|:--:|:--:|:--:|
| Find, summarize, storage insights, duplicates, preview | ✅ | ✅ | ✅ |
| Organize files (exact plan + approval) | ✅ | ✅ | ✅ |
| Create documents, spreadsheets, presentations | ✅ | ✅ | ✅ |
| Device vitals, process status, folder monitoring | ✅ | ✅ | ✅ |
| Open a document | ✅ | ✅ | ✅ |
| Local notification | ✅ | ✅¹ | ✅ |
| Network status, compare folders | ✅ | ✅ | ✅ |
| Read / write the clipboard | ✅ | ✅² | ✅ |
| Sleep, restart, shut down | ✅ | ✅ | ✅ |
| Capture the screen | ✅ | — | — |
| Discover installed applications | ✅ | ✅ | ✅ |
| Launch / quit an application | ✅ | — | ✅ |
| Model reasoning · command external AI agents | — | — | — |

¹ Linux notifications use `notify-send` (`libnotify`), preinstalled on most desktops.
² Linux clipboard needs `xclip`.

## Safety model

- The adapter API answers **loopback requests only**. A paired phone is limited to
  your local network and to a session you started and can revoke.
- **All Access** is a short, visible, expiring session. It never survives a restart:
  if the runtime stops, authority is revoked and recorded, never resumed.
- **Emergency stop** is a durable server-side latch. While it is set, every adapter
  dispatch is refused — and it survives restarts until you clear it.
- Every adapter call writes an **append-only, hash-chained receipt**. Altering,
  deleting, or reordering a receipt is detectable and reported by the health scan.
- File **contents are never written to the ledger** — only path, size, and a hash.
- Every adapter call is checked against the capability registry **on the server**,
  not just in the interface: a tool with no verified adapter for your OS cannot run.
- Receipts export to JSON or CSV with a live integrity attestation attached.
- Writes never overwrite. File moves need an exact plan plus a one-time confirmation.
  Nothing is ever deleted.

## Develop

```bash
cd app
npm run dev     # dev server with hot reload
npm test        # full verification suite
npm run audit   # tests + production build
```

Durable product and engineering rules live in [`app/AGENTS.md`](app/AGENTS.md).
Product, architecture, security, and UX documents live in [`docs/`](docs).

---

© ECONTEUR LLC
