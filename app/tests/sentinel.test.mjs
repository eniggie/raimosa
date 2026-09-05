import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createDesktopToolService } from "../server/desktop-tools.mjs";
import { TASK_STATUS, HONESTY, LEVEL } from "../server/sentinel.mjs";
import {
  route,
  listProviders,
  registerProvider,
} from "../server/providers.mjs";
import { proKey } from "./helpers.mjs";

async function sandbox(name) {
  const base = path.join(
    os.tmpdir(),
    `raimosa-${name}-${randomUUID().slice(0, 8)}`,
  );
  const home = path.join(base, "home");
  const root = path.join(base, "workspace");
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(root, { recursive: true });
  return {
    base,
    home,
    root,
    ledgerFile: path.join(home, "ledger.db"),
    stateFile: path.join(home, "state.db"),
  };
}
// Every sandbox gets its own ledger and state files. Without this the tests
// share the checkout's durable state — and one test's emergency latch would
// silently block every test after it.
const open = (paths) =>
  createDesktopToolService({
    ledgerFile: paths.ledgerFile,
    stateFile: paths.stateFile,
  });

function gitRepo(dir) {
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync(
    "git",
    [
      "-c",
      "user.email=t@t",
      "-c",
      "user.name=t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "init",
    ],
    { cwd: dir },
  );
}

// The single rule Sentinel exists to enforce.
test("an agent's claim never becomes VERIFIED without Sentinel's own evidence", async () => {
  const paths = await sandbox("claim");
  const service = open(paths);
  const { sentinel } = service;
  const agent = sentinel.registerAgent({ name: "Codex", provider: "codex" });
  const task = sentinel.createTask({
    title: "Auth refactor",
    instruction: "Refactor auth without breaking tests",
    acceptance: ["tests pass"],
    agentId: agent.id,
    root: paths.root,
  });
  assert.equal(task.status, TASK_STATUS.PLANNED);

  const claimed = sentinel.claimComplete(task.id, {
    agentId: agent.id,
    summary: "The application is complete.",
  });
  assert.equal(claimed.status, TASK_STATUS.CLAIMED, "a claim is only a claim");
  assert.notEqual(claimed.status, TASK_STATUS.VERIFIED_COMPLETE);

  // The claim receipt is recorded as evidence-of-a-claim, explicitly unverified.
  const claimReceipt = service
    .listReceipts(50)
    .receipts.find((r) => r.tool === "sentinel-claim");
  assert.ok(claimReceipt);
  assert.equal(claimReceipt.verified, false);
  assert.equal(claimReceipt.result.honesty, HONESTY.UNCERTAIN);
  service.closeLedger();
});

test("the Proof Engine verifies with real checks and derives status from evidence only", async () => {
  const paths = await sandbox("proof");
  gitRepo(paths.root);
  const service = open(paths);
  const { sentinel } = service;
  const agent = sentinel.registerAgent({
    name: "Claude Code",
    provider: "claude",
  });
  const task = sentinel.createTask({
    title: "Docs",
    instruction: "Write docs",
    agentId: agent.id,
    root: paths.root,
  });
  sentinel.claimComplete(task.id, { summary: "done" });

  const verified = await sentinel.verifyTask(task.id, {
    checks: ["git-head", "git-status"],
  });
  assert.equal(verified.status, TASK_STATUS.VERIFIED_COMPLETE);
  const head = verified.verification.checks.find((c) => c.check === "git-head");
  assert.equal(head.honesty, HONESTY.VERIFIED);
  assert.match(
    head.evidence.head,
    /^[0-9a-f]{40}$/,
    "a real commit hash was observed",
  );

  // The verification is a receipt with verified:true because checks ran.
  const receipt = service
    .listReceipts(50)
    .receipts.find((r) => r.id === verified.verification.receiptId);
  assert.equal(receipt.verified, true);
  assert.equal(receipt.result.outcome, TASK_STATUS.VERIFIED_COMPLETE);
  service.closeLedger();
});

test("the Proof Engine only runs its fixed allowlist, never an agent-supplied command", async () => {
  const paths = await sandbox("allow");
  gitRepo(paths.root);
  const service = open(paths);
  const { sentinel } = service;
  const task = sentinel.createTask({
    title: "x",
    instruction: "x",
    root: paths.root,
  });
  const result = await sentinel.verifyTask(task.id, {
    checks: ["rm -rf /", "curl evil", "git-head"],
  });
  const bad = result.verification.checks.filter((c) => !c.ran);
  assert.equal(bad.length, 2);
  for (const c of bad) assert.equal(c.honesty, HONESTY.UNKNOWN);
  // One real check passed, two could not run → not fully verified.
  assert.notEqual(result.status, TASK_STATUS.VERIFIED_COMPLETE);
  assert.equal(result.status, TASK_STATUS.PARTIALLY_COMPLETE);
  service.closeLedger();
});

test("verification is refused inside an unapproved or escaping root", async () => {
  const paths = await sandbox("root");
  const service = open(paths);
  const task = service.sentinel.createTask({
    title: "x",
    instruction: "x",
    root: os.homedir(),
  });
  await assert.rejects(
    () => service.sentinel.verifyTask(task.id),
    /specific folder/,
  );
  service.closeLedger();
});

test("emergency stop pauses every agent and blocks verification", async () => {
  const paths = await sandbox("stop");
  gitRepo(paths.root);
  const service = open(paths);
  const { sentinel } = service;
  const a = sentinel.registerAgent({ name: "A", provider: "codex" });
  const b = sentinel.registerAgent({ name: "B", provider: "claude" });
  const task = sentinel.createTask({
    title: "t",
    instruction: "t",
    agentId: a.id,
    root: paths.root,
  });

  const stop = service.emergencyStop();
  assert.equal(
    stop.revoked.agents,
    2,
    "STOP ALL AGENTS pauses every registered agent",
  );
  const agents = sentinel.listAgents();
  assert.ok(
    agents.every(
      (x) => x.status === "paused" && x.pausedReason === "emergency-stop",
    ),
  );

  const blocked = await sentinel.verifyTask(task.id);
  assert.equal(blocked.status, TASK_STATUS.BLOCKED);
  assert.throws(
    () => sentinel.registerAgent({ name: "C", provider: "x" }),
    /Emergency stop/,
  );
  void b;
  service.closeLedger();
});

test("permission levels: raising a tool is enforced in dispatch, lowering is refused", async () => {
  const paths = await sandbox("levels");
  const service = open(paths);
  const { sentinel } = service;
  await fs.writeFile(path.join(paths.root, "a.txt"), "x");

  // find-files is Level 1 by default and runs freely.
  const before = await service.handle("find-files", {
    root: paths.root,
    query: "a",
  });
  assert.equal(before.result.count, 1);

  // The owner raises it to Level 3: now it needs live access AND a typed confirmation.
  sentinel.setLevel("find-files", LEVEL.HUMAN_CONFIRMATION);
  await assert.rejects(
    () => service.handle("find-files", { root: paths.root, query: "a" }),
    /Level 3/,
  );
  const access = service.startAccess({ duration: 300, confirmed: true });
  await assert.rejects(
    () =>
      service.handle("find-files", {
        root: paths.root,
        query: "a",
        accessToken: access.session.token,
      }),
    /type "CONFIRM"/,
  );
  const after = await service.handle("find-files", {
    root: paths.root,
    query: "a",
    accessToken: access.session.token,
    confirmation: "CONFIRM",
  });
  assert.equal(after.result.count, 1);

  // A default gate can never be weakened through policy.
  assert.throws(
    () => sentinel.setLevel("system-power", 1),
    /cannot be lowered/,
  );
  assert.throws(() => sentinel.setLevel("not-a-tool", 2), /Unknown tool/);
  service.closeLedger();
});

test("a Level 3 approval cannot be granted without live authority; a phone inherits none", async () => {
  const paths = await sandbox("approve");
  const service = open(paths);
  const { sentinel } = service;
  const req = sentinel.requestApproval({
    action: "rotate credentials",
    reason: "expiry",
    level: 3,
    risk: "high",
  });
  assert.equal(req.status, "pending");
  assert.throws(
    () => service.decideApproval(req.id, { decision: "approved" }),
    /Level 3/,
  );
  // Denying never needs authority.
  const denied = service.decideApproval(req.id, { decision: "denied" });
  assert.equal(denied.status, "denied");
  assert.throws(
    () => service.decideApproval(req.id, { decision: "approved" }),
    /already decided/,
  );

  const req2 = sentinel.requestApproval({
    action: "install dependency",
    reason: "build",
    level: 2,
  });
  const access = service.startAccess({ duration: 300, confirmed: true });
  const ok = service.decideApproval(req2.id, {
    decision: "approved",
    accessToken: access.session.token,
  });
  assert.equal(ok.status, "approved");
  assert.equal(ok.decidedVia, "desktop");
  // Every decision is in the ledger.
  assert.ok(
    service
      .listReceipts(50)
      .receipts.some((r) => r.tool === "sentinel-approval-decided"),
  );
  service.closeLedger();
});

test("cost guard pauses an agent that exceeds its budget", async () => {
  const paths = await sandbox("cost");
  const service = open(paths);
  const { sentinel } = service;
  const agent = sentinel.registerAgent({
    name: "Spender",
    provider: "codex",
    budgetUsd: 1,
  });
  sentinel.recordUsage(agent.id, { tokens: 1000, usd: 0.4 });
  assert.equal(sentinel.listAgents()[0].status, "registered");
  const over = sentinel.recordUsage(agent.id, { tokens: 5000, usd: 0.8 });
  assert.equal(over.overBudget, true);
  assert.equal(sentinel.listAgents()[0].pausedReason, "budget-exceeded");
  assert.ok(
    service
      .listReceipts(50)
      .receipts.some((r) => r.tool === "sentinel-budget-exceeded"),
  );
  service.closeLedger();
});

test("trust score is derived only from verification receipts and says so", async () => {
  const paths = await sandbox("trust");
  gitRepo(paths.root);
  const service = open(paths);
  const { sentinel } = service;
  const agent = sentinel.registerAgent({ name: "T", provider: "codex" });
  assert.equal(sentinel.trustScore(agent.id).score, null);
  assert.equal(sentinel.trustScore(agent.id).honesty, HONESTY.UNKNOWN);
  const task = sentinel.createTask({
    title: "t",
    instruction: "t",
    agentId: agent.id,
    root: paths.root,
  });
  await sentinel.verifyTask(task.id, { checks: ["git-head"] });
  const score = sentinel.trustScore(agent.id);
  assert.equal(score.score, 100);
  assert.equal(score.honesty, HONESTY.INFERRED);
  assert.match(score.meaning, /not a guarantee/);
  service.closeLedger();
});

test("repeated failures escalate to a human instead of looping", async () => {
  const paths = await sandbox("loop");
  gitRepo(paths.root);
  const service = open(paths);
  const { sentinel } = service;
  const agent = sentinel.registerAgent({ name: "Loopy", provider: "codex" });
  let last;
  for (let i = 0; i < 3; i += 1) {
    const task = sentinel.createTask({
      title: `t${i}`,
      instruction: "t",
      agentId: agent.id,
      root: paths.root,
    });
    // npm-lint has no script in an empty repo → a genuine failed check.
    last = await sentinel.verifyTask(task.id, { checks: ["npm-lint"] });
  }
  assert.equal(last.status, TASK_STATUS.REQUIRES_HUMAN_REVIEW);
  assert.ok(
    sentinel.status().warnings.some((w) => w.kind === "requires-human-review"),
  );
  service.closeLedger();
});

test("the provider registry ships unconfigured and never pretends", () => {
  // The OpenAI adapter is registered at boot but reports configured:false
  // until the vault holds a key — so routing returns nothing, honestly.
  const listed = listProviders();
  const openai = listed.find((p) => p.id === "openai");
  assert.ok(openai, "the adapter is registered");
  assert.equal(openai.configured, false);
  const r = route({ kind: "text" });
  assert.equal(r.provider, null);
  assert.match(r.reason, /No configured provider|No AI provider is configured/);
  registerProvider({ id: "stub", kind: "text", configured: () => false });
  assert.equal(route({ kind: "text" }).provider, null);
});

test("health reports Sentinel and the honest provider state", async () => {
  const paths = await sandbox("health");
  const service = open(paths);
  const health = service.health();
  assert.equal(health.sentinel.protected, true);
  assert.equal(health.doctrine.modelProvider, null);
  service.activateLicense({ key: proKey() });
  service.closeLedger();
});
