# RAIMOSA AI

A local, governed desktop commander. One unified **OVIA AI** plans work, asks for
approval, executes through named adapters, and writes a tamper-evident receipt for
everything it does.

RAIMOSA runs entirely on your machine. There is no cloud account, no telemetry, and
no external model provider.

---

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
| Discover installed applications | ✅ | ✅ | ✅ |
| Launch / quit an application | ✅ | — | ✅ |
| Sleep, restart, shut down · screen capture · model reasoning | — | — | — |

¹ Linux notifications use `notify-send` (`libnotify`), preinstalled on most desktops.

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
