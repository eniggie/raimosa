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

# 3. Compile the native shell as a universal binary so one download runs on
#    both Apple Silicon and Intel Macs.
say "Compiling the native shell (arm64 + x86_64)…"
for arch in arm64 x86_64; do
  swiftc -O \
    -target "${arch}-apple-macosx13.0" \
    -framework AppKit -framework WebKit \
    -o "$OUT/RAIMOSA-$arch" \
    "$ROOT/native/macos/RAIMOSA.swift" 2>/dev/null || true
done
if [ -f "$OUT/RAIMOSA-arm64" ] && [ -f "$OUT/RAIMOSA-x86_64" ]; then
  lipo -create "$OUT/RAIMOSA-arm64" "$OUT/RAIMOSA-x86_64" \
    -output "$CONTENTS/MacOS/RAIMOSA"
  say "Universal binary: $(lipo -archs "$CONTENTS/MacOS/RAIMOSA")"
elif [ -f "$OUT/RAIMOSA-$(uname -m)" ]; then
  cp "$OUT/RAIMOSA-$(uname -m)" "$CONTENTS/MacOS/RAIMOSA"
  say "Single-architecture build: $(uname -m)"
else
  fail "The native shell did not compile."
fi
rm -f "$OUT/RAIMOSA-arm64" "$OUT/RAIMOSA-x86_64"

# 4. Copy the runtime the shell launches. Only what the product needs to run.
say "Bundling the runtime…"
mkdir -p "$CONTENTS/Resources/app"
cp -R "$ROOT/app/bin" "$CONTENTS/Resources/app/"
cp -R "$ROOT/app/server" "$CONTENTS/Resources/app/"
cp -R "$ROOT/app/dist" "$CONTENTS/Resources/app/"
cp "$ROOT/app/package.json" "$CONTENTS/Resources/app/"

# 5. Bundle the Node runtime so a downloaded copy needs nothing installed.
NODE_BIN="$(command -v node || true)"
if [ -n "$NODE_BIN" ] && [ "${RAIMOSA_SKIP_NODE:-}" != "1" ]; then
  say "Bundling Node $(node -v) ($(du -h "$NODE_BIN" | cut -f1))…"
  mkdir -p "$CONTENTS/Resources/runtime/bin"
  cp "$(readlink -f "$NODE_BIN" 2>/dev/null || echo "$NODE_BIN")" \
    "$CONTENTS/Resources/runtime/bin/node"
  chmod +x "$CONTENTS/Resources/runtime/bin/node"
  ARCHS="$(lipo -archs "$CONTENTS/Resources/runtime/bin/node" 2>/dev/null || echo unknown)"
  say "Bundled Node architectures: $ARCHS"
  case "$ARCHS" in
    *arm64*x86_64* | *x86_64*arm64*) : ;;
    *) say "NOTE: the bundled Node is $ARCHS only, so this build targets $ARCHS Macs." ;;
  esac
else
  say "NOTE: Node was not bundled. The app will require Node 22+ on the target Mac."
fi

# 6. Icon.
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

# 7. Info.plist.
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

# 8. Sign. With a Developer ID identity present, sign properly with the
#    hardened runtime (required for notarization); otherwise fall back to
#    ad-hoc so local builds still cohere.
DEVID="$(security find-identity -v -p codesigning 2>/dev/null | grep -o '"Developer ID Application: [^"]*"' | head -1 | tr -d '"')"
if [ -n "$DEVID" ]; then
  say "Signing with: $DEVID"
  ENTITLEMENTS="$OUT/raimosa-entitlements.plist"
  # Node's V8 JIT needs these two under the hardened runtime; without them a
  # signed-and-notarized app would crash on launch.
  cat > "$ENTITLEMENTS" <<'ENT'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
</dict>
</plist>
ENT
  # Nested executables first, then the bundle.
  if [ -f "$CONTENTS/Resources/runtime/bin/node" ]; then
    codesign --force --options runtime --timestamp \
      --entitlements "$ENTITLEMENTS" --sign "$DEVID" \
      "$CONTENTS/Resources/runtime/bin/node"
  fi
  codesign --force --options runtime --timestamp \
    --entitlements "$ENTITLEMENTS" --sign "$DEVID" "$APP"
  say "Verify: $(codesign -dv "$APP" 2>&1 | grep '^Authority=Developer ID' | head -1)"
elif command -v codesign >/dev/null 2>&1; then
  say "Signing (ad-hoc — no Developer ID certificate found)…"
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
