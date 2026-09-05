import { useCallback, useEffect, useState } from "react";
import {
  BookOpenIcon as BookOpen,
  DownloadSimpleIcon as DownloadSimple,
  NotePencilIcon as NotePencil,
  TrashIcon as Trash,
} from "@phosphor-icons/react";
import { desktopApi } from "../desktop-api";

// Memory holds facts, never secrets. Everything here is readable, editable,
// deletable, and exportable by the owner; disabling memory stops both writes
// and reads. Verification memory is written by Sentinel and shown read-only.

const KINDS = [
  ["short-term", "Short-term", "Current task context — expires after a day."],
  ["project", "Project", "Decisions and architecture for a project."],
  ["user", "User", "Your explicit preferences and workflows."],
  [
    "verification",
    "Verification",
    "How agents have performed. Written by Sentinel.",
  ],
];

export function MemoryView({ accessToken, onRequestAccess, onAnnouncement }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    kind: "user",
    key: "",
    value: "",
    scope: "",
  });
  const [editing, setEditing] = useState({});
  const [confirmClear, setConfirmClear] = useState("");

  const refresh = useCallback(async () => {
    try {
      setStatus(await desktopApi.memoryStatus());
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(label, fn) {
    setBusy(true);
    setError("");
    try {
      const out = await fn();
      onAnnouncement?.(label);
      await refresh();
      return out;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  function exportMemory() {
    void run("Memory exported.", async () => {
      const data = await desktopApi.memoryExport();
      const blob = new Blob([data.content], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = data.filename;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  const byKind = (kind) =>
    (status?.memories ?? []).filter((m) => m.kind === kind);

  return (
    <section className="workspace-page memory-view">
      <div className="page-heading">
        <div>
          <span>MEMORY</span>
          <h1>
            {status
              ? status.enabled
                ? "Remembering"
                : "Memory is off"
              : "Reading memory…"}
          </h1>
          <p>
            {status
              ? `${status.count} entries. Facts only — anything that looks like a credential is refused and belongs in the Vault.`
              : error || ""}
          </p>
        </div>
        <div className="sentinel-actions">
          <button
            type="button"
            className="secondary"
            onClick={exportMemory}
            disabled={busy || !status}
          >
            <DownloadSimple size={16} /> Export
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy || !status}
            onClick={() => {
              if (!accessToken) return onRequestAccess?.();
              void run(
                status.enabled ? "Memory disabled." : "Memory enabled.",
                () => desktopApi.memorySetEnabled(!status.enabled, accessToken),
              );
            }}
          >
            {status?.enabled ? "Disable memory" : "Enable memory"}
          </button>
        </div>
      </div>

      {error && (
        <p className="sentinel-error" role="alert">
          {error}
        </p>
      )}

      {KINDS.map(([kind, title, detail]) => (
        <section className="surface live-tool" key={kind}>
          <header>
            <div>
              <BookOpen size={24} />
              <span>{title.toUpperCase()}</span>
            </div>
            <h2>{title} memory</h2>
            <p>{detail}</p>
          </header>
          {byKind(kind).length === 0 ? (
            <p className="empty-note">Nothing remembered yet.</p>
          ) : (
            byKind(kind).map((m) => (
              <div className="sentinel-row" key={m.id}>
                <div>
                  <strong>
                    {m.key}
                    {m.scope ? (
                      <span className="sentinel-chip muted">{m.scope}</span>
                    ) : null}
                    {m.source !== "owner" ? (
                      <span className="sentinel-chip claim">{m.source}</span>
                    ) : null}
                  </strong>
                  {editing[m.id] !== undefined && m.source === "owner" ? (
                    <textarea
                      aria-label={`Edit ${m.key}`}
                      rows={2}
                      value={editing[m.id]}
                      onChange={(e) =>
                        setEditing({ ...editing, [m.id]: e.target.value })
                      }
                    />
                  ) : (
                    <span>{m.value}</span>
                  )}
                </div>
                <div className="sentinel-actions">
                  {m.source === "owner" &&
                    (editing[m.id] !== undefined ? (
                      <button
                        type="button"
                        className="primary"
                        disabled={busy}
                        onClick={() =>
                          void run(`Updated ${m.key}.`, () =>
                            desktopApi.memoryRemember({
                              kind: m.kind,
                              key: m.key,
                              value: editing[m.id],
                              scope: m.scope,
                            }),
                          ).then(() =>
                            setEditing((e) => ({ ...e, [m.id]: undefined })),
                          )
                        }
                      >
                        Save
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() =>
                          setEditing({ ...editing, [m.id]: m.value })
                        }
                      >
                        <NotePencil size={16} /> Edit
                      </button>
                    ))}
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(`Forgot ${m.key}.`, () =>
                        desktopApi.memoryForget(m.id),
                      )
                    }
                  >
                    <Trash size={16} /> Forget
                  </button>
                </div>
              </div>
            ))
          )}
        </section>
      ))}

      <section className="surface live-tool">
        <header>
          <div>
            <NotePencil size={24} />
            <span>REMEMBER</span>
          </div>
          <h2>Add a fact</h2>
          <p>
            Stored locally. Refused if it looks like a password, key, or token.
          </p>
        </header>
        <form
          className="tool-form sentinel-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(`Remembered ${form.key}.`, () =>
              desktopApi.memoryRemember({
                kind: form.kind,
                key: form.key,
                value: form.value,
                scope: form.scope || null,
              }),
            ).then(
              (r) =>
                r &&
                setForm({ kind: form.kind, key: "", value: "", scope: "" }),
            );
          }}
        >
          <select
            aria-label="Kind"
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value })}
          >
            {KINDS.filter(([k]) => k !== "verification").map(([k, t]) => (
              <option key={k} value={k}>
                {t}
              </option>
            ))}
          </select>
          <input
            aria-label="Key"
            placeholder="Key (e.g. preferred-editor)"
            value={form.key}
            onChange={(e) => setForm({ ...form, key: e.target.value })}
            required
          />
          <input
            aria-label="Value"
            placeholder="Value"
            value={form.value}
            onChange={(e) => setForm({ ...form, value: e.target.value })}
            required
          />
          <input
            aria-label="Scope"
            placeholder="Scope (optional, e.g. project name)"
            value={form.scope}
            onChange={(e) => setForm({ ...form, scope: e.target.value })}
          />
          <button
            type="submit"
            className="primary"
            disabled={busy || !status?.enabled}
          >
            Remember
          </button>
        </form>
      </section>

      <section className="surface live-tool">
        <header>
          <div>
            <Trash size={24} />
            <span>CLEAR</span>
          </div>
          <h2>Forget everything</h2>
          <p>
            Needs a live All Access session and a typed CONFIRM. Recorded as a
            receipt.
          </p>
        </header>
        <div className="sentinel-actions">
          <input
            aria-label="Type CONFIRM to clear memory"
            placeholder="Type CONFIRM"
            value={confirmClear}
            onChange={(e) => setConfirmClear(e.target.value)}
          />
          <button
            type="button"
            className="secondary"
            disabled={busy || confirmClear !== "CONFIRM"}
            onClick={() => {
              if (!accessToken) return onRequestAccess?.();
              void run("Memory cleared.", () =>
                desktopApi.memoryClear(accessToken),
              ).then(() => setConfirmClear(""));
            }}
          >
            Clear all memory
          </button>
        </div>
      </section>
    </section>
  );
}
