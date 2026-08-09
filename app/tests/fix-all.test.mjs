import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDesktopToolService } from "../server/desktop-tools.mjs";
import { capabilityCatalog } from "../server/ovia-core.mjs";
import { proKey } from "./helpers.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

test("reading the clipboard requires Pro, then All Access", async () => {
  const service = createDesktopToolService({ ledgerFile: ":memory:" });
  // On Free the clipboard is Pro-gated first.
  await assert.rejects(
    service.handle("read-clipboard", {}),
    /RAIMOSA Pro/,
    "clipboard is a Pro tool",
  );
  // With Pro, it still requires All Access — the clipboard has no folder scope
  // and routinely holds credentials.
  service.activateLicense({ key: proKey() });
  await assert.rejects(
    service.handle("read-clipboard", {}),
    /All Access/,
    "the clipboard has no folder scope and routinely holds credentials",
  );
  const entry = capabilityCatalog.find((item) => item.id === "clipboard");
  assert.equal(entry.risk, "sensitive-read");
  service.closeLedger();
});

test("every unscoped or side-effecting tool is gated behind All Access", async () => {
  const source = await fs.readFile(
    new URL("../server/desktop-tools.mjs", import.meta.url),
    "utf8",
  );
  const block = source.slice(
    source.indexOf("const CONTROL_TOOLS = new Set(["),
    source.indexOf("]);", source.indexOf("const CONTROL_TOOLS = new Set([")),
  );
  // Any tool that touches the device outside an approved folder, or changes
  // state a person would notice, must be listed here.
  for (const tool of [
    "read-clipboard",
    "write-clipboard",
    "capture-screen",
    "system-power",
    "launch-application",
    "close-application",
    "local-notification",
    "open-document",
    "execute-organization",
    "create-work-product",
  ]) {
    assert.ok(block.includes(`"${tool}"`), `${tool} must require All Access`);
  }
});

test("the shipped shell decision is documented, not left as drift", async () => {
  const adr1 = await fs.readFile(
    path.join(repoRoot, "docs/decisions/ADR-001-DESKTOP-SHELL.md"),
    "utf8",
  );
  assert.match(adr1, /SUPERSEDED/);
  assert.match(adr1, /ADR-002/);

  const adr2 = await fs.readFile(
    path.join(repoRoot, "docs/decisions/ADR-002-NATIVE-SHELL-SWIFT.md"),
    "utf8",
  );
  assert.match(adr2, /AppKit \+ WKWebView/);
  // The ADR must record what was lost, not only what was gained.
  assert.match(adr2, /No Rust trusted core/);
  assert.match(adr2, /not notarized/);
});

test("the Windows and Linux shells own their runtime and admit they are unverified", async () => {
  const windows = await fs.readFile(
    path.join(repoRoot, "native/windows/RAIMOSA.ps1"),
    "utf8",
  );
  assert.match(windows, /UNVERIFIED ON REAL WINDOWS HARDWARE/);
  assert.match(windows, /api\/raimosa\/health/);
  assert.match(windows, /FormClosing/);
  assert.match(windows, /\.Kill\(\)/);
  assert.match(windows, /RAIMOSA_NATIVE/);

  const linux = await fs.readFile(
    path.join(repoRoot, "native/linux/install-desktop.sh"),
    "utf8",
  );
  assert.match(linux, /UNVERIFIED ON REAL LINUX HARDWARE/);
  assert.match(linux, /trap /);
  assert.match(linux, /api\/raimosa\/health/);
  // It must not claim to be a compiled native shell.
  assert.match(linux, /not a compiled native shell/i);
});
