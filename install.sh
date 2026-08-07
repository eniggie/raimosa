#!/usr/bin/env bash
# RAIMOSA AI installer — macOS and Linux.
#
#   curl -fsSL <url>/install.sh | bash
#   ./install.sh
#
# Installs into this checkout and puts a `raimosa` command on your PATH.
# Nothing is installed system-wide and nothing runs as root.

set -euo pipefail

MIN_NODE_MAJOR=22
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/app"

say()  { printf '  %s\n' "$1"; }
fail() { printf '\n  ERROR: %s\n\n' "$1" >&2; exit 1; }

printf '\n  RAIMOSA AI installer\n\n'

# 1. Node
if ! command -v node >/dev/null 2>&1; then
  fail "Node.js is not installed.
  RAIMOSA needs Node ${MIN_NODE_MAJOR} or newer for its built-in SQLite ledger.
  Install it from https://nodejs.org (or: brew install node / apt install nodejs)
  and run this installer again."
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt "$MIN_NODE_MAJOR" ]; then
  fail "Node $(node -v) is too old — RAIMOSA needs Node ${MIN_NODE_MAJOR}+.
  Node ${MIN_NODE_MAJOR} is the first release with the built-in SQLite used by
  the receipt ledger. Upgrade from https://nodejs.org and try again."
fi
say "Node $(node -v) — OK"

[ -d "$APP_DIR" ] || fail "Cannot find the app directory at $APP_DIR"
cd "$APP_DIR"

# 2. Dependencies
say "Installing dependencies…"
if [ -f package-lock.json ]; then npm ci --no-audit --no-fund >/dev/null
else npm install --no-audit --no-fund >/dev/null; fi

# 3. Build the interface
say "Building the interface…"
npm run build >/dev/null

# 4. Verify before claiming success
say "Verifying the install…"
npm test >/dev/null 2>&1 || fail "The verification suite failed. Nothing was linked."

# 5. Put `raimosa` on PATH. npm link needs write access to the global prefix,
#    which stock installs often don't have — so fall back to a plain symlink
#    in ~/.local/bin rather than printing instructions for a command that
#    doesn't exist.
LAUNCH=""
if npm link >/dev/null 2>&1; then
  say "Linked the 'raimosa' command."
  LAUNCH="raimosa"
else
  mkdir -p "$HOME/.local/bin"
  ln -sf "$APP_DIR/bin/raimosa.mjs" "$HOME/.local/bin/raimosa"
  chmod +x "$APP_DIR/bin/raimosa.mjs"
  say "Installed the 'raimosa' command to ~/.local/bin (no sudo needed)."
  case ":$PATH:" in
    *":$HOME/.local/bin:"*) LAUNCH="raimosa" ;;
    *)
      LAUNCH="$HOME/.local/bin/raimosa"
      PROFILE="$HOME/.zshrc"
      [ -n "${BASH_VERSION:-}" ] && PROFILE="$HOME/.bashrc"
      say "NOTE: ~/.local/bin is not on your PATH. Add it with:"
      say "  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> $PROFILE"
      ;;
  esac
fi

cat <<EOF

  RAIMOSA AI is installed.

    Start it:   $LAUNCH
    Options:    $LAUNCH --port 5000 --no-open

  It runs entirely on this machine. The adapter API answers loopback
  requests only, and a paired phone is limited to your local network.

EOF
