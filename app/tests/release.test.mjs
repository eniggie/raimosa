import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

test("the macOS build produces a self-contained universal app", async () => {
  const build = await fs.readFile(
    path.join(repoRoot, "native/macos/build.sh"),
    "utf8",
  );
  // Both architectures, merged with lipo: one download for Intel and Apple Silicon.
  assert.match(build, /arm64 x86_64|for arch in arm64 x86_64/);
  assert.match(build, /lipo -create/);
  // Node is bundled so a downloaded copy needs nothing installed.
  assert.match(build, /Resources\/runtime\/bin\/node/);
  // And when it cannot be bundled, the build must say so rather than imply
  // the app is self-contained.
  assert.match(build, /Node was not bundled/);

  const swift = await fs.readFile(
    path.join(repoRoot, "native/macos/RAIMOSA.swift"),
    "utf8",
  );
  // The bundled runtime must be preferred over whatever is on the host.
  const bundledIndex = swift.indexOf("runtime/bin/node");
  const systemIndex = swift.indexOf("/usr/local/bin/node");
  assert.ok(bundledIndex > 0 && bundledIndex < systemIndex);
});

test("the release script verifies before it packages and publishes checksums", async () => {
  const release = await fs.readFile(path.join(repoRoot, "release.sh"), "utf8");
  // Nothing ships if the suite fails.
  assert.match(release, /npm test/);
  assert.match(release, /Nothing was packaged/);
  // Every platform artifact plus checksums.
  assert.match(release, /hdiutil create/);
  assert.match(release, /macOS\.dmg/);
  assert.match(release, /windows\.zip/);
  assert.match(release, /linux\.tar\.gz/);
  assert.match(release, /shasum -a 256/);
  // The drag-to-Applications gesture and an honest first-launch note.
  assert.match(release, /ln -s \/Applications/);
  assert.match(release, /right-click/i);
  // Unverified platforms must be labelled inside the archives themselves.
  assert.match(release, /NOT YET VERIFIED ON REAL WINDOWS HARDWARE/);
  assert.match(release, /NOT YET VERIFIED ON REAL LINUX HARDWARE/);
});

test("installers never print instructions for a command that does not exist", async () => {
  const sh = await fs.readFile(path.join(repoRoot, "install.sh"), "utf8");
  // The macOS/Linux installer falls back to a ~/.local/bin symlink and warns
  // when that directory is not on PATH.
  assert.match(sh, /\.local\/bin/);
  assert.match(sh, /not on your PATH/);
  // The options line must use the resolved launcher, not a hardcoded name.
  assert.match(sh, /Options:\s+\$LAUNCH/);
  assert.ok(!sh.includes("Options:    raimosa"));

  const ps = await fs.readFile(path.join(repoRoot, "install.ps1"), "utf8");
  // The Windows installer falls back to a per-user shim on PATH.
  assert.match(ps, /LOCALAPPDATA/);
  assert.match(ps, /raimosa\.cmd/);
  assert.match(ps, /Options:\s+\$launch/);
});
