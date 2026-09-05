import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

// The MCP bridge is how real agents (Codex, Claude Code) report to Sentinel.
// This test speaks the actual protocol over stdio against a real, isolated
// RAIMOSA instance — no mocks — and asserts the one rule that matters: an
// agent's claim stays a claim until Sentinel's own checks say otherwise.

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8877;

function rpcClient(child) {
  let id = 0;
  const pending = new Map();
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      const resolver = pending.get(message.id);
      if (resolver) {
        pending.delete(message.id);
        resolver(message);
      }
    }
  });
  return {
    request(method, params = {}) {
      const current = (id += 1);
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: current, method, params })}\n`,
      );
      return new Promise((resolve) => pending.set(current, resolve));
    },
    notify(method, params = {}) {
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`,
      );
    },
  };
}

async function waitFor(url, attempts = 80) {
  for (let i = 0; i < attempts; i += 1) {
    const ok = await fetch(url)
      .then((r) => r.ok)
      .catch(() => false);
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

test("an agent can report to Sentinel over MCP, and its claim is not trusted", async () => {
  const base = path.join(
    os.tmpdir(),
    `raimosa-mcp-${randomUUID().slice(0, 8)}`,
  );
  const home = path.join(base, "home");
  const repo = path.join(base, "repo");
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(repo, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: repo });
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
    { cwd: repo },
  );

  // A real RAIMOSA instance with isolated state.
  const app = spawn(
    "node",
    [path.join(appDir, "bin/raimosa.mjs"), "--port", String(PORT), "--no-open"],
    {
      env: { ...process.env, RAIMOSA_HOME: home, RAIMOSA_WORKSPACE: repo },
      stdio: "ignore",
    },
  );
  // The bridge, pointed at it.
  const bridge = spawn("node", [path.join(appDir, "bin/raimosa-mcp.mjs")], {
    env: { ...process.env, RAIMOSA_URL: `http://127.0.0.1:${PORT}` },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const rpc = rpcClient(bridge);

  try {
    assert.ok(
      await waitFor(`http://127.0.0.1:${PORT}/api/raimosa/health`),
      "RAIMOSA should start",
    );

    const init = await rpc.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-agent", version: "1" },
    });
    assert.equal(init.result.serverInfo.name, "raimosa-sentinel");
    assert.match(init.result.instructions, /claim/i);
    rpc.notify("notifications/initialized");

    const list = await rpc.request("tools/list");
    const names = list.result.tools.map((t) => t.name);
    assert.ok(names.includes("sentinel_claim_complete"));
    assert.ok(names.includes("sentinel_request_verification"));
    // No tool on this surface can run a desktop action.
    assert.ok(
      !names.some((n) =>
        /launch|clipboard|power|open-document|organize/.test(n),
      ),
    );

    const call = async (name, args) => {
      const response = await rpc.request("tools/call", {
        name,
        arguments: args,
      });
      const text = response.result.content[0].text;
      return {
        isError: response.result.isError === true,
        data: response.result.isError ? text : JSON.parse(text),
      };
    };

    const registered = await call("sentinel_register_agent", {
      name: "Codex",
      provider: "codex",
      root: repo,
    });
    assert.equal(registered.isError, false);
    const agentId = registered.data.agent.id;

    const created = await call("sentinel_create_task", {
      title: "Ship feature",
      instruction: "Implement and test the feature",
      acceptance: ["tests pass"],
      agentId,
      root: repo,
    });
    const taskId = created.data.task.id;

    const claimed = await call("sentinel_claim_complete", {
      taskId,
      agentId,
      summary: "Everything is done and all tests pass.",
    });
    assert.equal(
      claimed.data.task.status,
      "CLAIMED",
      "a claim over MCP is only a claim",
    );

    const verified = await call("sentinel_request_verification", {
      taskId,
      checks: ["git-head", "git-status"],
    });
    assert.equal(verified.data.task.status, "VERIFIED_COMPLETE");
    assert.equal(verified.data.task.verification.checks[0].honesty, "VERIFIED");

    // An agent can request approval but never grant it.
    const approval = await call("sentinel_request_approval", {
      action: "Install dependency",
      reason: "needed for build",
      level: 2,
      agentId,
    });
    assert.equal(approval.data.approval.status, "pending");
    const status = await call("sentinel_approval_status", {
      approvalId: approval.data.approval.id,
    });
    assert.equal(status.data.approval.status, "pending");

    // Unknown tools and bad input are errors, not silent successes.
    const unknown = await rpc.request("tools/call", {
      name: "run_shell",
      arguments: {},
    });
    assert.ok(unknown.error);
    const bad = await call("sentinel_create_task", { title: "" });
    assert.equal(bad.isError, true);
  } finally {
    bridge.kill();
    app.kill();
  }
});
