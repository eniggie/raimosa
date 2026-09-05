import { useCallback, useEffect, useState } from "react";
import {
  FingerprintIcon as Fingerprint,
  LockKeyIcon as LockKey,
  ShieldCheckIcon as ShieldCheck,
  TrashIcon as Trash,
  WarningIcon as Warning,
} from "@phosphor-icons/react";
import { desktopApi } from "../desktop-api";

// The Credential Vault screen shows NAMES. It has no way to display a value,
// because no route returns one: secrets live in the operating system's
// keychain and RAIMOSA's own components read them in-process. Storing needs a
// live All Access session; removing additionally needs a typed CONFIRM.

export function VaultView({ accessToken, onRequestAccess, onAnnouncement }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", secret: "", purpose: "" });
  const [confirming, setConfirming] = useState({});

  const refresh = useCallback(async () => {
    try {
      setStatus(await desktopApi.vaultStatus());
      setError("");
    } catch (refreshError) {
      setError(refreshError.message);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function store(event) {
    event.preventDefault();
    if (!accessToken) {
      onRequestAccess?.();
      return;
    }
    setBusy(true);
    setError("");
    try {
      await desktopApi.vaultPut(
        form.name,
        form.secret,
        form.purpose,
        accessToken,
      );
      onAnnouncement?.(`Stored ${form.name} in the vault.`);
      // The value is cleared from the page the moment it is stored.
      setForm({ name: "", secret: "", purpose: "" });
      await refresh();
    } catch (storeError) {
      setError(storeError.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(name) {
    if (!accessToken) {
      onRequestAccess?.();
      return;
    }
    if (confirming[name] !== "CONFIRM") return;
    setBusy(true);
    setError("");
    try {
      await desktopApi.vaultRemove(name, accessToken);
      onAnnouncement?.(`Removed ${name} from the vault.`);
      setConfirming((c) => ({ ...c, [name]: "" }));
      await refresh();
    } catch (removeError) {
      setError(removeError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="workspace-page vault-view">
      <div className="page-heading">
        <div>
          <span>CREDENTIAL VAULT</span>
          <h1>Secrets stay in the keychain</h1>
          <p>
            {status
              ? status.note
              : error
                ? `The local adapter is not responding: ${error}`
                : "Reading the vault…"}
          </p>
        </div>
      </div>

      {error && (
        <p className="sentinel-error" role="alert">
          {error}
        </p>
      )}

      {status && (
        <div className="metric-grid" aria-label="Vault status">
          <article>
            <span>BACKEND</span>
            <strong>
              {status.available
                ? status.durable
                  ? "OS keychain"
                  : "memory"
                : "none"}
            </strong>
            <p>
              {status.available
                ? `${status.backend} on ${status.platform}`
                : `No verified adapter on ${status.platform}`}
            </p>
          </article>
          <article>
            <span>STORED</span>
            <strong>{status.count}</strong>
            <p>names indexed · values never leave the keychain</p>
          </article>
          <article className={accessToken ? "access-live" : ""}>
            <span>AUTHORITY</span>
            <strong>{accessToken ? "LIVE" : "OFF"}</strong>
            <p>
              {accessToken
                ? "storing and removing are enabled"
                : "All Access is required to change the vault"}
            </p>
          </article>
        </div>
      )}

      <section className="surface live-tool">
        <header>
          <div>
            <Fingerprint size={24} />
            <span>STORED CREDENTIALS</span>
          </div>
          <h2>What RAIMOSA holds for you</h2>
          <p>
            Each entry is a name. Components such as the OpenAI provider read
            the value in-process; every read leaves a receipt.
          </p>
        </header>
        {!status || status.secrets.length === 0 ? (
          <p className="empty-note">Nothing stored yet.</p>
        ) : (
          status.secrets.map((s) => (
            <div className="sentinel-row" key={s.name}>
              <div>
                <strong>{s.name}</strong>
                <span>
                  {s.purpose ? `${s.purpose} · ` : ""}
                  added {new Date(s.createdAt).toLocaleDateString()}
                  {s.lastUsed
                    ? ` · last used ${new Date(s.lastUsed).toLocaleString()}`
                    : " · never used"}
                </span>
              </div>
              <div className="sentinel-actions">
                <input
                  aria-label={`Type CONFIRM to remove ${s.name}`}
                  placeholder="Type CONFIRM"
                  value={confirming[s.name] ?? ""}
                  onChange={(e) =>
                    setConfirming({ ...confirming, [s.name]: e.target.value })
                  }
                />
                <button
                  type="button"
                  className="secondary"
                  disabled={busy || confirming[s.name] !== "CONFIRM"}
                  onClick={() => void remove(s.name)}
                >
                  <Trash size={16} /> Remove
                </button>
              </div>
            </div>
          ))
        )}
      </section>

      <section className="surface live-tool">
        <header>
          <div>
            <LockKey size={24} />
            <span>STORE A CREDENTIAL</span>
          </div>
          <h2>Add to the keychain</h2>
          <p>
            The value is sent once to the local adapter over loopback, written
            to the keychain, and cleared from this page. It is not written to
            any RAIMOSA database or receipt.
          </p>
        </header>
        {status && !status.available ? (
          <p className="sentinel-note">
            <Warning size={16} /> Storing is refused here because this platform
            has no verified secure-store adapter yet.
          </p>
        ) : (
          <form className="tool-form sentinel-form" onSubmit={store}>
            <input
              aria-label="Secret name"
              placeholder="Name (e.g. OPENAI_API_KEY)"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              autoComplete="off"
            />
            <input
              aria-label="Secret value"
              type="password"
              placeholder="Value"
              value={form.secret}
              onChange={(e) => setForm({ ...form, secret: e.target.value })}
              required
              autoComplete="new-password"
            />
            <input
              aria-label="Purpose"
              placeholder="Purpose (optional)"
              value={form.purpose}
              onChange={(e) => setForm({ ...form, purpose: e.target.value })}
            />
            <button
              type="submit"
              className="primary"
              disabled={busy || !status?.available}
            >
              <ShieldCheck size={16} />{" "}
              {accessToken ? "Store in keychain" : "Request access to store"}
            </button>
          </form>
        )}
      </section>
    </section>
  );
}
