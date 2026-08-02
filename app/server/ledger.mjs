import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// RAIMOSA durable receipt ledger.
//
// Every adapter call, All Access lifecycle event, and mobile-remote event is
// appended here. The ledger is append-only at the database level: UPDATE and
// DELETE are rejected by triggers, not merely avoided by convention.
//
// Each row carries a SHA-256 hash over its own content plus the previous row's
// hash. A verifier can therefore prove that no receipt was altered, reordered,
// or removed after the fact. That property is what lets the product claim a
// receipt is evidence rather than a log line.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS receipts (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  id         TEXT NOT NULL UNIQUE,
  tool       TEXT NOT NULL,
  scope      TEXT NOT NULL,
  timestamp  TEXT NOT NULL,
  verified   INTEGER NOT NULL,
  result     TEXT NOT NULL,
  prev_hash  TEXT NOT NULL,
  hash       TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS receipts_are_append_only_update
BEFORE UPDATE ON receipts
BEGIN
  SELECT RAISE(ABORT, 'RAIMOSA receipts are append-only and cannot be updated.');
END;

CREATE TRIGGER IF NOT EXISTS receipts_are_append_only_delete
BEFORE DELETE ON receipts
BEGIN
  SELECT RAISE(ABORT, 'RAIMOSA receipts are append-only and cannot be deleted.');
END;
`;

const GENESIS = "0".repeat(64);

function hashRow(row) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        row.id,
        row.tool,
        row.scope,
        row.timestamp,
        row.verified ? 1 : 0,
        row.result,
        row.prev_hash,
      ]),
    )
    .digest("hex");
}

function toReceipt(row) {
  return {
    id: row.id,
    tool: row.tool,
    scope: row.scope,
    timestamp: row.timestamp,
    verified: row.verified === 1,
    result: JSON.parse(row.result),
    sequence: row.seq,
    hash: row.hash,
  };
}

/**
 * Open (or create) a durable receipt ledger.
 *
 * @param {string} file Absolute path to the SQLite file, or ":memory:" for a
 *   non-durable ledger. Tests use ":memory:"; the product uses a real file.
 */
export function createLedger(file) {
  if (file !== ":memory:") {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);

  const insert = db.prepare(
    `INSERT INTO receipts (id, tool, scope, timestamp, verified, result, prev_hash, hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const selectLatest = db.prepare(
    "SELECT hash FROM receipts ORDER BY seq DESC LIMIT 1",
  );
  const selectPage = db.prepare(
    "SELECT * FROM receipts ORDER BY seq DESC LIMIT ?",
  );
  const selectAll = db.prepare("SELECT * FROM receipts ORDER BY seq ASC");
  const selectCount = db.prepare("SELECT COUNT(*) AS total FROM receipts");

  return {
    file,
    durable: file !== ":memory:",

    /** Append a receipt and return it with its sequence number and hash. */
    append(receipt) {
      const prev = selectLatest.get();
      const row = {
        id: receipt.id,
        tool: receipt.tool,
        scope: String(receipt.scope ?? ""),
        timestamp: receipt.timestamp,
        verified: receipt.verified ? 1 : 0,
        result: JSON.stringify(receipt.result ?? null),
        prev_hash: prev ? prev.hash : GENESIS,
      };
      row.hash = hashRow(row);
      insert.run(
        row.id,
        row.tool,
        row.scope,
        row.timestamp,
        row.verified,
        row.result,
        row.prev_hash,
        row.hash,
      );
      return { ...receipt, sequence: selectCount.get().total, hash: row.hash };
    },

    /** Most recent receipts, newest first. */
    list(limit = 50) {
      const bounded = Math.max(1, Math.min(100, Number(limit) || 50));
      return selectPage.all(bounded).map(toReceipt);
    },

    count() {
      return selectCount.get().total;
    },

    /**
     * Recompute the whole hash chain. Returns the first break, if any, so a
     * scan can report exactly which receipt stopped being trustworthy.
     */
    verify() {
      let expectedPrev = GENESIS;
      let checked = 0;
      for (const row of selectAll.all()) {
        if (row.prev_hash !== expectedPrev) {
          return {
            intact: false,
            checked,
            brokenAt: row.id,
            reason: "Receipt does not follow the previous receipt.",
          };
        }
        if (hashRow(row) !== row.hash) {
          return {
            intact: false,
            checked,
            brokenAt: row.id,
            reason: "Receipt content does not match its recorded hash.",
          };
        }
        expectedPrev = row.hash;
        checked += 1;
      }
      return { intact: true, checked, head: expectedPrev };
    },

    close() {
      db.close();
    },
  };
}
