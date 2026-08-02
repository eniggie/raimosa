import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createLedger } from "../server/ledger.mjs";
import { createDesktopToolService } from "../server/desktop-tools.mjs";

async function tempLedgerFile(name) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `raimosa-${name}-`));
  return path.join(dir, "ledger.db");
}

function sampleReceipt(id, tool = "find-files") {
  return {
    id,
    tool,
    scope: "/approved/workspace",
    timestamp: new Date().toISOString(),
    verified: true,
    result: { matches: 2 },
  };
}

test("receipts survive a full runtime restart", async () => {
  const file = await tempLedgerFile("durable");

  const first = createLedger(file);
  first.append(sampleReceipt("RC-AAAA1111"));
  first.append(sampleReceipt("RC-BBBB2222", "raimosa-health-scan"));
  first.close();

  const reopened = createLedger(file);
  const receipts = reopened.list();
  assert.equal(reopened.count(), 2);
  assert.deepEqual(
    receipts.map((entry) => entry.id),
    ["RC-BBBB2222", "RC-AAAA1111"],
  );
  assert.deepEqual(receipts[1].result, { matches: 2 });
  assert.equal(reopened.verify().intact, true);
  reopened.close();
});

test("the ledger is append-only at the database level", async () => {
  const file = await tempLedgerFile("append-only");
  const ledger = createLedger(file);
  ledger.append(sampleReceipt("RC-CCCC3333"));
  ledger.close();

  // A direct writer with full database access still cannot rewrite history.
  const raw = new DatabaseSync(file);
  assert.throws(
    () => raw.exec("UPDATE receipts SET tool = 'forged'"),
    /append-only/,
  );
  assert.throws(() => raw.exec("DELETE FROM receipts"), /append-only/);
  raw.close();

  const reopened = createLedger(file);
  assert.equal(reopened.list()[0].tool, "find-files");
  reopened.close();
});

test("tampering with a stored receipt is detected and located", async () => {
  const file = await tempLedgerFile("tamper");
  const ledger = createLedger(file);
  ledger.append(sampleReceipt("RC-DDDD4444"));
  ledger.append(sampleReceipt("RC-EEEE5555", "execute-organization"));
  ledger.append(sampleReceipt("RC-FFFF6666"));
  ledger.close();

  // Simulate an attacker who can disable the triggers and edit the file.
  const raw = new DatabaseSync(file);
  raw.exec("DROP TRIGGER receipts_are_append_only_update");
  raw.exec(
    "UPDATE receipts SET result = '{\"matches\":999}' WHERE id = 'RC-EEEE5555'",
  );
  raw.close();

  const reopened = createLedger(file);
  const integrity = reopened.verify();
  assert.equal(integrity.intact, false);
  assert.equal(integrity.brokenAt, "RC-EEEE5555");
  assert.match(integrity.reason, /does not match its recorded hash/);
  reopened.close();
});

test("removing a receipt breaks the chain rather than passing silently", async () => {
  const file = await tempLedgerFile("deletion");
  const ledger = createLedger(file);
  ledger.append(sampleReceipt("RC-1111AAAA"));
  ledger.append(sampleReceipt("RC-2222BBBB", "execute-organization"));
  ledger.append(sampleReceipt("RC-3333CCCC"));
  ledger.close();

  const raw = new DatabaseSync(file);
  raw.exec("DROP TRIGGER receipts_are_append_only_delete");
  raw.exec("DELETE FROM receipts WHERE id = 'RC-2222BBBB'");
  raw.close();

  const reopened = createLedger(file);
  const integrity = reopened.verify();
  assert.equal(integrity.intact, false);
  assert.equal(integrity.brokenAt, "RC-3333CCCC");
  assert.match(integrity.reason, /does not follow the previous receipt/);
  reopened.close();
});

test("adapter receipts written by the service persist across service restarts", async () => {
  const file = await tempLedgerFile("service");

  const first = createDesktopToolService({ ledgerFile: file });
  await first.scanRuntime();
  const beforeRestart = first.listReceipts();
  assert.equal(beforeRestart.durable, true);
  assert.ok(beforeRestart.count >= 1);
  first.closeLedger();

  const second = createDesktopToolService({ ledgerFile: file });
  const afterRestart = second.listReceipts();
  assert.equal(afterRestart.count, beforeRestart.count);
  assert.equal(afterRestart.receipts[0].tool, "raimosa-health-scan");
  assert.equal(afterRestart.integrity.intact, true);
  second.closeLedger();
});

test("the health scan reports ledger durability and integrity as real checks", async () => {
  const file = await tempLedgerFile("scan");
  const service = createDesktopToolService({ ledgerFile: file });
  const scan = await service.scanRuntime();
  const checks = new Map(scan.result.checks.map((c) => [c.id, c]));

  assert.equal(checks.get("ledger.durability").status, "pass");
  assert.equal(checks.get("ledger.integrity").status, "pass");
  assert.match(checks.get("ledger.integrity").detail, /unbroken hash chain/);
  service.closeLedger();

  // An in-memory ledger must fail the durability check rather than claim it.
  const volatile = createDesktopToolService({ ledgerFile: ":memory:" });
  const volatileScan = await volatile.scanRuntime();
  const volatileChecks = new Map(
    volatileScan.result.checks.map((c) => [c.id, c]),
  );
  assert.equal(volatileChecks.get("ledger.durability").status, "fail");
  assert.ok(
    volatileScan.result.findings.some((f) => f.id === "ledger-not-durable"),
  );
  volatile.closeLedger();
});
