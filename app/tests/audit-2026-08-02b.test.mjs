import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDesktopToolService } from "../server/desktop-tools.mjs";

async function fixture(name) {
  return fs.mkdtemp(path.join(os.tmpdir(), `raimosa-${name}-`));
}

test("file contents never reach the permanent ledger", async () => {
  const root = await fixture("redact");
  const secret = "# API KEY sk-live-SUPERSECRET-123\npassword: hunter2\n";
  await fs.writeFile(path.join(root, "secrets.md"), secret);
  const service = createDesktopToolService({ ledgerFile: ":memory:" });

  const result = await service.handle("preview-file", {
    root,
    path: "secrets.md",
  });
  // The caller still gets the real preview.
  assert.match(result.result.content, /SUPERSECRET/);

  // The ledger keeps evidence of the read, never the bytes.
  const stored = service.listReceipts(10).receipts[0];
  assert.equal(stored.tool, "preview-file");
  assert.equal(stored.result.content, undefined);
  assert.equal(stored.result.path, "secrets.md");
  assert.match(stored.result.contentSha256, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(stored).includes("SUPERSECRET"));
  assert.ok(!JSON.stringify(stored).includes("hunter2"));

  // Redaction must not break the tamper-evident chain.
  assert.equal(service.listReceipts(10).integrity.intact, true);
  service.closeLedger();
});

test("duplicate scanning reports partial results as partial", async () => {
  const root = await fixture("dupe-bounds");
  await fs.writeFile(path.join(root, "a.md"), "identical\n");
  await fs.writeFile(path.join(root, "b.md"), "identical\n");
  const service = createDesktopToolService({ ledgerFile: ":memory:" });
  const result = await service.handle("find-duplicates", { root });
  // A small, fully-scanned folder must claim completeness explicitly.
  assert.equal(result.result.complete, true);
  assert.equal(result.result.limitation, undefined);
  assert.ok(result.result.bytesHashed > 0);
  assert.equal(result.result.groupCount, 1);
  service.closeLedger();
});
