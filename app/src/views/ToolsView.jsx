import { useEffect, useMemo, useState } from "react";
import {
  ActivityIcon as Activity,
  BellIcon as Bell,
  CheckCircleIcon as CheckCircle,
  FolderIcon as Folder,
  MagnifyingGlassIcon as MagnifyingGlass,
  NotePencilIcon as NotePencil,
  PlayIcon as Play,
  ShieldCheckIcon as ShieldCheck,
  StopIcon as Stop,
  WarningIcon as Warning,
  WrenchIcon as Wrench,
} from "@phosphor-icons/react";
import { desktopApi } from "../desktop-api";

function ToolSection({ icon: Icon, eyebrow, title, description, children }) {
  return (
    <section className="surface live-tool">
      <header>
        <div>
          <Icon size={24} />
          <span>{eyebrow}</span>
        </div>
        <h2>{title}</h2>
        <p>{description}</p>
      </header>
      {children}
    </section>
  );
}

function ActionButton({ children, busy, disabled = false, ...props }) {
  return (
    <button
      type="button"
      className="secondary tool-action"
      disabled={Boolean(busy) || disabled}
      {...props}
    >
      {children}
    </button>
  );
}

function AccessGate({ onRequestAccess }) {
  return (
    <div className="tool-access-gate">
      <ShieldCheck />
      <span>
        <strong>OVIA AI All Access required</strong>
        <small>
          Start a visible, expiring session to reveal these controls.
        </small>
      </span>
      <button type="button" className="secondary" onClick={onRequestAccess}>
        Start All Access
      </button>
    </div>
  );
}

export function ToolsView({ accessToken, onRequestAccess, onAnnouncement }) {
  const [health, setHealth] = useState(null);
  const [root, setRoot] = useState("");
  const [query, setQuery] = useState("");
  const [processQuery, setProcessQuery] = useState("");
  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [organization, setOrganization] = useState(null);
  const [confirmation, setConfirmation] = useState("");
  const [product, setProduct] = useState({
    name: "raimosa-brief",
    format: "markdown",
    content:
      "# RAIMOSA Brief\n\nCreated and verified by the local desktop adapter.",
  });
  const [applications, setApplications] = useState([]);
  const [selectedApp, setSelectedApp] = useState("");
  const [notification, setNotification] = useState(
    "RAIMOSA desktop adapters are online.",
  );
  const [documentPath, setDocumentPath] = useState("README.md");
  const [previousSnapshot, setPreviousSnapshot] = useState(null);

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

  const unavailable = useMemo(
    () =>
      (health?.capabilities ?? []).filter(
        (item) => item.status !== "available",
      ),
    [health],
  );
  const availableCount = useMemo(
    () =>
      (health?.capabilities ?? []).filter((item) => item.status === "available")
        .length,
    [health],
  );

  async function run(tool, payload, after) {
    if (!health || busy) return;
    setBusy(tool);
    setError("");
    try {
      const data = await desktopApi.run(tool, { ...payload, accessToken });
      setReceipt(data.receipt);
      after?.(data.receipt);
      onAnnouncement?.(`${tool} completed with receipt ${data.receipt.id}.`);
    } catch (toolError) {
      setError(toolError.message);
      onAnnouncement?.(`${tool} failed: ${toolError.message}`);
    } finally {
      setBusy("");
    }
  }

  function runRootTool(tool, extra = {}, after) {
    return run(tool, { root: root.trim(), ...extra }, after);
  }

  async function refreshApplications() {
    await run("list-applications", {}, (nextReceipt) => {
      const nextApplications = nextReceipt.result.applications;
      setApplications(nextApplications);
      setSelectedApp(nextApplications[0]?.path ?? "");
    });
  }

  function compareSnapshot(nextReceipt) {
    const next = nextReceipt.result;
    const changed =
      previousSnapshot && previousSnapshot.fingerprint !== next.fingerprint;
    setPreviousSnapshot(next);
    setReceipt({
      ...nextReceipt,
      result: {
        ...next,
        changed: Boolean(changed),
        message: previousSnapshot
          ? changed
            ? "Folder contents changed."
            : "No folder change detected."
          : "Baseline snapshot recorded.",
      },
    });
  }

  return (
    <section className="workspace-page live-tools-view">
      <div
        className={`prototype-notice ${health ? "core-live" : ""}`}
        role="status"
      >
        {health ? <CheckCircle size={15} /> : <Warning size={15} />}
        <strong>
          {health
            ? "Local desktop adapter online"
            : "Desktop adapter unavailable"}
        </strong>
        <span>
          {health
            ? `${availableCount} verified capabilities · desktop API is loopback-only`
            : "No action controls are available"}
        </span>
      </div>

      <div className="page-heading">
        <div>
          <span>DESKTOP TOOLS</span>
          <h1>Only live adapters get controls</h1>
          <p>
            Every action below reaches a local adapter, returns a receipt, and
            stays inside the exact folder or application you select.
          </p>
        </div>
      </div>

      <section className="scope-bar surface">
        <ShieldCheck size={24} />
        <label>
          <span>Approved folder</span>
          <input
            value={root}
            onChange={(event) => setRoot(event.target.value)}
            aria-label="Approved folder path"
          />
        </label>
        <small>
          Filesystem and home roots are rejected. Writes cannot overwrite
          existing files.
        </small>
      </section>

      {error && (
        <div className="inline-error" role="alert">
          <Warning />
          {error}
        </div>
      )}

      {health && (
        <div className="live-tool-grid">
          <ToolSection
            icon={MagnifyingGlass}
            eyebrow="READ-ONLY"
            title="Find and summarize"
            description="Search filenames and bounded text content, or inventory an approved folder."
          >
            <label className="tool-field">
              Search text
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="filename or text"
              />
            </label>
            <div className="tool-actions">
              <ActionButton
                busy={busy}
                onClick={() => runRootTool("find-files", { query })}
              >
                <MagnifyingGlass />
                Find files
              </ActionButton>
              <ActionButton
                busy={busy}
                onClick={() => runRootTool("summarize-folder")}
              >
                <Folder />
                Summarize folder
              </ActionButton>
            </div>
          </ToolSection>

          <ToolSection
            icon={Folder}
            eyebrow="EXACT PLAN + APPROVAL"
            title="Organize files"
            description="Plan top-level moves by file type, then execute only that one-time approved plan. No deletion."
          >
            <div className="tool-actions">
              <ActionButton
                busy={busy}
                onClick={() =>
                  runRootTool("plan-organization", {}, (nextReceipt) => {
                    setOrganization(nextReceipt.result);
                    setConfirmation("");
                  })
                }
              >
                <Wrench />
                Create exact plan
              </ActionButton>
            </div>
            {organization && (
              <div className="organization-plan">
                <strong>
                  {organization.operations.length} moves · 0 deletions
                </strong>
                <ul>
                  {organization.operations.slice(0, 6).map((operation) => (
                    <li key={`${operation.source}-${operation.destination}`}>
                      <span>{operation.source}</span>
                      <span>→</span>
                      <span>{operation.destination}</span>
                    </li>
                  ))}
                </ul>
                {organization.operations.length > 6 && (
                  <small>
                    + {organization.operations.length - 6} more in the receipt
                  </small>
                )}
                <label className="tool-field">
                  Type MOVE to approve
                  <input
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                  />
                </label>
                {accessToken ? (
                  <ActionButton
                    busy={busy}
                    disabled={confirmation !== "MOVE"}
                    onClick={() =>
                      run(
                        "execute-organization",
                        { approvalId: organization.approvalId, confirmation },
                        () => {
                          setOrganization(null);
                          setConfirmation("");
                        },
                      )
                    }
                  >
                    <CheckCircle />
                    Execute approved plan
                  </ActionButton>
                ) : (
                  <AccessGate onRequestAccess={onRequestAccess} />
                )}
              </div>
            )}
          </ToolSection>

          <ToolSection
            icon={NotePencil}
            eyebrow="CREATE + VERIFY"
            title="Create a work product"
            description="Write one new Markdown, CSV, or HTML presentation file in the approved folder. Existing files are never replaced."
          >
            <div className="product-fields">
              <label className="tool-field">
                File name
                <input
                  value={product.name}
                  onChange={(event) =>
                    setProduct({ ...product, name: event.target.value })
                  }
                />
              </label>
              <label className="tool-field">
                Format
                <select
                  value={product.format}
                  onChange={(event) =>
                    setProduct({ ...product, format: event.target.value })
                  }
                >
                  <option value="markdown">Markdown</option>
                  <option value="csv">CSV</option>
                  <option value="presentation">HTML presentation</option>
                </select>
              </label>
              <label className="tool-field wide">
                Content
                <textarea
                  rows={5}
                  value={product.content}
                  onChange={(event) =>
                    setProduct({ ...product, content: event.target.value })
                  }
                />
              </label>
            </div>
            {accessToken ? (
              <ActionButton
                busy={busy}
                onClick={() => runRootTool("create-work-product", product)}
              >
                <NotePencil />
                Create verified file
              </ActionButton>
            ) : (
              <AccessGate onRequestAccess={onRequestAccess} />
            )}
          </ToolSection>

          <ToolSection
            icon={Activity}
            eyebrow="OBSERVE"
            title="Processes and folder monitoring"
            description="Inspect bounded process status or compare approved-folder snapshots for export and download completion."
          >
            <label className="tool-field">
              Process filter
              <input
                value={processQuery}
                onChange={(event) => setProcessQuery(event.target.value)}
                placeholder="optional application name"
              />
            </label>
            <div className="tool-actions">
              <ActionButton
                busy={busy}
                onClick={() => run("process-status", { query: processQuery })}
              >
                <Activity />
                Inspect processes
              </ActionButton>
              <ActionButton
                busy={busy}
                onClick={() =>
                  runRootTool("folder-snapshot", {}, compareSnapshot)
                }
              >
                <Folder />
                {previousSnapshot ? "Check for changes" : "Record baseline"}
              </ActionButton>
            </div>
          </ToolSection>

          <ToolSection
            icon={Activity}
            eyebrow="READ-ONLY AGENT DISCOVERY"
            title="Local AI agent runtimes"
            description="Discover supported local agent CLIs and running processes. RAIMOSA AI does not read their prompts, transcripts, credentials, or private state."
          >
            <div className="tool-actions">
              <ActionButton
                busy={busy}
                onClick={() => run("agent-runtime-monitor", {})}
              >
                <Activity />
                Discover local agents
              </ActionButton>
            </div>
          </ToolSection>

          <ToolSection
            icon={Play}
            eyebrow="VERIFIED MACOS APPS"
            title="Applications and documents"
            description="Discover installed applications first. Launch and quit apply only to the exact selected application."
          >
            <div className="tool-actions">
              <ActionButton busy={busy} onClick={refreshApplications}>
                <MagnifyingGlass />
                Refresh installed apps
              </ActionButton>
            </div>
            {applications.length > 0 && (
              <>
                <label className="tool-field">
                  Verified application
                  <select
                    value={selectedApp}
                    onChange={(event) => setSelectedApp(event.target.value)}
                  >
                    {applications.map((app) => (
                      <option value={app.path} key={app.path}>
                        {app.name}
                      </option>
                    ))}
                  </select>
                </label>
                {accessToken ? (
                  <div className="tool-actions">
                    <ActionButton
                      busy={busy}
                      onClick={() =>
                        run("launch-application", { appPath: selectedApp })
                      }
                    >
                      <Play />
                      Launch selected app
                    </ActionButton>
                    <ActionButton
                      busy={busy}
                      onClick={() =>
                        run("close-application", { appPath: selectedApp })
                      }
                    >
                      <Stop />
                      Quit selected app
                    </ActionButton>
                  </div>
                ) : (
                  <AccessGate onRequestAccess={onRequestAccess} />
                )}
              </>
            )}
            <label className="tool-field">
              Document path inside approved folder
              <input
                value={documentPath}
                onChange={(event) => setDocumentPath(event.target.value)}
                placeholder="README.md"
              />
            </label>
            {accessToken ? (
              <ActionButton
                busy={busy}
                disabled={!documentPath.trim()}
                onClick={() =>
                  runRootTool("open-document", { path: documentPath })
                }
              >
                <Play />
                Open exact document
              </ActionButton>
            ) : (
              <AccessGate onRequestAccess={onRequestAccess} />
            )}
          </ToolSection>

          <ToolSection
            icon={Bell}
            eyebrow="VISIBLE SIDE EFFECT"
            title="Local notification"
            description="Send one visible macOS notification after you provide its exact message."
          >
            <label className="tool-field">
              Notification text
              <input
                value={notification}
                onChange={(event) => setNotification(event.target.value)}
              />
            </label>
            {accessToken ? (
              <ActionButton
                busy={busy}
                disabled={!notification.trim()}
                onClick={() =>
                  run("local-notification", {
                    title: "RAIMOSA AI",
                    message: notification,
                  })
                }
              >
                <Bell />
                Send local notification
              </ActionButton>
            ) : (
              <AccessGate onRequestAccess={onRequestAccess} />
            )}
          </ToolSection>
        </div>
      )}

      {receipt && (
        <section
          className="surface receipt-panel"
          aria-label="Latest verified receipt"
        >
          <header>
            <div>
              <CheckCircle size={22} />
              <span>VERIFIED RECEIPT</span>
            </div>
            <strong>{receipt.id}</strong>
          </header>
          <dl>
            <div>
              <dt>Tool</dt>
              <dd>{receipt.tool}</dd>
            </div>
            <div>
              <dt>Scope</dt>
              <dd>{receipt.scope}</dd>
            </div>
            <div>
              <dt>Time</dt>
              <dd>{new Date(receipt.timestamp).toLocaleTimeString()}</dd>
            </div>
          </dl>
          <pre>{JSON.stringify(receipt.result, null, 2)}</pre>
        </section>
      )}

      {unavailable.length > 0 && (
        <section className="surface unavailable-tools">
          <header>
            <Warning size={22} />
            <div>
              <span>NO ACTION CONTROLS</span>
              <h2>Capabilities waiting for a verified adapter</h2>
            </div>
          </header>
          <div>
            {unavailable.map((item) => (
              <article key={item.id}>
                <strong>{item.title}</strong>
                <p>{item.description}</p>
                <span>{item.risk}</span>
              </article>
            ))}
          </div>
        </section>
      )}
    </section>
  );
}
