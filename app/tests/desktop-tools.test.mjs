import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDesktopToolService } from "../server/desktop-tools.mjs";
import { proKey } from "./helpers.mjs";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "raimosa-tools-"));
  await fs.writeFile(path.join(root, "brief.txt"), "RAIMOSA launch brief");
  await fs.writeFile(
    path.join(root, "status.csv"),
    "name,status\nadapter,online\n",
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test("read-only tools inspect only an approved specific folder", async (t) => {
  const service = createDesktopToolService({ ledgerFile: ":memory:" });
  const root = await fixture(t);
  const found = await service.handle("find-files", { root, query: "launch" });
  assert.equal(found.verified, true);
  assert.equal(found.result.count, 1);
  assert.equal(found.result.files[0].path, "brief.txt");

  const summary = await service.handle("summarize-folder", { root });
  assert.equal(summary.result.files, 2);
  await assert.rejects(
    service.handle("summarize-folder", { root: os.homedir() }),
    /specific folder/,
  );
});

test("write tools require live All Access and never overwrite", async (t) => {
  const service = createDesktopToolService({ ledgerFile: ":memory:" });
  const root = await fixture(t);
  await assert.rejects(
    service.handle("create-work-product", {
      root,
      name: "report",
      format: "markdown",
      content: "Ready",
    }),
    /All Access/,
  );

  const access = service.startAccess({
    duration: 300,
    confirmed: true,
  }).session;
  const created = await service.handle("create-work-product", {
    root,
    name: "report",
    format: "markdown",
    content: "Ready",
    accessToken: access.token,
  });
  assert.equal(created.result.path, "report.md");
  await assert.rejects(
    service.handle("create-work-product", {
      root,
      name: "report",
      format: "markdown",
      content: "Replace",
      accessToken: access.token,
    }),
    /exist/i,
  );
  service.endAccess({ token: access.token });
  await assert.rejects(
    service.handle("local-notification", { message: "blocked" }),
    /All Access/,
  );
});

test("file organization is exact, approval-bound, reversible in design, and deletion-free", async (t) => {
  const service = createDesktopToolService({ ledgerFile: ":memory:" });
  const root = await fixture(t);
  const plan = await service.handle("plan-organization", { root });
  assert.equal(plan.result.deletions, 0);
  assert.equal(plan.result.operations.length, 2);

  const access = service.startAccess({
    duration: 300,
    confirmed: true,
  }).session;
  await assert.rejects(
    service.handle("execute-organization", {
      approvalId: plan.result.approvalId,
      confirmation: "YES",
      accessToken: access.token,
    }),
    /MOVE/,
  );

  const result = await service.handle("execute-organization", {
    approvalId: plan.result.approvalId,
    confirmation: "MOVE",
    accessToken: access.token,
  });
  assert.equal(result.result.moved, 2);
  assert.equal(result.result.deletions, 0);
  assert.ok(
    (
      await fs.stat(
        path.join(root, "RAIMOSA Organized", "Documents", "brief.txt"),
      )
    ).isFile(),
  );
  assert.ok(
    (
      await fs.stat(
        path.join(root, "RAIMOSA Organized", "Spreadsheets", "status.csv"),
      )
    ).isFile(),
  );
});

test("mobile remote pairing inherits only the active revocable desktop session", async (t) => {
  const service = createDesktopToolService({ ledgerFile: ":memory:" });
  service.activateLicense({ key: proKey() });
  const root = await fixture(t);
  const access = service.startAccess({
    duration: 300,
    confirmed: true,
  }).session;
  const pairing = service.startRemotePairing({
    accessToken: access.token,
    port: 4173,
  }).pairing;
  assert.match(pairing.code, /^\d{6}$/);

  const remote = service.pairRemote({ code: pairing.code }).session;
  const receipt = await service.handle(
    "summarize-folder",
    { root },
    { remoteToken: remote.token },
  );
  assert.equal(receipt.result.files, 2);
  await assert.rejects(
    service.handle("execute-organization", {}, { remoteToken: remote.token }),
    /not available from the mobile remote/,
  );

  service.endAccess({ token: access.token });
  await assert.rejects(
    service.handle("process-status", {}, { remoteToken: remote.token }),
    /expired or revoked/,
  );
});

test("folder snapshots detect evidence changes", async (t) => {
  const service = createDesktopToolService({ ledgerFile: ":memory:" });
  const root = await fixture(t);
  const first = await service.handle("folder-snapshot", { root });
  await fs.writeFile(path.join(root, "new.md"), "new evidence");
  const second = await service.handle("folder-snapshot", { root });
  assert.notEqual(first.result.fingerprint, second.result.fingerprint);
  assert.equal(second.result.files, first.result.files + 1);
});

test("live health scans and every adapter call appear in the runtime ledger", async (t) => {
  const service = createDesktopToolService({ ledgerFile: ":memory:" });
  const root = await fixture(t);

  const scan = await service.scanRuntime();
  assert.equal(scan.tool, "raimosa-health-scan");
  assert.equal(scan.verified, true);
  assert.ok(scan.result.checks.length >= 4);

  const summary = await service.handle("summarize-folder", { root });
  const ledger = service.listReceipts();
  assert.equal(ledger.ok, true);
  assert.equal(ledger.receipts[0].id, summary.id);
  assert.ok(
    ledger.receipts.some((item) => item.id === scan.id),
    "health-scan receipt should persist across later calls",
  );
});

test("authority receipts are logged without access or pairing secrets", () => {
  const service = createDesktopToolService({ ledgerFile: ":memory:" });
  service.activateLicense({ key: proKey() });
  const access = service.startAccess({
    duration: 300,
    confirmed: true,
  }).session;
  const pairing = service.startRemotePairing({
    accessToken: access.token,
    port: 4173,
  }).pairing;
  service.pairRemote({ code: pairing.code });
  service.endAccess({ token: access.token });

  const ledger = service.listReceipts(100);
  assert.ok(ledger.receipts.some((item) => item.tool === "access-start"));
  assert.ok(ledger.receipts.some((item) => item.tool === "remote-paired"));
  assert.ok(ledger.receipts.some((item) => item.tool === "access-end"));
  const serialized = JSON.stringify(ledger.receipts);
  assert.equal(serialized.includes(access.token), false);
  assert.equal(serialized.includes(pairing.code), false);
});

test("agent runtime monitoring is read-only and does not expose private agent state", async () => {
  const service = createDesktopToolService({ ledgerFile: ":memory:" });
  const result = await service.handle("agent-runtime-monitor");
  assert.equal(result.tool, "agent-runtime-monitor");
  assert.equal(result.verified, true);
  assert.ok(Array.isArray(result.result.agents));
  assert.ok(result.result.agents.some((agent) => agent.id === "codex"));
  assert.match(result.result.privacy, /not read/i);
  assert.equal(JSON.stringify(result).includes("transcriptContent"), false);
});
