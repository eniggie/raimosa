import { useEffect, useMemo, useState } from "react";
import {
  ActivityIcon as Activity,
  BellIcon as Bell,
  CheckCircleIcon as CheckCircle,
  DesktopIcon as Desktop,
  DeviceMobileIcon as DeviceMobile,
  LinkIcon as Link,
  LockKeyIcon as LockKey,
  PlayIcon as Play,
  ShieldCheckIcon as ShieldCheck,
  StopIcon as Stop,
  WarningIcon as Warning,
  XIcon as X,
} from "@phosphor-icons/react";
import { desktopApi } from "../desktop-api";

export function RemoteView({ access, onRequestAccess, onAnnouncement }) {
  const [pairing, setPairing] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function startPairing() {
    if (!access.token || busy) return;
    setBusy(true);
    setError("");
    try {
      const data = await desktopApi.startRemote(access.token);
      setPairing(data.pairing);
      onAnnouncement?.("Mobile remote pairing code created.");
    } catch (pairError) {
      setError(pairError.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!access.active) setPairing(null);
  }, [access.active]);

  return (
    <section className="workspace-page remote-view">
      <div className="prototype-notice core-live" role="status">
        <DeviceMobile size={16} />
        <strong>Mobile is a desktop remote</strong>
        <span>
          No phone can connect without a fresh code and active OVIA AI All
          Access.
        </span>
      </div>
      <div className="page-heading">
        <div>
          <span>MOBILE REMOTE</span>
          <h1>Control this desktop from a paired phone</h1>
          <p>
            The phone remains a revocable extension of this desktop session. It
            cannot inherit credentials, arbitrary shell access, or authority
            after All Access ends.
          </p>
        </div>
      </div>

      <div className="remote-layout">
        <section className="surface remote-pairing">
          <header>
            <DeviceMobile size={28} />
            <div>
              <span>PAIR ONE PHONE</span>
              <h2>Local-network pairing</h2>
            </div>
          </header>
          {!access.active ? (
            <div className="remote-lock">
              <LockKey size={31} />
              <div>
                <strong>All Access is off</strong>
                <p>
                  Start a visible, timed session before generating a remote
                  code.
                </p>
              </div>
              <button
                type="button"
                className="primary"
                onClick={onRequestAccess}
              >
                Start All Access
              </button>
            </div>
          ) : !pairing ? (
            <div className="remote-ready">
              <ShieldCheck size={27} />
              <p>
                Pairing will expire after five minutes or when the current All
                Access session ends.
              </p>
              <button
                type="button"
                className="primary"
                onClick={startPairing}
                disabled={busy}
              >
                {busy ? "Creating…" : "Create pairing code"}
              </button>
            </div>
          ) : (
            <div className="pairing-ticket">
              <span>PAIRING CODE</span>
              <strong>{pairing.code}</strong>
              <p>On the phone, open one address below and enter this code.</p>
              <div className="remote-addresses">
                {pairing.urls.length ? (
                  pairing.urls.map((url) => (
                    <a href={url} key={url} target="_blank" rel="noreferrer">
                      <Link />
                      {url}
                    </a>
                  ))
                ) : (
                  <em>
                    No local-network address was detected. Connect this desktop
                    to Wi-Fi or Ethernet.
                  </em>
                )}
              </div>
              <small>
                Code expires at{" "}
                {new Date(pairing.expiresAt).toLocaleTimeString()}.
              </small>
              <button
                type="button"
                className="secondary"
                onClick={() => setPairing(null)}
              >
                <X />
                Hide code
              </button>
            </div>
          )}
          {error && (
            <div className="inline-error" role="alert">
              <Warning />
              {error}
            </div>
          )}
        </section>

        <section className="surface remote-boundaries">
          <header>
            <ShieldCheck size={28} />
            <div>
              <span>CONTROL BOUNDARIES</span>
              <h2>Same safety, smaller screen</h2>
            </div>
          </header>
          <ul>
            <li>
              <CheckCircle /> Pairing is local-network only and short-lived.
            </li>
            <li>
              <CheckCircle /> Every remote tool call returns a desktop receipt.
            </li>
            <li>
              <CheckCircle /> Emergency Stop and All Access revocation
              disconnect phones.
            </li>
            <li>
              <CheckCircle /> Only the verified remote tool allowlist is
              exposed.
            </li>
            <li>
              <Stop /> No publishing, credentials, money, deletion, power, or
              shell control.
            </li>
          </ul>
        </section>
      </div>
    </section>
  );
}

function remoteSessionFromStorage() {
  try {
    return JSON.parse(
      window.sessionStorage.getItem("raimosa-remote-session") || "null",
    );
  } catch {
    return null;
  }
}

export function RemoteControlView() {
  const [code, setCode] = useState("");
  const [session, setSession] = useState(remoteSessionFromStorage);
  const [apps, setApps] = useState([]);
  const [selectedApp, setSelectedApp] = useState("");
  const [notification, setNotification] = useState(
    "Remote check-in from OVIA AI.",
  );
  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [clock, setClock] = useState(Date.now());

  const remaining = useMemo(
    () =>
      session?.expiresAt
        ? Math.max(
            0,
            Math.ceil((new Date(session.expiresAt).getTime() - clock) / 1000),
          )
        : 0,
    [session, clock],
  );

  useEffect(() => {
    if (!session?.token) return;
    const id = window.setInterval(async () => {
      setClock(Date.now());
      const status = await desktopApi
        .remoteStatus(session.token)
        .catch(() => ({ active: false }));
      if (!status.active) {
        setSession(null);
        window.sessionStorage.removeItem("raimosa-remote-session");
        setError("The desktop revoked or ended this remote session.");
      }
    }, 3000);
    return () => window.clearInterval(id);
  }, [session?.token]);

  async function pair(event) {
    event.preventDefault();
    if (code.length !== 6 || busy) return;
    setBusy("pair");
    setError("");
    try {
      const data = await desktopApi.pairRemote(code);
      setSession(data.session);
      window.sessionStorage.setItem(
        "raimosa-remote-session",
        JSON.stringify(data.session),
      );
      setCode("");
    } catch (pairError) {
      setError(pairError.message);
    } finally {
      setBusy("");
    }
  }

  async function run(tool, payload = {}, after) {
    if (!session?.token || busy) return;
    setBusy(tool);
    setError("");
    try {
      const data = await desktopApi.runRemote(tool, session.token, payload);
      setReceipt(data.receipt);
      after?.(data.receipt);
    } catch (toolError) {
      setError(toolError.message);
      if (/expired|revoked/i.test(toolError.message)) {
        setSession(null);
        window.sessionStorage.removeItem("raimosa-remote-session");
      }
    } finally {
      setBusy("");
    }
  }

  async function disconnect() {
    if (session?.token)
      await desktopApi.endRemote(session.token).catch(() => {});
    setSession(null);
    window.sessionStorage.removeItem("raimosa-remote-session");
  }

  return (
    <main className="remote-shell">
      <header>
        <img src="/assets/raimosa-r-emblem.png" alt="" />
        <div>
          <strong>RAIMOSA AI</strong>
          <span>OVIA AI MOBILE REMOTE</span>
        </div>
      </header>
      {!session ? (
        <section className="remote-card pair-card">
          <DeviceMobile size={39} />
          <span>PAIR WITH DESKTOP</span>
          <h1>Your phone is the remote</h1>
          <p>
            Generate a code from Remote on the RAIMOSA desktop, then enter it
            here.
          </p>
          <form onSubmit={pair}>
            <label>
              Six-digit pairing code
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(event) =>
                  setCode(event.target.value.replace(/\D/g, ""))
                }
                placeholder="000000"
              />
            </label>
            <button type="submit" disabled={code.length !== 6 || busy}>
              {busy ? "Pairing…" : "Pair securely"}
            </button>
          </form>
          {error && (
            <div className="remote-error" role="alert">
              <Warning />
              {error}
            </div>
          )}
        </section>
      ) : (
        <>
          <section className="remote-session">
            <div>
              <CheckCircle weight="fill" />
              <span>
                <strong>Paired to desktop</strong>
                <small>
                  {Math.floor(remaining / 60)}m {remaining % 60}s remaining
                </small>
              </span>
            </div>
            <button type="button" onClick={disconnect}>
              Disconnect
            </button>
          </section>
          {error && (
            <div className="remote-error" role="alert">
              <Warning />
              {error}
            </div>
          )}
          <section className="remote-controls">
            <button
              type="button"
              onClick={() => run("process-status", { query: "" })}
              disabled={busy}
            >
              <Activity />
              Inspect running processes
            </button>
            <button
              type="button"
              onClick={() =>
                run("summarize-folder", { root: session.defaultWorkspace })
              }
              disabled={busy}
            >
              <Desktop />
              Summarize approved workspace
            </button>
            <button
              type="button"
              onClick={() =>
                run("list-applications", {}, (next) => {
                  setApps(next.result.applications);
                  setSelectedApp(next.result.applications[0]?.path ?? "");
                })
              }
              disabled={busy}
            >
              <Play />
              Load installed applications
            </button>
            {apps.length > 0 && (
              <div className="remote-app-control">
                <label>
                  Application
                  <select
                    value={selectedApp}
                    onChange={(event) => setSelectedApp(event.target.value)}
                  >
                    {apps.map((app) => (
                      <option value={app.path} key={app.path}>
                        {app.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() =>
                    run("launch-application", { appPath: selectedApp })
                  }
                  disabled={busy}
                >
                  <Play />
                  Launch
                </button>
                <button
                  type="button"
                  onClick={() =>
                    run("close-application", { appPath: selectedApp })
                  }
                  disabled={busy}
                >
                  <Stop />
                  Quit
                </button>
              </div>
            )}
            <div className="remote-notification">
              <label>
                Notification
                <input
                  value={notification}
                  onChange={(event) => setNotification(event.target.value)}
                />
              </label>
              <button
                type="button"
                onClick={() =>
                  run("local-notification", {
                    title: "RAIMOSA AI Remote",
                    message: notification,
                  })
                }
                disabled={busy || !notification.trim()}
              >
                <Bell />
                Send to desktop
              </button>
            </div>
          </section>
          {receipt && (
            <section className="remote-receipt">
              <CheckCircle />
              <span>
                <strong>{receipt.tool}</strong>
                <small>Verified receipt {receipt.id}</small>
              </span>
            </section>
          )}
        </>
      )}
      <footer>
        <ShieldCheck /> Local network · paired · revocable · logged
      </footer>
    </main>
  );
}
