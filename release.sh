#!/usr/bin/env bash
# Build downloadable RAIMOSA releases.
#
#   ./release.sh
#
# Produces, in dist-release/:
#   RAIMOSA-<version>-macOS.dmg      drag-to-Applications installer, self-contained
#   RAIMOSA-<version>-windows.zip    WebView2 shell + runtime (needs Node 22+)
#   RAIMOSA-<version>-linux.tar.gz   desktop launcher + runtime (needs Node 22+)
#   SHA256SUMS.txt                   checksums for every artifact
#
# The macOS build bundles Node, so it runs on a Mac with nothing installed.
# The Windows and Linux archives do not — no cross-platform Node binary is
# available on this machine to bundle, and shipping one unverified would be
# worse than saying so.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$ROOT/dist-release"
VERSION="$(node -p "require('$ROOT/app/package.json').version")"

say() { printf '  %s\n' "$1"; }
fail() { printf '\n  ERROR: %s\n\n' "$1" >&2; exit 1; }

printf '\n  RAIMOSA AI — building release %s\n\n' "$VERSION"

# Never ship something the suite rejects.
say "Verifying…"
(cd "$ROOT/app" && npm test >/dev/null 2>&1) || fail "Tests failed. Nothing was packaged."
say "Tests pass."

rm -rf "$OUT"
mkdir -p "$OUT"

# ---------- macOS ----------
if [ "$(uname -s)" = "Darwin" ]; then
  say "Building RAIMOSA.app…"
  "$ROOT/native/macos/build.sh" >/dev/null

  APP="$ROOT/native/macos/build/RAIMOSA.app"
  [ -d "$APP" ] || fail "RAIMOSA.app was not produced."

  say "Packaging the disk image…"
  STAGE="$OUT/dmg-stage"
  rm -rf "$STAGE"; mkdir -p "$STAGE"
  cp -R "$APP" "$STAGE/"
  # The familiar drag-to-install gesture.
  ln -s /Applications "$STAGE/Applications"
  cat > "$STAGE/READ ME FIRST.txt" <<'NOTE'
RAIMOSA AI

1. Drag RAIMOSA to the Applications folder beside it.
2. The first time you open it, right-click the app and choose Open.

Why the right-click: this build is signed ad-hoc rather than notarized with an
Apple Developer ID, so macOS asks you to confirm the first launch. Every later
launch is a normal double-click.

Nothing else is required. Node is bundled inside the app.

RAIMOSA runs entirely on your machine. Its adapter API answers loopback
requests only, and every action it takes writes a hash-chained receipt you
can read and export from the Ledger screen.

© ECONTEUR LLC
NOTE

  DMG="$OUT/RAIMOSA-$VERSION-macOS.dmg"
  hdiutil create -volname "RAIMOSA AI" -srcfolder "$STAGE" \
    -ov -format UDZO "$DMG" >/dev/null
  rm -rf "$STAGE"
  say "Built $(basename "$DMG") ($(du -h "$DMG" | cut -f1))"

  # Notarize when credentials exist. The keychain profile is created once with:
  #   xcrun notarytool store-credentials raimosa-notary \
  #     --apple-id <apple-id> --team-id W842SR649M
  if xcrun notarytool history --keychain-profile raimosa-notary \
      >/dev/null 2>&1; then
    say "Notarizing (this usually takes a few minutes)…"
    if xcrun notarytool submit "$DMG" --keychain-profile raimosa-notary \
        --wait 2>&1 | tee "$OUT/notarization.log" | grep -q "status: Accepted"; then
      xcrun stapler staple "$DMG" >/dev/null
      say "Notarized and stapled: double-click install, no Gatekeeper warning."
    else
      say "NOTE: notarization was not accepted — see dist-release/notarization.log."
      say "The DMG still works with right-click > Open."
    fi
  else
    say "NOTE: no 'raimosa-notary' keychain profile; skipping notarization."
    say "First launch will need right-click > Open."
  fi
else
  say "Skipping the macOS disk image (not running on macOS)."
fi

# ---------- Windows ----------
say "Packaging the Windows archive…"
WIN="$OUT/win-stage/RAIMOSA-$VERSION"
mkdir -p "$WIN/app" "$WIN/native/windows"
cp -R "$ROOT/app/bin" "$ROOT/app/server" "$ROOT/app/dist" "$WIN/app/"
cp "$ROOT/app/package.json" "$WIN/app/"
cp "$ROOT/native/windows/RAIMOSA.ps1" "$WIN/native/windows/"
cp "$ROOT/README.md" "$WIN/"
cat > "$WIN/START HERE.txt" <<'NOTE'
RAIMOSA AI for Windows

REQUIREMENT: Node.js 22 or newer from https://nodejs.org
  (Node ships the built-in SQLite that RAIMOSA's receipt ledger uses.)

To start:
  Right-click START-RAIMOSA.cmd and choose Run.

NOT YET VERIFIED ON REAL WINDOWS HARDWARE. This shell was written and reviewed
on macOS. If it fails, the cross-platform command line still works:
  cd app && npm install && npm start

© ECONTEUR LLC
NOTE
printf '@echo off\r\npowershell -ExecutionPolicy Bypass -File "%%~dp0native\\windows\\RAIMOSA.ps1"\r\n' \
  > "$WIN/START-RAIMOSA.cmd"
(cd "$OUT/win-stage" && zip -qr "$OUT/RAIMOSA-$VERSION-windows.zip" "RAIMOSA-$VERSION")
rm -rf "$OUT/win-stage"
say "Built RAIMOSA-$VERSION-windows.zip ($(du -h "$OUT/RAIMOSA-$VERSION-windows.zip" | cut -f1))"

# ---------- Linux ----------
say "Packaging the Linux archive…"
LNX="$OUT/linux-stage/RAIMOSA-$VERSION"
mkdir -p "$LNX/app" "$LNX/native/linux"
cp -R "$ROOT/app/bin" "$ROOT/app/server" "$ROOT/app/dist" "$LNX/app/"
cp "$ROOT/app/package.json" "$LNX/app/"
cp "$ROOT/app/public/assets/raimosa-app-icon.png" "$LNX/app/"
mkdir -p "$LNX/app/public/assets"
cp "$ROOT/app/public/assets/raimosa-app-icon.png" "$LNX/app/public/assets/"
cp "$ROOT/native/linux/install-desktop.sh" "$LNX/native/linux/"
chmod +x "$LNX/native/linux/install-desktop.sh"
cp "$ROOT/README.md" "$LNX/"
cat > "$LNX/START HERE.txt" <<'NOTE'
RAIMOSA AI for Linux

REQUIREMENT: Node.js 22 or newer
  (Node ships the built-in SQLite that RAIMOSA's receipt ledger uses.)

To add RAIMOSA to your application menu:
  ./native/linux/install-desktop.sh

Or run it directly:
  node app/bin/raimosa.mjs

NOT YET VERIFIED ON REAL LINUX HARDWARE. This launcher was written and reviewed
on macOS. It opens a dedicated app window using an installed Chromium-family
browser; it is not a compiled native shell like the macOS build.

© ECONTEUR LLC
NOTE
(cd "$OUT/linux-stage" && tar -czf "$OUT/RAIMOSA-$VERSION-linux.tar.gz" "RAIMOSA-$VERSION")
rm -rf "$OUT/linux-stage"
say "Built RAIMOSA-$VERSION-linux.tar.gz ($(du -h "$OUT/RAIMOSA-$VERSION-linux.tar.gz" | cut -f1))"

# ---------- Checksums ----------
say "Writing checksums…"
(cd "$OUT" && shasum -a 256 RAIMOSA-* > SHA256SUMS.txt)

printf '\n  Release %s is ready in dist-release/\n\n' "$VERSION"
(cd "$OUT" && ls -lh RAIMOSA-* SHA256SUMS.txt | awk '{printf "    %-42s %s\n", $9, $5}')
printf '\n  Verify a download with:  shasum -a 256 -c SHA256SUMS.txt\n\n'
