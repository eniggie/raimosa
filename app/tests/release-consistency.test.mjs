import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const read = (rel) => readFileSync(path.join(repoRoot, rel), "utf8");
const version = JSON.parse(read("app/package.json")).version;

// The landing page links to release assets by their version-stamped filename
// through GitHub's /releases/latest/download/ path. If the page keeps an old
// version after a release bump, every Download button 404s — silently, for
// everyone. Catch the drift here instead of in the wild.
test("the landing page's download links match the shipped version", () => {
  const page = read("web/index.html");
  const linked = [
    ...page.matchAll(
      /RAIMOSA-(\d+\.\d+\.\d+)-(?:macOS\.dmg|windows\.zip|linux\.tar\.gz)/g,
    ),
  ];
  assert.ok(
    linked.length >= 3,
    "the page should link all three platform downloads",
  );
  for (const [asset, linkedVersion] of linked) {
    assert.equal(
      linkedVersion,
      version,
      `${asset} is stale — run: node tools/sync-web-version.mjs`,
    );
  }
});

test("the Windows package manifest version matches the shipped version", () => {
  const manifest = read("store/windows/AppxManifest.xml");
  const identity = manifest.match(/<Identity[\s\S]*?Version="([^"]+)"/);
  assert.ok(identity, "the manifest declares an Identity version");
  assert.equal(
    identity[1],
    `${version}.0`,
    "MSIX identity version must be <package.json version>.0",
  );
});

test("the winget manifests match the shipped version", () => {
  const manifest = read(
    `store/winget/manifests/e/ECONTEURLLC/RAIMOSA/${version}/ECONTEURLLC.RAIMOSA.yaml`,
  );
  assert.match(
    manifest,
    new RegExp(`PackageVersion:\\s*${version.replace(/\./g, "\\.")}`),
  );
});
