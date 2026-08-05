#!/usr/bin/env bash
# Build RAIMOSA.app — a native macOS application bundle.
#
#   ./native/macos/build.sh            build into native/macos/build
#   ./native/macos/build.sh --install  also copy into /Applications
#
# Requires the Xcode Command Line Tools (swiftc). No Rust, no Electron.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="$ROOT/native/macos/build"
APP="$OUT/RAIMOSA.app"
CONTENTS="$APP/Contents"
VERSION="$(node -p "require('$ROOT/app/package.json').version")"

say() { printf '  %s\n' "$1"; }
fail() { printf '\n  ERROR: %s\n\n' "$1" >&2; exit 1; }

printf '\n  Building RAIMOSA.app %s\n\n' "$VERSION"

command -v swiftc >/dev/null 2>&1 || fail "swiftc not found. Install the Xcode Command Line Tools:
  xcode-select --install"

# 1. Build the web interface the shell will render.
say "Building the interface…"
(cd "$ROOT/app" && npm run build >/dev/null)

# 2. Lay out the bundle.
rm -rf "$APP"
mkdir -p "$CONTENTS/MacOS" "$CONTENTS/Resources"

# 3. Compile the native shell.
say "Compiling the native shell…"
swiftc -O \
  -target x86_64-apple-macosx13.0 \
  -framework AppKit -framework WebKit \
  -o "$CONTENTS/MacOS/RAIMOSA" \
  "$ROOT/native/macos/RAIMOSA.swift"

# 4. Copy the runtime the shell launches. Only what the product needs to run.
say "Bundling the runtime…"
mkdir -p "$CONTENTS/Resources/app"
cp -R "$ROOT/app/bin" "$CONTENTS/Resources/app/"
cp -R "$ROOT/app/server" "$CONTENTS/Resources/app/"
cp -R "$ROOT/app/dist" "$CONTENTS/Resources/app/"
cp "$ROOT/app/package.json" "$CONTENTS/Resources/app/"

# 5. Icon.
if command -v sips >/dev/null 2>&1 && command -v iconutil >/dev/null 2>&1; then
  say "Generating the app icon…"
  ICONSET="$OUT/RAIMOSA.iconset"
  rm -rf "$ICONSET"; mkdir -p "$ICONSET"
  SOURCE="$ROOT/app/public/assets/raimosa-app-icon.png"
  for size in 16 32 64 128 256 512; do
    sips -z $size $size "$SOURCE" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null 2>&1
    double=$((size * 2))
    sips -z $double $double "$SOURCE" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null 2>&1
  done
  iconutil -c icns "$ICONSET" -o "$CONTENTS/Resources/RAIMOSA.icns" 2>/dev/null || true
  rm -rf "$ICONSET"
fi

# 6. Info.plist.
cat > "$CONTENTS/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>RAIMOSA AI</string>
  <key>CFBundleDisplayName</key><string>RAIMOSA AI</string>
  <key>CFBundleIdentifier</key><string>com.econteur.raimosa</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>RAIMOSA</string>
  <key>CFBundleIconFile</key><string>RAIMOSA</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSHumanReadableCopyright</key><string>© ECONTEUR LLC</string>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key><true/>
  </dict>
</dict>
</plist>
PLIST

# 7. Ad-hoc sign so Gatekeeper treats it as a coherent bundle on this machine.
if command -v codesign >/dev/null 2>&1; then
  say "Signing (ad-hoc)…"
  codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || \
    say "Ad-hoc signing failed; the app still runs locally."
fi

say "Built $APP"

if [ "${1:-}" = "--install" ]; then
  rm -rf "/Applications/RAIMOSA.app"
  cp -R "$APP" /Applications/
  say "Installed to /Applications/RAIMOSA.app"
fi

cat <<EOF

  RAIMOSA.app is ready.

    Open it:     open "$APP"
    Install it:  ./native/macos/build.sh --install

  Note: this build is ad-hoc signed, not notarized. macOS may ask you to
  confirm the first launch (right-click > Open).

EOF
