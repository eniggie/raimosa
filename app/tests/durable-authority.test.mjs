import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDesktopToolService } from "../server/desktop-tools.mjs";
import { createStateStore } from "../server/state-store.mjs";

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

test("an approved plan survives a restart and stays bound to its exact operations", async () => {
  const paths = await workspace("approval-restart");
  await fs.writeFile(path.join(paths.root, "notes.md"), "# notes\n");
  await fs.writeFile(path.join(paths.root, "sheet.csv"), "a,b\n");

  const first = open(paths);
  const plan = await first.handle("plan-organization", { root: paths.root });
  const { approvalId, operations } = plan.result;
  assert.equal(operations.length, 2);
  first.closeLedger();

  // Authority does not survive the restart, so the operator grants a fresh
  // All Access session. The approval itself is still valid and still exact.
  const second = open(paths);
  const access = second.startAccess({ duration: 300, confirmed: true }).session;
  const executed = await second.handle("execute-organization", {
    approvalId,
    confirmation: "MOVE",
    accessToken: access.token,
  });
  assert.equal(executed.result.moved, 2);
  assert.equal(executed.result.deletions, 0);
  assert.ok(
    await fs
      .stat(path.join(paths.root, "RAIMOSA Organized", "Documents", "notes.md"))
      .catch(() => null),
  );
  second.closeLedger();
});

test("an approval is single-use and cannot be replayed into duplicate side effects", async () => {
  const paths = await workspace("single-use");
  await fs.writeFile(path.join(paths.root, "notes.md"), "# notes\n");

  const service = open(paths);
  const plan = await service.handle("plan-organization", { root: paths.root });
  const { approvalId } = plan.result;
  const access = service.startAccess({
    duration: 300,
    confirmed: true,
  }).session;

  await service.handle("execute-organization", {
    approvalId,
    confirmation: "MOVE",
    accessToken: access.token,
  });
  await assert.rejects(
    service.handle("execute-organization", {
      approvalId,
      confirmation: "MOVE",
      accessToken: access.token,
    }),
    /already used|missing or expired/,
  );
  service.closeLedger();
});

test("an approval claimed before a crash cannot run again after restart", async () => {
  const paths = await workspace("crash-claim");
  await fs.writeFile(path.join(paths.root, "notes.md"), "# notes\n");

  const first = open(paths);
  const plan = await first.handle("plan-organization", { root: paths.root });
  const { approvalId } = plan.result;
  first.closeLedger();

  // Simulate the runtime dying after the claim is written but before the moves
  // finish: the claim is already durable, the files are still untouched.
  const store = createStateStore(paths.stateFile);
  assert.equal(store.claimApproval(approvalId), true);
  store.close();

  const second = open(paths);
  const access = second.startAccess({ duration: 300, confirmed: true }).session;
  await assert.rejects(
    second.handle("execute-organization", {
      approvalId,
      confirmation: "MOVE",
      accessToken: access.token,
    }),
    /already used/,
  );
  // The original file was never moved by a replay.
  assert.ok(await fs.stat(path.join(paths.root, "notes.md")).catch(() => null));
  second.closeLedger();
});

test("All Access does not silently survive a runtime restart", async () => {
  const paths = await workspace("access-restart");

  const first = open(paths);
  const started = first.startAccess({ duration: 900, confirmed: true });
  const token = started.session.token;
  assert.equal(first.accessStatus(token).active, true);
  first.closeLedger();

  const second = open(paths);
  assert.equal(
    second.accessStatus(token).active,
    false,
    "authority must not resume after the visible countdown was lost",
  );
  assert.equal(second.recovery.revokedAccessSessions, 1);

  const ledger = second.listReceipts(100);
  const interrupted = ledger.receipts.find(
    (entry) => entry.tool === "access-interrupted",
  );
  assert.ok(interrupted, "the revocation must be recorded, not silent");
  assert.equal(interrupted.result.state, "revoked");
  assert.equal(ledger.integrity.intact, true);
  second.closeLedger();
});

test("a paired mobile remote dies with the runtime that authorised it", async () => {
  const paths = await workspace("remote-restart");

  const first = open(paths);
  const access = first.startAccess({ duration: 900, confirmed: true });
  const pairing = first.startRemotePairing({
    accessToken: access.session.token,
  });
  const remote = first.pairRemote({ code: pairing.pairing.code });
  assert.equal(first.remoteStatus(remote.session.token).active, true);
  first.closeLedger();

  const second = open(paths);
  assert.equal(second.remoteStatus(remote.session.token).active, false);
  // The pairing code must not be reusable either.
  assert.throws(
    () => second.pairRemote({ code: pairing.pairing.code }),
    /invalid or expired/,
  );
  second.closeLedger();
});

test("the durable state file never stores a usable credential", async () => {
  const paths = await workspace("no-secrets");

  const service = open(paths);
  const access = service.startAccess({ duration: 900, confirmed: true });
  const pairing = service.startRemotePairing({
    accessToken: access.session.token,
  });
  const remote = service.pairRemote({ code: pairing.pairing.code });
  service.closeLedger();

  const bytes = await fs.readFile(paths.stateFile, "latin1");
  for (const secret of [
    access.session.token,
    remote.session.token,
    pairing.pairing.code,
  ]) {
    assert.ok(
      !bytes.includes(secret),
      `the state file must not contain the raw secret ${secret.slice(0, 6)}…`,
    );
  }

  const ledgerBytes = await fs.readFile(paths.ledgerFile, "latin1");
  assert.ok(!ledgerBytes.includes(access.session.token));
  assert.ok(!ledgerBytes.includes(pairing.pairing.code));
});

test("the health scan reports durable authority state and crash recovery", async () => {
  const paths = await workspace("scan-authority");

  const first = open(paths);
  first.startAccess({ duration: 900, confirmed: true });
  first.closeLedger();

  const second = open(paths);
  const scan = await second.scanRuntime();
  const checks = new Map(scan.result.checks.map((c) => [c.id, c]));
  assert.equal(checks.get("authority.durable-state").status, "pass");
  assert.equal(checks.get("authority.crash-recovery").status, "pass");
  assert.match(
    checks.get("authority.crash-recovery").detail,
    /revoked, not resumed/,
  );
  second.closeLedger();
});
