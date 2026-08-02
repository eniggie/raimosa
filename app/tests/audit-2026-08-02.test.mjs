import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDesktopToolService } from "../server/desktop-tools.mjs";
import { planCommand } from "../server/ovia-core.mjs";

async function workspace(name) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `raimosa-${name}-`));
  return {
    root: dir,
    ledgerFile: path.join(dir, ".raimosa", "ledger.db"),
    stateFile: path.join(dir, ".raimosa", "state.db"),
  };
}

function open(paths) {
  return createDesktopToolService({
    ledgerFile: paths.ledgerFile,
    stateFile: paths.stateFile,
  });
}

test("emergency stop is a server-side latch that blocks every dispatch", async () => {
  const paths = await workspace("latch");
  await fs.writeFile(path.join(paths.root, "notes.md"), "# notes\n");
  const service = open(paths);

  const access = service.startAccess({ duration: 300, confirmed: true });
  const stopped = service.emergencyStop();
  assert.equal(stopped.latched, true);

  // Every dispatch path is refused at the server, not just in the UI.
  await assert.rejects(
    service.handle("find-files", { root: paths.root, query: "" }),
    /Emergency stop is active/,
  );
  assert.throws(
    () => service.startAccess({ duration: 300, confirmed: true }),
    /Emergency stop is active/,
  );
  assert.throws(
    () => service.startRemotePairing({ accessToken: access.session.token }),
    /Emergency stop is active/,
  );

  // All authority was revoked by the stop itself.
  assert.equal(service.accessStatus(access.session.token).active, false);

  // The stop and its effects are receipts in the hash-chained ledger.
  const receipts = service.listReceipts(100).receipts;
  const stopReceipt = receipts.find((entry) => entry.tool === "emergency-stop");
  assert.ok(stopReceipt);
  assert.equal(stopReceipt.result.state, "latched");
  service.closeLedger();
});

test("the emergency latch survives a restart and must be cleared explicitly", async () => {
  const paths = await workspace("latch-restart");
  const first = open(paths);
  first.emergencyStop();
  first.closeLedger();

  const second = open(paths);
  assert.equal(second.emergencyStatus().latched, true);
  await assert.rejects(
    second.handle("find-files", { root: paths.root, query: "" }),
    /Emergency stop is active/,
  );

  const cleared = second.emergencyClear();
  assert.equal(cleared.latched, false);
  const result = await second.handle("find-files", {
    root: paths.root,
    query: "",
  });
  assert.equal(result.tool, "find-files");
  const clearReceipt = second
    .listReceipts(100)
    .receipts.find((entry) => entry.tool === "emergency-clear");
  assert.ok(clearReceipt);
  second.closeLedger();
});

test("the health scan fails while the emergency latch is active", async () => {
  const paths = await workspace("latch-scan");
  const service = open(paths);
  service.emergencyStop();
  const scan = await service.scanRuntime();
  const check = scan.result.checks.find(
    (item) => item.id === "authority.emergency-latch",
  );
  assert.equal(check.status, "fail");
  assert.ok(
    scan.result.findings.some((item) => item.id === "emergency-stop-latched"),
  );
  assert.equal(scan.result.status, "attention");
  service.closeLedger();
});

test("a paired remote can still run control tools under live All Access", async () => {
  const paths = await workspace("remote-control");
  const service = open(paths);
  const access = service.startAccess({ duration: 300, confirmed: true });
  const pairing = service.startRemotePairing({
    accessToken: access.session.token,
  });
  const remote = service.pairRemote({ code: pairing.pairing.code });

  // Control tool from the remote: authorised through the stored hash, no raw
  // desktop token in the payload. Notification adapter is macOS-gated, so use
  // open-document — it requires All Access and a real file.
  await fs.writeFile(path.join(paths.root, "brief.txt"), "hello\n");
  if (process.platform === "darwin") {
    const result = await service.handle(
      "open-document",
      { root: paths.root, path: "brief.txt" },
      { remoteToken: remote.session.token },
    );
    assert.equal(result.result.state, "open-request-accepted");
  }

  // After access ends, the same remote control call must fail.
  service.endAccess({ token: access.session.token });
  await assert.rejects(
    service.handle(
      "open-document",
      { root: paths.root, path: "brief.txt" },
      { remoteToken: remote.session.token },
    ),
    /expired or revoked|All Access/,
  );
  service.closeLedger();
});

test("repeated failed pairing attempts revoke every outstanding code", async () => {
  const paths = await workspace("pair-lockout");
  const service = open(paths);
  const access = service.startAccess({ duration: 300, confirmed: true });
  const pairing = service.startRemotePairing({
    accessToken: access.session.token,
  });

  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.throws(
      () => service.pairRemote({ code: "000000" }),
      /invalid or expired/,
    );
  }

  // The lockout revoked the real code too and recorded the event.
  assert.throws(
    () => service.pairRemote({ code: pairing.pairing.code }),
    /invalid or expired/,
  );
  const lockout = service
    .listReceipts(100)
    .receipts.find((entry) => entry.tool === "remote-pairing-lockout");
  assert.ok(lockout);
  assert.equal(lockout.result.state, "all-pairing-codes-revoked");
  service.closeLedger();
});

test("an unrecognized command yields an honest no-match plan, not find-files", () => {
  const plan = planCommand("zzqx blorp nothing meaningful");
  assert.equal(plan.decision, "clarification-needed");
  assert.equal(plan.capabilityId, null);
  assert.equal(plan.adapter, null);
  assert.equal(plan.available, false);
  // A matched command still plans normally.
  const matched = planCommand("organize my downloads folder");
  assert.equal(matched.capabilityId, "organize-files");
  assert.equal(matched.decision, "approval-required");
});

test("hidden folders cannot be approved as adapter roots", async () => {
  const paths = await workspace("hidden-root");
  const hidden = path.join(paths.root, ".secrets");
  await fs.mkdir(hidden, { recursive: true });
  await fs.writeFile(path.join(hidden, "key.txt"), "private\n");
  const service = open(paths);
  await assert.rejects(
    service.handle("find-files", { root: hidden, query: "" }),
    /Hidden folders/,
  );
  // The visible parent still works.
  const ok = await service.handle("find-files", {
    root: paths.root,
    query: "",
  });
  assert.equal(ok.tool, "find-files");
  service.closeLedger();
});
