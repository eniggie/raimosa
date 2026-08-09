#!/usr/bin/env bash
# Fetch the official Node runtimes that get bundled into the Windows and Linux
# releases, verified against Apple— against Node's published SHASUMS256.
#
#   ./native/fetch-node.sh
#
# Downloads into vendor/node/{win-x64,win-arm64,linux-x64,linux-arm64}. These
# binaries are large and reproducible, so they are gitignored rather than
# committed; release.sh calls this automatically when they are missing.

set -euo pipefail

NODE_VERSION="v22.23.2" # LTS; first line with a stable built-in SQLite ledger
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/vendor/node"
BASE="https://nodejs.org/dist/$NODE_VERSION"

say() { printf '  %s\n' "$1"; }
fail() { printf '\n  ERROR: %s\n\n' "$1" >&2; exit 1; }

if [ -x "$DEST/win-x64/node.exe" ] && [ -x "$DEST/linux-x64/node" ] \
   && [ -x "$DEST/win-arm64/node.exe" ] && [ -x "$DEST/linux-arm64/node" ]; then
  say "Node runtimes already present ($NODE_VERSION)."
  exit 0
fi

command -v curl >/dev/null 2>&1 || fail "curl is required to fetch Node."
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

say "Downloading Node $NODE_VERSION for 4 platforms…"
curl -fsSL "$BASE/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt" || fail "Could not fetch SHASUMS256."
for f in win-x64.zip win-arm64.zip linux-x64.tar.xz linux-arm64.tar.xz; do
  curl -fsSL "$BASE/node-$NODE_VERSION-$f" -o "$TMP/node-$NODE_VERSION-$f" &
done
wait

say "Verifying against Node's official checksums…"
( cd "$TMP" && grep -E "win-(x64|arm64).zip|linux-(x64|arm64).tar.xz" SHASUMS256.txt \
  | shasum -a 256 -c - >/dev/null ) || fail "Checksum verification failed. Nothing extracted."

mkdir -p "$DEST"
for arch in x64 arm64; do
  ( cd "$TMP" && unzip -qo "node-$NODE_VERSION-win-$arch.zip" "node-$NODE_VERSION-win-$arch/node.exe" )
  mkdir -p "$DEST/win-$arch"
  cp "$TMP/node-$NODE_VERSION-win-$arch/node.exe" "$DEST/win-$arch/node.exe"

  ( cd "$TMP" && tar -xf "node-$NODE_VERSION-linux-$arch.tar.xz" "node-$NODE_VERSION-linux-$arch/bin/node" )
  mkdir -p "$DEST/linux-$arch"
  cp "$TMP/node-$NODE_VERSION-linux-$arch/bin/node" "$DEST/linux-$arch/node"
  chmod +x "$DEST/linux-$arch/node"
done
echo "$NODE_VERSION" > "$DEST/VERSION.txt"

say "Node runtimes ready in vendor/node ($(du -sh "$DEST" | cut -f1))."
