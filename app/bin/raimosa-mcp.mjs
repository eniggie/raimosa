#!/usr/bin/env node
// RAIMOSA Sentinel — MCP bridge for AI agents.
//
// This is how Codex, Claude Code, and any MCP-compatible agent report to
// Sentinel. It speaks the Model Context Protocol over stdio (newline-delimited
// JSON-RPC 2.0) and forwards every call to the running RAIMOSA adapter on
// loopback, so all of Sentinel's rules stay enforced server-side:
//
//   • What an agent sends is a CLAIM. Sentinel records it as unverified.
//   • Verification is Sentinel's own fixed allowlist of checks; nothing an
//     agent says is ever spliced into a command.
//   • An agent can request approval; it cannot grant one.
//   • There is deliberately NO tool here that runs a desktop action.
//
// Register with Claude Code:
//   claude mcp add raimosa -- node /path/to/app/bin/raimosa-mcp.mjs
// Register with Codex (~/.codex/config.toml):
//   [mcp_servers.raimosa]
//   command = "node"
//   args = ["/path/to/app/bin/raimosa-mcp.mjs"]
//
// The adapter must be running (`raimosa`). Point at a non-default port with
// RAIMOSA_URL=http://127.0.0.1:<port>.

import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const VERSION = (() => {
  try {
    return JSON.parse(
      readFileSync(path.join(here, "..", "package.json"), "utf8"),
    ).version;
  } catch {
    return "0.0.0";
  }
})();
const BASE = (process.env.RAIMOSA_URL || "http://127.0.0.1:4173").replace(
  /\/$/,
  "",
);
const PROTOCOL_VERSION = "2024-11-05";

async function api(route, body = {}) {
  const response = await fetch(`${BASE}/api/raimosa${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response
    .json()
    .catch(() => ({ ok: false, error: "Invalid adapter response." }));
  if (!response.ok || !data.ok)
    throw new Error(
      data.error || `RAIMOSA adapter returned ${response.status}`,
    );
  return data;
}

const str = { type: "string" };
const strList = { type: "array", items: { type: "string" } };

// Tool surface offered to agents. Descriptions say plainly how Sentinel will
// treat the input, so a well-behaved agent is not misled about authority.
const TOOLS = [
  {
    name: "sentinel_status",
    description:
      "Read Sentinel's live status: agents, tasks, pending approvals, warnings. Read-only.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    run: () => api("/sentinel/status"),
  },
  {
    name: "sentinel_register_agent",
    description:
      "Register yourself as an agent under Sentinel supervision. Returns your agentId. Optionally bind an approved root folder and a 30-day budget in USD.",
    inputSchema: {
      type: "object",
      properties: {
        name: str,
        provider: { ...str, description: "e.g. codex, claude, gemini" },
        root: {
          ...str,
          description: "Approved folder you will work in (absolute path)",
        },
        budgetUsd: { type: "number" },
        risk: { type: "string", enum: ["low", "medium", "high"] },
      },
      required: ["name", "provider"],
      additionalProperties: false,
    },
    run: (a) => api("/sentinel/agents/register", a),
  },
  {
    name: "sentinel_create_task",
    description:
      "Create a supervised task with its original instruction and acceptance criteria. Sentinel will verify against these, not against your report.",
    inputSchema: {
      type: "object",
      properties: {
        title: str,
        instruction: str,
        acceptance: strList,
        agentId: str,
        root: {
          ...str,
          description: "Approved folder (git repo) where verification runs",
        },
      },
      required: ["title", "instruction"],
      additionalProperties: false,
    },
    run: (a) => api("/sentinel/tasks/create", a),
  },
  {
    name: "sentinel_claim_complete",
    description:
      "Report that you believe a task is complete. Sentinel records this as a CLAIM (status CLAIMED, unverified). It does not mark the task verified.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: str,
        agentId: str,
        summary: { ...str, description: "What you did, in plain words" },
        filesChanged: strList,
      },
      required: ["taskId", "summary"],
      additionalProperties: false,
    },
    run: (a) => api("/sentinel/tasks/claim", a),
  },
  {
    name: "sentinel_request_verification",
    description:
      "Ask Sentinel to verify a task now. Sentinel runs ITS OWN allowlisted checks (git-head, git-status, git-diff-stat, npm-test, npm-build, npm-lint) inside the task's approved folder and derives the status from that evidence only. Returns the outcome and evidence.",
    inputSchema: {
      type: "object",
      properties: { taskId: str, checks: strList },
      required: ["taskId"],
      additionalProperties: false,
    },
    run: (a) => api("/sentinel/tasks/verify", a),
  },
  {
    name: "sentinel_report_step",
    description:
      "Report what you are doing as you go so the proof record is complete: kind 'action' (what you did), 'command' (a command you ran), 'file' (a file you changed), 'error' (something that failed), or 'note'. Recorded as agent-reported; it never changes task status.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: str,
        agentId: str,
        kind: {
          type: "string",
          enum: ["action", "command", "file", "error", "note"],
        },
        detail: str,
      },
      required: ["taskId", "kind", "detail"],
      additionalProperties: false,
    },
    run: (a) => api("/sentinel/tasks/step", a),
  },
  {
    name: "sentinel_report_progress",
    description:
      "Report your estimated progress (0-100) on a task. Shown to the owner as agent-reported progress, not verified.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: str,
        progress: { type: "integer", minimum: 0, maximum: 100 },
        note: str,
      },
      required: ["taskId", "progress"],
      additionalProperties: false,
    },
    run: (a) => api("/sentinel/tasks/progress", a),
  },
  {
    name: "sentinel_proof_record",
    description:
      "Read the full proof record for a task: original instruction, acceptance criteria, what you reported, and what Sentinel verified — each labelled by who established it.",
    inputSchema: {
      type: "object",
      properties: { taskId: str },
      required: ["taskId"],
      additionalProperties: false,
    },
    run: (a) => api("/sentinel/tasks/proof", a),
  },
  {
    name: "sentinel_request_approval",
    description:
      "Request the owner's approval before a Level 2 or Level 3 action (install software, send email, change config, anything irreversible). Returns an approvalId with status 'pending'. You cannot approve it yourself; poll sentinel_approval_status.",
    inputSchema: {
      type: "object",
      properties: {
        action: str,
        reason: str,
        level: { type: "integer", enum: [2, 3] },
        risk: { type: "string", enum: ["low", "medium", "high"] },
        agentId: str,
      },
      required: ["action", "reason"],
      additionalProperties: false,
    },
    run: (a) => api("/sentinel/approvals/request", a),
  },
  {
    name: "sentinel_approval_status",
    description:
      "Check whether an approval has been approved or denied by the owner.",
    inputSchema: {
      type: "object",
      properties: { approvalId: str },
      required: ["approvalId"],
      additionalProperties: false,
    },
    run: async ({ approvalId }) => {
      const status = await api("/sentinel/status");
      const approval = status.approvals.list.find((a) => a.id === approvalId);
      if (!approval) throw new Error("Unknown approval.");
      return { ok: true, approval };
    },
  },
  {
    name: "sentinel_record_usage",
    description:
      "Report tokens and cost you consumed so Sentinel can enforce your budget. Exceeding the budget pauses you.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: str,
        tokens: { type: "integer" },
        usd: { type: "number" },
        note: str,
      },
      required: ["agentId"],
      additionalProperties: false,
    },
    run: (a) => api("/sentinel/agents/usage", a),
  },
];

const out = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const reply = (id, result) => out({ jsonrpc: "2.0", id, result });
const fail = (id, code, message) =>
  out({ jsonrpc: "2.0", id, error: { code, message } });

async function handle(message) {
  const { id, method, params = {} } = message;
  // Notifications carry no id and get no reply.
  if (id === undefined || id === null) return;
  switch (method) {
    case "initialize":
      return reply(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "raimosa-sentinel", version: VERSION },
        instructions:
          "Sentinel treats everything you send as a claim. Register, create tasks with acceptance criteria, claim completion when you believe you are done, then request verification — Sentinel's own checks decide the status. Request approval before any Level 2/3 action.",
      });
    case "ping":
      return reply(id, {});
    case "tools/list":
      return reply(id, {
        tools: TOOLS.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
      });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) return fail(id, -32602, `Unknown tool: ${params.name}`);
      try {
        const result = await tool.run(params.arguments ?? {});
        return reply(id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        });
      } catch (error) {
        return reply(id, {
          isError: true,
          content: [{ type: "text", text: error.message }],
        });
      }
    }
    default:
      return fail(id, -32601, `Method not found: ${method}`);
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const text = line.trim();
  if (!text) return;
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    return fail(null, -32700, "Parse error");
  }
  void handle(message).catch((error) =>
    fail(message?.id ?? null, -32603, error.message),
  );
});
rl.on("close", () => process.exit(0));
