import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
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

function open() {
  return createDesktopToolService({ ledgerFile: ":memory:" });
}

test("network status proves connectivity instead of assuming it", async () => {
  const service = open();
  const result = await service.handle("network-status", {});
  assert.equal(typeof result.result.online, "boolean");
  assert.ok(Array.isArray(result.result.interfaces));
  // Hardware addresses must never be reported.
  for (const item of result.result.interfaces) assert.equal(item.mac, "hidden");
  if (result.result.online) assert.ok(result.result.dnsResolveMs >= 0);
  service.closeLedger();
});

test("folder comparison reports both sides and size differences", async () => {
  const left = await fs.mkdtemp(path.join(os.tmpdir(), "raimosa-cmp-a-"));
  const right = await fs.mkdtemp(path.join(os.tmpdir(), "raimosa-cmp-b-"));
  await fs.writeFile(path.join(left, "same.md"), "identical\n");
  await fs.writeFile(path.join(right, "same.md"), "identical\n");
  await fs.writeFile(path.join(left, "only-left.md"), "x\n");
  await fs.writeFile(path.join(right, "only-right.md"), "y\n");
  await fs.writeFile(path.join(left, "sized.md"), "short\n");
  await fs.writeFile(path.join(right, "sized.md"), "much longer content\n");

  const service = open();
  const result = await service.handle("compare-folders", {
    root: left,
    compareTo: right,
  });
  assert.deepEqual(result.result.onlyInLeft, ["only-left.md"]);
  assert.deepEqual(result.result.onlyInRight, ["only-right.md"]);
  assert.equal(result.result.differentSize.length, 1);
  assert.equal(result.result.differentSize[0].path, "sized.md");
  assert.equal(result.result.identical, 1);

  await assert.rejects(
    service.handle("compare-folders", { root: left, compareTo: left }),
    /two different folders/,
  );
  service.closeLedger();
});

test("clipboard contents never reach the permanent ledger", async (t) => {
  if (process.platform !== "darwin")
    return t.skip("clipboard adapter is macOS here");
  const service = open();
  service.activateLicense({ key: proKey() });
  const secret = "sk-live-CLIPBOARD-SECRET-42";
  const access = service.startAccess({ duration: 300, confirmed: true });
  const written = await service.handle("write-clipboard", {
    text: secret,
    accessToken: access.session.token,
  });
  assert.equal(written.result.content, secret);

  const read = await service.handle("read-clipboard", {
    accessToken: access.session.token,
  });
  assert.match(read.result.content, /CLIPBOARD-SECRET/);

  const ledger = service.listReceipts(20);
  assert.ok(!JSON.stringify(ledger).includes("CLIPBOARD-SECRET"));
  for (const entry of ledger.receipts.filter((r) =>
    r.tool.includes("clipboard"),
  )) {
    assert.equal(entry.result.content, undefined);
    assert.match(entry.result.contentSha256, /^[a-f0-9]{64}$/);
  }
  assert.equal(ledger.integrity.intact, true);
  service.closeLedger();
});

test("high-impact power actions require a typed confirmation", async () => {
  const service = open();
  service.activateLicense({ key: proKey() });
  const access = service.startAccess({ duration: 300, confirmed: true });
  for (const action of ["restart", "shutdown"]) {
    await assert.rejects(
      service.handle("system-power", {
        action,
        accessToken: access.session.token,
      }),
      new RegExp(`Type ${action.toUpperCase()}`),
    );
    await assert.rejects(
      service.handle("system-power", {
        action,
        confirmation: "yes",
        accessToken: access.session.token,
      }),
      new RegExp(`Type ${action.toUpperCase()}`),
    );
  }
  // Unknown actions are refused outright.
  await assert.rejects(
    service.handle("system-power", {
      action: "self-destruct",
      accessToken: access.session.token,
    }),
    /Choose sleep/,
  );
  // And All Access is mandatory even for a sleep.
  await assert.rejects(
    service.handle("system-power", { action: "sleep" }),
    /All Access/,
  );
  service.closeLedger();
});

test("screen capture refuses to overwrite and requires All Access", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "raimosa-shot-"));
  await fs.writeFile(path.join(root, "taken.png"), "not really a png");
  const service = open();
  service.activateLicense({ key: proKey() });
  await assert.rejects(
    service.handle("capture-screen", { root, name: "x" }),
    /All Access/,
  );
  const access = service.startAccess({ duration: 300, confirmed: true });
  await assert.rejects(
    service.handle("capture-screen", {
      root,
      name: "taken",
      accessToken: access.session.token,
    }),
    /already exists/,
  );
  service.closeLedger();
});

test("every new capability is registered and governed by the server", async () => {
  for (const id of [
    "network-status",
    "compare-folders",
    "clipboard",
    "screen-capture",
    "system-power",
  ]) {
    const entry = capabilityCatalog.find((item) => item.id === id);
    assert.ok(entry, `${id} missing from the catalog`);
    if (entry.status === "available") assert.ok(entry.adapter);
  }
  // Placeholders that still have no adapter must stay unavailable.
  for (const id of ["model-reasoning", "agent-command-bridge"]) {
    const entry = capabilityCatalog.find((item) => item.id === id);
    assert.equal(entry.status, "unavailable");
    assert.equal(entry.adapter, null);
  }
});

test("the native macOS shell is a real bundle that owns its runtime", async () => {
  const swift = await fs.readFile(
    path.join(repoRoot, "native/macos/RAIMOSA.swift"),
    "utf8",
  );
  // It must terminate the child runtime, or an orphan would keep authority
  // alive after the window closed.
  assert.match(swift, /applicationWillTerminate/);
  assert.match(swift, /stopRuntime/);
  assert.match(swift, /SIGKILL/);
  // It must wait for a real health response before showing the interface.
  assert.match(swift, /api\/raimosa\/health/);
  assert.match(swift, /webView\.isHidden = false/);

  const build = await fs.readFile(
    path.join(repoRoot, "native/macos/build.sh"),
    "utf8",
  );
  assert.match(build, /swiftc/);
  assert.match(build, /CFBundleIdentifier/);
  assert.match(build, /com\.econteur\.raimosa/);
});
