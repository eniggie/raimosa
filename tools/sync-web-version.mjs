#!/usr/bin/env node
// Keep the landing page's download links in step with the shipped version.
//
//   node tools/sync-web-version.mjs
//
// The release assets are version-stamped (RAIMOSA-<version>-macOS.dmg), and the
// page links to them through GitHub's /releases/latest/download/<asset> path.
// That path resolves against the newest release, so a stale version in the
// filename 404s the moment a new release ships. Run this after bumping
// app/package.json; `npm test` fails if the page ever drifts.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(
  readFileSync(path.join(root, "app/package.json"), "utf8"),
).version;

const pagePath = path.join(root, "web/index.html");
const before = readFileSync(pagePath, "utf8");
const after = before.replace(
  /RAIMOSA-\d+\.\d+\.\d+-(macOS\.dmg|windows\.zip|linux\.tar\.gz)/g,
  (_, asset) => `RAIMOSA-${version}-${asset}`,
);

if (after === before) {
  console.log(`  web/index.html already targets ${version}`);
} else {
  writeFileSync(pagePath, after);
  console.log(`  web/index.html download links updated to ${version}`);
}
