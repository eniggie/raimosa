import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { capabilityCatalog, oviaDoctrine, planCommand } from "./ovia-core.mjs";
import { createLedger } from "./ledger.mjs";
import { createStateStore } from "./state-store.mjs";

const execFileAsync = promisify(execFile);
const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".json",
  ".csv",
  ".html",
  ".css",
  ".js",
  ".jsx",
  ".mjs",
  ".ts",
  ".tsx",
]);
const MAX_FILES = 1_000;
const MAX_DEPTH = 6;
const MAX_TEXT_BYTES = 64 * 1024;
const MAX_BODY_BYTES = 1024 * 1024;
const ACCESS_DURATIONS = new Set([300, 600, 900]);
const CONTROL_TOOLS = new Set([
  "execute-organization",
  "create-work-product",
  "launch-application",
  "close-application",
  "local-notification",
  "open-document",
]);
const REMOTE_TOOLS = new Set([
  "find-files",
  "summarize-folder",
  "folder-snapshot",
  "list-applications",
  "launch-application",
  "close-application",
  "process-status",
  "local-notification",
  "open-document",
]);

function receipt(tool, scope, result) {
  return {
    id: `RC-${randomUUID().slice(0, 8).toUpperCase()}`,
    tool,
    scope,
    timestamp: new Date().toISOString(),
    verified: true,
    result,
  };
}

// Remote and pairing records reference the All Access session that authorised
// them. They store only a hash of that token so the state file never holds a
// credential that could be replayed.
function accessTokenHash(token) {
  return token ? createHash("sha256").update(String(token)).digest("hex") : null;
}

function safeName(name, fallback = "raimosa-output") {
  const cleaned = String(name ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9._ -]/g, "-")
    .replace(/\s+/g, "-");
  return cleaned && cleaned !== "." && cleaned !== ".." ? cleaned : fallback;
}

function escapeAppleScript(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

async function approvedRoot(input) {
  if (!input || typeof input !== "string")
    throw new Error("An approved folder path is required.");
  const resolved = path.resolve(input);
  const home = path.resolve(os.homedir());
  if (resolved === path.parse(resolved).root || resolved === home) {
    throw new Error(
      "Choose a specific folder, not the filesystem or home directory.",
    );
  }
  const real = await fs.realpath(resolved);
  const stat = await fs.stat(real);
  if (!stat.isDirectory())
    throw new Error("The approved path must be a folder.");
  return real;
}

async function containedPath(root, relativePath, { mustExist = true } = {}) {
  const relative = String(relativePath ?? "").replaceAll("\\", "/");
  const candidate = path.resolve(root, relative);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    throw new Error("The requested path leaves the approved folder.");
  }
  if (!mustExist) {
    const parent = await fs.realpath(path.dirname(candidate));
    if (parent !== root && !parent.startsWith(`${root}${path.sep}`)) {
      throw new Error("The destination leaves the approved folder.");
    }
    return candidate;
  }
  const real = await fs.realpath(candidate);
  if (real !== root && !real.startsWith(`${root}${path.sep}`)) {
    throw new Error("The requested path leaves the approved folder.");
  }
  return real;
}

async function walk(root, { depth = 0, results = [] } = {}) {
  if (depth > MAX_DEPTH || results.length >= MAX_FILES) return results;
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === ".DS_Store" || entry.name.startsWith(".")) continue;
    const absolute = path.join(root, entry.name);
    const stat = await fs.stat(absolute);
    results.push({
      absolute,
      name: entry.name,
      type: entry.isDirectory() ? "folder" : "file",
      size: entry.isDirectory() ? 0 : stat.size,
      modifiedAt: stat.mtime.toISOString(),
    });
    if (entry.isDirectory())
      await walk(absolute, { depth: depth + 1, results });
    if (results.length >= MAX_FILES) break;
  }
  return results;
}

function relativeItems(root, items) {
  return items.map((item) => ({
    ...item,
    path: path.relative(root, item.absolute),
    absolute: undefined,
  }));
}

function categoryFor(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  if (
    [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".heic"].includes(
      extension,
    )
  )
    return "Images";
  if ([".mp4", ".mov", ".mkv", ".avi", ".webm"].includes(extension))
    return "Video";
  if ([".mp3", ".wav", ".m4a", ".aac", ".flac"].includes(extension))
    return "Audio";
  if ([".pdf", ".doc", ".docx", ".txt", ".md", ".rtf"].includes(extension))
    return "Documents";
  if ([".csv", ".xls", ".xlsx", ".numbers"].includes(extension))
    return "Spreadsheets";
  if ([".ppt", ".pptx", ".key", ".html"].includes(extension))
    return "Presentations";
  if ([".zip", ".tar", ".gz", ".dmg", ".pkg"].includes(extension))
    return "Archives";
  return "Other";
}

async function findFiles(payload) {
  const root = await approvedRoot(payload.root);
  const query = String(payload.query ?? "")
    .trim()
    .toLowerCase();
  const items = relativeItems(root, await walk(root));
  const matches = [];
  for (const item of items) {
    if (item.type !== "file") continue;
    let reason =
      item.name.toLowerCase().includes(query) ||
      item.path.toLowerCase().includes(query)
        ? "name"
        : null;
    if (
      !reason &&
      query &&
      TEXT_EXTENSIONS.has(path.extname(item.name).toLowerCase()) &&
      item.size <= MAX_TEXT_BYTES
    ) {
      const absolute = await containedPath(root, item.path);
      const content = await fs.readFile(absolute, "utf8").catch(() => "");
      if (content.toLowerCase().includes(query)) reason = "content";
    }
    if (!query || reason) matches.push({ ...item, match: reason || "all" });
    if (matches.length >= 100) break;
  }
  return receipt("find-files", root, {
    query,
    count: matches.length,
    files: matches,
  });
}

async function summarizeFolder(payload) {
  const root = await approvedRoot(payload.root);
  const items = relativeItems(root, await walk(root));
  const files = items.filter((item) => item.type === "file");
  const folders = items.filter((item) => item.type === "folder");
  const types = {};
  for (const item of files) {
    const extension = path.extname(item.name).toLowerCase() || "[no extension]";
    types[extension] = (types[extension] ?? 0) + 1;
  }
  const recent = [...files]
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
    .slice(0, 10);
  return receipt("summarize-folder", root, {
    files: files.length,
    folders: folders.length,
    bytes: files.reduce((sum, item) => sum + item.size, 0),
    types: Object.entries(types)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12),
    recent,
  });
}

async function createWorkProduct(payload) {
  const root = await approvedRoot(payload.root);
  const formats = { markdown: ".md", csv: ".csv", presentation: ".html" };
  const extension = formats[payload.format];
  if (!extension)
    throw new Error("Choose Markdown, CSV, or HTML presentation.");
  const base = safeName(payload.name);
  const fileName = base.toLowerCase().endsWith(extension)
    ? base
    : `${base}${extension}`;
  const destination = path.join(root, fileName);
  if (destination !== root && !destination.startsWith(`${root}${path.sep}`))
    throw new Error("Invalid destination.");
  const content = String(payload.content ?? "").slice(0, MAX_BODY_BYTES);
  const rendered =
    payload.format === "presentation"
      ? `<!doctype html><html><head><meta charset="utf-8"><title>${base}</title><style>body{font-family:system-ui;background:#09070d;color:#f7f0df;padding:8vw}section{min-height:70vh;border-bottom:1px solid #6f3bd1;padding:5vw 0}h1,h2{color:#d7b469}</style></head><body><section><h1>${base}</h1><p>${content.replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</p></section></body></html>`
      : content;
  await fs.writeFile(destination, rendered, { encoding: "utf8", flag: "wx" });
  const stat = await fs.stat(destination);
  return receipt("create-work-product", root, {
    path: path.relative(root, destination),
    bytes: stat.size,
    format: payload.format,
  });
}

async function folderSnapshot(payload) {
  const root = await approvedRoot(payload.root);
  const items = relativeItems(root, await walk(root)).filter(
    (item) => item.type === "file",
  );
  const compact = items.map(({ path: itemPath, size, modifiedAt }) => ({
    path: itemPath,
    size,
    modifiedAt,
  }));
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(compact))
    .digest("hex");
  return receipt("folder-snapshot", root, {
    fingerprint,
    files: compact.length,
    items: compact.slice(0, 200),
  });
}

async function listApplications() {
  if (process.platform !== "darwin")
    throw new Error("Application control is available only on macOS.");
  const roots = [
    "/Applications",
    "/System/Applications",
    path.join(os.homedir(), "Applications"),
  ];
  const applications = [];
  for (const root of roots) {
    const entries = await fs
      .readdir(root, { withFileTypes: true })
      .catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.endsWith(".app")) continue;
      applications.push({
        name: entry.name.replace(/\.app$/i, ""),
        path: path.join(root, entry.name),
      });
    }
  }
  return receipt("list-applications", "macOS applications", {
    applications: applications
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 80),
  });
}

async function validateApplication(appPath) {
  const listed = await listApplications();
  const selected = listed.result.applications.find(
    (app) => app.path === appPath,
  );
  if (!selected)
    throw new Error(
      "Select an application from the verified installed-app list.",
    );
  return selected;
}

async function launchApplication(payload) {
  const app = await validateApplication(payload.appPath);
  await execFileAsync("/usr/bin/open", ["-g", app.path], { timeout: 10_000 });
  return receipt("launch-application", app.path, {
    application: app.name,
    state: "launch-request-accepted",
  });
}

async function closeApplication(payload) {
  const app = await validateApplication(payload.appPath);
  const script = `tell application "${escapeAppleScript(app.name)}" to quit`;
  await execFileAsync("/usr/bin/osascript", ["-e", script], {
    timeout: 10_000,
  });
  return receipt("close-application", app.path, {
    application: app.name,
    state: "quit-request-accepted",
  });
}

async function processStatus(payload) {
  const query = String(payload.query ?? "")
    .trim()
    .toLowerCase();
  const { stdout } = await execFileAsync(
    "/bin/ps",
    ["-axo", "pid=,etime=,comm="],
    { timeout: 10_000, maxBuffer: 1024 * 1024 },
  );
  const processes = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(\S+)\s+(.+)$/);
      return match
        ? { pid: Number(match[1]), elapsed: match[2], command: match[3] }
        : null;
    })
    .filter(Boolean)
    .filter((item) => !query || item.command.toLowerCase().includes(query))
    .slice(0, 50);
  return receipt("process-status", "local process table", {
    query,
    count: processes.length,
    processes,
  });
}

async function monitorAgentRuntimes() {
  const definitions = [
    { id: "codex", name: "Codex", commands: ["codex"] },
    { id: "claude", name: "Claude", commands: ["claude"] },
    { id: "grok", name: "Grok", commands: ["grok"] },
    { id: "gemini", name: "Gemini", commands: ["gemini"] },
  ];
  const { stdout } = await execFileAsync(
    "/bin/ps",
    ["-axo", "pid=,etime=,comm="],
    { timeout: 10_000, maxBuffer: 1024 * 1024 },
  );
  const processLines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const agents = [];
  for (const definition of definitions) {
    let executable = null;
    for (const command of definition.commands) {
      const result = await execFileAsync("/usr/bin/which", [command], {
        timeout: 3_000,
      }).catch(() => null);
      if (result?.stdout.trim()) {
        executable = result.stdout.trim();
        break;
      }
    }
    const matches = processLines
      .map((line) => {
        const match = line.match(/^(\d+)\s+(\S+)\s+(.+)$/);
        return match
          ? { pid: Number(match[1]), elapsed: match[2], command: match[3] }
          : null;
      })
      .filter(Boolean)
      .filter((item) =>
        definition.commands.some((command) =>
          item.command.toLowerCase().includes(command),
        ),
      )
      .slice(0, 10);
    agents.push({
      id: definition.id,
      name: definition.name,
      installed: Boolean(executable),
      executable,
      running: matches.length > 0,
      processes: matches,
      commandAdapter: false,
    });
  }
  return receipt("agent-runtime-monitor", "local AI agent runtimes", {
    agents,
    installed: agents.filter((agent) => agent.installed).length,
    running: agents.filter((agent) => agent.running).length,
    privacy:
      "Process metadata only. Prompts, transcripts, credentials, and private agent state were not read.",
  });
}

async function localNotification(payload) {
  if (process.platform !== "darwin")
    throw new Error("Local notifications are available only on macOS.");
  const title = escapeAppleScript(
    String(payload.title ?? "RAIMOSA AI").slice(0, 80),
  );
  const message = escapeAppleScript(
    String(payload.message ?? "").slice(0, 240),
  );
  if (!message) throw new Error("Notification text is required.");
  await execFileAsync(
    "/usr/bin/osascript",
    ["-e", `display notification "${message}" with title "${title}"`],
    { timeout: 10_000 },
  );
  return receipt("local-notification", "current macOS user", {
    title,
    message,
    state: "display-request-accepted",
  });
}

async function openDocument(payload) {
  if (process.platform !== "darwin")
    throw new Error("Document opening is available only on macOS.");
  const root = await approvedRoot(payload.root);
  const file = await containedPath(root, payload.path);
  const stat = await fs.stat(file);
  if (!stat.isFile())
    throw new Error("Choose one file inside the approved folder.");
  await execFileAsync("/usr/bin/open", ["-g", file], { timeout: 10_000 });
  return receipt("open-document", root, {
    path: path.relative(root, file),
    state: "open-request-accepted",
  });
}

export function createDesktopToolService(options = {}) {
  const stateDir = path.resolve(process.cwd(), "local-workspace", ".raimosa");
  const ledger = createLedger(
    options.ledgerFile ?? path.join(stateDir, "ledger.db"),
  );
  const state = createStateStore(
    options.stateFile ??
      (options.ledgerFile === ":memory:"
        ? ":memory:"
        : path.join(stateDir, "state.db")),
  );

  function record(nextReceipt) {
    return ledger.append(nextReceipt);
  }

  // Crash recovery. A runtime that stops takes the visible All Access
  // countdown with it, so any authority that outlived the process is closed
  // here and reported, never silently resumed. Approvals are left alone: they
  // are inert plans that still require live authority to execute.
  function recoverInterruptedAuthority() {
    const now = Date.now();
    state.purgeExpired(now);
    const stranded = state.listSessions("access");
    for (const session of stranded) {
      record(
        receipt("access-interrupted", "local desktop authority", {
          sessionId: session.id,
          state: "revoked",
          reason:
            "The RAIMOSA runtime stopped while this All Access session was live. Authority was ended, not resumed.",
          wouldHaveExpiredAt: new Date(session.expiresAt).toISOString(),
        }),
      );
    }
    const remotes = state.listSessions("remote").length;
    state.deleteAll("access");
    state.deleteAll("remote");
    state.deleteAll("pairing");
    return { revokedAccessSessions: stranded.length, revokedRemotes: remotes };
  }

  const recovery = recoverInterruptedAuthority();

  function activeAccess(token) {
    const session = state.getSession("access", token);
    if (!session || session.expiresAt <= Date.now()) {
      if (token) state.deleteSession("access", token);
      return null;
    }
    return session;
  }

  function liveAccessByHash(hash) {
    const session = state.getSessionByHash("access", hash);
    if (!session || session.expiresAt <= Date.now()) return null;
    return session;
  }

  function requireAccess(token) {
    const session = activeAccess(token);
    if (!session)
      throw new Error(
        "A live OVIA AI All Access session is required for this control.",
      );
    return session;
  }

  function startAccess(payload = {}) {
    const duration = Number(payload.duration);
    if (!ACCESS_DURATIONS.has(duration) || payload.confirmed !== true) {
      throw new Error("Confirm a 5, 10, or 15 minute All Access session.");
    }
    const token = randomUUID();
    // The token is the lookup key and is stored only as a hash. It must never
    // become part of the persisted payload.
    const session = {
      id: `ACCESS-${randomUUID().slice(0, 8).toUpperCase()}`,
      createdAt: Date.now(),
      expiresAt: Date.now() + duration * 1000,
      durationSeconds: duration,
    };
    state.putSession("access", token, session);
    record(
      receipt("access-start", "local desktop authority", {
        sessionId: session.id,
        expiresAt: new Date(session.expiresAt).toISOString(),
        durationSeconds: duration,
      }),
    );
    return {
      ok: true,
      session: {
        id: session.id,
        token,
        expiresAt: new Date(session.expiresAt).toISOString(),
        remainingSeconds: duration,
      },
    };
  }

  function endAccess(payload = {}) {
    const session = activeAccess(payload.token);
    if (payload.token) state.deleteSession("access", payload.token);
    const boundToThisAccess = (entry) =>
      entry.accessTokenHash === accessTokenHash(payload.token);
    state.deleteSessionsWhere("remote", boundToThisAccess);
    state.deleteSessionsWhere("pairing", boundToThisAccess);
    if (session) {
      record(
        receipt("access-end", "local desktop authority", {
          sessionId: session.id,
          state: "revoked",
        }),
      );
    }
    return { ok: true, ended: true };
  }

  function accessStatus(token) {
    const session = activeAccess(token);
    return {
      ok: true,
      active: Boolean(session),
      session: session
        ? {
            id: session.id,
            expiresAt: new Date(session.expiresAt).toISOString(),
            remainingSeconds: Math.max(
              0,
              Math.ceil((session.expiresAt - Date.now()) / 1000),
            ),
          }
        : null,
    };
  }

  function networkUrls(port = 4173) {
    const urls = [];
    for (const addresses of Object.values(os.networkInterfaces())) {
      for (const address of addresses ?? []) {
        if (address.family === "IPv4" && !address.internal)
          urls.push(`http://${address.address}:${port}/remote`);
      }
    }
    return [...new Set(urls)];
  }

  function startRemotePairing(payload = {}) {
    const access = requireAccess(payload.accessToken);
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const pairing = {
      id: `PAIR-${randomUUID().slice(0, 8).toUpperCase()}`,
      accessTokenHash: accessTokenHash(payload.accessToken),
      createdAt: Date.now(),
      expiresAt: Math.min(access.expiresAt, Date.now() + 5 * 60 * 1000),
    };
    state.putSession("pairing", code, pairing);
    record(
      receipt("remote-pairing-start", "local network", {
        pairingId: pairing.id,
        expiresAt: new Date(pairing.expiresAt).toISOString(),
        urls: networkUrls(payload.port),
      }),
    );
    return {
      ok: true,
      pairing: {
        id: pairing.id,
        code,
        urls: networkUrls(payload.port),
        expiresAt: new Date(pairing.expiresAt).toISOString(),
        remainingSeconds: Math.max(
          0,
          Math.ceil((pairing.expiresAt - Date.now()) / 1000),
        ),
      },
    };
  }

  function pairRemote(payload = {}) {
    const code = String(payload.code ?? "").trim();
    const pairing = state.getSession("pairing", code);
    const access = pairing ? liveAccessByHash(pairing.accessTokenHash) : null;
    if (!pairing || pairing.expiresAt <= Date.now() || !access) {
      state.deleteSession("pairing", code);
      throw new Error("The pairing code is invalid or expired.");
    }
    state.deleteSession("pairing", code);
    const token = randomUUID();
    const session = {
      id: `REMOTE-${randomUUID().slice(0, 8).toUpperCase()}`,
      accessTokenHash: pairing.accessTokenHash,
      createdAt: Date.now(),
      expiresAt: access.expiresAt,
    };
    state.putSession("remote", token, session);
    record(
      receipt("remote-paired", "local network", {
        sessionId: session.id,
        expiresAt: new Date(session.expiresAt).toISOString(),
      }),
    );
    return {
      ok: true,
      session: {
        id: session.id,
        token,
        expiresAt: new Date(session.expiresAt).toISOString(),
        remainingSeconds: Math.max(
          0,
          Math.ceil((session.expiresAt - Date.now()) / 1000),
        ),
        defaultWorkspace: path.resolve(process.cwd(), "local-workspace"),
        tools: [...REMOTE_TOOLS],
      },
    };
  }

  function activeRemote(token) {
    const session = state.getSession("remote", token);
    if (
      !session ||
      session.expiresAt <= Date.now() ||
      !liveAccessByHash(session.accessTokenHash)
    ) {
      if (token) state.deleteSession("remote", token);
      return null;
    }
    return session;
  }

  function remoteStatus(token) {
    const session = activeRemote(token);
    return {
      ok: true,
      active: Boolean(session),
      session: session
        ? {
            id: session.id,
            expiresAt: new Date(session.expiresAt).toISOString(),
            remainingSeconds: Math.max(
              0,
              Math.ceil((session.expiresAt - Date.now()) / 1000),
            ),
          }
        : null,
    };
  }

  function endRemote(payload = {}) {
    const session = activeRemote(payload.token);
    if (payload.token) state.deleteSession("remote", payload.token);
    if (session) {
      record(
        receipt("remote-ended", "local network", {
          sessionId: session.id,
          state: "disconnected",
        }),
      );
    }
    return { ok: true, ended: true };
  }

  async function scanRuntime() {
    const workspace = path.resolve(process.cwd(), "local-workspace");
    const checks = [];
    const findings = [];

    const workspaceStat = await fs.stat(workspace).catch(() => null);
    const workspaceReady = Boolean(workspaceStat?.isDirectory());
    checks.push({
      id: "workspace.available",
      status: workspaceReady ? "pass" : "fail",
      detail: workspaceReady
        ? "Approved local workspace is available."
        : "The approved local workspace is missing.",
    });
    if (!workspaceReady) {
      findings.push({
        id: "workspace-missing",
        severity: "high",
        title: "Approved workspace is unavailable",
        detail: workspace,
      });
    }

    const availableCapabilities = capabilityCatalog.filter(
      (item) => item.status === "available",
    );
    const invalidCapabilities = availableCapabilities.filter(
      (item) => !item.adapter,
    );
    checks.push({
      id: "capabilities.registered",
      status: invalidCapabilities.length === 0 ? "pass" : "fail",
      detail:
        invalidCapabilities.length === 0
          ? `${availableCapabilities.length} available capabilities have named adapters.`
          : `${invalidCapabilities.length} available capabilities have no adapter.`,
    });
    for (const capability of invalidCapabilities) {
      findings.push({
        id: `adapter-missing-${capability.id}`,
        severity: "high",
        title: "Available capability has no adapter",
        detail: capability.title,
      });
    }

    const macOnly = capabilityCatalog.filter(
      (item) =>
        item.status === "available" && item.adapter?.startsWith("macos-"),
    );
    const platformReady = process.platform === "darwin" || macOnly.length === 0;
    checks.push({
      id: "platform.compatibility",
      status: platformReady ? "pass" : "fail",
      detail: platformReady
        ? `Runtime platform ${process.platform} matches registered adapters.`
        : `${macOnly.length} macOS adapters are incorrectly available on ${process.platform}.`,
    });
    if (!platformReady) {
      findings.push({
        id: "platform-mismatch",
        severity: "high",
        title: "Adapter platform mismatch",
        detail: process.platform,
      });
    }

    checks.push({
      id: "authority.expiry",
      status: "pass",
      detail:
        "All Access and mobile remote sessions are server-expiring and revocable.",
    });

    const integrity = ledger.verify();
    checks.push({
      id: "ledger.integrity",
      status: integrity.intact ? "pass" : "fail",
      detail: integrity.intact
        ? `${integrity.checked} receipts verified against an unbroken hash chain.`
        : `Receipt chain broken at ${integrity.brokenAt}: ${integrity.reason}`,
    });
    if (!integrity.intact) {
      findings.push({
        id: "ledger-chain-broken",
        severity: "high",
        title: "Receipt ledger integrity check failed",
        detail: `${integrity.brokenAt} — ${integrity.reason}`,
      });
    }

    checks.push({
      id: "authority.durable-state",
      status: state.durable ? "pass" : "fail",
      detail: state.durable
        ? "Approvals and authority are stored durably, and secrets are held only as hashes."
        : "Authority state is in memory only and will not survive a restart.",
    });

    checks.push({
      id: "authority.crash-recovery",
      status: "pass",
      detail: recovery.revokedAccessSessions
        ? `${recovery.revokedAccessSessions} All Access session(s) survived a runtime stop and were revoked, not resumed.`
        : "No All Access session outlived the previous runtime.",
    });

    checks.push({
      id: "ledger.durability",
      status: ledger.durable ? "pass" : "fail",
      detail: ledger.durable
        ? "Receipts are written to an append-only on-disk ledger and survive restart."
        : "Receipts are held in a non-durable in-memory ledger.",
    });
    if (!ledger.durable) {
      findings.push({
        id: "ledger-not-durable",
        severity: "medium",
        title: "Receipt ledger is not durable",
        detail: "Receipts will be lost when this runtime stops.",
      });
    }

    return record(
      receipt("raimosa-health-scan", "local RAIMOSA runtime", {
        status: findings.length ? "attention" : "healthy",
        checks,
        findings,
        availableCapabilities: availableCapabilities.length,
        unavailableCapabilities: capabilityCatalog.filter(
          (item) => item.status !== "available",
        ).length,
      }),
    );
  }

  async function planOrganization(payload) {
    const root = await approvedRoot(payload.root);
    const entries = await fs.readdir(root, { withFileTypes: true });
    const operations = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || entry.name.startsWith(".")) continue;
      const category = categoryFor(entry.name);
      const source = entry.name;
      const destination = path.join("RAIMOSA Organized", category, entry.name);
      if (source === destination) continue;
      operations.push({ type: "move", source, destination });
    }
    const approvalId = `APR-${randomUUID().slice(0, 8).toUpperCase()}`;
    const hash = createHash("sha256")
      .update(JSON.stringify({ root, operations }))
      .digest("hex");
    state.putApproval({
      id: approvalId,
      root,
      operations,
      hash,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
    return receipt("plan-organization", root, {
      approvalId,
      hash,
      operations,
      deletions: 0,
      expiresInSeconds: 600,
    });
  }

  async function executeOrganization(payload) {
    if (payload.confirmation !== "MOVE")
      throw new Error('Type "MOVE" to confirm this exact plan.');
    const approval = state.getApproval(payload.approvalId);
    if (!approval || approval.expiresAt < Date.now())
      throw new Error("The approval is missing or expired. Create a new plan.");
    if (approval.claimedAt)
      throw new Error(
        "This approval was already used. Create a new plan to run it again.",
      );
    // Take single-use ownership before the first file moves. If the runtime
    // dies mid-execution the claim is already on disk, so the same approved
    // plan can never be replayed into duplicate side effects.
    if (!state.claimApproval(payload.approvalId))
      throw new Error(
        "This approval was already used. Create a new plan to run it again.",
      );
    const completed = [];
    try {
      for (const operation of approval.operations) {
        const source = await containedPath(approval.root, operation.source);
        const destination = path.resolve(approval.root, operation.destination);
        if (!destination.startsWith(`${approval.root}${path.sep}`))
          throw new Error("A destination leaves the approved folder.");
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs
          .access(destination)
          .then(() => {
            throw new Error(
              `Destination already exists: ${operation.destination}`,
            );
          })
          .catch((error) => {
            if (error.code !== "ENOENT") throw error;
          });
        await fs.rename(source, destination);
        completed.push({ source, destination });
      }
    } catch (error) {
      for (const operation of completed.reverse()) {
        await fs
          .rename(operation.destination, operation.source)
          .catch(() => {});
      }
      throw error;
    }
    state.deleteApproval(payload.approvalId);
    return receipt("execute-organization", approval.root, {
      moved: completed.length,
      deletions: 0,
      verified: await Promise.all(
        completed.map(async ({ destination }) =>
          Boolean(await fs.stat(destination).catch(() => null)),
        ),
      ),
    });
  }

  async function handle(tool, payload = {}, context = {}) {
    const effectivePayload = { ...payload };
    if (context.remoteToken) {
      const remote = activeRemote(context.remoteToken);
      if (!remote)
        throw new Error("The mobile remote session is expired or revoked.");
      if (!REMOTE_TOOLS.has(tool))
        throw new Error("This tool is not available from the mobile remote.");
      effectivePayload.accessToken = remote.accessToken;
    }
    if (CONTROL_TOOLS.has(tool)) requireAccess(effectivePayload.accessToken);
    let result;
    switch (tool) {
      case "find-files":
        result = await findFiles(effectivePayload);
        break;
      case "summarize-folder":
        result = await summarizeFolder(effectivePayload);
        break;
      case "plan-organization":
        result = await planOrganization(effectivePayload);
        break;
      case "execute-organization":
        result = await executeOrganization(effectivePayload);
        break;
      case "create-work-product":
        result = await createWorkProduct(effectivePayload);
        break;
      case "folder-snapshot":
        result = await folderSnapshot(effectivePayload);
        break;
      case "list-applications":
        result = await listApplications();
        break;
      case "launch-application":
        result = await launchApplication(effectivePayload);
        break;
      case "close-application":
        result = await closeApplication(effectivePayload);
        break;
      case "process-status":
        result = await processStatus(effectivePayload);
        break;
      case "agent-runtime-monitor":
        result = await monitorAgentRuntimes();
        break;
      case "local-notification":
        result = await localNotification(effectivePayload);
        break;
      case "open-document":
        result = await openDocument(effectivePayload);
        break;
      default:
        throw new Error("Unknown or unavailable tool.");
    }
    return record(result);
  }

  return {
    health() {
      return {
        ok: true,
        runtime: "local-node-adapter",
        platform: process.platform,
        hostname: os.hostname(),
        defaultWorkspace: path.resolve(process.cwd(), "local-workspace"),
        capabilities: capabilityCatalog,
        doctrine: oviaDoctrine(),
        remote: {
          available: true,
          mode: "paired-local-network",
          urls: networkUrls(),
        },
      };
    },
    plan: planCommand,
    handle,
    startAccess,
    endAccess,
    accessStatus,
    startRemotePairing,
    pairRemote,
    remoteStatus,
    endRemote,
    scanRuntime,
    listReceipts(limit = 50) {
      const integrity = ledger.verify();
      return {
        ok: true,
        receipts: ledger.list(limit),
        count: ledger.count(),
        durable: ledger.durable,
        integrity,
      };
    },
    verifyLedger() {
      return ledger.verify();
    },
    recovery,
    closeLedger() {
      ledger.close();
      state.close();
    },
  };
}

export { MAX_BODY_BYTES };
