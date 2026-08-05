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
  // system-power has a verified adapter now; what must stay true is that it
  // carries its real risk class rather than being quietly downgraded.
  const power = capabilityCatalog.find((item) => item.id === "system-power");
  assert.equal(power.risk, "high-impact");
  if (power.status === "available") assert.ok(power.adapter);
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

  // system-power now has a verified adapter, so it plans — but as a
  // high-impact action that can never run without explicit approval.
  const power = planCommand("shut down the desktop");
  assert.equal(power.capabilityId, "system-power");
  assert.equal(power.decision, "approval-required");
  assert.equal(power.requiresApproval, true);
  assert.equal(power.risk, "high-impact");

  const blockedAgent = planCommand("command claude to review this code");
  assert.equal(blockedAgent.capabilityId, "agent-command-bridge");
  assert.equal(blockedAgent.decision, "unavailable");
});
