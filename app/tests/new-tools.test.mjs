import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDesktopToolService } from "../server/desktop-tools.mjs";
import { capabilityCatalog } from "../server/ovia-core.mjs";

async function fixture(name) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `raimosa-${name}-`));
  return dir;
}

function open() {
  return createDesktopToolService({ ledgerFile: ":memory:" });
}

test("storage insights report largest files and bytes by category", async () => {
  const root = await fixture("storage");
  await fs.writeFile(path.join(root, "big.csv"), "x".repeat(5000));
  await fs.writeFile(path.join(root, "small.md"), "# tiny\n");
  const service = open();
  const result = await service.handle("storage-insights", { root });
  assert.equal(result.result.files, 2);
  assert.equal(result.result.largest[0].path, "big.csv");
  const categories = new Map(result.result.byCategory);
  assert.equal(categories.get("Spreadsheets"), 5000);
  service.closeLedger();
});

test("duplicate detection matches content hashes, not names or sizes alone", async () => {
  const root = await fixture("dupes");
  // Same size, different content: NOT duplicates.
  await fs.writeFile(path.join(root, "a.txt"), "aaaaaaaa");
  await fs.writeFile(path.join(root, "b.txt"), "bbbbbbbb");
  // Identical content under different names: duplicates.
  await fs.writeFile(path.join(root, "report.md"), "# identical body\n");
  await fs.mkdir(path.join(root, "archive"));
  await fs.writeFile(path.join(root, "archive", "copy.md"), "# identical body\n");
  const service = open();
  const result = await service.handle("find-duplicates", { root });
  assert.equal(result.result.groupCount, 1);
  const [group] = result.result.duplicateGroups;
  assert.deepEqual(group.paths.sort(), ["archive/copy.md", "report.md"]);
  assert.equal(result.result.wastedBytes, group.size);
  service.closeLedger();
});

test("file preview is bounded, text-only, and scope-contained", async () => {
  const root = await fixture("preview");
  await fs.writeFile(path.join(root, "notes.md"), "# hello preview\n");
  await fs.writeFile(path.join(root, "blob.bin"), Buffer.from([0, 1, 2]));
  const service = open();

  const ok = await service.handle("preview-file", { root, path: "notes.md" });
  assert.match(ok.result.content, /hello preview/);
  assert.equal(ok.result.truncated, false);

  await assert.rejects(
    service.handle("preview-file", { root, path: "blob.bin" }),
    /text files only/,
  );
  await assert.rejects(
    service.handle("preview-file", { root, path: "../outside.md" }),
    /leaves the approved folder|ENOENT|no such file/i,
  );
  service.closeLedger();
});

test("device vitals report real load, memory, and uptime figures", async () => {
  const service = open();
  const result = await service.handle("device-vitals", {});
  const vitals = result.result;
  assert.equal(vitals.platform, process.platform);
  assert.ok(vitals.cpu.cores >= 1);
  assert.ok(vitals.memory.totalBytes > 0);
  assert.ok(vitals.memory.usedPercent > 0 && vitals.memory.usedPercent < 100);
  assert.ok(vitals.uptimeSeconds > 0);
  if (vitals.disk) assert.ok(vitals.disk.totalBytes > 0);
  service.closeLedger();
});

test("every new capability is registered with a named adapter", () => {
  for (const id of [
    "storage-insights",
    "find-duplicates",
    "preview-file",
    "device-vitals",
  ]) {
    const entry = capabilityCatalog.find((item) => item.id === id);
    assert.ok(entry, `${id} missing from the catalog`);
    assert.equal(entry.status, "available");
    assert.equal(entry.risk, "read-only");
    assert.ok(entry.adapter);
  }
});
