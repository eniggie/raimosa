// OVIA AI honest status narrator.
//
// This is how OVIA AI answers "what's happening?" with no model at all: it
// reads live Sentinel state and the receipt ledger and says exactly what is
// KNOWN, what is VERIFIED, and what is only an agent's CLAIM. Every sentence
// is derived from a record; none is generated. When a model provider is
// configured it may phrase things more naturally, but the facts it is given
// come from here — so the distinction between "reported" and "verified" can
// never be blurred by fluent prose.

const DAY_MS = 24 * 60 * 60 * 1000;

function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function agentName(status, agentId) {
  return (
    status.agents.list.find((a) => a.id === agentId)?.name ??
    agentId ??
    "an agent"
  );
}

export function narrateStatus(status) {
  const lines = [];
  if (status.latched) {
    lines.push(
      "Emergency stop is active. Every agent is paused and nothing can run until you clear it.",
    );
  }
  const working = status.agents.list.filter((a) => a.status === "working");
  lines.push(
    working.length
      ? `Sentinel is supervising ${plural(working.length, "agent")}: ${working.map((a) => a.name).join(", ")}.`
      : status.agents.total
        ? `Sentinel has ${plural(status.agents.total, "registered agent")} and none is working right now.`
        : "No agents are registered with Sentinel.",
  );

  const claimed = status.tasks.list.filter((t) => t.status === "CLAIMED");
  for (const t of claimed.slice(0, 3)) {
    lines.push(
      `${agentName(status, t.agentId)} reported “${t.title}” as complete, but Sentinel has not verified it yet — that is a claim, not a result.`,
    );
  }
  const failed = status.tasks.list.filter((t) =>
    ["FAILED", "PARTIALLY_COMPLETE", "REQUIRES_HUMAN_REVIEW"].includes(
      t.status,
    ),
  );
  for (const t of failed.slice(0, 3)) {
    lines.push(
      t.status === "REQUIRES_HUMAN_REVIEW"
        ? `“${t.title}” needs your review: Sentinel found repeated failures and stopped escalating on its own.`
        : `Sentinel checked “${t.title}” and it did not pass: ${t.status.replaceAll("_", " ").toLowerCase()}.`,
    );
  }
  if (status.tasks.verified)
    lines.push(
      `${plural(status.tasks.verified, "task")} verified complete with Sentinel's own evidence.`,
    );

  if (status.approvals.pending)
    lines.push(
      `${plural(status.approvals.pending, "approval")} waiting for you: ${status.approvals.list
        .filter((a) => a.status === "pending")
        .slice(0, 3)
        .map(
          (a) =>
            `${agentName(status, a.agentId)} wants to ${a.action.toLowerCase()} (Level ${a.level}, risk ${a.risk})`,
        )
        .join("; ")}.`,
    );
  const security = status.warnings.filter(
    (w) => w.kind === "injection-suspected",
  );
  if (security.length)
    lines.push(
      `Security: ${plural(security.length, "suspected prompt injection")} recorded — the text was kept as evidence and not obeyed.`,
    );
  const stalled = status.warnings.filter((w) => w.kind === "agent-stalled");
  if (stalled.length)
    lines.push(`${stalled.map((w) => w.name).join(", ")} appears stalled.`);
  const budget = status.warnings.filter((w) => w.kind === "budget-exceeded");
  if (budget.length)
    lines.push(
      `${budget.map((w) => w.name).join(", ")} exceeded budget and is paused.`,
    );
  if (
    !status.approvals.pending &&
    !status.warnings.length &&
    !claimed.length &&
    !failed.length &&
    !status.latched
  )
    lines.push("Nothing needs your attention.");
  return lines;
}

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "they",
  "it",
  "this",
  "that",
  "my",
  "our",
  "their",
  "with",
  "on",
  "of",
  "for",
  "to",
  "is",
  "are",
  "was",
  "were",
  "has",
  "have",
  "did",
  "done",
  "finish",
  "finished",
  "complete",
  "completed",
  "project",
  "task",
  "work",
  "yet",
  "already",
  "please",
]);

/** Find a task by the meaningful words of a question, not an exact substring. */
function findTask(status, query) {
  const words = String(query ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w));
  if (!words.length) return null;
  const scored = status.tasks.list
    .map((t) => {
      const title = t.title.toLowerCase();
      const hits = words.filter((w) => title.includes(w)).length;
      return { t, hits };
    })
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  // Require every meaningful word to appear, or a strong majority for long
  // questions, so "the payments thing" does not match "Docs".
  const best = scored[0];
  if (!best) return null;
  return best.hits === words.length ||
    best.hits >= Math.ceil(words.length * 0.6)
    ? best.t
    : null;
}

/** "Did they finish X?" / "Is X done?" — per-task honesty. */
export function narrateTask(status, query) {
  const task = findTask(status, query);
  if (!task) return null;
  const who = agentName(status, task.agentId);
  switch (task.status) {
    case "VERIFIED_COMPLETE":
      return `Yes. “${task.title}” is verified complete — Sentinel ran its own checks and they passed.`;
    case "CLAIMED":
      return `${who} reported “${task.title}” as complete, but Sentinel has not verified it yet. Ask Sentinel to verify it before relying on that.`;
    case "PLANNED":
    case "VERIFYING":
      return `“${task.title}” is still in progress; no completion has been claimed or verified.`;
    case "PARTIALLY_COMPLETE":
      return `Not fully. Sentinel checked “${task.title}” and some checks failed.`;
    case "FAILED":
      return `No. Sentinel checked “${task.title}” and it failed.`;
    case "BLOCKED":
      return `“${task.title}” is blocked — the emergency stop was active when Sentinel tried to verify it.`;
    case "REQUIRES_HUMAN_REVIEW":
      return `“${task.title}” needs your review: repeated failures, so Sentinel stopped escalating on its own.`;
    default:
      return `“${task.title}” is ${task.status}.`;
  }
}

/** "What did Codex do?" / "What happened yesterday?" from the ledger. */
export function narrateLedger(receipts, { agentName: who, since, until } = {}) {
  const from = since ? Date.parse(since) : null;
  const to = until ? Date.parse(until) : null;
  const rows = receipts.filter((r) => {
    const t = Date.parse(r.timestamp);
    if (from && t < from) return false;
    if (to && t > to) return false;
    if (who) {
      const text = JSON.stringify(r.result ?? {}).toLowerCase();
      return (
        text.includes(String(who).toLowerCase()) ||
        r.scope.toLowerCase().includes(String(who).toLowerCase())
      );
    }
    return true;
  });
  if (!rows.length) return ["No receipts match that."];
  const byTool = new Map();
  for (const r of rows) byTool.set(r.tool, (byTool.get(r.tool) ?? 0) + 1);
  const summary = [...byTool.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([tool, n]) => `${n}× ${tool}`)
    .join(", ");
  const verified = rows.filter((r) => r.verified).length;
  return [
    `${plural(rows.length, "receipt")} in that window: ${summary}.`,
    `${verified} of them are verified observations; the rest are dispatched requests or recorded claims.`,
  ];
}

/**
 * Route a question to the right narration. Deterministic keyword routing —
 * the same fail-closed stance as the intent compiler: if the question is not
 * about status, say so instead of guessing.
 */
export function answer(question, { status, receipts, dayOffset = 0 } = {}) {
  const q = String(question ?? "")
    .trim()
    .toLowerCase();
  if (!q)
    return {
      kind: "empty",
      lines: [
        "Ask me what is happening, whether a task is finished, or what an agent did.",
      ],
    };

  if (/\b(yesterday|today|last\s+\d+\s+hours?|this\s+week)\b/.test(q)) {
    const now = Date.now();
    let since, until;
    if (q.includes("yesterday")) {
      since = new Date(now - DAY_MS - dayOffset).toISOString();
      until = new Date(now - dayOffset).toISOString();
    } else if (q.includes("this week"))
      since = new Date(now - 7 * DAY_MS).toISOString();
    else if (/last\s+(\d+)\s+hours?/.test(q))
      since = new Date(
        now - Number(q.match(/last\s+(\d+)\s+hours?/)[1]) * 3600 * 1000,
      ).toISOString();
    else since = new Date(now - DAY_MS).toISOString();
    return { kind: "ledger", lines: narrateLedger(receipts, { since, until }) };
  }
  const didMatch = q.match(/what did (.+?) do\b/);
  if (didMatch)
    return {
      kind: "ledger",
      lines: narrateLedger(receipts, { agentName: didMatch[1].trim() }),
    };

  const whyMatch = q.match(
    /why did sentinel (approve|verify|reject|deny|pause)\b/,
  );
  if (whyMatch) {
    const relevant = receipts
      .filter((r) => r.tool.startsWith("sentinel-"))
      .slice(0, 5);
    return {
      kind: "ledger",
      lines: relevant.length
        ? relevant.map(
            (r) =>
              `${r.timestamp.slice(0, 16).replace("T", " ")} · ${r.tool} · ${r.scope}${r.result?.outcome ? ` → ${r.result.outcome}` : ""}${r.result?.decision ? ` → ${r.result.decision}` : ""} (receipt ${r.id})`,
          )
        : ["Sentinel has not recorded a decision yet."],
    };
  }
  if (/\b(finish|finished|done|complete|completed)\b/.test(q)) {
    // The subject may come after the verb ("did they finish X") or before
    // the completion word ("is X done"); match on meaningful words either way.
    const specific = narrateTask(status, q);
    if (specific) return { kind: "task", lines: [specific] };
    const claimed = status.tasks.list.filter((t) => t.status === "CLAIMED");
    const verified = status.tasks.list.filter(
      (t) => t.status === "VERIFIED_COMPLETE",
    );
    return {
      kind: "task",
      lines: [
        ...claimed.map((t) => narrateTask(status, t.title)),
        verified.length
          ? `${plural(verified.length, "task")} verified complete.`
          : "Nothing is verified complete yet.",
      ],
    };
  }
  if (
    /\b(what'?s|what is) (happening|going on)|status|summary|update|computer\b/.test(
      q,
    )
  )
    return { kind: "status", lines: narrateStatus(status) };

  return {
    kind: "unknown",
    lines: [
      "I can only answer from Sentinel's records: what is happening, whether a task is finished, what an agent did, or why Sentinel decided something. No model is configured to go beyond that.",
    ],
  };
}
