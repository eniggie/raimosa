import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createDesktopToolService } from "../server/desktop-tools.mjs";
import { memoryBackend } from "../server/vault.mjs";
import { createAnthropicProvider } from "../server/providers/anthropic.mjs";
import { registerProvider, listProviders } from "../server/providers.mjs";

async function sandbox(name) {
  const home = path.join(
    os.tmpdir(),
    `raimosa-${name}-${randomUUID().slice(0, 8)}`,
  );
  const root = path.join(home, "workspace");
  await fs.mkdir(root, { recursive: true });
  return {
    home,
    root,
    ledgerFile: path.join(home, "ledger.db"),
    stateFile: path.join(home, "state.db"),
  };
}
const open = (paths) =>
  createDesktopToolService({
    ledgerFile: paths.ledgerFile,
    stateFile: paths.stateFile,
    vaultBackend: memoryBackend(),
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

test("the proof record separates what the agent reported from what Sentinel verified", async () => {
  const paths = await sandbox("proof");
  gitRepo(paths.root);
  const service = open(paths);
  const { sentinel } = service;
  const agent = sentinel.registerAgent({ name: "Codex", provider: "codex" });
  const task = sentinel.createTask({
    title: "Checkout",
    instruction: "Finish checkout",
    acceptance: ["tests pass"],
    agentId: agent.id,
    root: paths.root,
  });
  await sentinel.recordRestorePoint(task.id);

  sentinel.reportStep(task.id, {
    kind: "action",
    detail: "Refactored cart service",
  });
  sentinel.reportStep(task.id, { kind: "command", detail: "npm test" });
  sentinel.reportStep(task.id, { kind: "file", detail: "src/cart.js" });
  sentinel.reportStep(task.id, {
    kind: "error",
    detail: "1 flaky test on first run",
  });
  const p = sentinel.reportProgress(task.id, {
    progress: 72,
    note: "almost there",
  });
  assert.equal(p.progress, 72);
  // Reporting never moves status.
  assert.equal(sentinel.listTasks()[0].status, "PLANNED");
  assert.equal(sentinel.listTasks()[0].progress, 72);

  sentinel.claimComplete(task.id, { summary: "done" });
  await sentinel.verifyTask(task.id, { checks: ["git-head"] });

  const proof = sentinel.proofRecord(task.id);
  assert.equal(proof.originalInstruction, "Finish checkout");
  assert.deepEqual(proof.acceptanceCriteria, ["tests pass"]);
  assert.equal(proof.agentResponsible.name, "Codex");
  assert.equal(proof.actionsTaken.length, 1);
  assert.equal(proof.commandsExecuted[0].detail, "npm test");
  assert.equal(proof.filesModified[0].detail, "src/cart.js");
  assert.equal(proof.errors.length, 1);
  assert.match(proof.restorePoint.head, /^[0-9a-f]{40}$/);
  assert.equal(proof.finalStatus, "VERIFIED_COMPLETE");
  assert.ok(proof.honesty.agentReported.includes("commandsExecuted"));
  assert.ok(proof.honesty.sentinelVerified.includes("finalStatus"));
  // Step receipts are explicitly unverified; the verification receipt is verified.
  const receipts = service.listReceipts(50).receipts;
  assert.ok(
    receipts
      .filter((r) => r.tool === "sentinel-step")
      .every((r) => r.verified === false),
  );
  assert.ok(receipts.find((r) => r.tool === "sentinel-verification").verified);
  service.closeLedger();
});

test("a reported dangerous command becomes a warning without ever running", async () => {
  const paths = await sandbox("danger");
  const service = open(paths);
  const { sentinel } = service;
  const task = sentinel.createTask({
    title: "Cleanup",
    instruction: "c",
    root: paths.root,
  });
  sentinel.reportStep(task.id, {
    kind: "command",
    detail: "rm -rf / --no-preserve-root",
  });
  assert.ok(
    service
      .listReceipts(20)
      .receipts.some((r) => r.tool === "sentinel-dangerous-command"),
  );
  assert.ok(
    sentinel
      .status()
      .warnings.some(
        (w) =>
          w.kind === "injection-suspected" && w.where === "dangerous-command",
      ),
  );
  // Nothing was deleted: the sandbox is intact.
  assert.ok((await fs.stat(paths.root)).isDirectory());
  service.closeLedger();
});

test("owner controls: priority, cancel, and a cancelled task refuses further work", async () => {
  const paths = await sandbox("control");
  const service = open(paths);
  const { sentinel } = service;
  const agent = sentinel.registerAgent({ name: "A", provider: "codex" });
  const task = sentinel.createTask({
    title: "T",
    instruction: "t",
    agentId: agent.id,
    root: paths.root,
  });
  assert.equal(sentinel.setPriority(task.id, "urgent").priority, "urgent");
  assert.throws(
    () => sentinel.setPriority(task.id, "asap"),
    /Priority must be/,
  );
  assert.equal(sentinel.listAgents()[0].status, "working");
  const cancelled = sentinel.cancelTask(task.id, "owner-request");
  assert.equal(cancelled.status, "CANCELLED");
  assert.equal(
    sentinel.listAgents()[0].status,
    "registered",
    "cancelling frees the agent",
  );
  assert.throws(
    () => sentinel.reportStep(task.id, { kind: "note", detail: "x" }),
    /cancelled/,
  );
  await assert.rejects(() => sentinel.verifyTask(task.id), /cancelled/);
  assert.equal(sentinel.status().tasks.cancelled, 1);
  service.closeLedger();
});

test("a daily budget pauses an agent independently of its 30-day budget", async () => {
  const paths = await sandbox("daily");
  const service = open(paths);
  const { sentinel } = service;
  const agent = sentinel.registerAgent({
    name: "Spender",
    provider: "codex",
    budgetUsd: 100,
    budgetUsdDaily: 1,
  });
  assert.equal(sentinel.listAgents()[0].budgetUsdDaily, 1);
  const r = sentinel.recordUsage(agent.id, { tokens: 10, usd: 1.5 });
  assert.equal(r.overBudget, true);
  assert.equal(r.spentTodayUsd, 1.5);
  assert.equal(sentinel.listAgents()[0].pausedReason, "budget-exceeded");
  service.closeLedger();
});

test("the Anthropic adapter is vault-backed, honest when unconfigured, and surfaces a refusal as a refusal", async () => {
  const paths = await sandbox("anthropic");
  const service = open(paths);
  const registered = listProviders().find((p) => p.id === "anthropic");
  assert.ok(registered);
  assert.equal(registered.configured, false);

  const access = service.startAccess({ duration: 300, confirmed: true });
  await service.vaultPut({
    name: "ANTHROPIC_API_KEY",
    secret: "sk-ant-test-not-real",
    accessToken: access.session.token,
  });

  let seen = null;
  const stub = createAnthropicProvider({
    vault: service.vault,
    fetchImpl: async (url, init) => {
      seen = { url, headers: init.headers, body: JSON.parse(init.body) };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: "claude-fable-5-1",
          stop_reason: "end_turn",
          content: [
            {
              type: "text",
              text: "Codex reported it done; Sentinel has not verified it.",
            },
          ],
          usage: { input_tokens: 10, output_tokens: 12 },
        }),
      };
    },
  });
  assert.equal(await stub.refresh(), true);
  const out = await stub.complete({ system: "sys", input: "hi" });
  assert.equal(
    out.text,
    "Codex reported it done; Sentinel has not verified it.",
  );
  assert.equal(seen.headers["x-api-key"], "sk-ant-test-not-real");
  assert.equal(seen.headers["anthropic-version"], "2023-06-01");
  assert.equal(seen.body.model, "claude-fable-5-1");
  assert.equal(seen.body.fallbacks, "default");
  assert.ok(
    !("thinking" in seen.body),
    "thinking is always on for this model; the parameter is omitted",
  );
  assert.ok(
    !JSON.stringify(out).includes("sk-ant"),
    "the key never rides along with output",
  );

  const refusing = createAnthropicProvider({
    vault: service.vault,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        stop_reason: "refusal",
        stop_details: { category: "cyber", explanation: "declined" },
        content: [],
      }),
    }),
  });
  const refused = await refusing.complete({ input: "x" });
  assert.equal(refused.refused, true);
  assert.equal(refused.text, "");
  service.closeLedger();
});

test("OVIA AI phrases with a configured provider but never lets it change the facts", async () => {
  const paths = await sandbox("grounded");
  gitRepo(paths.root);
  const service = open(paths);
  const { sentinel } = service;
  const agent = sentinel.registerAgent({ name: "Codex", provider: "codex" });
  const task = sentinel.createTask({
    title: "Payments",
    instruction: "p",
    agentId: agent.id,
    root: paths.root,
  });
  sentinel.claimComplete(task.id, { summary: "all done" });

  // Unconfigured: records-only.
  let reply = await service.oviaAsk({ question: "did they finish payments?" });
  assert.equal(reply.phrasedBy, null);
  assert.match(reply.lines[0], /has not verified it yet/);

  // A configured stub provider that tries to embellish: its text is used for
  // phrasing, but the established facts travel alongside, unchanged.
  let promptSeen = "";
  registerProvider({
    id: "stub-text",
    kind: "text",
    privacy: "local",
    costRank: 0,
    configured: () => true,
    complete: async ({ input }) => {
      promptSeen = input;
      return {
        text: "Codex says it is done, but Sentinel has not verified it yet.",
      };
    },
  });
  reply = await service.oviaAsk({ question: "did they finish payments?" });
  assert.equal(reply.phrasedBy, "stub-text");
  assert.ok(
    reply.facts.some((l) => /has not verified it yet/.test(l)),
    "facts are returned with the phrasing",
  );
  assert.match(promptSeen, /FACTS:/);
  assert.ok(
    !/sk-|ANTHROPIC|OPENAI/.test(promptSeen),
    "no secret material reaches the model",
  );
  service.closeLedger();
});
