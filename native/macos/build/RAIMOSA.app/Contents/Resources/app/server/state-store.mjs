import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// RAIMOSA durable authority and approval state.
//
// Approvals, All Access sessions, mobile-remote sessions, and pairing codes
// previously lived only in memory, so a crash or restart silently discarded
// them and left no account of what had been granted.
//
// Two rules shape this store:
//
// 1. Secrets are never written to disk. Access tokens, remote tokens, and
//    pairing codes are stored only as SHA-256 hashes. The store can recognise
//    and revoke a credential it is shown, but the database alone cannot be
//    used to mint one.
//
// 2. Authority does not silently survive a restart. All Access is defined as a
//    *visible* session; once the runtime stops, its countdown is gone. On
//    startup any surviving session is explicitly closed and reported, never
//    resurrected. Approvals do survive, because they are inert until an
//    approved plan is executed under live authority.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  kind       TEXT NOT NULL,
  key_hash   TEXT NOT NULL,
  id         TEXT NOT NULL,
  payload    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (kind, key_hash)
);

CREATE TABLE IF NOT EXISTS flags (
  name       TEXT PRIMARY KEY,
  payload    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS approvals (
  id          TEXT PRIMARY KEY,
  root        TEXT NOT NULL,
  operations  TEXT NOT NULL,
  hash        TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  claimed_at  INTEGER
);
`;

function hashSecret(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

/**
 * Open (or create) the durable authority store.
 *
 * @param {string} file Absolute path to the SQLite file, or ":memory:".
 */
export function createStateStore(file) {
  if (file !== ":memory:") {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);

  const putSession = db.prepare(
    `INSERT OR REPLACE INTO sessions (kind, key_hash, id, payload, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const getSession = db.prepare(
    "SELECT * FROM sessions WHERE kind = ? AND key_hash = ?",
  );
  const deleteSession = db.prepare(
    "DELETE FROM sessions WHERE kind = ? AND key_hash = ?",
  );
  const listSessionsOfKind = db.prepare(
    "SELECT * FROM sessions WHERE kind = ?",
  );
  const deleteKind = db.prepare("DELETE FROM sessions WHERE kind = ?");
  const deleteExpired = db.prepare(
    "DELETE FROM sessions WHERE expires_at <= ?",
  );

  const putApproval = db.prepare(
    `INSERT OR REPLACE INTO approvals (id, root, operations, hash, expires_at, claimed_at)
     VALUES (?, ?, ?, ?, ?, NULL)`,
  );
  const getApproval = db.prepare("SELECT * FROM approvals WHERE id = ?");
  const claimApproval = db.prepare(
    "UPDATE approvals SET claimed_at = ? WHERE id = ? AND claimed_at IS NULL",
  );
  const dropApproval = db.prepare("DELETE FROM approvals WHERE id = ?");
  const dropExpiredApprovals = db.prepare(
    "DELETE FROM approvals WHERE expires_at <= ?",
  );

  function hydrate(row) {
    return {
      ...JSON.parse(row.payload),
      id: row.id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }

  return {
    file,
    durable: file !== ":memory:",

    /** Persist a session, keyed by the hash of its secret. */
    putSession(kind, secret, session) {
      const { id, createdAt, expiresAt, ...rest } = session;
      // Defence in depth: a caller that accidentally leaves a live credential
      // on the session object must fail loudly rather than write it to disk.
      for (const key of Object.keys(rest)) {
        if (/^(token|code|secret|password|key)$/i.test(key)) {
          throw new Error(
            `Refusing to persist "${key}": credentials are stored only as hashes.`,
          );
        }
      }
      if (rest && JSON.stringify(rest).includes(String(secret))) {
        throw new Error(
          "Refusing to persist a session payload that contains its own secret.",
        );
      }
      putSession.run(
        kind,
        hashSecret(secret),
        id,
        JSON.stringify(rest),
        createdAt,
        expiresAt,
      );
      return session;
    },

    getSession(kind, secret) {
      if (secret === undefined || secret === null) return null;
      const row = getSession.get(kind, hashSecret(secret));
      return row ? hydrate(row) : null;
    },

    /**
     * Look a session up by the hash of its secret rather than the secret
     * itself. A paired phone presents only a pairing code, so the desktop
     * access session behind it has to be resolved without ever re-deriving
     * that session's token.
     */
    getSessionByHash(kind, keyHash) {
      if (!keyHash) return null;
      const row = getSession.get(kind, String(keyHash));
      return row ? hydrate(row) : null;
    },

    deleteSession(kind, secret) {
      if (secret === undefined || secret === null) return;
      deleteSession.run(kind, hashSecret(secret));
    },

    listSessions(kind) {
      return listSessionsOfKind.all(kind).map(hydrate);
    },

    /**
     * Drop every session of a kind whose payload matches a predicate. Used to
     * cascade revocation from All Access down to paired remotes.
     */
    deleteSessionsWhere(kind, predicate) {
      let removed = 0;
      for (const row of listSessionsOfKind.all(kind)) {
        if (predicate(hydrate(row))) {
          deleteSession.run(kind, row.key_hash);
          removed += 1;
        }
      }
      return removed;
    },

    deleteAll(kind) {
      deleteKind.run(kind);
    },

    purgeExpired(now = Date.now()) {
      deleteExpired.run(now);
      dropExpiredApprovals.run(now);
    },

    putApproval(approval) {
      putApproval.run(
        approval.id,
        approval.root,
        JSON.stringify(approval.operations),
        approval.hash,
        approval.expiresAt,
      );
      return approval;
    },

    getApproval(id) {
      const row = getApproval.get(String(id ?? ""));
      if (!row) return null;
      return {
        id: row.id,
        root: row.root,
        operations: JSON.parse(row.operations),
        hash: row.hash,
        expiresAt: row.expires_at,
        claimedAt: row.claimed_at,
      };
    },

    /**
     * Atomically take single-use ownership of an approval.
     *
     * The claim is written *before* any file is touched, so a crash midway
     * through execution can never let the same approved plan run a second
     * time. Returns false if the approval was already claimed.
     */
    claimApproval(id, now = Date.now()) {
      const result = claimApproval.run(now, String(id ?? ""));
      return result.changes === 1;
    },

    deleteApproval(id) {
      dropApproval.run(String(id ?? ""));
    },

    /**
     * Durable named flags (e.g. the emergency-stop latch). A flag has no
     * expiry: it stays set across restarts until explicitly cleared.
     */
    setFlag(name, payload = {}) {
      db.prepare(
        "INSERT OR REPLACE INTO flags (name, payload, created_at) VALUES (?, ?, ?)",
      ).run(String(name), JSON.stringify(payload), Date.now());
    },

    getFlag(name) {
      const row = db
        .prepare("SELECT payload, created_at FROM flags WHERE name = ?")
        .get(String(name));
      return row ? { ...JSON.parse(row.payload), setAt: row.created_at } : null;
    },

    clearFlag(name) {
      db.prepare("DELETE FROM flags WHERE name = ?").run(String(name));
    },

    close() {
      db.close();
    },
  };
}
