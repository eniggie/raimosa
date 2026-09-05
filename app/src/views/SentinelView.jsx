import { useCallback, useEffect, useState } from "react";
import {
  CheckCircleIcon as CheckCircle,
  EyeIcon as Eye,
  LockKeyIcon as LockKey,
  PauseIcon as Pause,
  PlayIcon as Play,
  ShieldCheckIcon as ShieldCheck,
  ShieldWarningIcon as ShieldWarning,
  WarningIcon as Warning,
  XIcon as X,
} from "@phosphor-icons/react";
import { desktopApi } from "../desktop-api";

// Every value on this page comes from /sentinel/status. Nothing here is a
// placeholder: an empty registry renders as empty, and a claim is shown as a
// claim until Sentinel has its own evidence.

const STATUS_TONE = {
  VERIFIED_COMPLETE: "ok",
  CLAIMED: "claim",
  PLANNED: "muted",
  VERIFYING: "muted",
  UNVERIFIED: "warn",
  PARTIALLY_COMPLETE: "warn",
  FAILED: "bad",
  BLOCKED: "bad",
  REQUIRES_HUMAN_REVIEW: "bad",
};

function Chip({ tone = "muted", children }) {
  return <span className={`sentinel-chip ${tone}`}>{children}</span>;
}

function Section({ icon: Icon, eyebrow, title, description, children }) {
  return (
    <section className="surface live-tool">
      <header>
        <div>
          <Icon size={24} />
          <span>{eyebrow}</span>
        </div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </header>
      {children}
    </section>
  );
}

export function SentinelView({ accessToken, onRequestAccess, onAnnouncement }) {
  const [status, setStatus] = useState(null);
  const [policy, setPolicy] = useState(null);
  const [error, setError] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState("");
  const [agentForm, setAgentForm] = useState({
    name: "",
    provider: "",
    root: "",
    budgetUsd: "",
  });
  const [taskForm, setTaskForm] = useState({
    title: "",
    instruction: "",
    acceptance: "",
    agentId: "",
    root: "",
  });
  const [claims, setClaims] = useState({});
  const [checks, setChecks] = useState({});
  const [details, setDetails] = useState({});
  const [providers, setProviders] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const [s, p, h] = await Promise.all([
        desktopApi.sentinelStatus(),
        desktopApi.sentinelPolicy(),
        desktopApi.health(),
      ]);
      setStatus(s);
      setPolicy(p);
      setProviders(h.doctrine);
      setError("");
    } catch (refreshError) {
      setError(refreshError.message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Realtime: refresh the moment a new receipt lands. Polling stays as the
    // fallback so a closed stream never leaves the page stale.
    const id = window.setInterval(() => void refresh(), 15000);
    let source = null;
    try {
      source = new EventSource("/api/raimosa/events");
      source.addEventListener("receipt", () => void refresh());
    } catch {
      source = null;
    }
    return () => {
      window.clearInterval(id);
      source?.close();
    };
  }, [refresh]);

  async function act(label, fn) {
    setBusy(label);
    setError("");
    try {
      const result = await fn();
      onAnnouncement?.(label);
      await refresh();
      return result;
    } catch (actError) {
      setError(actError.message);
      onAnnouncement?.(`${label} failed: ${actError.message}`);
      return null;
    } finally {
      setBusy("");
    }
  }

  if (!status) {
    return (
      <section className="workspace-page sentinel-view">
        <div className="page-heading">
          <div>
            <span>SENTINEL</span>
            <h1>Independent agent supervisor</h1>
            <p>
              {error
                ? `The local adapter is not responding: ${error}`
                : "Reading the live registry…"}
            </p>
          </div>
        </div>
      </section>
    );
  }

  const { agents, tasks, approvals, warnings } = status;
  const simpleLine = status.latched
    ? "Emergency stop is active. Every agent is paused."
    : warnings.length
      ? `${warnings.length} item${warnings.length === 1 ? "" : "s"} need your attention.`
      : agents.working
        ? `${agents.working} agent${agents.working === 1 ? "" : "s"} working under supervision.`
        : "Nothing is running. Sentinel is ready.";

  return (
    <section className="workspace-page sentinel-view">
      <div className="page-heading">
        <div>
          <span>SENTINEL</span>
          <h1>
            {status.latched ? "STOPPED" : "PROTECTED"}{" "}
            <Chip tone={status.latched ? "bad" : "ok"}>
              {status.latched ? "latched" : "supervising"}
            </Chip>
          </h1>
          <p>{simpleLine}</p>
        </div>
        <button
          type="button"
          className="secondary"
          onClick={() => setAdvanced((v) => !v)}
        >
          {advanced ? "Simple view" : "Advanced view"}
        </button>
      </div>

      {error && (
        <p className="sentinel-error" role="alert">
          {error}
        </p>
      )}

      <div className="metric-grid" aria-label="Sentinel status">
        <article>
          <span>AGENTS WORKING</span>
          <strong>{agents.working}</strong>
          <p>
            {agents.total} registered · {agents.paused} paused
          </p>
        </article>
        <article>
          <span>VERIFIED</span>
          <strong>{tasks.verified}</strong>
          <p>
            {tasks.claimed} claimed, awaiting evidence · {tasks.failed} failed
          </p>
        </article>
        <article className={approvals.pending ? "access-live" : ""}>
          <span>APPROVALS</span>
          <strong>{approvals.pending}</strong>
          <p>
            {approvals.pending ? "waiting for your decision" : "none pending"}
          </p>
        </article>
        <article>
          <span>WARNINGS</span>
          <strong>{warnings.length}</strong>
          <p>
            {tasks.needsHuman} need human review · {tasks.blocked} blocked or
            unverified
          </p>
        </article>
      </div>

      {warnings.length > 0 && (
        <section className="surface">
          <div className="surface-title">
            <div>
              <ShieldWarning />
              <span>NEEDS ATTENTION</span>
            </div>
          </div>
          {warnings.map((w, i) => (
            <div className="activity-item" key={i}>
              <Warning />
              <div>
                <strong>{w.kind.replaceAll("-", " ")}</strong>
                <span>{w.name ?? w.title ?? w.agentId ?? w.taskId}</span>
              </div>
            </div>
          ))}
        </section>
      )}

      {approvals.pending > 0 && (
        <Section
          icon={LockKey}
          eyebrow="APPROVAL REQUIRED"
          title="Decide what agents may do"
          description="Level 3 approvals need a live All Access session. Denying never needs authority."
        >
          {approvals.list
            .filter((a) => a.status === "pending")
            .map((a) => (
              <div className="sentinel-row" key={a.id}>
                <div>
                  <strong>{a.action}</strong>
                  <span>
                    {a.reason} · Level {a.level} · risk {a.risk}
                    {a.agentId ? ` · ${a.agentId}` : ""}
                  </span>
                </div>
                <div className="sentinel-actions">
                  <button
                    type="button"
                    className="primary"
                    disabled={Boolean(busy)}
                    onClick={() => {
                      if (a.level === 3 && !accessToken) {
                        onRequestAccess?.();
                        return;
                      }
                      void act(`Approved ${a.action}`, () =>
                        desktopApi.sentinelDecide(
                          a.id,
                          "approved",
                          accessToken,
                        ),
                      );
                    }}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void act(`Denied ${a.action}`, () =>
                        desktopApi.sentinelDecide(a.id, "denied", accessToken),
                      )
                    }
                  >
                    Deny
                  </button>
                </div>
              </div>
            ))}
        </Section>
      )}

      <Section
        icon={Eye}
        eyebrow="AGENT REGISTRY"
        title="Agents under supervision"
        description="Register an agent to supervise it. Discovery below is read-only and shows which agent binaries are present on this machine."
      >
        {agents.list.length === 0 ? (
          <p className="empty-note">No agents registered yet.</p>
        ) : (
          agents.list.map((a) => (
            <div className="sentinel-row" key={a.id}>
              <div>
                <strong>
                  {a.name}{" "}
                  <Chip
                    tone={
                      a.status === "working"
                        ? "ok"
                        : a.status === "paused" || a.status === "revoked"
                          ? "bad"
                          : "muted"
                    }
                  >
                    {a.status}
                  </Chip>
                  {a.health === "stalled" && <Chip tone="warn">stalled</Chip>}
                </strong>
                <span>
                  {a.provider}
                  {a.observedRunning ? " · process observed" : ""}
                  {a.pausedReason ? ` · ${a.pausedReason}` : ""}
                  {" · trust "}
                  {a.trust.score === null ? "—" : `${a.trust.score}%`} (
                  {a.trust.basis})
                </span>
              </div>
              <div className="sentinel-actions">
                {a.status === "paused" ? (
                  <button
                    type="button"
                    className="secondary"
                    disabled={Boolean(busy) || status.latched}
                    onClick={() =>
                      void act(`Resumed ${a.name}`, () =>
                        desktopApi.sentinelResumeAgent(a.id),
                      )
                    }
                  >
                    <Play size={16} /> Resume
                  </button>
                ) : a.status !== "revoked" ? (
                  <button
                    type="button"
                    className="secondary"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void act(`Paused ${a.name}`, () =>
                        desktopApi.sentinelPauseAgent(a.id, "owner-request"),
                      )
                    }
                  >
                    <Pause size={16} /> Pause
                  </button>
                ) : null}
                {a.status !== "revoked" && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void act(`Revoked ${a.name}`, () =>
                        desktopApi.sentinelRevokeAgent(a.id),
                      )
                    }
                  >
                    <X size={16} /> Revoke
                  </button>
                )}
              </div>
            </div>
          ))
        )}

        {advanced && status.discovered?.length > 0 && (
          <p className="sentinel-note">
            Discovered on this machine:{" "}
            {status.discovered
              .map(
                (d) =>
                  `${d.name} (${d.installed ? "installed" : "not installed"}${d.running?.length ? `, ${d.running.length} running` : ""})`,
              )
              .join(" · ")}
          </p>
        )}

        <form
          className="tool-form sentinel-form"
          onSubmit={(event) => {
            event.preventDefault();
            void act(`Registered ${agentForm.name}`, () =>
              desktopApi.sentinelRegisterAgent({
                name: agentForm.name,
                provider: agentForm.provider,
                root: agentForm.root || undefined,
                budgetUsd:
                  agentForm.budgetUsd === ""
                    ? undefined
                    : Number(agentForm.budgetUsd),
              }),
            ).then(
              (r) =>
                r &&
                setAgentForm({
                  name: "",
                  provider: "",
                  root: "",
                  budgetUsd: "",
                }),
            );
          }}
        >
          <input
            aria-label="Agent name"
            placeholder="Agent name (e.g. Codex)"
            value={agentForm.name}
            onChange={(e) =>
              setAgentForm({ ...agentForm, name: e.target.value })
            }
            required
          />
          <input
            aria-label="Provider"
            placeholder="Provider (codex, claude, gemini…)"
            value={agentForm.provider}
            onChange={(e) =>
              setAgentForm({ ...agentForm, provider: e.target.value })
            }
            required
          />
          <input
            aria-label="Approved root"
            placeholder="Approved folder (optional)"
            value={agentForm.root}
            onChange={(e) =>
              setAgentForm({ ...agentForm, root: e.target.value })
            }
          />
          <input
            aria-label="Monthly budget USD"
            placeholder="Budget USD / 30 days (optional)"
            inputMode="decimal"
            value={agentForm.budgetUsd}
            onChange={(e) =>
              setAgentForm({ ...agentForm, budgetUsd: e.target.value })
            }
          />
          <button
            type="submit"
            className="primary"
            disabled={Boolean(busy) || status.latched}
          >
            Register agent
          </button>
        </form>
      </Section>

      <Section
        icon={CheckCircle}
        eyebrow="TASKS · PROOF ENGINE"
        title="Claims are not results"
        description="Record what an agent says it finished, then let Sentinel verify it with real checks inside the approved folder. Status comes only from evidence."
      >
        {tasks.list.length === 0 ? (
          <p className="empty-note">No tasks yet.</p>
        ) : (
          tasks.list.map((t) => (
            <div className="sentinel-task" key={t.id}>
              <div className="sentinel-row">
                <div>
                  <strong>
                    {t.title}{" "}
                    <Chip tone={STATUS_TONE[t.status] ?? "muted"}>
                      {t.status.replaceAll("_", " ")}
                    </Chip>
                  </strong>
                  <span>
                    {t.agentId ? `${t.agentId} · ` : ""}
                    {t.root ?? "no root"} · {t.acceptance.length} acceptance
                    criteria
                    {t.claim ? ` · claim: “${t.claim.summary || "done"}”` : ""}
                    {t.progress ? ` · ${t.progress}% (agent-reported)` : ""}
                    {t.priority !== "normal" ? ` · ${t.priority}` : ""}
                  </span>
                </div>
                <div className="sentinel-actions">
                  {t.status !== "CANCELLED" &&
                    t.status !== "VERIFIED_COMPLETE" && (
                      <>
                        <select
                          aria-label={`Priority for ${t.title}`}
                          value={t.priority}
                          onChange={(e) =>
                            void act(`${t.title} → ${e.target.value}`, () =>
                              desktopApi.sentinelPriority(t.id, e.target.value),
                            )
                          }
                        >
                          {["low", "normal", "high", "urgent"].map((p) => (
                            <option key={p} value={p}>
                              {p}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="secondary"
                          disabled={Boolean(busy)}
                          onClick={() =>
                            void act(`Cancelled ${t.title}`, () =>
                              desktopApi.sentinelCancel(t.id, "owner-request"),
                            )
                          }
                        >
                          Cancel
                        </button>
                      </>
                    )}
                  {advanced && (
                    <button
                      type="button"
                      className="secondary"
                      disabled={Boolean(busy)}
                      onClick={() =>
                        void desktopApi
                          .sentinelProof(t.id)
                          .then((r) =>
                            setDetails((d) => ({
                              ...d,
                              [`proof:${t.id}`]: r.proof,
                            })),
                          )
                          .catch((e) => setError(e.message))
                      }
                    >
                      Proof
                    </button>
                  )}
                  <button
                    type="button"
                    className="secondary"
                    disabled={Boolean(busy) || status.latched || !t.root}
                    onClick={() =>
                      void act(`Verified ${t.title}`, () =>
                        desktopApi.sentinelVerify(
                          t.id,
                          checks[t.id]?.length ? checks[t.id] : undefined,
                          t.root,
                        ),
                      ).then(async () => {
                        const v = await desktopApi
                          .sentinelVerifications(t.id)
                          .catch(() => null);
                        if (v)
                          setDetails((d) => ({
                            ...d,
                            [t.id]: v.verifications,
                          }));
                      })
                    }
                  >
                    <ShieldCheck size={16} /> Verify
                  </button>
                </div>
              </div>
              <div className="sentinel-subrow">
                <input
                  aria-label={`Claim summary for ${t.title}`}
                  placeholder="What the agent says it did…"
                  value={claims[t.id] ?? ""}
                  onChange={(e) =>
                    setClaims({ ...claims, [t.id]: e.target.value })
                  }
                />
                <button
                  type="button"
                  className="secondary"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void act(`Recorded claim for ${t.title}`, () =>
                      desktopApi.sentinelClaim(t.id, {
                        summary: claims[t.id] ?? "",
                      }),
                    )
                  }
                >
                  Record claim
                </button>
                <div
                  className="sentinel-checks"
                  role="group"
                  aria-label="Checks to run"
                >
                  {status.verifiers.map((v) => {
                    const on = (checks[t.id] ?? []).includes(v.name);
                    return (
                      <label key={v.name} title={v.describe}>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() =>
                            setChecks({
                              ...checks,
                              [t.id]: on
                                ? (checks[t.id] ?? []).filter(
                                    (c) => c !== v.name,
                                  )
                                : [...(checks[t.id] ?? []), v.name],
                            })
                          }
                        />
                        {v.name}
                      </label>
                    );
                  })}
                </div>
              </div>
              {advanced && details[`proof:${t.id}`] && (
                <div className="sentinel-evidence">
                  {(() => {
                    const pr = details[`proof:${t.id}`];
                    const rows = [
                      ["Instruction", pr.originalInstruction],
                      ["Acceptance", pr.acceptanceCriteria.join("; ") || "—"],
                      [
                        "Actions (agent-reported)",
                        pr.actionsTaken.map((x) => x.detail).join("; ") || "—",
                      ],
                      [
                        "Commands (agent-reported)",
                        pr.commandsExecuted.map((x) => x.detail).join("; ") ||
                          "—",
                      ],
                      [
                        "Files (agent-reported)",
                        pr.filesModified.map((x) => x.detail).join("; ") || "—",
                      ],
                      [
                        "Errors (agent-reported)",
                        pr.errors.map((x) => x.detail).join("; ") || "—",
                      ],
                      [
                        "Restore point (verified)",
                        pr.restorePoint
                          ? `${pr.restorePoint.head.slice(0, 12)} · ${pr.restorePoint.changedFiles} dirty`
                          : "none",
                      ],
                      [
                        "Verifications (verified)",
                        pr.verifications.map((v) => v.outcome).join(", ") ||
                          "none yet",
                      ],
                      ["Final status", pr.finalStatus],
                    ];
                    return rows.map(([k, v]) => (
                      <div className="activity-item" key={k}>
                        <div>
                          <strong>{k}</strong>
                          <span>{v}</span>
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              )}
              {advanced && details[t.id]?.length > 0 && (
                <div className="sentinel-evidence">
                  {details[t.id][0].checks.map((c) => (
                    <div className="activity-item" key={c.check}>
                      {c.ok ? <CheckCircle /> : <Warning />}
                      <div>
                        <strong>
                          {c.check}{" "}
                          <Chip tone={c.honesty === "VERIFIED" ? "ok" : "warn"}>
                            {c.honesty}
                          </Chip>
                        </strong>
                        <span>
                          {typeof c.evidence === "string"
                            ? c.evidence
                            : JSON.stringify(c.evidence)}
                        </span>
                      </div>
                      <em>{details[t.id][0].receiptId}</em>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}

        <form
          className="tool-form sentinel-form"
          onSubmit={(event) => {
            event.preventDefault();
            void act(`Created task ${taskForm.title}`, () =>
              desktopApi.sentinelCreateTask({
                title: taskForm.title,
                instruction: taskForm.instruction,
                acceptance: taskForm.acceptance
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean),
                agentId: taskForm.agentId || undefined,
                root: taskForm.root || undefined,
              }),
            ).then(
              (r) =>
                r &&
                setTaskForm({
                  title: "",
                  instruction: "",
                  acceptance: "",
                  agentId: "",
                  root: "",
                }),
            );
          }}
        >
          <input
            aria-label="Task title"
            placeholder="Task title"
            value={taskForm.title}
            onChange={(e) =>
              setTaskForm({ ...taskForm, title: e.target.value })
            }
            required
          />
          <input
            aria-label="Original instruction"
            placeholder="Original instruction"
            value={taskForm.instruction}
            onChange={(e) =>
              setTaskForm({ ...taskForm, instruction: e.target.value })
            }
            required
          />
          <textarea
            aria-label="Acceptance criteria"
            placeholder="Acceptance criteria, one per line"
            rows={2}
            value={taskForm.acceptance}
            onChange={(e) =>
              setTaskForm({ ...taskForm, acceptance: e.target.value })
            }
          />
          <select
            aria-label="Agent"
            value={taskForm.agentId}
            onChange={(e) =>
              setTaskForm({ ...taskForm, agentId: e.target.value })
            }
          >
            <option value="">No agent</option>
            {agents.list.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.provider})
              </option>
            ))}
          </select>
          <input
            aria-label="Approved folder for verification"
            placeholder="Approved folder to verify in (git repo)"
            value={taskForm.root}
            onChange={(e) => setTaskForm({ ...taskForm, root: e.target.value })}
          />
          <button
            type="submit"
            className="primary"
            disabled={Boolean(busy) || status.latched}
          >
            Create task
          </button>
        </form>
      </Section>

      {advanced && policy && (
        <Section
          icon={LockKey}
          eyebrow="PERMISSION POLICY"
          title="Levels 0–3, enforced at dispatch"
          description="Raise any tool's level. A tool can never be lowered below the gate its adapter already relies on."
        >
          <div className="sentinel-policy">
            {Object.entries(policy.effective).map(([tool, level]) => (
              <label key={tool}>
                <span>{tool}</span>
                <select
                  value={level}
                  onChange={(e) =>
                    void act(`${tool} → Level ${e.target.value}`, () =>
                      desktopApi.sentinelSetLevel(tool, Number(e.target.value)),
                    )
                  }
                >
                  {[0, 1, 2, 3].map((n) => (
                    <option
                      key={n}
                      value={n}
                      disabled={n < policy.defaults[tool]}
                    >
                      Level {n}
                      {n === 0
                        ? " · observe"
                        : n === 1
                          ? " · safe autonomy"
                          : n === 2
                            ? " · approval"
                            : " · human confirmation"}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </Section>
      )}

      {advanced && (
        <Section
          icon={ShieldCheck}
          eyebrow="AI PROVIDERS"
          title="Provider-independent by design"
          description="RAIMOSA works locally with no model. Sentinel never claims model output unless a provider is genuinely configured."
        >
          <p className="sentinel-note">
            Configured provider:{" "}
            <strong>{providers?.modelProvider ?? "none"}</strong>.{" "}
            {providers?.available?.length
              ? providers.available
                  .map(
                    (p) =>
                      `${p.name} (${p.configured ? "configured" : `not configured — add ${p.id === "openai" ? "OPENAI_API_KEY" : "a key"} in the Vault`})`,
                  )
                  .join(" · ")
              : "No adapters registered."}{" "}
            Nothing here will pretend a model exists.
          </p>
        </Section>
      )}

      {advanced && status.recentVerifications.length > 0 && (
        <section className="surface">
          <div className="surface-title">
            <div>
              <ShieldCheck />
              <span>RECENT VERIFICATIONS</span>
            </div>
          </div>
          {status.recentVerifications.map((v) => (
            <div className="activity-item" key={v.id}>
              {v.outcome === "VERIFIED_COMPLETE" ? (
                <CheckCircle />
              ) : (
                <Warning />
              )}
              <div>
                <strong>{v.outcome.replaceAll("_", " ")}</strong>
                <span>
                  {v.taskId}
                  {v.agentId ? ` · ${v.agentId}` : ""} ·{" "}
                  {new Date(v.at).toLocaleString()}
                </span>
              </div>
              <em>{v.receiptId}</em>
            </div>
          ))}
        </section>
      )}
    </section>
  );
}
