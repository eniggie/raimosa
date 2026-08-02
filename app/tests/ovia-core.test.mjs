import assert from "node:assert/strict";
import test from "node:test";
import { capabilityCatalog, planCommand } from "../server/ovia-core.mjs";

test("the capability catalog exposes only implemented controls as available", () => {
  const available = capabilityCatalog
    .filter((item) => item.status === "available")
    .map((item) => item.id);
  assert.ok(available.includes("find-files"));
  assert.ok(available.includes("mobile-remote"));
  assert.ok(available.includes("agent-runtime-monitor"));
  assert.equal(
    capabilityCatalog.find((item) => item.id === "system-power").status,
    "unavailable",
  );
  assert.equal(
    capabilityCatalog.find((item) => item.id === "model-reasoning").status,
    "unavailable",
  );
  assert.equal(
    capabilityCatalog.find((item) => item.id === "agent-command-bridge").status,
    "unavailable",
  );
});

test("OVIA AI Core compiles read-only and blocked plans honestly", () => {
  const readOnly = planCommand("summarize this folder", {
    root: "/tmp/example",
  });
  assert.equal(readOnly.capabilityId, "summarize-folder");
  assert.equal(readOnly.decision, "ready-read-only");
  assert.equal(readOnly.requiresApproval, false);

  const blocked = planCommand("shut down the desktop");
  assert.equal(blocked.capabilityId, "system-power");
  assert.equal(blocked.decision, "unavailable");
  assert.equal(blocked.available, false);

  const blockedAgent = planCommand("command claude to review this code");
  assert.equal(blockedAgent.capabilityId, "agent-command-bridge");
  assert.equal(blockedAgent.decision, "unavailable");
});
