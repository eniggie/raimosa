import { useEffect, useRef, useState } from "react";
import {
  ActivityIcon as Activity,
  ArrowRightIcon as ArrowRight,
  BellIcon as Bell,
  BookOpenIcon as BookOpen,
  CalendarBlankIcon as CalendarBlank,
  CaretDownIcon as CaretDown,
  CaretRightIcon as CaretRight,
  CaretUpIcon as CaretUp,
  CheckIcon as Check,
  CheckCircleIcon as CheckCircle,
  ClockIcon as Clock,
  DeviceMobileIcon as DeviceMobile,
  DownloadSimpleIcon as DownloadSimple,
  EyeIcon as Eye,
  FingerprintIcon as Fingerprint,
  FolderIcon as Folder,
  GearSixIcon as GearSix,
  HouseIcon as House,
  LightningIcon as Lightning,
  ListChecksIcon as ListChecks,
  LockKeyIcon as LockKey,
  MagnifyingGlassIcon as MagnifyingGlass,
  NotePencilIcon as NotePencil,
  PaperPlaneTiltIcon as PaperPlaneTilt,
  PlayIcon as Play,
  ShieldCheckIcon as ShieldCheck,
  ShieldWarningIcon as ShieldWarning,
  SidebarSimpleIcon as SidebarSimple,
  SparkleIcon as Sparkle,
  StopIcon as Stop,
  WarningIcon as Warning,
  WrenchIcon as Wrench,
  XIcon as X,
} from "@phosphor-icons/react";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/montserrat/latin-500.css";
import "@fontsource/montserrat/latin-600.css";
import "@fontsource/montserrat/latin-700.css";
import "./styles.css";
import { desktopApi } from "./desktop-api";
import { IntelligenceView } from "./views/IntelligenceView.jsx";
import { RemoteView } from "./views/RemoteView.jsx";
import { ToolsView } from "./views/ToolsView.jsx";

const nav = [
  ["Home", House],
  ["Intelligence", Sparkle],
  ["Tools", Wrench],
  ["Remote", DeviceMobile],
  ["Ledger", BookOpen],
  ["Permissions", LockKey],
  ["Settings", GearSix],
];

const modes = {
  Ask: {
    authority: "ADVICE ONLY · NO ACTION ACCESS",
    helper: "Ask about RAIMOSA, active work, or prior receipts.",
  },
  Operate: {
    authority: "PLAN ONLY · APPROVAL REQUIRED",
    helper: "Turn an outcome into a governed mission plan.",
  },
  "Scan & Debug": {
    authority: "READ-ONLY SCAN · NO REPAIR ACCESS",
    helper: "Scan RAIMOSA, explain issues, and propose a verified repair.",
  },
};

const formatTime = (seconds) =>
  `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

function useModalFocus(onClose) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const node = ref.current;
    const focusable = () => [
      ...(node?.querySelectorAll(
        "button:not(:disabled), input:not(:disabled), [tabindex='0']",
      ) ?? []),
    ];
    focusable()[0]?.focus();
    function onKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key === "Tab") {
        const items = focusable();
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus?.();
    };
  }, [onClose]);
  return ref;
}

function Header({
  active,
  stopped,
  adapterOnline,
  onNavigate,
  onStop,
  onCommand,
}) {
  const [command, setCommand] = useState("");
  const inputRef = useRef(null);
  useEffect(() => {
    function onShortcut(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);

  function submit(event) {
    event.preventDefault();
    if (!command.trim()) return;
    onCommand(command.trim());
    setCommand("");
  }

  return (
    <header className="topbar">
      <button
        className="brand"
        type="button"
        onClick={() => onNavigate("Home")}
        aria-label="Go to RAIMOSA Home"
      >
        <img src="/assets/raimosa-r-emblem.png" alt="" />
        <div>
          <strong>RAIMOSA AI</strong>
          <span>AI DESKTOP COMMANDER</span>
        </div>
      </button>
      <form className="command" role="search" onSubmit={submit}>
        <MagnifyingGlass size={19} />
        <input
          ref={inputRef}
          aria-label="Global command"
          placeholder="What should RAIMOSA coordinate?"
          value={command}
          onChange={(event) => setCommand(event.target.value)}
        />
        <kbd aria-hidden="true">⌘ K</kbd>
        <button
          type="submit"
          aria-label="Send global command"
          disabled={!command.trim()}
        >
          <ArrowRight size={18} />
        </button>
      </form>
      <div className="trust">
        <span>
          {adapterOnline ? <ShieldCheck size={20} /> : <Warning size={20} />}
          {adapterOnline ? "Adapter online" : "Adapter offline"}
        </span>
        <button
          type="button"
          className={active === "Permissions" ? "selected" : ""}
          onClick={() => onNavigate("Permissions")}
        >
          <LockKey size={20} />
          Permissions
        </button>
        <button
          type="button"
          className={`stop ${stopped ? "active" : ""}`}
          onClick={onStop}
        >
          <Stop size={20} />
          {stopped ? "Stop active" : "Emergency stop"}
        </button>
      </div>
    </header>
  );
}

function SideNav({ active, onChange }) {
  return (
    <nav className="sidenav" aria-label="Main navigation">
      {nav.map(([label, Icon]) => (
        <button
          type="button"
          key={label}
          className={active === label ? "active" : ""}
          onClick={() => onChange(label)}
          aria-current={active === label ? "page" : undefined}
        >
          <Icon size={25} weight={active === label ? "duotone" : "regular"} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

function PageHeading({ eyebrow, title, description, action }) {
  return (
    <div className="page-heading">
      <div>
        <span>{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}

function relativeTime(iso) {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

// Everything on this page is read from the live adapter: the capability
// registry, the durable emergency latch, and the real receipt ledger. It must
// never render a placeholder that looks like a record.
function HomeView({
  onNavigate,
  onAllAccess,
  access,
  adapterOnline,
  health,
  receipts,
  receiptsError,
}) {
  const capabilities = health?.capabilities ?? [];
  const available = capabilities.filter((c) => c.status === "available");
  const pro = health?.license?.pro === true;
  const latched = health?.emergency?.latched === true;
  const recent = receipts.slice(0, 3);
  const lastReceipt = receipts[0] ?? null;

  return (
    <section className="workspace-page home-view">
      <PageHeading
        eyebrow="COMMAND CENTER"
        title={`${greeting()}, Commander`}
        description="One governed place to plan, approve, inspect, and verify RAIMOSA work."
        action={
          <button
            type="button"
            className="primary"
            onClick={() => onNavigate("Tools")}
          >
            Open tools <ArrowRight size={18} />
          </button>
        }
      />
      <div className="metric-grid" aria-label="Command center status">
        <article>
          <span>VERIFIED CAPABILITIES</span>
          <strong>{adapterOnline ? available.length : "—"}</strong>
          <p>
            {adapterOnline
              ? `${available.length} of ${capabilities.length} have a verified adapter on ${health?.platform ?? "this system"}.`
              : "The local adapter is not responding."}
          </p>
          <button type="button" onClick={() => onNavigate("Permissions")}>
            Review permissions <CaretRight />
          </button>
        </article>
        <article>
          <span>RECEIPTS RECORDED</span>
          <strong>{receiptsError ? "—" : receipts.length}</strong>
          <p>
            {receiptsError
              ? "The ledger could not be read."
              : lastReceipt
                ? `Last: ${lastReceipt.tool} · ${relativeTime(lastReceipt.timestamp) ?? "recorded"}.`
                : "No adapter action has been recorded yet."}
          </p>
          <button type="button" onClick={() => onNavigate("Ledger")}>
            Open the ledger <CaretRight />
          </button>
        </article>
        <article className={access.active ? "access-live" : ""}>
          <span>OVIA AI AUTHORITY</span>
          <strong>
            {access.active ? formatTime(access.remaining) : "OFF"}
          </strong>
          <p>
            {access.active
              ? "All Access is visible, timed, and revocable."
              : "No All Access session is active."}
          </p>
          <button type="button" onClick={onAllAccess}>
            {access.active ? "Review access" : "Request access"} <CaretRight />
          </button>
        </article>
      </div>
      <div className="home-columns">
        <section className="surface activity-surface">
          <div className="surface-title">
            <div>
              <Activity />
              <span>RECENT RECEIPTS</span>
            </div>
            <button type="button" onClick={() => onNavigate("Ledger")}>
              See runtime receipts
            </button>
          </div>
          {receiptsError ? (
            <p className="empty-note">
              The receipt ledger could not be read: {receiptsError}
            </p>
          ) : recent.length === 0 ? (
            <p className="empty-note">
              No receipts yet. Every adapter action RAIMOSA takes is recorded
              here as tamper-evident evidence.
            </p>
          ) : (
            recent.map((entry) => (
              <div className="activity-item" key={entry.id}>
                {entry.verified ? <CheckCircle /> : <Warning />}
                <div>
                  <strong>{entry.tool}</strong>
                  <span>
                    {entry.scope} ·{" "}
                    {relativeTime(entry.timestamp) ?? entry.timestamp}
                  </span>
                </div>
                <em>{entry.id}</em>
              </div>
            ))
          )}
        </section>
        <section className="surface trust-surface">
          <div className="surface-title">
            <div>
              <ShieldCheck />
              <span>TRUST POSTURE</span>
            </div>
          </div>
          <dl>
            <div>
              <dt>Local adapter</dt>
              <dd className={adapterOnline ? "ok" : ""}>
                {adapterOnline ? "Online" : "Offline"}
              </dd>
            </div>
            <div>
              <dt>Licence</dt>
              <dd className={pro ? "ok" : ""}>{pro ? "Pro" : "Free"}</dd>
            </div>
            <div>
              <dt>Emergency stop</dt>
              <dd className={latched ? "" : "ok"}>
                {latched ? "ENGAGED" : adapterOnline ? "Ready" : "Unknown"}
              </dd>
            </div>
            <div>
              <dt>Last local receipt</dt>
              <dd>
                {receiptsError
                  ? "Unavailable"
                  : lastReceipt
                    ? (relativeTime(lastReceipt.timestamp) ?? "recorded")
                    : "None yet"}
              </dd>
            </div>
          </dl>
          <button
            type="button"
            className="secondary"
            onClick={() => onNavigate("Permissions")}
          >
            Review permissions
          </button>
        </section>
      </div>
    </section>
  );
}
function PermissionsView({
  access,
  capabilities = [],
  adapterOnline,
  onRequest,
  onEnd,
}) {
  return (
    <section className="workspace-page permissions-view">
      <div
        className={`prototype-notice ${adapterOnline ? "core-live" : ""}`}
        role="status"
      >
        {adapterOnline ? <CheckCircle size={15} /> : <Warning size={15} />}
        <strong>
          {adapterOnline
            ? "Live permission registry"
            : "Desktop adapter unavailable"}
        </strong>
        <span>
          {adapterOnline
            ? "All Access is enforced by the local runtime"
            : "No authority session can start"}
        </span>
      </div>
      <PageHeading
        eyebrow="PERMISSIONS"
        title="Visible authority, never silent access"
        description="Capability families are explicit. High-risk actions always require step-up approval."
        action={
          adapterOnline ? (
            <button
              type="button"
              className={access.active ? "danger" : "primary"}
              onClick={access.active ? onEnd : onRequest}
            >
              {access.active ? "End All Access" : "Request All Access"}
            </button>
          ) : null
        }
      />
      {access.active ? (
        <div className="access-session-card" role="status">
          <ShieldWarning weight="fill" />
          <div>
            <span>OVIA AI ALL ACCESS · ACTIVE</span>
            <strong>{formatTime(access.remaining)} remaining</strong>
            <p>
              Approved capability families only. Every use appears in the
              ledger.
            </p>
          </div>
          <button type="button" onClick={onEnd}>
            Revoke now
          </button>
        </div>
      ) : (
        <div className="no-access-card">
          <LockKey />
          <div>
            <strong>No All Access session</strong>
            <p>OVIA AI remains in the authority shown by its selected mode.</p>
          </div>
        </div>
      )}
      <section
        className="surface capability-table"
        aria-label="Capability permissions"
      >
        <div className="capability-head">
          <span>Capability family</span>
          <span>Current authority</span>
          <span>Protection</span>
        </div>
        {capabilities.map((capability) => (
          <div key={capability.id}>
            <span>
              {capability.status === "available" ? (
                <CheckCircle />
              ) : (
                <ShieldWarning />
              )}
              {capability.title}
            </span>
            <strong
              className={capability.status === "available" ? "" : "blocked"}
            >
              {capability.status === "available"
                ? capability.risk === "read-only"
                  ? "Read-only"
                  : access.active
                    ? "All Access"
                    : "Approval required"
                : "Unavailable"}
            </strong>
            <em>{capability.adapter ?? "No verified adapter"}</em>
          </div>
        ))}
      </section>
    </section>
  );
}

function SettingsView({ settings, onChange }) {
  // Only settings that actually change behaviour belong here. A switch that
  // writes state nothing reads is a fake control.
  const rows = [
    [
      "motion",
      "Reduced motion",
      "Minimize non-essential transitions and animated status.",
    ],
  ];
  return (
    <section className="workspace-page settings-view">
      <PageHeading
        eyebrow="SETTINGS"
        title="Local command preferences"
        description="Tune the interface without changing mission authority or permissions."
      />
      <section className="surface settings-panel">
        <h2>Interface</h2>
        {rows.map(([key, title, detail]) => (
          <label key={key}>
            <span>
              <strong>{title}</strong>
              <small>{detail}</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={settings[key]}
              onChange={(event) => onChange(key, event.target.checked)}
            />
          </label>
        ))}
      </section>
      <section className="surface local-card">
        <ShieldCheck />
        <div>
          <strong>Local-first</strong>
          <p>
            This preference is held in this browser session. No account or cloud
            state is changed.
          </p>
        </div>
      </section>
    </section>
  );
}

function RuntimeLedgerView() {
  const [receipts, setReceipts] = useState([]);
  const [durable, setDurable] = useState(false);
  const [integrity, setIntegrity] = useState(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [exporting, setExporting] = useState("");

  const visible = filter
    ? receipts.filter(
        (entry) =>
          entry.tool.toLowerCase().includes(filter.toLowerCase()) ||
          entry.scope.toLowerCase().includes(filter.toLowerCase()),
      )
    : receipts;

  async function exportReceipts(format) {
    setExporting(format);
    setError("");
    try {
      const data = await desktopApi.exportReceipts(format, filter);
      const blob = new Blob([data.content], {
        type: format === "csv" ? "text/csv" : "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = data.filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(exportError.message);
    } finally {
      setExporting("");
    }
  }

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const data = await desktopApi.receipts();
      setReceipts(data.receipts ?? []);
      setDurable(data.durable === true);
      setIntegrity(data.integrity ?? null);
      setTotal(Number(data.count) || 0);
    } catch (ledgerError) {
      setError(ledgerError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <section className="workspace-page runtime-ledger-view">
      <div className="prototype-notice core-live" role="status">
        <Activity size={15} />
        <strong>Live runtime evidence</strong>
        <span>
          {durable ? "Durable append-only ledger" : "Non-durable ledger"} ·{" "}
          {total} recorded · showing the latest {receipts.length}
        </span>
      </div>
      <PageHeading
        eyebrow="LEDGER"
        title="Runtime receipt ledger"
        description="Verified adapter, access, scan, and mobile-remote events from this local RAIMOSA AI runtime."
        action={
          <div className="ledger-actions">
            <button
              type="button"
              className="primary"
              onClick={refresh}
              disabled={loading}
            >
              <Activity size={18} />
              {loading ? "Refreshing…" : "Refresh receipts"}
            </button>
          </div>
        }
      />
      {receipts.length > 0 && (
        <div className="ledger-toolbar">
          <label className="ledger-filter">
            <MagnifyingGlass size={17} />
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter by tool or scope"
              aria-label="Filter receipts by tool or scope"
            />
          </label>
          <span className="ledger-count" role="status">
            {visible.length} of {receipts.length} shown
          </span>
          <div className="ledger-export">
            <button
              type="button"
              className="secondary"
              disabled={Boolean(exporting)}
              onClick={() => exportReceipts("json")}
            >
              <DownloadSimple size={17} />
              {exporting === "json" ? "Exporting…" : "Export JSON"}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={Boolean(exporting)}
              onClick={() => exportReceipts("csv")}
            >
              <DownloadSimple size={17} />
              {exporting === "csv" ? "Exporting…" : "Export CSV"}
            </button>
          </div>
        </div>
      )}
      <div
        className={`runtime-ledger-note${
          integrity && !integrity.intact ? " ledger-note-broken" : ""
        }`}
        role={integrity && !integrity.intact ? "alert" : "note"}
      >
        <ShieldCheck size={19} />
        {integrity && !integrity.intact ? (
          <span>
            Receipt chain integrity check FAILED at {integrity.brokenAt}.{" "}
            {integrity.reason} Treat every receipt after that point as
            unverified.
          </span>
        ) : durable ? (
          <span>
            Receipts are written to an append-only on-disk ledger and survive a
            runtime restart. Each receipt is hash-chained to the one before it
            {integrity ? `; all ${integrity.checked} verified` : ""}.
          </span>
        ) : (
          <span>
            This runtime is using a non-durable in-memory ledger. Receipts will
            be lost when it stops.
          </span>
        )}
      </div>
      {error && (
        <div className="inline-error" role="alert">
          <Warning />
          {error}
        </div>
      )}
      {!loading && !error && receipts.length === 0 && (
        <section className="surface runtime-empty">
          <BookOpen size={30} />
          <h2>No runtime receipts yet</h2>
          <p>
            Run a live health scan or use a verified tool. Its receipt will
            appear here.
          </p>
        </section>
      )}
      {receipts.length > 0 && (
        <section className="surface runtime-receipts">
          <div className="runtime-receipt-head">
            <span>Tool or event</span>
            <span>Scope</span>
            <span>Time</span>
            <span>Evidence</span>
          </div>
          {visible.map((item) => (
            <details key={item.id} className="runtime-receipt-row">
              <summary>
                <span>
                  <CheckCircle size={19} />
                  <strong>{item.tool}</strong>
                  <small>{item.id}</small>
                </span>
                <span title={item.scope}>{item.scope}</span>
                <time dateTime={item.timestamp}>
                  {new Date(item.timestamp).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </time>
                <em>{item.verified ? "Verified" : "Unverified"}</em>
              </summary>
              <pre>{JSON.stringify(item.result, null, 2)}</pre>
            </details>
          ))}
        </section>
      )}
    </section>
  );
}

function Ovia({ access, command, onAccess, onEnd, collapsed, onToggle }) {
  const [mode, setMode] = useState("Scan & Debug");
  const [scanning, setScanning] = useState(false);
  const [scanReceipt, setScanReceipt] = useState(null);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([
    {
      id: 1,
      text: "Ready to run a read-only RAIMOSA health scan.",
      time: "OVIA AI",
    },
  ]);
  const processedCommandRef = useRef(null);
  const threadRef = useRef(null);
  const authority = access.active
    ? `ALL ACCESS · ${formatTime(access.remaining)} · STEP-UP ON`
    : modes[mode].authority;

  useEffect(() => {
    if (!command || processedCommandRef.current === command.id) return;
    processedCommandRef.current = command.id;
    setMode("Operate");
    setMessages((current) => [
      ...current,
      { id: command.id, text: command.text, time: "You" },
    ]);
    void desktopApi
      .health()
      .then((healthData) =>
        desktopApi.plan(command.text, healthData.defaultWorkspace),
      )
      .then(({ plan }) => {
        const approval = !plan.available
          ? "No dispatch or action ran because no verified adapter is configured."
          : plan.requiresApproval
            ? "Explicit approval is required before execution."
            : "This plan remains read-only.";
        setMessages((current) => [
          ...current,
          {
            id: command.id + 1,
            text: `${plan.id}: ${plan.intent}. Decision: ${plan.decision}. Risk: ${plan.risk}. ${approval}`,
            time: "OVIA AI",
          },
        ]);
      })
      .catch((planError) => {
        setMessages((current) => [
          ...current,
          {
            id: command.id + 1,
            text: `I could not compile that objective: ${planError.message}`,
            time: "OVIA AI",
          },
        ]);
      });
  }, [command]);

  useEffect(() => {
    const node = threadRef.current;
    if (node) node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [messages, mode, scanReceipt]);

  async function scan(userText) {
    setMode("Scan & Debug");
    setScanning(true);
    setScanReceipt(null);
    setMessages((current) => [
      ...current,
      ...(userText ? [{ id: Date.now(), text: userText, time: "You" }] : []),
      {
        id: Date.now() + 1,
        text: "Running a live read-only scan of the local RAIMOSA AI runtime.",
        time: "OVIA AI",
      },
    ]);
    try {
      const data = await desktopApi.scan();
      const nextReceipt = data.receipt;
      setScanReceipt(nextReceipt);
      const findings = nextReceipt.result.findings.length;
      setMessages((current) => [
        ...current,
        {
          id: Date.now() + 2,
          text: `Live scan complete: ${nextReceipt.result.checks.length} checks, ${findings} ${findings === 1 ? "finding" : "findings"}. Receipt ${nextReceipt.id}.`,
          time: "OVIA AI",
        },
      ]);
    } catch (scanError) {
      setMessages((current) => [
        ...current,
        {
          id: Date.now() + 2,
          text: `The live scan failed: ${scanError.message}`,
          time: "OVIA AI",
        },
      ]);
    } finally {
      setScanning(false);
    }
  }

  async function send(event) {
    event.preventDefault();
    if (!input.trim()) return;
    const text = input.trim();
    setInput("");
    if (mode === "Scan & Debug") {
      await scan(text);
      return;
    }
    setMessages((current) => [
      ...current,
      { id: Date.now(), text, time: "You" },
    ]);
    if (mode === "Ask") {
      setMessages((current) => [
        ...current,
        {
          id: Date.now() + 1,
          text: "External model reasoning is not configured. I can still compile governed local plans, run verified adapters, and show receipts.",
          time: "OVIA AI",
        },
      ]);
      return;
    }
    try {
      const healthData = await desktopApi.health();
      const { plan } = await desktopApi.plan(text, healthData.defaultWorkspace);
      setMessages((current) => [
        ...current,
        {
          id: Date.now() + 1,
          text: `${plan.id}: ${plan.intent}. ${plan.explanation} Decision: ${plan.decision}.`,
          time: "OVIA AI",
        },
      ]);
    } catch (planError) {
      setMessages((current) => [
        ...current,
        {
          id: Date.now() + 1,
          text: `I could not compile that plan: ${planError.message}`,
          time: "OVIA AI",
        },
      ]);
    }
  }

  if (collapsed) {
    return (
      <aside className="ovia collapsed" aria-label="OVIA AI collapsed">
        <button
          type="button"
          className="ovia-restore"
          onClick={onToggle}
          aria-label="Open OVIA AI"
        >
          <img src="/assets/raimosa-r-emblem.png" alt="" />
          <span>OVIA AI</span>
          <SidebarSimple size={20} />
        </button>
      </aside>
    );
  }

  return (
    <aside className="ovia" aria-label="OVIA AI">
      <div className="ovia-title">
        <span>
          <img src="/assets/raimosa-r-emblem.png" alt="" />
          OVIA AI
        </span>
        <button type="button" aria-label="Minimize OVIA AI" onClick={onToggle}>
          <SidebarSimple size={20} />
        </button>
      </div>
      <div className="modes" role="tablist" aria-label="OVIA AI modes">
        {Object.keys(modes).map((item) => (
          <button
            type="button"
            role="tab"
            aria-selected={mode === item}
            className={mode === item ? "active" : ""}
            key={item}
            onClick={() => setMode(item)}
          >
            {item}
          </button>
        ))}
      </div>
      <p className="helper">{modes[mode].helper}</p>
      <div className={`authority ${access.active ? "all" : ""}`}>
        <LockKey size={16} />
        {authority}
      </div>
      <div ref={threadRef} className="thread" aria-live="polite">
        {messages.map((message) => (
          <div
            className={`message ${message.time === "You" ? "from-user" : ""}`}
            key={message.id}
          >
            <img src="/assets/raimosa-r-emblem.png" alt="" />
            <div>
              <time>{message.time}</time>
              <p>{message.text}</p>
            </div>
          </div>
        ))}
        {scanReceipt && mode === "Scan & Debug" && (
          <div
            className={`finding ${scanReceipt.result.findings.length === 0 ? "healthy" : ""}`}
          >
            <div>
              {scanReceipt.result.findings.length === 0 ? (
                <CheckCircle size={25} />
              ) : (
                <Warning size={25} />
              )}
              <strong>
                {scanReceipt.result.findings.length === 0
                  ? "Runtime healthy"
                  : `${scanReceipt.result.findings.length} live ${scanReceipt.result.findings.length === 1 ? "issue" : "issues"} found`}
              </strong>
            </div>
            <span>LIVE SCAN · {scanReceipt.id}</span>
            <p>
              {scanReceipt.result.findings.length === 0
                ? `${scanReceipt.result.checks.length} runtime checks passed with no finding.`
                : `${scanReceipt.result.findings[0].title}: ${scanReceipt.result.findings[0].detail}`}
            </p>
          </div>
        )}
        {mode === "Scan & Debug" && (
          <button
            type="button"
            className="scan"
            onClick={() => void scan()}
            disabled={scanning}
          >
            <Wrench size={18} />
            {scanning ? "Scanning live runtime…" : "Run live health scan"}
          </button>
        )}
      </div>
      <div className="composer-wrap">
        <span className="composer-context">
          {mode} ·{" "}
          {access.active
            ? "All Access active"
            : modes[mode].authority.toLowerCase()}
        </span>
        <form className="composer" onSubmit={send}>
          <input
            aria-label="Message OVIA AI"
            placeholder={`Message OVIA AI in ${mode} mode…`}
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
          <button
            type="submit"
            aria-label="Send message"
            disabled={!input.trim()}
          >
            <PaperPlaneTilt size={21} />
          </button>
        </form>
        <button
          type="button"
          className={`access ${access.active ? "active" : ""}`}
          onClick={access.active ? onEnd : onAccess}
        >
          <LockKey size={19} />
          {access.active
            ? `End All Access · ${formatTime(access.remaining)}`
            : "Request All Access"}
          <CaretDown size={17} />
        </button>
      </div>
    </aside>
  );
}

function AccessDialog({ capabilities = [], busy, error, onClose, onActivate }) {
  const [confirmed, setConfirmed] = useState(false);
  const [duration, setDuration] = useState(900);
  const dialogRef = useModalFocus(onClose);
  return (
    <div className="backdrop">
      <section
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="access-title"
      >
        <button
          type="button"
          className="close"
          onClick={onClose}
          aria-label="Close All Access dialog"
        >
          <X />
        </button>
        <ShieldWarning size={34} />
        <span>OVIA AI AUTHORITY</span>
        <h2 id="access-title">Start an All Access session?</h2>
        <p>
          OVIA AI can use approved capability families on this device for a
          short time. Every use is visible and logged.
        </p>
        <div className="included">
          <strong>Verified capability families</strong>
          {capabilities
            .filter((item) => item.status === "available")
            .map((item) => (
              <span key={item.id}>
                <Check />
                {item.title}
              </span>
            ))}
        </div>
        <div className="excluded">
          <Warning />
          <p>
            <strong>Still protected</strong>
            <br />
            Deletion, credentials, money, publishing, security changes,
            arbitrary shell, and unrestricted computer control.
          </p>
        </div>
        <fieldset>
          <legend>Duration</legend>
          {[300, 600, 900].map((seconds) => (
            <label
              className={duration === seconds ? "active" : ""}
              key={seconds}
            >
              <input
                type="radio"
                name="duration"
                checked={duration === seconds}
                onChange={() => setDuration(seconds)}
              />
              {seconds / 60} min
            </label>
          ))}
        </fieldset>
        <label className="confirm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          I understand this session is broad, visible, revocable, and still
          governed.
        </label>
        {error && (
          <div className="inline-error" role="alert">
            <Warning />
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="secondary"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={!confirmed || busy}
            onClick={() => onActivate(duration)}
          >
            {busy ? "Starting…" : "Start All Access"}
          </button>
        </div>
      </section>
    </div>
  );
}

function StopDialog({ stage, revoked, onReview, onClear }) {
  const dialogRef = useModalFocus(() => {});
  return (
    <div className="backdrop stopback">
      <section
        ref={dialogRef}
        className="stopdialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="stop-title"
      >
        <Stop size={45} />
        <span>LOCAL SAFETY CONTROL</span>
        <h2 id="stop-title">Emergency stop is active</h2>
        {stage === "blocked" ? (
          <>
            <p>
              New adapter dispatch and unused approvals are blocked at the local
              runtime. No completed action has been reversed.
            </p>
            <strong>
              <CheckCircle />
              Adapter dispatch latched at the local runtime
            </strong>
            <button type="button" onClick={onReview}>
              Continue to recovery review
            </button>
          </>
        ) : (
          <>
            <p>
              The latch is held by the server and survives a restart. It is
              cleared only by the explicit action below.
            </p>
            {/* These lines report what the server said it revoked. If the stop
                response is unavailable, say so rather than assert a result. */}
            <div className="recovery-list">
              {revoked ? (
                <>
                  <span>
                    <Check />
                    All Access revoked ({revoked.accessSessions})
                  </span>
                  <span>
                    <Check />
                    Paired remotes revoked ({revoked.remoteSessions})
                  </span>
                  <span>
                    <Check />
                    Completed receipts preserved
                  </span>
                </>
              ) : (
                <span>
                  <Warning />
                  The runtime did not report what was revoked.
                </span>
              )}
            </div>
            <button type="button" onClick={onClear}>
              Clear emergency stop
            </button>
          </>
        )}
      </section>
    </div>
  );
}

function loadSessionSettings() {
  const fallback = { notifications: true, motion: false, receipts: true };
  try {
    const saved = window.sessionStorage.getItem("raimosa-preview-settings");
    return saved ? { ...fallback, ...JSON.parse(saved) } : fallback;
  } catch {
    return fallback;
  }
}

export function App() {
  const [active, setActive] = useState("Ledger");
  const [accessModal, setAccessModal] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [stopStage, setStopStage] = useState("blocked");
  const [stopRevoked, setStopRevoked] = useState(null);
  const [access, setAccess] = useState({
    active: false,
    remaining: 0,
    token: null,
    id: null,
  });
  const [accessBusy, setAccessBusy] = useState(false);
  const [accessError, setAccessError] = useState("");
  const [health, setHealth] = useState(null);
  const [receipts, setReceipts] = useState([]);
  const [receiptsError, setReceiptsError] = useState("");
  const [command, setCommand] = useState(null);
  const [oviaCollapsed, setOviaCollapsed] = useState(false);
  const [settings, setSettings] = useState(loadSessionSettings);
  const [announcement, setAnnouncement] = useState(
    "RAIMOSA local adapter ready.",
  );

  useEffect(() => {
    if (!access.active) return;
    const id = window.setInterval(
      () =>
        setAccess((current) =>
          current.remaining <= 1
            ? { active: false, remaining: 0, token: null, id: null }
            : { ...current, remaining: current.remaining - 1 },
        ),
      1000,
    );
    return () => window.clearInterval(id);
  }, [access.active]);

  useEffect(() => {
    let current = true;
    desktopApi
      .health()
      .then((data) => {
        if (!current) return;
        setHealth(data);
        // The latch is server state and survives restarts; a fresh tab must
        // show the active emergency stop instead of a falsely ready shell.
        if (data.emergency?.latched) {
          setStopped(true);
          setStopStage("blocked");
        }
      })
      .catch(() => {
        if (current) setHealth(null);
      });
    return () => {
      current = false;
    };
  }, []);

  // The Home dashboard shows real receipts, so it reads the live ledger. It is
  // refetched when the view is opened, never cached into a stale-looking claim.
  useEffect(() => {
    if (active !== "Home") return;
    let current = true;
    desktopApi
      .receipts()
      .then((data) => {
        if (!current) return;
        setReceipts(data.receipts ?? []);
        setReceiptsError("");
      })
      .catch((error) => {
        if (!current) return;
        setReceipts([]);
        setReceiptsError(error.message || "unavailable");
      });
    return () => {
      current = false;
    };
  }, [active]);

  useEffect(() => {
    window.sessionStorage.setItem(
      "raimosa-preview-settings",
      JSON.stringify(settings),
    );
  }, [settings]);

  // The reduced-motion class lives on .shell, but the ambient field is
  // painted on body::before — outside that subtree. Mirror the setting onto
  // <body> so the in-app toggle actually stops every animation, not just the
  // ones inside the shell.
  useEffect(() => {
    document.body.classList.toggle("reduced-motion-field", settings.motion);
  }, [settings.motion]);

  // Inside RAIMOSA.app the window uses a transparent titlebar, so the shell
  // must reserve space for the traffic lights rather than sit beneath them.
  useEffect(() => {
    if (health?.native === "macos") document.body.classList.add("native-macos");
  }, [health?.native]);

  useEffect(
    () => () => {
      if (simulationTimerRef.current)
        window.clearTimeout(simulationTimerRef.current);
    },
    [],
  );

  function resetViewportScroll() {
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0 }));
  }

  function navigate(next) {
    if (next === "Ledger") setLedgerMode("runtime");
    setActive(next);
    resetViewportScroll();
    setAnnouncement(`${next} opened.`);
  }

  async function startAccess(duration) {
    if (accessBusy) return;
    setAccessBusy(true);
    setAccessError("");
    try {
      const data = await desktopApi.startAccess(duration);
      setAccess({
        active: true,
        remaining: data.session.remainingSeconds,
        token: data.session.token,
        id: data.session.id,
      });
      setAccessModal(false);
      setAnnouncement(`All Access active for ${duration / 60} minutes.`);
    } catch (error) {
      setAccessError(error.message);
    } finally {
      setAccessBusy(false);
    }
  }

  async function endAccess(message = "All Access ended.") {
    const token = access.token;
    setAccess({ active: false, remaining: 0, token: null, id: null });
    if (token) await desktopApi.endAccess(token).catch(() => {});
    setAnnouncement(message);
  }

  function requestStop() {
    // Latch the server first: this blocks every adapter dispatch and revokes
    // all authority runtime-wide, not just in this tab.
    void desktopApi
      .emergencyStop()
      .then((result) => setStopRevoked(result.revoked ?? null))
      .catch(() => setStopRevoked(null));
    setAccess({ active: false, remaining: 0, token: null, id: null });
    setAnnouncement(
      "Emergency stop active. All Access and mobile remote sessions were revoked.",
    );
    setStopStage("blocked");
    setStopped(true);
    setAnnouncement("Emergency stop active. New execution is blocked.");
  }

  let workspace;
  if (active === "Home")
    workspace = (
      <HomeView
        onNavigate={navigate}
        onAllAccess={() =>
          access.active ? navigate("Permissions") : setAccessModal(true)
        }
        access={access}
        adapterOnline={Boolean(health)}
        health={health}
        receipts={receipts}
        receiptsError={receiptsError}
      />
    );
  if (active === "Ledger") workspace = <RuntimeLedgerView />;
  if (active === "Intelligence")
    workspace = (
      <IntelligenceView
        initialCommand={command}
        onAnnouncement={setAnnouncement}
      />
    );
  if (active === "Tools")
    workspace = (
      <ToolsView
        accessToken={access.token}
        onRequestAccess={() => setAccessModal(true)}
        onAnnouncement={setAnnouncement}
      />
    );
  if (active === "Remote")
    workspace = (
      <RemoteView
        access={access}
        onRequestAccess={() => setAccessModal(true)}
        onAnnouncement={setAnnouncement}
      />
    );
  if (active === "Permissions")
    workspace = (
      <PermissionsView
        access={access}
        capabilities={health?.capabilities}
        adapterOnline={Boolean(health)}
        onRequest={() => setAccessModal(true)}
        onEnd={endAccess}
      />
    );
  if (active === "Settings")
    workspace = (
      <SettingsView
        settings={settings}
        onChange={(key, checked) => {
          setSettings((current) => ({ ...current, [key]: checked }));
          setAnnouncement(
            `${key === "motion" ? "Reduced motion" : key === "notifications" ? "Decision notifications" : "Receipt summaries"} ${checked ? "enabled" : "disabled"}.`,
          );
        }}
      />
    );

  return (
    <div className={`shell ${settings.motion ? "reduced-motion" : ""}`}>
      <Header
        active={active}
        stopped={stopped}
        adapterOnline={Boolean(health)}
        onNavigate={navigate}
        onStop={requestStop}
        onCommand={(text) => {
          setCommand({ id: Date.now(), text, source: "global" });
          setActive("Intelligence");
          setOviaCollapsed(false);
          resetViewportScroll();
          setAnnouncement("Command loaded into the OVIA AI Core compiler.");
        }}
      />
      {access.active && (
        <div className="accessbar" role="status">
          <ShieldWarning weight="fill" />
          <strong>
            OVIA AI All Access active · {formatTime(access.remaining)} remaining
          </strong>
          <span>
            Desktop and paired remote controls · high-risk step-up remains on
          </span>
          <button type="button" onClick={() => endAccess()}>
            End now
          </button>
        </div>
      )}
      <div className={`body ${oviaCollapsed ? "ovia-collapsed" : ""}`}>
        <SideNav active={active} onChange={navigate} />
        <main id="workspace">{workspace}</main>
        <Ovia
          access={access}
          command={command}
          onAccess={() => setAccessModal(true)}
          onEnd={endAccess}
          collapsed={oviaCollapsed}
          onToggle={() => setOviaCollapsed((current) => !current)}
        />
      </div>
      <div className="sr-only" aria-live="polite">
        {announcement}
      </div>
      {accessModal && (
        <AccessDialog
          capabilities={health?.capabilities}
          busy={accessBusy}
          error={accessError}
          onClose={() => {
            if (!accessBusy) {
              setAccessModal(false);
              setAccessError("");
            }
          }}
          onActivate={startAccess}
        />
      )}
      {stopped && (
        <StopDialog
          stage={stopStage}
          revoked={stopRevoked}
          onReview={() => setStopStage("review")}
          onClear={() => {
            void desktopApi.emergencyClear().catch(() => {});
            setStopped(false);
            setStopStage("blocked");
            setAnnouncement("Emergency stop cleared after recovery review.");
          }}
        />
      )}
    </div>
  );
}
