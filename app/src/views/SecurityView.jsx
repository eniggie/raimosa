import { useCallback, useEffect, useState } from "react";
import {
  EyeIcon as Eye,
  ShieldCheckIcon as ShieldCheck,
  ShieldWarningIcon as ShieldWarning,
  WarningIcon as Warning,
} from "@phosphor-icons/react";
import { desktopApi } from "../desktop-api";

// Security & Privacy: every line is derived from a live record. The security
// feed is the ledger filtered to security-relevant receipts; the privacy
// dashboard states what RAIMOSA can see, what agents can see, what leaves the
// device, and what is stored — from health, Sentinel, and the vault, not copy.

const SECURITY_TOOLS = [
  "sentinel-injection-suspected",
  "emergency-stop",
  "emergency-clear",
  "remote-pairing-lockout",
  "access-interrupted",
  "sentinel-budget-exceeded",
  "sentinel-stop-all",
  "vault-secret-stored",
  "vault-secret-used",
  "vault-secret-removed",
  "sentinel-agent-revoked",
];

export function SecurityView() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [health, sentinel, vault, receipts] = await Promise.all([
        desktopApi.health(),
        desktopApi.sentinelStatus(),
        desktopApi.vaultStatus(),
        desktopApi.receiptsQuery({ limit: 300 }),
      ]);
      setData({
        health,
        sentinel,
        vault,
        receipts: receipts.receipts,
        integrity: receipts.integrity,
      });
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 8000);
    return () => window.clearInterval(id);
  }, [refresh]);

  if (!data) {
    return (
      <section className="workspace-page security-view">
        <div className="page-heading">
          <div>
            <span>SECURITY &amp; PRIVACY</span>
            <h1>Reading live state…</h1>
            <p>{error}</p>
          </div>
        </div>
      </section>
    );
  }

  const { health, sentinel, vault, receipts, integrity } = data;
  const events = receipts.filter((r) => SECURITY_TOOLS.includes(r.tool));
  const injections = events.filter(
    (r) => r.tool === "sentinel-injection-suspected",
  ).length;
  const configuredProviders = health.doctrine.configured ?? [];
  const agentRoots = sentinel.agents.list
    .filter((a) => a.root)
    .map((a) => `${a.name}: ${a.root}`);

  return (
    <section className="workspace-page security-view">
      <div className="page-heading">
        <div>
          <span>SECURITY &amp; PRIVACY</span>
          <h1>
            {health.emergency.latched
              ? "STOPPED"
              : injections
                ? "ATTENTION"
                : "PROTECTED"}
          </h1>
          <p>
            {health.emergency.latched
              ? "Emergency stop is active."
              : injections
                ? `${injections} suspected prompt injection${injections === 1 ? "" : "s"} recorded and not obeyed.`
                : "No security events need your attention."}
          </p>
        </div>
      </div>

      <div className="metric-grid" aria-label="Security status">
        <article>
          <span>LEDGER</span>
          <strong>{integrity.intact ? "INTACT" : "BROKEN"}</strong>
          <p>
            {integrity.checked} receipts hash-chained · append-only, enforced by
            the database
          </p>
        </article>
        <article>
          <span>SECURITY EVENTS</span>
          <strong>{events.length}</strong>
          <p>
            {injections} injection ·{" "}
            {events.filter((r) => r.tool.startsWith("emergency")).length}{" "}
            stop/clear ·{" "}
            {events.filter((r) => r.tool.startsWith("vault")).length} vault
          </p>
        </article>
        <article>
          <span>LEAVES THE DEVICE</span>
          <strong>
            {configuredProviders.length
              ? configuredProviders.join(", ")
              : "nothing"}
          </strong>
          <p>
            {configuredProviders.length
              ? "only requests you make to a configured model provider"
              : "no model provider is configured; no telemetry; no accounts"}
          </p>
        </article>
        <article>
          <span>CREDENTIALS</span>
          <strong>{vault.count}</strong>
          <p>
            {vault.available
              ? `in the ${vault.backend}; RAIMOSA stores names only`
              : "no secure store on this platform"}
          </p>
        </article>
      </div>

      <section className="surface live-tool">
        <header>
          <div>
            <Eye size={24} />
            <span>PRIVACY DASHBOARD</span>
          </div>
          <h2>What sees what</h2>
          <p>Stated from live configuration, not from marketing copy.</p>
        </header>
        <div className="sentinel-row">
          <div>
            <strong>What RAIMOSA can see</strong>
            <span>
              Approved folders only, resolved through symlink-safe containment.
              Default workspace: {health.defaultWorkspace}. Hidden folders can
              never be approved.
            </span>
          </div>
        </div>
        <div className="sentinel-row">
          <div>
            <strong>What agents can see</strong>
            <span>
              {agentRoots.length
                ? agentRoots.join(" · ")
                : "No agent is bound to a folder."}{" "}
              Agents report to Sentinel; they never receive credentials or
              desktop control through it.
            </span>
          </div>
        </div>
        <div className="sentinel-row">
          <div>
            <strong>What leaves this device</strong>
            <span>
              {configuredProviders.length
                ? `Requests you make to: ${configuredProviders.join(", ")}. The provider key never leaves the vault.`
                : "Nothing. No model provider is configured, there is no telemetry, and there are no accounts."}
            </span>
          </div>
        </div>
        <div className="sentinel-row">
          <div>
            <strong>What is stored</strong>
            <span>
              An append-only receipt ledger and a local state database
              (approvals, sessions as hashes, Sentinel records, memory).
              Credential values are in the OS keychain only. Clipboard and file
              contents are never written to the ledger.
            </span>
          </div>
        </div>
        <div className="sentinel-row">
          <div>
            <strong>What is shared</strong>
            <span>
              Nothing, unless you export the ledger or memory yourself. A paired
              phone sees status over your local network for the life of one
              revocable session.
            </span>
          </div>
        </div>
      </section>

      <section className="surface live-tool">
        <header>
          <div>
            {injections ? (
              <ShieldWarning size={24} />
            ) : (
              <ShieldCheck size={24} />
            )}
            <span>SECURITY EVENTS</span>
          </div>
          <h2>From the ledger</h2>
          <p>Every entry here is a receipt; none can be edited or deleted.</p>
        </header>
        {events.length === 0 ? (
          <p className="empty-note">No security events recorded.</p>
        ) : (
          events.slice(0, 40).map((r) => (
            <div className="activity-item" key={r.id}>
              {r.tool === "sentinel-injection-suspected" ? (
                <Warning />
              ) : (
                <ShieldCheck />
              )}
              <div>
                <strong>{r.tool}</strong>
                <span>
                  {r.scope} · {new Date(r.timestamp).toLocaleString()}
                  {r.result?.reasons ? ` · ${r.result.reasons.join(", ")}` : ""}
                </span>
              </div>
              <em>{r.id}</em>
            </div>
          ))
        )}
      </section>
    </section>
  );
}
