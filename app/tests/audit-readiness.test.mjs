import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDesktopToolService } from "../server/desktop-tools.mjs";
import { capabilityCatalog } from "../server/ovia-core.mjs";
import { startRaimosa } from "../server/standalone.mjs";

function open() {
  return createDesktopToolService({ ledgerFile: ":memory:" });
}

test("the capability registry is enforced by the server, not only the UI", async () => {
  const service = open();
  // Find a capability the catalog marks unavailable on this platform, and a
  // tool governed by it. Calling that route directly must be refused.
  const unavailable = capabilityCatalog.filter(
    (item) => item.status !== "available",
  );
  assert.ok(unavailable.length > 0, "fixture needs an unavailable capability");

  const access = service.startAccess({ duration: 300, confirmed: true });
  if (process.platform !== "darwin" && process.platform !== "win32") {
    // On Linux 'applications' is unavailable: launching must be refused even
    // with live All Access, because no verified adapter exists here.
    await assert.rejects(
      service.handle("launch-application", {
        appPath: "/usr/share/applications/firefox.desktop",
        accessToken: access.session.token,
      }),
      /no verified adapter/,
    );
  }
  // A capability that IS available still runs.
  const vitals = await service.handle("device-vitals", {});
  assert.equal(vitals.tool, "device-vitals");
  service.closeLedger();
});

test("every dispatchable tool maps to a real catalog capability", async () => {
  const source = await fs.readFile(
    new URL("../server/desktop-tools.mjs", import.meta.url),
    "utf8",
  );
  const mapBlock = source.slice(
    source.indexOf("const TOOL_CAPABILITY = {"),
    source.indexOf("};", source.indexOf("const TOOL_CAPABILITY = {")),
  );
  const ids = [...mapBlock.matchAll(/:\s*"([a-z-]+)"/g)].map((m) => m[1]);
  assert.ok(ids.length >= 15);
  for (const id of ids) {
    assert.ok(
      capabilityCatalog.some((item) => item.id === id),
      `${id} is not a catalog capability`,
    );
  }
});

test("ledger export carries its own integrity verdict", async () => {
  const service = open();
  await service.handle("device-vitals", {});
  await service.scanRuntime();

  const json = service.exportLedger({ format: "json" });
  assert.equal(json.format, "json");
  assert.match(json.filename, /^raimosa-receipts-\d{4}-\d{2}-\d{2}\.json$/);
  const parsed = JSON.parse(json.content);
  assert.equal(parsed.integrity.intact, true);
  assert.match(parsed.attestation, /unbroken SHA-256 chain/);
  assert.equal(parsed.exportedReceipts, parsed.receipts.length);
  // Oldest first, so the chain reads in order.
  assert.ok(parsed.receipts[0].sequence < parsed.receipts.at(-1).sequence);

  const csv = service.exportLedger({ format: "csv" });
  const [header, ...rows] = csv.content.split("\n");
  assert.equal(header, "sequence,id,tool,scope,timestamp,verified,hash,result");
  assert.equal(rows.length, parsed.receipts.length);

  const filtered = service.exportLedger({ format: "json", tool: "vitals" });
  const filteredParsed = JSON.parse(filtered.content);
  assert.equal(filteredParsed.exportedReceipts, 1);
  assert.equal(filteredParsed.filter, "vitals");
  service.closeLedger();
});

test("exported CSV escapes quotes so a receipt cannot break the columns", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "raimosa-csv-"));
  await fs.writeFile(path.join(root, 'we"ird.md'), "# hi\n");
  const service = open();
  await service.handle("find-files", { root, query: "" });
  const csv = service.exportLedger({ format: "csv" });
  // Every data row must have the same column count as the header.
  const rows = csv.content.split("\n");
  const columns = (line) =>
    (line.match(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/g) ?? []).length;
  const expected = columns(rows[0]);
  for (const row of rows.slice(1)) assert.equal(columns(row), expected);
  service.closeLedger();
});

test("the static server rejects null bytes and never leaves dist", async () => {
  const { server, url } = await startRaimosa({ port: 4296, host: "127.0.0.1" });
  try {
    const nul = await fetch(`${url}/%00/x`);
    assert.equal(nul.status, 400);

    for (const attempt of [
      "/../package.json",
      "/%2e%2e/package.json",
      "/assets/../../server/desktop-tools.mjs",
    ]) {
      const response = await fetch(`${url}${attempt}`);
      const body = await response.text();
      assert.ok(
        !body.includes("createDesktopToolService") &&
          !body.includes("devDependencies"),
        `${attempt} leaked source`,
      );
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
