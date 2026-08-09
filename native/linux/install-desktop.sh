#!/usr/bin/env bash
# RAIMOSA AI — Linux desktop integration.
#
#   ./native/linux/install-desktop.sh
#
# Installs a launcher and .desktop entry so RAIMOSA appears in your application
# menu with its own icon and its own window.
#
# HONEST SCOPE: this is not a compiled native shell like the macOS build. There
# is no single Linux GUI toolkit to target, and a WebKitGTK binary would need a
# build environment this project does not assume. Instead the launcher starts
# the runtime and opens it in an existing browser's app mode — a separate,
# chrome-less window with no tabs or address bar. The runtime is still owned by
# the launcher and is terminated when the window closes.
#
# UNVERIFIED ON REAL LINUX HARDWARE. Written on macOS, not yet run on Linux.

set -euo pipefail

MIN_NODE_MAJOR=22
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BIN_DIR="$HOME/.local/bin"
APP_DIR="$HOME/.local/share/applications"
ICON_DIR="$HOME/.local/share/icons/hicolor/512x512/apps"
LAUNCHER="$BIN_DIR/raimosa-desktop"

say() { printf '  %s\n' "$1"; }
fail() { printf '\n  ERROR: %s\n\n' "$1" >&2; exit 1; }

printf '\n  RAIMOSA AI — Linux desktop integration\n\n'

# Prefer the bundled Node so nothing needs installing; fall back to a system
# Node only for a CPU architecture we did not bundle.
case "$(uname -m)" in
  x86_64|amd64) NODE_ARCH="x64" ;;
  aarch64|arm64) NODE_ARCH="arm64" ;;
  *) NODE_ARCH="" ;;
esac
BUNDLED_NODE="$ROOT/vendor/node/linux-$NODE_ARCH/node"
if [ -n "$NODE_ARCH" ] && [ -x "$BUNDLED_NODE" ]; then
  say "Using the bundled Node runtime ($NODE_ARCH) — nothing to install."
else
  command -v node >/dev/null 2>&1 || fail "This build has no bundled Node for your CPU ($(uname -m)) and none is installed.
  Install Node.js ${MIN_NODE_MAJOR}+ from https://nodejs.org or your package manager, then rerun this."
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$NODE_MAJOR" -ge "$MIN_NODE_MAJOR" ] || fail "The installed Node $(node -v) is too old — RAIMOSA needs Node ${MIN_NODE_MAJOR}+."
  BUNDLED_NODE="$(command -v node)"
  say "Using the installed Node $(node -v)."
fi

mkdir -p "$BIN_DIR" "$APP_DIR" "$ICON_DIR"

# The launcher owns the runtime for the lifetime of the window.
cat > "$LAUNCHER" <<'LAUNCH'
#!/usr/bin/env bash
set -euo pipefail
ROOT="__ROOT__"
PORT=$(( 4200 + RANDOM % 600 ))

# Prefer the bundled Node for this CPU; fall back to a system Node.
case "$(uname -m)" in
  x86_64|amd64) NA="x64" ;;
  aarch64|arm64) NA="arm64" ;;
  *) NA="" ;;
esac
NODE_BIN="$ROOT/vendor/node/linux-$NA/node"
[ -n "$NA" ] && [ -x "$NODE_BIN" ] || NODE_BIN="node"

RAIMOSA_NATIVE=linux "$NODE_BIN" "$ROOT/app/bin/raimosa.mjs" --port "$PORT" --no-open &
RUNTIME=$!
# Always take the runtime down with the window, however this script exits.
trap 'kill "$RUNTIME" 2>/dev/null || true; wait "$RUNTIME" 2>/dev/null || true' EXIT INT TERM

for _ in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:$PORT/api/raimosa/health" >/dev/null 2>&1; then break; fi
  sleep 0.25
done

# Prefer a chrome-less app window; fall back to the default browser.
for browser in chromium chromium-browser google-chrome brave-browser microsoft-edge; do
  if command -v "$browser" >/dev/null 2>&1; then
    "$browser" --app="http://localhost:$PORT" --class=RAIMOSA >/dev/null 2>&1
    exit 0
  fi
done

if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "http://localhost:$PORT" >/dev/null 2>&1
  # No window to wait on, so hold the runtime until interrupted.
  wait "$RUNTIME"
else
  echo "RAIMOSA is running at http://localhost:$PORT"
  wait "$RUNTIME"
fi
LAUNCH

sed -i.bak "s|__ROOT__|$ROOT|" "$LAUNCHER" && rm -f "$LAUNCHER.bak"
chmod +x "$LAUNCHER"
say "Installed launcher: $LAUNCHER"

cp "$ROOT/app/public/assets/raimosa-app-icon.png" "$ICON_DIR/raimosa.png"

cat > "$APP_DIR/raimosa.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=RAIMOSA AI
GenericName=Desktop Commander
Comment=A local, governed desktop commander with a tamper-evident receipt ledger
Exec=$LAUNCHER
Icon=raimosa
Terminal=false
Categories=Utility;System;
StartupWMClass=RAIMOSA
DESKTOP

command -v update-desktop-database >/dev/null 2>&1 && \
  update-desktop-database "$APP_DIR" >/dev/null 2>&1 || true

cat <<EOF

  RAIMOSA AI is in your application menu.

    Start it:  $LAUNCHER
    Or search for "RAIMOSA AI" in your launcher.

  Note: this opens a dedicated app window via an installed Chromium-family
  browser. It is not a compiled native shell like the macOS build.

EOF
