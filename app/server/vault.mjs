import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";

// RAIMOSA Credential Vault — a broker over the operating system's secure store.
//
// The rules this module exists to keep:
//
//   1. A secret never lands in RAIMOSA's own database, the receipt ledger, a
//      log line, or an API response. The state DB holds only an INDEX of names.
//   2. The API can store, list (names only), and delete. There is no route
//      that returns a secret's value. RAIMOSA's own components (for example a
//      provider adapter) read a secret in-process via `read()` and use it there.
//   3. Storage uses the OS keychain. On macOS that is the login Keychain via
//      /usr/bin/security, under a `RAIMOSA:` service prefix so the vault can
//      never see or touch an item it did not create. Windows Credential
//      Manager and Linux Secret Service are declared unavailable until an
//      adapter exists and has been verified on that platform — nothing here
//      pretends.
//
// A memory backend exists for tests and for platforms without a verified
// adapter; it is reported as `durable:false` so no interface can call it a
// vault.

const execFileAsync = promisify(execFile);
const SERVICE_PREFIX = "RAIMOSA:";
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const MAX_SECRET_BYTES = 8 * 1024;

export function keychainBackend() {
  const service = (name) => `${SERVICE_PREFIX}${name}`;
  return {
    id: "macos-keychain",
    durable: true,
    async put(name, secret) {
      // -U updates an existing item in place instead of failing on duplicates.
      await execFileAsync(
        "/usr/bin/security",
        [
          "add-generic-password",
          "-a",
          name,
          "-s",
          service(name),
          "-w",
          secret,
          "-U",
        ],
        { timeout: 10_000 },
      );
    },
    async read(name) {
      try {
        const { stdout } = await execFileAsync(
          "/usr/bin/security",
          ["find-generic-password", "-a", name, "-s", service(name), "-w"],
          { timeout: 10_000, maxBuffer: 64 * 1024 },
        );
        return stdout.replace(/\n$/, "");
      } catch {
        return null;
      }
    },
    async remove(name) {
      await execFileAsync(
        "/usr/bin/security",
        ["delete-generic-password", "-a", name, "-s", service(name)],
        { timeout: 10_000 },
      ).catch(() => {});
    },
  };
}

export function memoryBackend() {
  const store = new Map();
  return {
    id: "memory",
    durable: false,
    async put(name, secret) {
      store.set(name, secret);
    },
    async read(name) {
      return store.has(name) ? store.get(name) : null;
    },
    async remove(name) {
      store.delete(name);
    },
  };
}

export function defaultBackend() {
  if (process.platform === "darwin") return keychainBackend();
  return null;
}

/**
 * @param {object} deps
 * @param {string} deps.stateFile   Shared state DB; holds the name index only.
 * @param {(r:object)=>object} deps.record
 * @param {(tool:string,scope:string,result:object,opts?:object)=>object} deps.receipt
 * @param {object|null} [deps.backend]  Storage backend; null → unavailable.
 */
export function createVault({ stateFile, record, receipt, backend }) {
  const db = new DatabaseSync(stateFile);
  if (stateFile !== ":memory:") db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS vault_index (
      name        TEXT PRIMARY KEY,
      purpose     TEXT,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      last_used   INTEGER
    );
  `);
  const q = {
    upsert: db.prepare(
      `INSERT INTO vault_index (name, purpose, created_at, updated_at, last_used)
       VALUES (?, ?, ?, ?, NULL)
       ON CONFLICT(name) DO UPDATE SET purpose = excluded.purpose, updated_at = excluded.updated_at`,
    ),
    get: db.prepare("SELECT * FROM vault_index WHERE name = ?"),
    list: db.prepare("SELECT * FROM vault_index ORDER BY name"),
    touch: db.prepare("UPDATE vault_index SET last_used = ? WHERE name = ?"),
    remove: db.prepare("DELETE FROM vault_index WHERE name = ?"),
  };
  const store = backend === undefined ? defaultBackend() : backend;

  function requireAvailable() {
    if (!store)
      throw new Error(
        `The credential vault has no verified secure-store adapter on ${process.platform} yet.`,
      );
  }
  function validName(name) {
    const value = String(name ?? "").trim();
    if (!NAME_PATTERN.test(value))
      throw new Error(
        "A secret name is 1–64 characters: letters, digits, dot, dash, underscore.",
      );
    return value;
  }

  const row = (r) =>
    r && {
      name: r.name,
      purpose: r.purpose,
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
      lastUsed: r.last_used ? new Date(r.last_used).toISOString() : null,
    };

  return {
    status() {
      return {
        available: Boolean(store),
        backend: store?.id ?? null,
        durable: store?.durable ?? false,
        platform: process.platform,
        count: q.list.all().length,
        note: store
          ? store.durable
            ? "Secrets live in the operating system keychain. RAIMOSA stores only their names."
            : "Memory backend: secrets are NOT persisted. For tests only."
          : "No verified secure-store adapter on this platform; storing is refused.",
      };
    },

    /** Names and metadata only. Never values. */
    list() {
      return q.list.all().map(row);
    },

    async put(name, secret, { purpose = null } = {}) {
      requireAvailable();
      const key = validName(name);
      const value = String(secret ?? "");
      if (!value) throw new Error("A secret value is required.");
      if (Buffer.byteLength(value, "utf8") > MAX_SECRET_BYTES)
        throw new Error("Secrets are limited to 8 KB.");
      await store.put(key, value);
      const t = Date.now();
      q.upsert.run(key, purpose ? String(purpose).slice(0, 200) : null, t, t);
      // The receipt proves a secret was stored. It carries the name and the
      // length — never the value, never a hash a guesser could test against.
      record(
        receipt("vault-secret-stored", "credential vault", {
          name: key,
          purpose,
          bytes: Buffer.byteLength(value, "utf8"),
          backend: store.id,
        }),
      );
      return row(q.get.get(key));
    },

    /**
     * In-process read for RAIMOSA's own components. Not reachable over the
     * API. Records that a read happened, not what was read.
     */
    async read(name, { by = "raimosa" } = {}) {
      if (!store) return null;
      const key = validName(name);
      const value = await store.read(key);
      if (value !== null) {
        q.touch.run(Date.now(), key);
        record(
          receipt("vault-secret-used", "credential vault", { name: key, by }),
        );
      }
      return value;
    },

    async remove(name) {
      requireAvailable();
      const key = validName(name);
      await store.remove(key);
      q.remove.run(key);
      record(
        receipt("vault-secret-removed", "credential vault", { name: key }),
      );
      return { name: key, removed: true };
    },

    close: () => db.close(),
  };
}
