import { useEffect, useMemo, useState } from "react";
import {
  CheckCircleIcon as CheckCircle,
  FingerprintIcon as Fingerprint,
  ShieldCheckIcon as ShieldCheck,
  SparkleIcon as Sparkle,
  WarningIcon as Warning,
  WrenchIcon as Wrench,
} from "@phosphor-icons/react";
import { desktopApi } from "../desktop-api";

function StatusPill({ children, tone = "ready" }) {
  return <span className={`core-status ${tone}`}>{children}</span>;
}

export function IntelligenceView({ initialCommand, onAnnouncement }) {
  const [health, setHealth] = useState(null);
  const [command, setCommand] = useState(
    "Summarize the approved folder and report anything that needs attention.",
  );
  const [root, setRoot] = useState("");
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    desktopApi
      .health()
      .then((data) => {
        if (!current) return;
        setHealth(data);
        setRoot(data.defaultWorkspace);
      })
      .catch((healthError) => {
        if (current) setError(healthError.message);
      });
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    if (!initialCommand?.text) return;
    setCommand(initialCommand.text);
    setPlan(null);
  }, [initialCommand?.id, initialCommand?.text]);

  const counts = useMemo(() => {
    const capabilities = health?.capabilities ?? [];
    return {
      available: capabilities.filter((item) => item.status === "available")
        .length,
      unavailable: capabilities.filter((item) => item.status !== "available")
        .length,
    };
  }, [health]);

  async function compile(event) {
    event.preventDefault();
    if (!command.trim() || busy || !health) return;
    setBusy(true);
    setError("");
    try {
      const data = await desktopApi.plan(command.trim(), root.trim());
      setPlan(data.plan);
      onAnnouncement?.(`OVIA AI Core compiled ${data.plan.id}.`);
    } catch (planError) {
      setError(planError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="workspace-page intelligence-view">
      <div className="prototype-notice core-live" role="status">
        {health ? <CheckCircle size={15} /> : <Warning size={15} />}
        <strong>
          {health ? "OVIA AI Core online" : "Checking OVIA AI Core"}
        </strong>
        <span>
          {health
            ? `${health.runtime} · desktop only`
            : "Local adapter connection required"}
        </span>
      </div>

      <div className="page-heading">
        <div>
          <span>INTELLIGENCE</span>
          <h1>OVIA AI Core</h1>
          <p>
            A local operating mind that plans, chooses verified tools,
            classifies risk, requires approval, and checks its own work.
          </p>
        </div>
        {health && <StatusPill>{counts.available} live adapters</StatusPill>}
      </div>

      <div className="core-grid">
        <section className="surface core-compiler">
          <div className="surface-title">
            <div>
              <Sparkle />
              <span>INTENT COMPILER</span>
            </div>
          </div>
          <form onSubmit={compile}>
            <label>
              Desktop objective
              <textarea
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                rows={4}
              />
            </label>
            <label>
              Approved folder scope
              <input
                value={root}
                onChange={(event) => setRoot(event.target.value)}
                placeholder="/Users/name/specific-folder"
              />
            </label>
            <button
              type="submit"
              className="primary"
              disabled={!health || busy || !command.trim()}
            >
              <Wrench size={18} />
              {busy ? "Compiling…" : "Compile governed plan"}
            </button>
          </form>
          {error && (
            <div className="inline-error" role="alert">
              <Warning />
              {error}
            </div>
          )}
        </section>

        <section className="surface core-doctrine">
          <div className="surface-title">
            <div>
              <ShieldCheck />
              <span>DISTILLED OPERATING DOCTRINE</span>
            </div>
          </div>
          <ol>
            {(
              health?.doctrine?.principles ?? [
                "Understand the outcome before selecting a tool.",
                "Use only adapters that report available.",
                "Verify the observable result before claiming success.",
              ]
            ).map((principle) => (
              <li key={principle}>{principle}</li>
            ))}
          </ol>
          <div className="provider-state">
            <Fingerprint size={22} />
            <div>
              <strong>Local reasoning · clearly identified</strong>
              <span>No external model provider is configured or implied.</span>
            </div>
          </div>
        </section>
      </div>

      {plan && (
        <section
          className="surface compiled-plan"
          aria-label="Compiled OVIA AI plan"
        >
          <header>
            <div>
              <span>{plan.id}</span>
              <h2>{plan.intent}</h2>
            </div>
            <StatusPill
              tone={
                plan.available
                  ? plan.requiresApproval
                    ? "approval"
                    : "ready"
                  : "blocked"
              }
            >
              {plan.decision}
            </StatusPill>
          </header>
          <div className="plan-facts">
            <div>
              <span>Scope</span>
              <strong>{plan.scope}</strong>
            </div>
            <div>
              <span>Risk</span>
              <strong>{plan.risk}</strong>
            </div>
            <div>
              <span>Adapter</span>
              <strong>{plan.adapter ?? "Unavailable"}</strong>
            </div>
            <div>
              <span>Approval</span>
              <strong>
                {plan.requiresApproval ? "Required" : "Read-only"}
              </strong>
            </div>
          </div>
          <p>{plan.explanation}</p>
          <ol>
            {plan.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>
      )}
    </section>
  );
}
