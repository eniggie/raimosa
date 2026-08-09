import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createDesktopToolService } from "../server/desktop-tools.mjs";
import { verifyLicenseKey, PRO_TOOLS } from "../server/licensing.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

// Mint a real key with the signing CLI (uses the private key outside the repo).
function mintKey(holder) {
  const out = execFileSync(
    "node",
    [path.join(repoRoot, "tools/sign-license.mjs"), holder],
    { encoding: "utf8" },
  );
  const line = out.split("\n").find((l) => l.trim().startsWith("RAIMOSA-"));
  return line.trim();
}

function open(paths) {
  return createDesktopToolService(paths ?? { ledgerFile: ":memory:" });
}

test("a genuine key verifies offline; tampering and forgery do not", () => {
  const key = mintKey("buyer@example.com");
  const ok = verifyLicenseKey(key);
  assert.equal(ok.valid, true);
  assert.equal(ok.tier, "pro");
  assert.equal(ok.holder, "buyer@example.com");

  assert.equal(verifyLicenseKey(key.slice(0, -4) + "AAAA").valid, false);
  assert.equal(verifyLicenseKey("RAIMOSA-forged.forged").valid, false);
  assert.equal(verifyLicenseKey("not-a-key").valid, false);
  // A self-made payload without the private key cannot be signed.
  const fakePayload = Buffer.from(
    JSON.stringify({
      p: "raimosa",
      t: "pro",
      h: "thief",
      i: "2026-01-01",
      v: 1,
    }),
  ).toString("base64url");
  assert.equal(
    verifyLicenseKey(`RAIMOSA-${fakePayload}.${fakePayload}`).valid,
    false,
  );
});

test("Pro tools are blocked on Free and unlocked by a valid license", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "raimosa-lic-"));
  const service = open({
    ledgerFile: path.join(root, ".raimosa", "ledger.db"),
    stateFile: path.join(root, ".raimosa", "state.db"),
  });
  const access = service.startAccess({ duration: 300, confirmed: true });

  // Free tier: a Pro tool is refused even with live All Access.
  assert.equal(service.licenseStatus().pro, false);
  await assert.rejects(
    service.handle("read-clipboard", { accessToken: access.session.token }),
    /RAIMOSA Pro/,
  );
  // mobile-remote (a Pro feature, not a tool) is refused too.
  assert.throws(
    () => service.startRemotePairing({ accessToken: access.session.token }),
    /RAIMOSA Pro/,
  );

  // A free tool still works.
  const scan = await service.scanRuntime();
  assert.equal(scan.tool, "raimosa-health-scan");

  // Activate Pro.
  const activated = service.activateLicense({
    key: mintKey("owner@econteur.com"),
  });
  assert.equal(activated.pro, true);
  assert.equal(activated.holder, "owner@econteur.com");

  // Now the Pro feature is allowed to run (pairing starts).
  const pairing = service.startRemotePairing({
    accessToken: access.session.token,
  });
  assert.ok(pairing.pairing.code);
  service.closeLedger();
});

test("license state survives a restart and can be removed", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "raimosa-lic2-"));
  const paths = {
    ledgerFile: path.join(root, ".raimosa", "ledger.db"),
    stateFile: path.join(root, ".raimosa", "state.db"),
  };
  const first = open(paths);
  first.activateLicense({ key: mintKey("persist@econteur.com") });
  assert.equal(first.licenseStatus().pro, true);
  first.closeLedger();

  const second = open(paths);
  assert.equal(second.licenseStatus().pro, true, "Pro must survive restart");
  assert.equal(second.removeLicense().pro, false);
  const third = open(paths);
  assert.equal(third.licenseStatus().pro, false, "removal must persist");
  second.closeLedger();
  third.closeLedger();
});

test("activating a bad key is refused and leaves the tier Free", () => {
  const service = open();
  assert.throws(
    () => service.activateLicense({ key: "RAIMOSA-x.y" }),
    /invalid|malformed|not a RAIMOSA/i,
  );
  assert.equal(service.licenseStatus().pro, false);
  service.closeLedger();
});

test("the Pro tool set matches the catalog's pro flags", async () => {
  const { capabilityCatalog } = await import("../server/ovia-core.mjs");
  const proCaps = new Set(
    capabilityCatalog.filter((c) => c.pro).map((c) => c.id),
  );
  // Every Pro tool maps to a pro-flagged capability (via a small known map).
  const toolToCap = {
    "launch-application": "applications",
    "close-application": "applications",
    "open-document": "open-document",
    "read-clipboard": "clipboard",
    "write-clipboard": "clipboard",
    "capture-screen": "screen-capture",
    "system-power": "system-power",
  };
  for (const tool of PRO_TOOLS) {
    assert.ok(
      proCaps.has(toolToCap[tool]),
      `${tool} must map to a pro capability`,
    );
  }
  assert.ok(proCaps.has("mobile-remote"));
});
