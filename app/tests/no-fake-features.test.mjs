import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { planCommand, capabilityCatalog } from "../server/ovia-core.mjs";

const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const read = (rel) => readFileSync(path.join(appRoot, rel), "utf8");

// RAIMOSA ships as a paid product. A control that renders but does nothing, or
// a record that is fabricated, is the one thing the product cannot contain.
test("the interface ships no prototype or sample-data surfaces", () => {
  const app = read("src/App.jsx");
  assert.ok(
    !app.includes("PrototypeNotice"),
    "the prototype banner (and the fake screens it labelled) must be gone",
  );
  // The fake mission ledger's fabricated identifiers.
  for (const fabricated of ["RC-0184", "AP-0017-V2", "FD-0042", "9:12 AM"]) {
    assert.ok(
      !app.includes(fabricated),
      `fabricated record ${fabricated} must not be rendered as evidence`,
    );
  }
  // setTimeout-driven fake progress.
  assert.ok(
    !/setTimeout\([^)]*\n?[^)]*setPlans/.test(app),
    "simulated progress must not stand in for a real adapter call",
  );
});

test("every navigation entry resolves to a real view", () => {
  const app = read("src/App.jsx");
  const navBlock = app.slice(app.indexOf("const nav = ["));
  const labels = [
    ...navBlock.slice(0, navBlock.indexOf("];")).matchAll(/\["([^"]+)"/g),
  ].map((m) => m[1]);
  assert.ok(labels.length > 0);
  for (const label of labels) {
    assert.ok(
      app.includes(`active === "${label}"`),
      `nav entry ${label} must route to a real view`,
    );
  }
  // The removed prototype sections must not come back as nav entries.
  assert.ok(!labels.includes("Missions"));
  assert.ok(!labels.includes("Workflows"));
});

test("settings only expose switches that change behaviour", () => {
  const app = read("src/App.jsx");
  const start = app.indexOf("function SettingsView(");
  const body = app.slice(start, app.indexOf("function ", start + 10));
  for (const dead of ["notifications", "receipts"]) {
    assert.ok(
      !body.includes(`"${dead}"`),
      `settings row "${dead}" is read by nothing and must not render a switch`,
    );
  }
  assert.ok(body.includes('"motion"'), "reduced motion genuinely applies");
});

test("emergency stop reports what the server actually revoked", () => {
  const app = read("src/App.jsx");
  const tools = read("server/desktop-tools.mjs");
  assert.ok(
    tools.includes("revoked: {"),
    "the server must report the sessions it revoked",
  );
  assert.ok(
    app.includes("revoked.accessSessions"),
    "the recovery list must render the server's numbers, not a static checklist",
  );
});

// A capability must never advertise itself on a platform whose adapter cannot
// run — the registry is the authority, so the gate belongs there.
test("agent-runtime-monitor is not advertised on Windows", () => {
  const core = read("server/ovia-core.mjs");
  const entry = core.slice(core.indexOf('id: "agent-runtime-monitor"'));
  const block = entry.slice(0, entry.indexOf("},"));
  assert.ok(
    !block.includes('status: "available"'),
    "it shells out to /bin/ps and /usr/bin/which; it must be platform-gated",
  );
  assert.ok(block.includes("desktopStatus("));
});

test("no capability description promises a platform its gate refuses", () => {
  const apps = capabilityCatalog.find((c) => c.id === "applications");
  assert.ok(apps);
  assert.ok(
    !/linux/i.test(apps.description),
    "the applications gate refuses Linux, so its description must not offer it",
  );
});

// Intent matching must not fire on a substring buried inside another word.
test("intent matching uses whole words, not bare substrings", () => {
  const sleepBetter = planCommand("how do I sleep better at night");
  assert.notEqual(
    sleepBetter.capabilityId,
    "system-power",
    '"sleep better" must not select the high-impact power capability',
  );
  // And the real intent still works.
  assert.equal(
    planCommand("put the computer to sleep").capabilityId,
    "system-power",
  );
  assert.equal(planCommand("find my invoice files").capabilityId, "find-files");
  // Unrecognized input still fails closed.
  assert.equal(planCommand("xyzzy plugh").decision, "clarification-needed");
});
