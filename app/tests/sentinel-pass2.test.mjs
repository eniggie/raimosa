import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { createDesktopToolService } from "../server/desktop-tools.mjs";
import { memoryBackend } from "../server/vault.mjs";
import { answer, narrateTask } from "../server/narrator.mjs";
import { looksLikeSecret } from "../server/memory.mjs";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(appDir, "..");

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

// ---------- OVIA AI honest narrator ----------

test("OVIA AI never reads an agent's claim back as a result", async () => {
  const paths = await sandbox("narrate");
  gitRepo(paths.root);
  const service = open(paths);
  const { sentinel } = service;
  const codex = sentinel.registerAgent({ name: "Codex", provider: "codex" });
  const task = sentinel.createTask({
    title: "Checkout system",
    instruction: "finish checkout",
    agentId: codex.id,
    root: paths.root,
  });
  sentinel.claimComplete(task.id, {
    agentId: codex.id,
    summary: "All done, everything works.",
  });

  let reply = await service.oviaAsk({
    question: "Did they finish the checkout system?",
  });
  assert.equal(reply.kind, "task");
  assert.match(
    reply.lines[0],
    /Codex reported .* as complete, but Sentinel has not verified it yet/,
  );
  assert.doesNotMatch(reply.lines[0], /^Yes\./);

  reply = await service.oviaAsk({
    question: "what's happening on my computer?",
  });
  assert.equal(reply.kind, "status");
  assert.ok(reply.lines.some((l) => /that is a claim, not a result/.test(l)));

  await sentinel.verifyTask(task.id, { checks: ["git-head"] });
  reply = await service.oviaAsk({ question: "is the checkout system done?" });
  assert.match(
    reply.lines[0],
    /^Yes\. .* verified complete — Sentinel ran its own checks/,
  );

  // Questions outside the records are refused, not improvised.
  reply = await service.oviaAsk({ question: "write me a poem about the sea" });
  assert.equal(reply.kind, "unknown");
  assert.match(reply.lines[0], /No model is configured/);
  service.closeLedger();
});

test("the narrator answers 'what did X do' and 'what happened' from the ledger", async () => {
  const paths = await sandbox("ledgerq");
  gitRepo(paths.root);
  const service = open(paths);
  const { sentinel } = service;
  const claude = sentinel.registerAgent({
    name: "Claude Code",
    provider: "claude",
  });
  const t = sentinel.createTask({
    title: "Docs",
    instruction: "docs",
    agentId: claude.id,
    root: paths.root,
  });
  await sentinel.verifyTask(t.id, { checks: ["git-head"] });

  const did = await service.oviaAsk({ question: `what did ${claude.id} do?` });
  assert.equal(did.kind, "ledger");
  assert.match(did.lines[0], /receipts? in that window/);
  const today = await service.oviaAsk({
    question: "what happened in the last 2 hours?",
  });
  assert.equal(today.kind, "ledger");
  const why = await service.oviaAsk({
    question: "why did sentinel verify that?",
  });
  assert.ok(why.lines.some((l) => /sentinel-verification/.test(l)));

  // The ledger query itself: since + text.
  const q = service.queryReceipts({ text: "sentinel-verification" });
  assert.ok(q.receipts.length >= 1);
  assert.ok(q.receipts.every((r) => r.tool === "sentinel-verification"));
  const future = service.queryReceipts({
    since: new Date(Date.now() + 60_000).toISOString(),
  });
  assert.equal(future.receipts.length, 0);
  service.closeLedger();
});

test("narrateTask phrases every status honestly", () => {
  const status = {
    agents: { list: [{ id: "A", name: "Codex" }] },
    tasks: {
      list: [
        { title: "One", status: "CLAIMED", agentId: "A" },
        { title: "Two", status: "FAILED", agentId: "A" },
        { title: "Three", status: "REQUIRES_HUMAN_REVIEW", agentId: "A" },
      ],
    },
  };
  assert.match(
    narrateTask(status, "one"),
    /reported .* but Sentinel has not verified/,
  );
  assert.match(narrateTask(status, "two"), /^No\./);
  assert.match(narrateTask(status, "three"), /needs your review/);
  assert.equal(narrateTask(status, "nothing"), null);
  assert.equal(answer("", {}).kind, "empty");
});

// ---------- Memory ----------

test("memory holds facts, refuses secrets, can be disabled, cleared, and exported", async () => {
  const paths = await sandbox("memory");
  const service = open(paths);
  const m = service.memoryRemember({
    kind: "user",
    key: "preferred-editor",
    value: "VS Code",
  });
  assert.equal(m.memory.value, "VS Code");
  assert.throws(
    () =>
      service.memoryRemember({
        kind: "user",
        key: "openai",
        value: "sk-live-abcdefghijklmnopqrstuvwxyz",
      }),
    /looks like a credential/,
  );
  assert.throws(
    () =>
      service.memoryRemember({
        kind: "project",
        key: "db",
        value: "password: hunter2xyz",
      }),
    /looks like a credential/,
  );
  assert.throws(
    () => service.memoryRemember({ kind: "nope", key: "k", value: "v" }),
    /Unknown memory kind/,
  );
  assert.ok(looksLikeSecret("-----BEGIN PRIVATE KEY-----"));
  assert.ok(!looksLikeSecret("Prefers dark mode and 2-space indents."));

  // Editing is an upsert on (kind, scope, key).
  service.memoryRemember({
    kind: "user",
    key: "preferred-editor",
    value: "Zed",
  });
  assert.equal(
    service.memoryStatus().memories.filter((x) => x.key === "preferred-editor")
      .length,
    1,
  );
  assert.equal(service.memoryStatus().memories[0].value, "Zed");

  // Export carries the entries; the ledger carries only kind/key, never value.
  const exported = JSON.parse(service.memoryExport().content);
  assert.equal(exported.memories.length, 1);
  const ledger = JSON.stringify(service.listReceipts(50));
  assert.ok(ledger.includes("memory-remembered"));
  assert.ok(!ledger.includes("Zed"), "memory values never enter the ledger");

  // Disable: writes refused, reads empty. Clear needs authority + CONFIRM.
  const access = service.startAccess({ duration: 300, confirmed: true });
  service.memorySetEnabled({
    enabled: false,
    accessToken: access.session.token,
  });
  assert.throws(
    () => service.memoryRemember({ kind: "user", key: "x", value: "y" }),
    /disabled/,
  );
  assert.equal(service.memoryStatus().memories.length, 0);
  service.memorySetEnabled({
    enabled: true,
    accessToken: access.session.token,
  });
  assert.equal(service.memoryStatus().memories.length, 1);
  assert.throws(
    () => service.memoryClear({ accessToken: access.session.token }),
    /CONFIRM/,
  );
  assert.equal(
    service.memoryClear({
      accessToken: access.session.token,
      confirmation: "CONFIRM",
    }).cleared,
    1,
  );
  service.closeLedger();
});

test("Sentinel writes verification memory; an agent cannot author its own record", async () => {
  const paths = await sandbox("vmem");
  gitRepo(paths.root);
  const service = open(paths);
  const { sentinel } = service;
  const agent = sentinel.registerAgent({ name: "Codex", provider: "codex" });
  const task = sentinel.createTask({
    title: "Feature",
    instruction: "f",
    agentId: agent.id,
    root: paths.root,
  });
  await sentinel.verifyTask(task.id, { checks: ["git-head"] });
  const vm = service.memory.recall({ kind: "verification", scope: agent.id });
  assert.equal(vm.length, 1);
  assert.equal(vm[0].source, "sentinel");
  assert.match(vm[0].value, /VERIFIED_COMPLETE — Feature \(Codex\)/);
  // The owner route always writes source "owner" — it cannot forge Sentinel's record.
  const forged = service.memoryRemember({
    kind: "verification",
    key: task.id,
    value: "VERIFIED_COMPLETE — forged",
    scope: agent.id,
  });
  assert.equal(forged.memory.source, "owner");
  service.closeLedger();
});

// ---------- Restore points ----------

test("a restore point is recorded when a supervised task starts in a git repo", async () => {
  const paths = await sandbox("restore");
  gitRepo(paths.root);
  await fs.writeFile(path.join(paths.root, "dirty.txt"), "uncommitted");
  const service = open(paths);
  const task = service.sentinel.createTask({
    title: "Change things",
    instruction: "c",
    root: paths.root,
  });
  const rp = await service.sentinel.recordRestorePoint(task.id);
  assert.match(rp.head, /^[0-9a-f]{40}$/);
  assert.equal(
    rp.changedFiles,
    1,
    "the dirty file is counted so rollback knows the baseline",
  );
  const receipt = service
    .listReceipts(20)
    .receipts.find((r) => r.id === rp.receiptId);
  assert.equal(receipt.tool, "sentinel-restore-point");
  assert.equal(receipt.verified, true);
  assert.equal(service.sentinel.listTasks()[0].restorePoint.head, rp.head);
  // Not a repo → nothing to anchor, and that is said, not faked.
  const plain = await sandbox("plain");
  const svc2 = open(plain);
  const t2 = svc2.sentinel.createTask({
    title: "x",
    instruction: "x",
    root: plain.root,
  });
  assert.equal(await svc2.sentinel.recordRestorePoint(t2.id), null);
  svc2.closeLedger();
  service.closeLedger();
});

// ---------- Realtime events over HTTP ----------

test("the /events stream pushes new receipts to a loopback client", async () => {
  const base = path.join(
    os.tmpdir(),
    `raimosa-sse-${randomUUID().slice(0, 8)}`,
  );
  const home = path.join(base, "home");
  const work = path.join(base, "work");
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(work, { recursive: true });
  await fs.writeFile(path.join(work, "a.txt"), "x");
  const PORT = 8879;
  const app = spawn(
    "node",
    [path.join(appDir, "bin/raimosa.mjs"), "--port", String(PORT), "--no-open"],
    {
      env: { ...process.env, RAIMOSA_HOME: home, RAIMOSA_WORKSPACE: work },
      stdio: "ignore",
    },
  );
  try {
    let up = false;
    for (let i = 0; i < 80 && !up; i += 1) {
      up = await fetch(`http://127.0.0.1:${PORT}/api/raimosa/health`)
        .then((r) => r.ok)
        .catch(() => false);
      if (!up) await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(up);
    const controller = new AbortController();
    const stream = await fetch(`http://127.0.0.1:${PORT}/api/raimosa/events`, {
      signal: controller.signal,
    });
    assert.equal(stream.headers.get("content-type"), "text/event-stream");
    const reader = stream.body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    // Pump continuously. Racing reader.read() against a timeout would discard
    // whatever the losing read had already consumed.
    void (async () => {
      for (;;) {
        const { value, done } = await reader
          .read()
          .catch(() => ({ done: true }));
        if (done) break;
        if (value) text += decoder.decode(value, { stream: true });
      }
    })();
    const read = async (until, ms) => {
      const deadline = Date.now() + ms;
      while (!text.includes(until) && Date.now() < deadline)
        await new Promise((r) => setTimeout(r, 100));
      return text.includes(until);
    };
    assert.ok(
      await read("event: connected", 3000),
      "the stream announces it is connected and where the count starts",
    );
    // Cause a receipt and expect it to arrive without polling.
    await fetch(`http://127.0.0.1:${PORT}/api/raimosa/tools/find-files`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ root: work, query: "a" }),
    });
    assert.ok(
      await read('"tool":"find-files"', 5000),
      "the new receipt was pushed",
    );
    controller.abort();
  } finally {
    app.kill();
  }
});

// ---------- Naming ----------

test("user-facing copy says OVIA AI, never a bare OVIA", async () => {
  const files = execFileSync(
    "git",
    ["ls-files", "app/src", "web", "docs", "README.md", "store"],
    { cwd: repoRoot, encoding: "utf8" },
  )
    .split("\n")
    .filter((f) => /\.(jsx?|html|md)$/.test(f));
  const offenders = [];
  for (const f of files) {
    const text = await fs.readFile(path.join(repoRoot, f), "utf8");
    const hits = text.match(/\bOVIA\b(?!\s+AI)/g);
    if (
      hits &&
      !/ovia-core|\/ovia\/|ovia-text|ovia-voice/.test(
        text.match(/.*\bOVIA\b(?!\s+AI).*/)?.[0] ?? "",
      )
    )
      offenders.push(`${f} (${hits.length})`);
  }
  assert.deepEqual(offenders, []);
});
