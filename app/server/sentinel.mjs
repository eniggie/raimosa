import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { inspect, SOURCE } from "./provenance.mjs";

// RAIMOSA Sentinel — the independent agent supervisor.
//
// Sentinel exists to keep one line bright: an agent's CLAIM is never a
// RESULT. An agent may say "done"; only evidence Sentinel gathered itself can
// move a task to VERIFIED_COMPLETE. Everything Sentinel decides is written to
// the same tamper-evident receipt ledger as every other RAIMOSA action, so
// "why did Sentinel approve this?" is always answerable from the chain.
//
// Sentinel does not run agents. It registers them, observes them, gates what
// they may ask for, verifies what they claim, and pauses them. Execution of
// any desktop action still goes through the one gated `handle()` — Sentinel
// adds policy on top of the existing gates and never bypasses one.

const execFileAsync = promisify(execFile);

export const TASK_STATUS = Object.freeze({
  PLANNED: "PLANNED",
  CLAIMED: "CLAIMED", // an agent said it is done; nothing verified yet
  VERIFYING: "VERIFYING",
  VERIFIED_COMPLETE: "VERIFIED_COMPLETE",
  UNVERIFIED: "UNVERIFIED", // Sentinel could not gather evidence
  PARTIALLY_COMPLETE: "PARTIALLY_COMPLETE",
  FAILED: "FAILED",
  BLOCKED: "BLOCKED",
  REQUIRES_HUMAN_REVIEW: "REQUIRES_HUMAN_REVIEW",
  CANCELLED: "CANCELLED",
});

// The honesty vocabulary. Every piece of evidence Sentinel reports carries one
// of these, so the interface can never blur "the command said so" with
// "Sentinel observed it".
export const HONESTY = Object.freeze({
  KNOWN: "KNOWN", // a fact RAIMOSA holds directly (registry, policy)
  VERIFIED: "VERIFIED", // Sentinel ran a check and observed the result
  INFERRED: "INFERRED", // derived from evidence, not observed directly
  UNCERTAIN: "UNCERTAIN", // evidence exists but is inconclusive
  UNKNOWN: "UNKNOWN", // no evidence could be gathered
});

// Permission levels. Defaults are derived from what each capability already
// requires today, so adopting the levels changes nothing until the owner
// raises one. Raising a tool's level is enforced by `requireLevel` inside the
// existing dispatch path, never only in the interface.
export const LEVEL = Object.freeze({
  OBSERVE: 0,
  SAFE_AUTONOMY: 1,
  APPROVAL_REQUIRED: 2,
  HUMAN_CONFIRMATION: 3,
});

const DEFAULT_LEVELS = Object.freeze({
  // Level 0 — read status only.
  "raimosa-health-scan": 0,
  "device-vitals": 0,
  "network-status": 0,
  "process-status": 0,
  "agent-runtime-monitor": 0,
  // Level 1 — low-risk, reversible, read-mostly.
  "find-files": 1,
  "summarize-folder": 1,
  "storage-insights": 1,
  "find-duplicates": 1,
  "preview-file": 1,
  "compare-folders": 1,
  "folder-snapshot": 1,
  "plan-organization": 1,
  "read-clipboard": 1,
  "capture-screen": 1,
  "list-applications": 1,
  // Level 2 — visible side effects; needs a live All Access session today.
  "execute-organization": 2,
  "create-work-product": 2,
  "write-clipboard": 2,
  "local-notification": 2,
  "open-document": 2,
  "launch-application": 2,
  "close-application": 2,
  // Level 3 — high impact; already needs a typed confirmation for
  // restart/shutdown.
  "system-power": 3,
});

// The only commands the Proof Engine will ever run. Each is a fixed argv —
// nothing from a task, claim, or agent is ever spliced into a command line.
// Checks run inside an approved root, which the caller resolves through the
// same symlink-safe containment every other adapter uses.
const VERIFIERS = Object.freeze({
  "git-status": {
    argv: ["git", "status", "--porcelain=v1"],
    describe: "working tree state",
    read: (out) => ({
      changedFiles: out.split("\n").filter(Boolean).length,
      lines: out.split("\n").filter(Boolean).slice(0, 200),
    }),
  },
  "git-diff-stat": {
    argv: ["git", "diff", "--stat", "HEAD"],
    describe: "uncommitted diff summary",
    read: (out) => ({ summary: out.trim().split("\n").slice(-1)[0] || "" }),
  },
  "git-head": {
    argv: ["git", "rev-parse", "HEAD"],
    describe: "current commit (restore point)",
    read: (out) => ({ head: out.trim() }),
  },
  "npm-test": {
    argv: ["npm", "test", "--silent"],
    describe: "test suite",
    read: (out) => ({
      passed: Number((out.match(/ℹ pass (\d+)/) || [])[1] ?? NaN),
      failed: Number((out.match(/ℹ fail (\d+)/) || [])[1] ?? NaN),
    }),
  },
  "npm-build": {
    argv: ["npm", "run", "build", "--silent"],
    describe: "production build",
    read: (out) => ({ tail: out.trim().split("\n").slice(-3) }),
  },
  "npm-lint": {
    argv: ["npm", "run", "lint", "--silent"],
    describe: "lint",
    read: (out) => ({ tail: out.trim().split("\n").slice(-3) }),
  },
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sentinel_agents (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  provider      TEXT NOT NULL,
  capabilities  TEXT NOT NULL,
  root          TEXT,
  allowlist     TEXT NOT NULL,
  budget_usd    REAL,
  status        TEXT NOT NULL,
  risk          TEXT NOT NULL,
  registered_at INTEGER NOT NULL,
  last_activity INTEGER NOT NULL,
  paused_reason TEXT
);
CREATE TABLE IF NOT EXISTS sentinel_tasks (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  instruction  TEXT NOT NULL,
  acceptance   TEXT NOT NULL,
  agent_id     TEXT,
  root         TEXT,
  status       TEXT NOT NULL,
  claim        TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sentinel_verifications (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL,
  agent_id    TEXT,
  checks      TEXT NOT NULL,
  outcome     TEXT NOT NULL,
  receipt_id  TEXT,
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sentinel_approvals (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT,
  action      TEXT NOT NULL,
  reason      TEXT NOT NULL,
  level       INTEGER NOT NULL,
  risk        TEXT NOT NULL,
  status      TEXT NOT NULL,
  decided_via TEXT,
  created_at  INTEGER NOT NULL,
  decided_at  INTEGER
);
CREATE TABLE IF NOT EXISTS sentinel_policy (
  tool   TEXT PRIMARY KEY,
  level  INTEGER NOT NULL,
  set_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sentinel_steps (
  id        TEXT PRIMARY KEY,
  task_id   TEXT NOT NULL,
  agent_id  TEXT,
  kind      TEXT NOT NULL,
  detail    TEXT NOT NULL,
  at        INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sentinel_task_meta (
  task_id   TEXT PRIMARY KEY,
  progress  INTEGER NOT NULL DEFAULT 0,
  priority  TEXT NOT NULL DEFAULT 'normal',
  cancelled INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sentinel_restore_points (
  task_id       TEXT PRIMARY KEY,
  head          TEXT,
  changed_files INTEGER,
  receipt_id    TEXT,
  at            INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sentinel_usage (
  id        TEXT PRIMARY KEY,
  agent_id  TEXT NOT NULL,
  tokens    INTEGER NOT NULL,
  usd       REAL NOT NULL,
  note      TEXT,
  at        INTEGER NOT NULL
);
`;

const STALL_MS = 15 * 60 * 1000;
const REPEATED_FAILURE_LIMIT = 3;

/**
 * @param {object} deps
 * @param {string} deps.stateFile   SQLite file shared with the authority store.
 * @param {(r:object)=>object} deps.record   Append a receipt to the ledger.
 * @param {(tool:string,scope:string,result:object,opts?:{verified?:boolean})=>object} deps.receipt
 * @param {()=>boolean} deps.isLatched   Emergency-stop state.
 * @param {(input:string)=>Promise<string>} deps.approvedRoot   Symlink-safe root resolver.
 */
export function createSentinel({
  stateFile,
  record,
  receipt,
  isLatched,
  approvedRoot,
  hooks = {},
}) {
  const db = new DatabaseSync(stateFile);
  if (stateFile !== ":memory:") db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
  // Additive column for a per-day cap; older DBs get it on first open.
  try {
    db.exec("ALTER TABLE sentinel_agents ADD COLUMN budget_usd_daily REAL");
  } catch {
    // already present
  }

  const q = {
    putAgent: db.prepare(
      `INSERT OR REPLACE INTO sentinel_agents
       (id,name,provider,capabilities,root,allowlist,budget_usd,status,risk,registered_at,last_activity,paused_reason)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ),
    getAgent: db.prepare("SELECT * FROM sentinel_agents WHERE id = ?"),
    listAgents: db.prepare(
      "SELECT * FROM sentinel_agents ORDER BY registered_at DESC",
    ),
    touchAgent: db.prepare(
      "UPDATE sentinel_agents SET last_activity = ? WHERE id = ?",
    ),
    setAgentStatus: db.prepare(
      "UPDATE sentinel_agents SET status = ?, paused_reason = ? WHERE id = ?",
    ),
    putTask: db.prepare(
      `INSERT INTO sentinel_tasks (id,title,instruction,acceptance,agent_id,root,status,claim,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,NULL,?,?)`,
    ),
    getTask: db.prepare("SELECT * FROM sentinel_tasks WHERE id = ?"),
    listTasks: db.prepare(
      "SELECT * FROM sentinel_tasks ORDER BY updated_at DESC LIMIT 200",
    ),
    setTask: db.prepare(
      "UPDATE sentinel_tasks SET status = ?, claim = ?, updated_at = ? WHERE id = ?",
    ),
    putVerification: db.prepare(
      `INSERT INTO sentinel_verifications (id,task_id,agent_id,checks,outcome,receipt_id,created_at)
       VALUES (?,?,?,?,?,?,?)`,
    ),
    listVerifications: db.prepare(
      "SELECT * FROM sentinel_verifications WHERE task_id = ? ORDER BY created_at DESC",
    ),
    allVerifications: db.prepare(
      "SELECT * FROM sentinel_verifications ORDER BY created_at DESC LIMIT 500",
    ),
    putApproval: db.prepare(
      `INSERT INTO sentinel_approvals (id,agent_id,action,reason,level,risk,status,decided_via,created_at,decided_at)
       VALUES (?,?,?,?,?,?,'pending',NULL,?,NULL)`,
    ),
    getApproval: db.prepare("SELECT * FROM sentinel_approvals WHERE id = ?"),
    decideApproval: db.prepare(
      `UPDATE sentinel_approvals SET status = ?, decided_via = ?, decided_at = ?
       WHERE id = ? AND status = 'pending'`,
    ),
    listApprovals: db.prepare(
      "SELECT * FROM sentinel_approvals ORDER BY created_at DESC LIMIT 200",
    ),
    setPolicy: db.prepare(
      "INSERT OR REPLACE INTO sentinel_policy (tool, level, set_at) VALUES (?,?,?)",
    ),
    listPolicy: db.prepare("SELECT * FROM sentinel_policy"),
    putStep: db.prepare(
      "INSERT INTO sentinel_steps (id, task_id, agent_id, kind, detail, at) VALUES (?,?,?,?,?,?)",
    ),
    listSteps: db.prepare(
      "SELECT * FROM sentinel_steps WHERE task_id = ? ORDER BY at ASC LIMIT 500",
    ),
    getMeta: db.prepare("SELECT * FROM sentinel_task_meta WHERE task_id = ?"),
    putMeta: db.prepare(
      `INSERT INTO sentinel_task_meta (task_id, progress, priority, cancelled) VALUES (?,?,?,?)
       ON CONFLICT(task_id) DO UPDATE SET progress = excluded.progress, priority = excluded.priority, cancelled = excluded.cancelled`,
    ),
    usageSince: db.prepare(
      "SELECT COALESCE(SUM(usd),0) AS usd FROM sentinel_usage WHERE agent_id = ? AND at >= ?",
    ),
    putRestore: db.prepare(
      "INSERT OR REPLACE INTO sentinel_restore_points (task_id, head, changed_files, receipt_id, at) VALUES (?,?,?,?,?)",
    ),
    getRestore: db.prepare(
      "SELECT * FROM sentinel_restore_points WHERE task_id = ?",
    ),
    putUsage: db.prepare(
      "INSERT INTO sentinel_usage (id,agent_id,tokens,usd,note,at) VALUES (?,?,?,?,?,?)",
    ),
    usageFor: db.prepare(
      "SELECT COALESCE(SUM(tokens),0) AS tokens, COALESCE(SUM(usd),0) AS usd FROM sentinel_usage WHERE agent_id = ? AND at >= ?",
    ),
  };

  const now = () => Date.now();
  const id = (prefix) => `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;
  const parse = (text, fallback) => {
    try {
      return JSON.parse(text);
    } catch {
      return fallback;
    }
  };

  function hydrateAgent(row) {
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      provider: row.provider,
      capabilities: parse(row.capabilities, []),
      root: row.root,
      allowlist: parse(row.allowlist, []),
      budgetUsd: row.budget_usd,
      budgetUsdDaily: row.budget_usd_daily ?? null,
      status: row.status,
      risk: row.risk,
      registeredAt: new Date(row.registered_at).toISOString(),
      lastActivity: new Date(row.last_activity).toISOString(),
      pausedReason: row.paused_reason,
    };
  }
  function hydrateTask(row) {
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      instruction: row.instruction,
      acceptance: parse(row.acceptance, []),
      agentId: row.agent_id,
      root: row.root,
      status: row.status,
      claim: row.claim ? parse(row.claim, null) : null,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      progress: q.getMeta.get(row.id)?.progress ?? 0,
      priority: q.getMeta.get(row.id)?.priority ?? "normal",
      cancelled: Boolean(q.getMeta.get(row.id)?.cancelled),
      restorePoint: (() => {
        const rp = q.getRestore.get(row.id);
        return rp
          ? {
              head: rp.head,
              changedFiles: rp.changed_files,
              receiptId: rp.receipt_id,
              at: new Date(rp.at).toISOString(),
            }
          : null;
      })(),
    };
  }
  function hydrateApproval(row) {
    if (!row) return null;
    return {
      id: row.id,
      agentId: row.agent_id,
      action: row.action,
      reason: row.reason,
      level: row.level,
      risk: row.risk,
      status: row.status,
      decidedVia: row.decided_via,
      createdAt: new Date(row.created_at).toISOString(),
      decidedAt: row.decided_at ? new Date(row.decided_at).toISOString() : null,
    };
  }

  function requireNotLatched() {
    if (isLatched())
      throw new Error(
        "Emergency stop is active. Sentinel will not register, verify, or approve until it is cleared.",
      );
  }

  // ---------- Permission levels ----------

  function levelFor(tool) {
    const override = q.listPolicy.all().find((row) => row.tool === tool);
    if (override) return override.level;
    return DEFAULT_LEVELS[tool] ?? LEVEL.APPROVAL_REQUIRED;
  }

  function policy() {
    const overrides = Object.fromEntries(
      q.listPolicy.all().map((row) => [row.tool, row.level]),
    );
    return {
      defaults: DEFAULT_LEVELS,
      overrides,
      effective: Object.fromEntries(
        Object.keys(DEFAULT_LEVELS).map((tool) => [tool, levelFor(tool)]),
      ),
    };
  }

  function setLevel(tool, level) {
    requireNotLatched();
    const numeric = Number(level);
    if (!(tool in DEFAULT_LEVELS))
      throw new Error(`Unknown tool for policy: ${tool}`);
    if (![0, 1, 2, 3].includes(numeric))
      throw new Error("Level must be 0, 1, 2, or 3.");
    // The owner may raise a level freely. Lowering below the default would
    // remove a gate the adapter itself relies on, so it is refused here rather
    // than silently weakening a control.
    if (numeric < DEFAULT_LEVELS[tool])
      throw new Error(
        `${tool} cannot be lowered below its default level ${DEFAULT_LEVELS[tool]}.`,
      );
    q.setPolicy.run(tool, numeric, now());
    record(
      receipt("sentinel-policy", "sentinel policy", {
        tool,
        level: numeric,
        default: DEFAULT_LEVELS[tool],
      }),
    );
    return { tool, level: numeric };
  }

  /**
   * Enforce the owner's policy inside the dispatch path. The existing gates
   * still run; this only adds requirements when a tool has been raised.
   */
  function requireLevel(tool, payload = {}, { hasAccess = false } = {}) {
    const effective = levelFor(tool);
    const base = DEFAULT_LEVELS[tool] ?? LEVEL.APPROVAL_REQUIRED;
    if (effective <= base) return effective;
    if (effective >= LEVEL.APPROVAL_REQUIRED && !hasAccess)
      throw new Error(
        `${tool} is set to Level ${effective} by your policy: a live All Access session is required.`,
      );
    if (
      effective === LEVEL.HUMAN_CONFIRMATION &&
      payload.confirmation !== "CONFIRM"
    )
      throw new Error(
        `${tool} is set to Level 3 by your policy: type "CONFIRM" to run it.`,
      );
    return effective;
  }

  // ---------- Agent registry ----------

  function registerAgent(input = {}) {
    requireNotLatched();
    const name = String(input.name ?? "").trim();
    const provider = String(input.provider ?? "").trim();
    if (!name || !provider)
      throw new Error("An agent needs a name and a provider.");
    const agent = {
      id: id("AGT"),
      name,
      provider,
      capabilities: Array.isArray(input.capabilities)
        ? input.capabilities.map(String).slice(0, 50)
        : [],
      root: input.root ? String(input.root) : null,
      allowlist: Array.isArray(input.allowlist)
        ? input.allowlist.map(String).slice(0, 50)
        : Object.keys(VERIFIERS),
      budgetUsd:
        input.budgetUsd === undefined || input.budgetUsd === null
          ? null
          : Number(input.budgetUsd),
      status: "registered",
      risk: ["low", "medium", "high"].includes(input.risk)
        ? input.risk
        : "medium",
    };
    const t = now();
    q.putAgent.run(
      agent.id,
      agent.name,
      agent.provider,
      JSON.stringify(agent.capabilities),
      agent.root,
      JSON.stringify(agent.allowlist),
      agent.budgetUsd,
      agent.status,
      agent.risk,
      t,
      t,
      null,
    );
    if (input.budgetUsdDaily !== undefined && input.budgetUsdDaily !== null)
      db.prepare(
        "UPDATE sentinel_agents SET budget_usd_daily = ? WHERE id = ?",
      ).run(Number(input.budgetUsdDaily), agent.id);
    record(
      receipt("sentinel-agent-registered", agent.name, {
        agentId: agent.id,
        provider: agent.provider,
        root: agent.root,
        risk: agent.risk,
        budgetUsd: agent.budgetUsd,
      }),
    );
    return hydrateAgent(q.getAgent.get(agent.id));
  }

  function setAgentStatus(
    agentId,
    status,
    reason = null,
    tool = "sentinel-agent-status",
  ) {
    const agent = hydrateAgent(q.getAgent.get(agentId));
    if (!agent) throw new Error("Unknown agent.");
    q.setAgentStatus.run(status, reason, agentId);
    record(
      receipt(tool, agent.name, {
        agentId,
        from: agent.status,
        to: status,
        reason,
      }),
    );
    return hydrateAgent(q.getAgent.get(agentId));
  }

  const pauseAgent = (agentId, reason = "owner-request") =>
    setAgentStatus(agentId, "paused", reason, "sentinel-agent-paused");
  const resumeAgent = (agentId) => {
    requireNotLatched();
    return setAgentStatus(
      agentId,
      "registered",
      null,
      "sentinel-agent-resumed",
    );
  };
  const revokeAgent = (agentId) =>
    setAgentStatus(
      agentId,
      "revoked",
      "owner-request",
      "sentinel-agent-revoked",
    );

  /** STOP ALL AGENTS: called by the emergency latch. */
  function pauseAll(reason = "emergency-stop") {
    const paused = [];
    for (const row of q.listAgents.all()) {
      if (row.status === "registered" || row.status === "working") {
        q.setAgentStatus.run("paused", reason, row.id);
        paused.push(row.id);
      }
    }
    if (paused.length)
      record(receipt("sentinel-stop-all", "sentinel", { paused, reason }));
    return paused;
  }

  function recordUsage(agentId, { tokens = 0, usd = 0, note = null } = {}) {
    const agent = hydrateAgent(q.getAgent.get(agentId));
    if (!agent) throw new Error("Unknown agent.");
    q.putUsage.run(
      id("USE"),
      agentId,
      Number(tokens) || 0,
      Number(usd) || 0,
      note,
      now(),
    );
    q.touchAgent.run(now(), agentId);
    const spent = q.usageFor.get(agentId, now() - 30 * 24 * 3600 * 1000);
    const today = q.usageSince.get(agentId, now() - 24 * 3600 * 1000);
    const overBudget =
      (agent.budgetUsd !== null && spent.usd > agent.budgetUsd) ||
      (agent.budgetUsdDaily !== null && today.usd > agent.budgetUsdDaily);
    if (overBudget && agent.status !== "paused") {
      try {
        hooks.onNotify?.({
          kind: "budget-exceeded",
          title: `${agent.name} exceeded its budget`,
          body: "The agent is paused.",
          priority: "high",
        });
      } catch {
        // best-effort
      }
      setAgentStatus(
        agentId,
        "paused",
        "budget-exceeded",
        "sentinel-budget-exceeded",
      );
    }
    return {
      spentUsd: spent.usd,
      spentTokens: spent.tokens,
      spentTodayUsd: today.usd,
      overBudget,
    };
  }

  /**
   * Trust is a historical reliability indicator derived only from receipts —
   * verified completions against claims. It never guarantees truth.
   */
  function trustScore(agentId) {
    const rows = q.allVerifications.all().filter((r) => r.agent_id === agentId);
    const claims = q.listTasks
      .all()
      .filter((r) => r.agent_id === agentId && r.claim);
    const verified = rows.filter(
      (r) => r.outcome === TASK_STATUS.VERIFIED_COMPLETE,
    ).length;
    const failed = rows.filter(
      (r) =>
        r.outcome === TASK_STATUS.FAILED ||
        r.outcome === TASK_STATUS.PARTIALLY_COMPLETE,
    ).length;
    const total = rows.length;
    return {
      agentId,
      verifiedCompletions: verified,
      failedOrPartial: failed,
      claims: claims.length,
      score: total ? Math.round((verified / total) * 100) : null,
      basis: total
        ? `${verified} of ${total} independent verifications passed`
        : "no verifications yet",
      honesty: total ? HONESTY.INFERRED : HONESTY.UNKNOWN,
      meaning: "historical reliability, not a guarantee",
    };
  }

  function listAgents({ discovered = [] } = {}) {
    const registered = q.listAgents.all().map(hydrateAgent);
    const stalled = (a) =>
      a.status === "working" && now() - Date.parse(a.lastActivity) > STALL_MS;
    return registered.map((a) => ({
      ...a,
      trust: trustScore(a.id),
      health: stalled(a)
        ? "stalled"
        : a.status === "revoked"
          ? "revoked"
          : "ok",
      observedRunning: discovered.some(
        (d) => d.id === a.provider.toLowerCase() && d.running?.length,
      ),
    }));
  }

  // ---------- Tasks and the Proof Engine ----------

  function createTask(input = {}) {
    requireNotLatched();
    const title = String(input.title ?? "").trim();
    const instruction = String(input.instruction ?? "").trim();
    if (!title || !instruction)
      throw new Error("A task needs a title and the original instruction.");
    const acceptance = Array.isArray(input.acceptance)
      ? input.acceptance.map(String).filter(Boolean).slice(0, 20)
      : [];
    if (input.agentId && !q.getAgent.get(input.agentId))
      throw new Error("Unknown agent.");
    const task = {
      id: id("TASK"),
      title,
      instruction,
      acceptance,
      agentId: input.agentId ?? null,
      root: input.root ? String(input.root) : null,
    };
    const t = now();
    q.putTask.run(
      task.id,
      task.title,
      task.instruction,
      JSON.stringify(task.acceptance),
      task.agentId,
      task.root,
      TASK_STATUS.PLANNED,
      t,
      t,
    );
    if (task.agentId) q.setAgentStatus.run("working", null, task.agentId);
    record(
      receipt("sentinel-task-created", task.title, {
        taskId: task.id,
        agentId: task.agentId,
        acceptance: task.acceptance,
        root: task.root,
      }),
    );
    return hydrateTask(q.getTask.get(task.id));
  }

  /**
   * An agent (or the owner on its behalf) claims completion. This records the
   * claim and moves the task to CLAIMED — never to VERIFIED. The receipt is
   * explicitly unverified: it is evidence that a claim was made, nothing more.
   */
  function claimComplete(taskId, input = {}) {
    const task = hydrateTask(q.getTask.get(taskId));
    if (!task) throw new Error("Unknown task.");
    const claim = {
      agentId: input.agentId ?? task.agentId ?? null,
      summary: String(input.summary ?? "").slice(0, 2000),
      filesChanged: Array.isArray(input.filesChanged)
        ? input.filesChanged.map(String).slice(0, 200)
        : [],
      claimedAt: new Date().toISOString(),
    };
    q.setTask.run(TASK_STATUS.CLAIMED, JSON.stringify(claim), now(), taskId);
    if (claim.agentId) q.touchAgent.run(now(), claim.agentId);
    // An agent's words are AGENT-provenance data: recorded, never executed.
    // If they read like an attempt to steer RAIMOSA or pull a secret, the
    // attempt itself becomes a security receipt and a dashboard warning.
    flagInjection(claim.summary, {
      taskId,
      agentId: claim.agentId,
      where: "claim",
      title: task.title,
    });
    record(
      receipt(
        "sentinel-claim",
        task.title,
        {
          taskId,
          agentId: claim.agentId,
          summary: claim.summary,
          filesChanged: claim.filesChanged.length,
          honesty: HONESTY.UNCERTAIN,
          note: "An agent's statement of completion. Not evidence.",
        },
        { verified: false },
      ),
    );
    return hydrateTask(q.getTask.get(taskId));
  }

  async function runCheck(name, cwd, allowlist) {
    const verifier = VERIFIERS[name];
    if (!verifier)
      return {
        check: name,
        ok: false,
        ran: false,
        honesty: HONESTY.UNKNOWN,
        evidence:
          "Not an allowed verifier. Sentinel only runs its fixed allowlist.",
      };
    if (!allowlist.includes(name))
      return {
        check: name,
        ok: false,
        ran: false,
        honesty: HONESTY.UNKNOWN,
        evidence: "This agent's allowlist does not permit that check.",
      };
    const started = now();
    try {
      const { stdout, stderr } = await execFileAsync(
        verifier.argv[0],
        verifier.argv.slice(1),
        {
          cwd,
          timeout: 10 * 60 * 1000,
          maxBuffer: 8 * 1024 * 1024,
          env: process.env,
        },
      );
      const out = `${stdout}\n${stderr}`;
      const read = verifier.read(out);
      const failedTests = Number.isFinite(read.failed) && read.failed > 0;
      return {
        check: name,
        ran: true,
        ok: !failedTests,
        honesty: HONESTY.VERIFIED,
        describe: verifier.describe,
        durationMs: now() - started,
        evidence: read,
      };
    } catch (error) {
      const code = error?.code;
      const missing = code === "ENOENT";
      return {
        check: name,
        ran: !missing,
        ok: false,
        honesty: missing ? HONESTY.UNKNOWN : HONESTY.VERIFIED,
        describe: verifier.describe,
        durationMs: now() - started,
        evidence: missing
          ? `${verifier.argv[0]} is not available here, so this could not be checked.`
          : {
              exitCode: typeof code === "number" ? code : null,
              tail: String(error.stdout ?? error.message ?? "")
                .trim()
                .split("\n")
                .slice(-8),
            },
      };
    }
  }

  /**
   * Independently verify a task. Sentinel runs allowlisted checks inside the
   * task's approved root and derives the status from what it observed. A claim
   * is never consulted for the verdict — only the evidence.
   */
  async function verifyTask(taskId, input = {}) {
    if (isLatched()) {
      const task = hydrateTask(q.getTask.get(taskId));
      if (!task) throw new Error("Unknown task.");
      q.setTask.run(
        TASK_STATUS.BLOCKED,
        task.claim ? JSON.stringify(task.claim) : null,
        now(),
        taskId,
      );
      record(
        receipt(
          "sentinel-verification",
          task.title,
          {
            taskId,
            outcome: TASK_STATUS.BLOCKED,
            reason: "emergency stop is active",
          },
          { verified: false },
        ),
      );
      return hydrateTask(q.getTask.get(taskId));
    }
    const task = hydrateTask(q.getTask.get(taskId));
    if (!task) throw new Error("Unknown task.");
    if (task.cancelled) throw new Error("This task was cancelled.");
    const rootInput = input.root ?? task.root;
    if (!rootInput)
      throw new Error("A task must have an approved root to be verified in.");
    const cwd = await approvedRoot(rootInput);
    const agent = task.agentId
      ? hydrateAgent(q.getAgent.get(task.agentId))
      : null;
    const allowlist = agent?.allowlist ?? Object.keys(VERIFIERS);
    const requested =
      Array.isArray(input.checks) && input.checks.length
        ? input.checks.map(String)
        : ["git-head", "git-status"];

    q.setTask.run(
      TASK_STATUS.VERIFYING,
      task.claim ? JSON.stringify(task.claim) : null,
      now(),
      taskId,
    );

    const results = [];
    for (const name of requested)
      results.push(await runCheck(name, cwd, allowlist));

    const ran = results.filter((r) => r.ran);
    const passed = ran.filter((r) => r.ok);
    let outcome;
    if (ran.length === 0) outcome = TASK_STATUS.UNVERIFIED;
    else if (passed.length === ran.length && ran.length === results.length)
      outcome = TASK_STATUS.VERIFIED_COMPLETE;
    else if (passed.length === 0) outcome = TASK_STATUS.FAILED;
    else outcome = TASK_STATUS.PARTIALLY_COMPLETE;

    // Repeated failures for the same agent escalate to a human rather than
    // letting an agent loop on its own claims.
    if (
      agent &&
      (outcome === TASK_STATUS.FAILED ||
        outcome === TASK_STATUS.PARTIALLY_COMPLETE)
    ) {
      const recentFailures = q.allVerifications
        .all()
        .filter(
          (r) =>
            r.agent_id === agent.id &&
            r.outcome !== TASK_STATUS.VERIFIED_COMPLETE,
        ).length;
      if (recentFailures + 1 >= REPEATED_FAILURE_LIMIT) {
        outcome = TASK_STATUS.REQUIRES_HUMAN_REVIEW;
        try {
          hooks.onNotify?.({
            kind: "requires-human-review",
            title: `Review needed: ${task.title}`,
            body: "Repeated verification failures.",
            priority: "high",
          });
        } catch {
          // best-effort
        }
      }
    }

    const verificationReceipt = record(
      receipt(
        "sentinel-verification",
        task.title,
        {
          taskId,
          agentId: task.agentId,
          root: cwd,
          checks: results,
          outcome,
          honesty: ran.length ? HONESTY.VERIFIED : HONESTY.UNKNOWN,
          claimSummary: task.claim?.summary ?? null,
        },
        { verified: ran.length > 0 },
      ),
    );
    q.putVerification.run(
      id("VER"),
      taskId,
      task.agentId,
      JSON.stringify(results),
      outcome,
      verificationReceipt.id,
      now(),
    );
    q.setTask.run(
      outcome,
      task.claim ? JSON.stringify(task.claim) : null,
      now(),
      taskId,
    );
    if (task.agentId) {
      q.touchAgent.run(now(), task.agentId);
      try {
        hooks.onVerified?.({
          agentId: task.agentId,
          agentName: agent?.name ?? null,
          taskId,
          taskTitle: task.title,
          outcome,
        });
      } catch {
        // Memory is a convenience; a failure there must never change a verdict.
      }
      if (outcome === TASK_STATUS.VERIFIED_COMPLETE)
        q.setAgentStatus.run("registered", null, task.agentId);
    }
    return {
      ...hydrateTask(q.getTask.get(taskId)),
      verification: {
        receiptId: verificationReceipt.id,
        checks: results,
        outcome,
      },
    };
  }

  /**
   * Record where the repository stood before an agent starts. Before any
   * significant change: the commit, and how many files were already dirty —
   * so "offer rollback" later has a fixed point to roll back to. Evidence,
   * not a stash: nothing is modified.
   */
  async function recordRestorePoint(taskId) {
    const task = hydrateTask(q.getTask.get(taskId));
    if (!task) throw new Error("Unknown task.");
    if (!task.root) return null;
    let cwd;
    try {
      cwd = await approvedRoot(task.root);
    } catch {
      return null;
    }
    const head = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd,
      timeout: 10_000,
    })
      .then((r) => r.stdout.trim())
      .catch(() => null);
    if (!head) return null; // not a git repository: nothing to anchor to
    const dirty = await execFileAsync("git", ["status", "--porcelain=v1"], {
      cwd,
      timeout: 10_000,
      maxBuffer: 4 * 1024 * 1024,
    })
      .then((r) => r.stdout.split("\n").filter(Boolean).length)
      .catch(() => null);
    const rp = record(
      receipt("sentinel-restore-point", task.title, {
        taskId,
        root: cwd,
        head,
        changedFilesBefore: dirty,
        honesty: HONESTY.VERIFIED,
      }),
    );
    q.putRestore.run(taskId, head, dirty, rp.id, now());
    return { head, changedFiles: dirty, receiptId: rp.id };
  }

  // ---------- Proof record: what the agent actually did ----------

  const STEP_KINDS = new Set(["action", "command", "file", "note", "error"]);
  const DANGEROUS =
    /\b(rm\s+-rf|mkfs|dd\s+if=|chmod\s+-R\s+777|curl[^\n]*\|\s*sh)\b/i;

  /**
   * An agent reports what it is doing as it goes: actions taken, commands it
   * ran, files it touched, errors it hit. This is AGENT-provenance data — it
   * fills the proof record and is inspected for injection, but it never
   * changes a task's status. Only verification does that.
   */
  function reportStep(taskId, input = {}) {
    const task = hydrateTask(q.getTask.get(taskId));
    if (!task) throw new Error("Unknown task.");
    if (task.cancelled) throw new Error("This task was cancelled.");
    const kind = STEP_KINDS.has(input.kind) ? input.kind : "note";
    const detail = String(input.detail ?? "").slice(0, 2000);
    if (!detail) throw new Error("A step needs a detail.");
    const agentId = input.agentId ?? task.agentId ?? null;
    q.putStep.run(id("STP"), taskId, agentId, kind, detail, now());
    if (agentId) q.touchAgent.run(now(), agentId);
    flagInjection(detail, {
      taskId,
      agentId,
      where: `step:${kind}`,
      title: task.title,
    });
    // A dangerous command is a warning even though nothing ran here: Sentinel
    // never executes it, but the owner should see the intent.
    if (kind === "command" && DANGEROUS.test(detail)) {
      record(
        receipt(
          "sentinel-dangerous-command",
          task.title,
          { taskId, agentId, detail, honesty: HONESTY.KNOWN },
          { verified: true },
        ),
      );
      injectionEvents.unshift({
        taskId,
        agentId,
        where: "dangerous-command",
        reasons: ["dangerous command reported"],
        title: task.title,
      });
    }
    record(
      receipt(
        "sentinel-step",
        task.title,
        { taskId, agentId, kind, detail },
        { verified: false },
      ),
    );
    return { taskId, kind, detail };
  }

  function reportProgress(taskId, input = {}) {
    const task = hydrateTask(q.getTask.get(taskId));
    if (!task) throw new Error("Unknown task.");
    const progress = Math.max(
      0,
      Math.min(100, Math.round(Number(input.progress) || 0)),
    );
    q.putMeta.run(taskId, progress, task.priority, task.cancelled ? 1 : 0);
    if (task.agentId) q.touchAgent.run(now(), task.agentId);
    record(
      receipt(
        "sentinel-progress",
        task.title,
        {
          taskId,
          agentId: task.agentId,
          progress,
          note: String(input.note ?? "").slice(0, 500) || null,
          honesty: HONESTY.UNCERTAIN,
          meaning: "agent-reported progress, not verified",
        },
        { verified: false },
      ),
    );
    return { taskId, progress };
  }

  function stepsFor(taskId) {
    return q.listSteps.all(taskId).map((r) => ({
      id: r.id,
      agentId: r.agent_id,
      kind: r.kind,
      detail: r.detail,
      at: new Date(r.at).toISOString(),
    }));
  }

  /** Owner controls: priority and cancellation. */
  function setPriority(taskId, priority) {
    const task = hydrateTask(q.getTask.get(taskId));
    if (!task) throw new Error("Unknown task.");
    if (!["low", "normal", "high", "urgent"].includes(priority))
      throw new Error("Priority must be low, normal, high, or urgent.");
    q.putMeta.run(taskId, task.progress, priority, task.cancelled ? 1 : 0);
    record(receipt("sentinel-task-priority", task.title, { taskId, priority }));
    return hydrateTask(q.getTask.get(taskId));
  }

  function cancelTask(taskId, reason = "owner-request") {
    const task = hydrateTask(q.getTask.get(taskId));
    if (!task) throw new Error("Unknown task.");
    q.putMeta.run(taskId, task.progress, task.priority, 1);
    q.setTask.run(
      TASK_STATUS.CANCELLED,
      task.claim ? JSON.stringify(task.claim) : null,
      now(),
      taskId,
    );
    if (task.agentId) q.setAgentStatus.run("registered", null, task.agentId);
    record(receipt("sentinel-task-cancelled", task.title, { taskId, reason }));
    return hydrateTask(q.getTask.get(taskId));
  }

  /** A full proof record for one task: every field the mandate lists. */
  function proofRecord(taskId) {
    const task = hydrateTask(q.getTask.get(taskId));
    if (!task) throw new Error("Unknown task.");
    const agent = task.agentId
      ? hydrateAgent(q.getAgent.get(task.agentId))
      : null;
    const steps = stepsFor(taskId);
    const verifications = q.listVerifications.all(taskId).map((r) => ({
      id: r.id,
      outcome: r.outcome,
      checks: parse(r.checks, []),
      receiptId: r.receipt_id,
      at: new Date(r.created_at).toISOString(),
    }));
    return {
      taskId,
      originalInstruction: task.instruction,
      acceptanceCriteria: task.acceptance,
      agentResponsible: agent
        ? { id: agent.id, name: agent.name, provider: agent.provider }
        : null,
      actionsTaken: steps.filter(
        (x) => x.kind === "action" || x.kind === "note",
      ),
      commandsExecuted: steps.filter((x) => x.kind === "command"),
      filesModified: steps.filter((x) => x.kind === "file"),
      errors: steps.filter((x) => x.kind === "error"),
      claim: task.claim,
      progress: task.progress,
      restorePoint: task.restorePoint,
      testResults: verifications.flatMap((v) =>
        v.checks.filter((c) => c.check === "npm-test"),
      ),
      verifications,
      securityFindings: injectionEvents.filter((e) => e.taskId === taskId),
      finalStatus: task.status,
      honesty: {
        agentReported: [
          "actionsTaken",
          "commandsExecuted",
          "filesModified",
          "errors",
          "claim",
          "progress",
        ],
        sentinelVerified: [
          "verifications",
          "testResults",
          "restorePoint",
          "finalStatus",
        ],
      },
    };
  }

  // ---------- Approvals (Level 2 / 3 actions routed to the owner) ----------

  function requestApproval(input = {}) {
    requireNotLatched();
    const action = String(input.action ?? "").trim();
    const reason = String(input.reason ?? "").trim();
    if (!action) throw new Error("An approval request needs an action.");
    const level = [2, 3].includes(Number(input.level))
      ? Number(input.level)
      : 2;
    const risk = ["low", "medium", "high"].includes(input.risk)
      ? input.risk
      : "medium";
    if (input.agentId && !q.getAgent.get(input.agentId))
      throw new Error("Unknown agent.");
    const approvalId = id("APV");
    q.putApproval.run(
      approvalId,
      input.agentId ?? null,
      action,
      reason,
      level,
      risk,
      now(),
    );
    flagInjection(`${action}\n${reason}`, {
      approvalId,
      agentId: input.agentId ?? null,
      where: "approval-request",
      title: action,
    });
    try {
      hooks.onNotify?.({
        kind: "approval-required",
        title: `Approval required: ${action}`,
        body: reason,
        priority: "high",
      });
    } catch {
      // best-effort
    }
    record(
      receipt("sentinel-approval-requested", action, {
        approvalId,
        agentId: input.agentId ?? null,
        level,
        risk,
        reason,
      }),
    );
    return hydrateApproval(q.getApproval.get(approvalId));
  }

  /**
   * Decide an approval. A Level 3 decision requires a live All Access session,
   * so a paired phone cannot approve a high-risk action without the desktop
   * having granted authority first.
   */
  function decideApproval(
    approvalId,
    { decision, via = "desktop", authority = false } = {},
  ) {
    requireNotLatched();
    const approval = hydrateApproval(q.getApproval.get(approvalId));
    if (!approval) throw new Error("Unknown approval.");
    if (approval.status !== "pending")
      throw new Error("This approval was already decided.");
    if (!["approved", "denied"].includes(decision))
      throw new Error('Decision must be "approved" or "denied".');
    if (
      decision === "approved" &&
      approval.level === LEVEL.HUMAN_CONFIRMATION &&
      !authority
    )
      throw new Error("A Level 3 approval requires a live All Access session.");
    q.decideApproval.run(decision, via, now(), approvalId);
    record(
      receipt("sentinel-approval-decided", approval.action, {
        approvalId,
        decision,
        via,
        level: approval.level,
        agentId: approval.agentId,
      }),
    );
    return hydrateApproval(q.getApproval.get(approvalId));
  }

  // ---------- Dashboard ----------

  // Recent suspected injections, surfaced as warnings. The receipt is the
  // durable record; this is only what the dashboard shows right now.
  const injectionEvents = [];
  function flagInjection(text, context) {
    const scan = inspect(text, SOURCE.AGENT);
    if (!scan.suspicious) return false;
    record(
      receipt(
        "sentinel-injection-suspected",
        context.title,
        { ...context, reasons: scan.reasons },
        { verified: true },
      ),
    );
    injectionEvents.unshift({ ...context, reasons: scan.reasons });
    injectionEvents.length = Math.min(injectionEvents.length, 50);
    try {
      hooks.onNotify?.({
        kind: "security-warning",
        title: "Suspected prompt injection",
        body: `${context.title}: ${scan.reasons.join(", ")}`,
        priority: "urgent",
      });
    } catch {
      // best-effort
    }
    return true;
  }

  function status({ discovered = [] } = {}) {
    const agents = listAgents({ discovered });
    const tasks = q.listTasks.all().map(hydrateTask);
    const approvals = q.listApprovals.all().map(hydrateApproval);
    const count = (s) => tasks.filter((t) => t.status === s).length;
    const warnings = [];
    for (const a of agents) {
      if (a.health === "stalled")
        warnings.push({ kind: "agent-stalled", agentId: a.id, name: a.name });
      if (a.pausedReason === "budget-exceeded")
        warnings.push({ kind: "budget-exceeded", agentId: a.id, name: a.name });
    }
    for (const t of tasks)
      if (t.status === TASK_STATUS.REQUIRES_HUMAN_REVIEW)
        warnings.push({
          kind: "requires-human-review",
          taskId: t.id,
          title: t.title,
        });
    for (const e of injectionEvents)
      warnings.push({ kind: "injection-suspected", ...e });
    const latched = isLatched();
    return {
      protected: !latched,
      latched,
      agents: {
        total: agents.length,
        working: agents.filter((a) => a.status === "working").length,
        paused: agents.filter((a) => a.status === "paused").length,
        list: agents,
      },
      tasks: {
        active: count(TASK_STATUS.PLANNED) + count(TASK_STATUS.VERIFYING),
        claimed: count(TASK_STATUS.CLAIMED),
        verified: count(TASK_STATUS.VERIFIED_COMPLETE),
        failed:
          count(TASK_STATUS.FAILED) + count(TASK_STATUS.PARTIALLY_COMPLETE),
        blocked: count(TASK_STATUS.BLOCKED) + count(TASK_STATUS.UNVERIFIED),
        needsHuman: count(TASK_STATUS.REQUIRES_HUMAN_REVIEW),
        cancelled: count(TASK_STATUS.CANCELLED),
        list: tasks,
      },
      approvals: {
        pending: approvals.filter((a) => a.status === "pending").length,
        list: approvals,
      },
      warnings,
      recentVerifications: q.allVerifications
        .all()
        .slice(0, 10)
        .map((r) => ({
          id: r.id,
          taskId: r.task_id,
          agentId: r.agent_id,
          outcome: r.outcome,
          receiptId: r.receipt_id,
          at: new Date(r.created_at).toISOString(),
        })),
      verifiers: Object.entries(VERIFIERS).map(([name, v]) => ({
        name,
        describe: v.describe,
      })),
      levels: LEVEL,
    };
  }

  return {
    TASK_STATUS,
    HONESTY,
    LEVEL,
    VERIFIERS: Object.keys(VERIFIERS),
    levelFor,
    policy,
    setLevel,
    requireLevel,
    registerAgent,
    listAgents,
    pauseAgent,
    resumeAgent,
    revokeAgent,
    pauseAll,
    recordUsage,
    trustScore,
    createTask,
    claimComplete,
    verifyTask,
    recordRestorePoint,
    reportStep,
    reportProgress,
    stepsFor,
    setPriority,
    cancelTask,
    proofRecord,
    listTasks: () => q.listTasks.all().map(hydrateTask),
    verificationsFor: (taskId) =>
      q.listVerifications.all(taskId).map((r) => ({
        id: r.id,
        outcome: r.outcome,
        checks: parse(r.checks, []),
        receiptId: r.receipt_id,
        at: new Date(r.created_at).toISOString(),
      })),
    requestApproval,
    decideApproval,
    status,
    close: () => db.close(),
  };
}
