import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

// RAIMOSA structured memory.
//
// Four kinds, each with a different lifetime and owner:
//   short-term    — current task context; expires on its own
//   project       — decisions and architecture for a project
//   user          — explicit preferences and workflows
//   verification  — how agents have performed (written by Sentinel)
//
// Rules:
//   • Memory holds facts, never secrets. Anything that looks like a credential
//     is refused at write time — the vault is the only place for those.
//   • The owner can view, edit, delete, disable, and export every entry.
//     When memory is disabled, writes are refused and reads return nothing;
//     nothing is silently retained "just in case".
//   • Every write and delete is a ledger receipt (content is summarised by
//     kind and key, not copied — memory can be edited, the ledger cannot).

export const MEMORY_KIND = Object.freeze({
  SHORT_TERM: "short-term",
  PROJECT: "project",
  USER: "user",
  VERIFICATION: "verification",
});

const SHORT_TERM_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_VALUE_BYTES = 16 * 1024;

// Secret-shaped values are refused. Broad on purpose: refusing a harmless
// string costs a retry; storing a key in memory would defeat the vault.
const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}/, // OpenAI-style keys
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/, // GitHub tokens
  /\bxox[abps]-[A-Za-z0-9-]{10,}/, // Slack tokens
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:password|passwd|api[\s_-]?key|secret|token)\s*[:=]\s*\S{6,}/i,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/, // JWT
];

export function looksLikeSecret(text) {
  const value = String(text ?? "");
  return SECRET_PATTERNS.some((re) => re.test(value));
}

export function createMemory({ stateFile, record, receipt }) {
  const db = new DatabaseSync(stateFile);
  if (stateFile !== ":memory:") db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id          TEXT PRIMARY KEY,
      kind        TEXT NOT NULL,
      key         TEXT NOT NULL,
      value       TEXT NOT NULL,
      scope       TEXT,
      source      TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      expires_at  INTEGER
    );
    CREATE UNIQUE INDEX IF NOT EXISTS memories_kind_scope_key
      ON memories (kind, COALESCE(scope, ''), key);
    CREATE TABLE IF NOT EXISTS memory_settings (
      name   TEXT PRIMARY KEY,
      value  TEXT NOT NULL
    );
  `);
  const q = {
    upsert: db.prepare(
      `INSERT INTO memories (id, kind, key, value, scope, source, created_at, updated_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(kind, COALESCE(scope, ''), key) DO UPDATE SET
         value = excluded.value, source = excluded.source,
         updated_at = excluded.updated_at, expires_at = excluded.expires_at`,
    ),
    get: db.prepare("SELECT * FROM memories WHERE id = ?"),
    list: db.prepare(
      "SELECT * FROM memories WHERE (expires_at IS NULL OR expires_at > ?) ORDER BY kind, scope, key",
    ),
    listKind: db.prepare(
      "SELECT * FROM memories WHERE kind = ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY scope, key",
    ),
    remove: db.prepare("DELETE FROM memories WHERE id = ?"),
    removeAll: db.prepare("DELETE FROM memories"),
    purge: db.prepare(
      "DELETE FROM memories WHERE expires_at IS NOT NULL AND expires_at <= ?",
    ),
    getSetting: db.prepare("SELECT value FROM memory_settings WHERE name = ?"),
    setSetting: db.prepare(
      "INSERT OR REPLACE INTO memory_settings (name, value) VALUES (?, ?)",
    ),
  };

  const now = () => Date.now();
  const hydrate = (r) =>
    r && {
      id: r.id,
      kind: r.kind,
      key: r.key,
      value: r.value,
      scope: r.scope,
      source: r.source,
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
      expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
    };

  function enabled() {
    return q.getSetting.get("enabled")?.value !== "false";
  }

  function remember({ kind, key, value, scope = null, source = "owner" } = {}) {
    if (!enabled())
      throw new Error(
        "Memory is disabled. Enable it in the Memory screen to store anything.",
      );
    if (!Object.values(MEMORY_KIND).includes(kind))
      throw new Error(`Unknown memory kind: ${kind}`);
    const k = String(key ?? "").trim();
    const v = String(value ?? "").trim();
    if (!k || !v) throw new Error("A memory needs a key and a value.");
    if (Buffer.byteLength(v, "utf8") > MAX_VALUE_BYTES)
      throw new Error("A memory value is limited to 16 KB.");
    if (looksLikeSecret(v) || looksLikeSecret(k))
      throw new Error(
        "That looks like a credential. Memory never holds secrets — store it in the Credential Vault instead.",
      );
    q.purge.run(now());
    const t = now();
    const expiresAt =
      kind === MEMORY_KIND.SHORT_TERM ? t + SHORT_TERM_TTL_MS : null;
    q.upsert.run(
      `MEM-${randomUUID().slice(0, 8).toUpperCase()}`,
      kind,
      k,
      v,
      scope,
      source,
      t,
      t,
      expiresAt,
    );
    record(
      receipt("memory-remembered", `${kind}${scope ? `:${scope}` : ""}`, {
        kind,
        key: k,
        scope,
        source,
        bytes: Buffer.byteLength(v, "utf8"),
      }),
    );
    return hydrate(
      db
        .prepare(
          "SELECT * FROM memories WHERE kind = ? AND COALESCE(scope,'') = ? AND key = ?",
        )
        .get(kind, scope ?? "", k),
    );
  }

  function recall({ kind, scope } = {}) {
    if (!enabled()) return [];
    q.purge.run(now());
    const rows = kind ? q.listKind.all(kind, now()) : q.list.all(now());
    return rows
      .map(hydrate)
      .filter((m) => scope === undefined || m.scope === scope);
  }

  function forget(id) {
    const row = hydrate(q.get.get(id));
    if (!row) throw new Error("Unknown memory.");
    q.remove.run(id);
    record(
      receipt(
        "memory-forgotten",
        `${row.kind}${row.scope ? `:${row.scope}` : ""}`,
        {
          id,
          kind: row.kind,
          key: row.key,
        },
      ),
    );
    return { id, forgotten: true };
  }

  function forgetAll() {
    const count = q.list.all(0).length;
    q.removeAll.run();
    record(receipt("memory-cleared", "memory", { count }));
    return { cleared: count };
  }

  function setEnabled(on) {
    q.setSetting.run("enabled", on ? "true" : "false");
    record(receipt("memory-setting", "memory", { enabled: Boolean(on) }));
    return { enabled: Boolean(on) };
  }

  function exportAll() {
    return {
      product: "RAIMOSA",
      exportedAt: new Date().toISOString(),
      enabled: enabled(),
      memories: recall(),
    };
  }

  /** Written by Sentinel after each verification; never by an agent. */
  function recordVerification({
    agentId,
    agentName,
    taskId,
    taskTitle,
    outcome,
  }) {
    if (!enabled() || !agentId) return null;
    return remember({
      kind: MEMORY_KIND.VERIFICATION,
      scope: agentId,
      key: taskId,
      value: `${outcome} — ${taskTitle}${agentName ? ` (${agentName})` : ""}`,
      source: "sentinel",
    });
  }

  return {
    MEMORY_KIND,
    status: () => ({ enabled: enabled(), count: recall().length }),
    remember,
    recall,
    forget,
    forgetAll,
    setEnabled,
    exportAll,
    recordVerification,
    close: () => db.close(),
  };
}
