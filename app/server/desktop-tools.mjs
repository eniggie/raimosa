import { createHash, randomInt, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promises as fs, existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import dns from "node:dns/promises";
import { capabilityCatalog, oviaDoctrine, planCommand } from "./ovia-core.mjs";
import { createLedger } from "./ledger.mjs";
import { createStateStore } from "./state-store.mjs";
import {
  verifyLicenseKey,
  requiresPro,
  PRO_TOOLS,
  PRO_FEATURES,
} from "./licensing.mjs";

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
  // Reading the clipboard is gated too. Every other sensitive read in RAIMOSA
  // is bounded by an approved folder; the clipboard has no scope at all and
  // routinely holds passwords, 2FA codes, and API keys.
  "read-clipboard",
  "write-clipboard",
  "capture-screen",
  "system-power",
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
  "storage-insights",
  "device-vitals",
  "folder-snapshot",
  "list-applications",
  "launch-application",
  "close-application",
  "process-status",
  "local-notification",
  "open-document",
]);

// The ledger is append-only by design: nothing written to it can ever be
// deleted. So any adapter that returns file *contents* must publish a
// redacted projection for the ledger — evidence that the read happened,
// never the bytes that were read. A tool listed here returns its full result
// to the caller and stores only what this function yields.
const LEDGER_REDACTORS = {
  "read-clipboard": (result) => ({
    characters: result.characters,
    truncated: result.truncated,
    contentSha256: createHash("sha256")
      .update(result.content ?? "")
      .digest("hex"),
    redacted:
      "Clipboard text is deliberately absent. The ledger is permanent; copied bytes are not.",
  }),
  "write-clipboard": (result) => ({
    characters: result.characters,
    truncated: result.truncated,
    contentSha256: createHash("sha256")
      .update(result.content ?? "")
      .digest("hex"),
    redacted:
      "Clipboard text is deliberately absent. The ledger is permanent; copied bytes are not.",
  }),
  "preview-file": (result) => ({
    path: result.path,
    bytes: result.bytes,
    truncated: result.truncated,
    contentSha256: createHash("sha256")
      .update(result.content ?? "")
      .digest("hex"),
    redacted:
      "File content is deliberately absent. The ledger is permanent; previewed bytes are not.",
  }),
};

// Which catalog capability governs each tool. The catalog decides what is
// available on THIS platform, and handle() enforces it — otherwise the
// catalog would only be hiding buttons while the server still executed the
// adapter for anyone who called the route directly.
const TOOL_CAPABILITY = {
  "find-files": "find-files",
  "summarize-folder": "summarize-folder",
  "storage-insights": "storage-insights",
  "find-duplicates": "find-duplicates",
  "preview-file": "preview-file",
  "device-vitals": "device-vitals",
  "plan-organization": "organize-files",
  "execute-organization": "organize-files",
  "create-work-product": "create-work-product",
  "folder-snapshot": "folder-monitor",
  "list-applications": "applications",
  "launch-application": "applications",
  "close-application": "applications",
  "process-status": "process-status",
  "agent-runtime-monitor": "agent-runtime-monitor",
  "local-notification": "local-notification",
  "open-document": "open-document",
  "network-status": "network-status",
  "compare-folders": "compare-folders",
  "read-clipboard": "clipboard",
  "write-clipboard": "clipboard",
  "capture-screen": "screen-capture",
  "system-power": "system-power",
};

// Installed copies can be launched from any directory, so state must not
// follow the working directory — otherwise each launch location would grow
// its own ledger and the receipt history would silently fragment.
//
// RAIMOSA_HOME overrides the state location; RAIMOSA_WORKSPACE overrides the
// default approved folder. A source checkout keeps using ./local-workspace so
// development and tests stay self-contained.
export function raimosaHome() {
  if (process.env.RAIMOSA_HOME) return path.resolve(process.env.RAIMOSA_HOME);
  const checkout = path.resolve(process.cwd(), "local-workspace");
  if (existsSync(path.join(checkout, "README.md")))
    return path.join(checkout, ".raimosa");
  return path.join(os.homedir(), ".raimosa");
}

export function defaultWorkspace() {
  if (process.env.RAIMOSA_WORKSPACE)
    return path.resolve(process.env.RAIMOSA_WORKSPACE);
  const checkout = path.resolve(process.cwd(), "local-workspace");
  if (existsSync(path.join(checkout, "README.md"))) return checkout;
  return path.join(os.homedir(), "RAIMOSA Workspace");
}

// `verified` is evidence, not decoration: it means RAIMOSA observed the result,
// not merely that the call returned without throwing. Adapters that can only
// hand a request to the operating system — launching or quitting an app,
// opening a document, posting a notification, sleeping the machine — cannot
// observe the outcome from inside this runtime, so they must record
// `verified: false`. Marking those true would make the exported ledger claim
// proof it does not have.
function receipt(tool, scope, result, { verified = true } = {}) {
  return {
    id: `RC-${randomUUID().slice(0, 8).toUpperCase()}`,
    tool,
    scope,
    timestamp: new Date().toISOString(),
    verified,
    result,
  };
}

// A receipt whose result only records that a request was accepted, never that
// it completed.
function dispatchReceipt(tool, scope, result) {
  return receipt(tool, scope, result, { verified: false });
}

// Remote and pairing records reference the All Access session that authorised
// them. They store only a hash of that token so the state file never holds a
// credential that could be replayed.
function accessTokenHash(token) {
  return token
    ? createHash("sha256").update(String(token)).digest("hex")
    : null;
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
  // Hidden directories (.ssh, .aws, .gnupg, …) hold credentials and private
  // state. walk() already refuses to descend into them; refuse to approve one
  // as a root too, so no adapter surface can be pointed at them.
  const relativeToHome = path.relative(home, real);
  const segments = (
    relativeToHome.startsWith("..") ? real : relativeToHome
  ).split(path.sep);
  if (segments.some((segment) => segment.startsWith("."))) {
    throw new Error(
      "Hidden folders hold private system state and cannot be approved.",
    );
  }
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

async function walk(root, { depth = 0, results = [], base = root } = {}) {
  if (depth > MAX_DEPTH || results.length >= MAX_FILES) return results;
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === ".DS_Store" || entry.name.startsWith(".")) continue;
    const absolute = path.join(root, entry.name);
    // A symlink can point outside the approved root. Following it — even just
    // to stat its target's size and mtime — leaks the existence and shape of
    // files the caller never approved. Include a symlink only when its real
    // target stays inside the approved base; otherwise skip it entirely. This
    // is the same containment rule preview-file enforces, applied to the walk.
    if (entry.isSymbolicLink()) {
      let realTarget;
      try {
        realTarget = await fs.realpath(absolute);
      } catch {
        continue;
      }
      if (realTarget !== base && !realTarget.startsWith(`${base}${path.sep}`))
        continue;
    }
    const stat = await fs.stat(absolute).catch(() => null);
    if (!stat) continue;
    results.push({
      absolute,
      name: entry.name,
      type: stat.isDirectory() ? "folder" : "file",
      size: stat.isDirectory() ? 0 : stat.size,
      modifiedAt: stat.mtime.toISOString(),
    });
    if (stat.isDirectory())
      await walk(absolute, { depth: depth + 1, results, base });
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

const MAX_HASH_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_HASH_BYTES = 2 * 1024 * 1024 * 1024;

async function storageInsights(payload) {
  const root = await approvedRoot(payload.root);
  const items = relativeItems(root, await walk(root)).filter(
    (item) => item.type === "file",
  );
  const byCategory = {};
  for (const item of items) {
    const category = categoryFor(item.name);
    byCategory[category] = (byCategory[category] ?? 0) + item.size;
  }
  const largest = [...items]
    .sort((a, b) => b.size - a.size)
    .slice(0, 15)
    .map(({ path: itemPath, size, modifiedAt }) => ({
      path: itemPath,
      size,
      modifiedAt,
    }));
  return receipt("storage-insights", root, {
    files: items.length,
    totalBytes: items.reduce((sum, item) => sum + item.size, 0),
    byCategory: Object.entries(byCategory).sort((a, b) => b[1] - a[1]),
    largest,
  });
}

async function findDuplicates(payload) {
  const root = await approvedRoot(payload.root);
  const files = relativeItems(root, await walk(root)).filter(
    (item) => item.type === "file" && item.size > 0,
  );
  // Same size first, then a full-content hash: no false duplicates.
  const bySize = new Map();
  for (const file of files) {
    const group = bySize.get(file.size) ?? [];
    group.push(file);
    bySize.set(file.size, group);
  }
  const groups = [];
  let skippedLarge = 0;
  // Every other adapter here is bounded. Hashing must be too: without a total
  // budget a folder of large duplicates would block the single-threaded
  // adapter for minutes. When the budget runs out the scan stops and says so
  // — a partial answer is reported as partial, never as complete.
  let bytesHashed = 0;
  let budgetExhausted = false;
  for (const candidates of bySize.values()) {
    if (candidates.length < 2 || budgetExhausted) continue;
    const byHash = new Map();
    for (const candidate of candidates) {
      if (candidate.size > MAX_HASH_BYTES) {
        skippedLarge += 1;
        continue;
      }
      if (bytesHashed + candidate.size > MAX_TOTAL_HASH_BYTES) {
        budgetExhausted = true;
        break;
      }
      const absolute = await containedPath(root, candidate.path);
      const content = await fs.readFile(absolute).catch(() => null);
      if (!content) continue;
      bytesHashed += content.byteLength;
      const hash = createHash("sha256").update(content).digest("hex");
      const group = byHash.get(hash) ?? [];
      group.push(candidate.path);
      byHash.set(hash, group);
    }
    for (const [hash, paths] of byHash) {
      if (paths.length >= 2)
        groups.push({
          hash: hash.slice(0, 16),
          size: candidates[0].size,
          paths,
        });
    }
  }
  groups.sort((a, b) => b.size - a.size);
  return receipt("find-duplicates", root, {
    duplicateGroups: groups.slice(0, 30),
    groupCount: groups.length,
    wastedBytes: groups.reduce(
      (sum, group) => sum + group.size * (group.paths.length - 1),
      0,
    ),
    skippedLargeFiles: skippedLarge,
    complete: !budgetExhausted && skippedLarge === 0,
    bytesHashed,
    note: "Detection is read-only. Removing duplicates requires an exact approved plan.",
    ...(budgetExhausted || skippedLarge
      ? {
          limitation: `Scan stopped early: ${
            budgetExhausted
              ? `the ${MAX_TOTAL_HASH_BYTES / 1024 ** 3} GB hashing budget was reached`
              : ""
          }${budgetExhausted && skippedLarge ? " and " : ""}${
            skippedLarge
              ? `${skippedLarge} file(s) exceeded the ${MAX_HASH_BYTES / 1024 ** 2} MB per-file limit`
              : ""
          }. More duplicates may exist.`,
        }
      : {}),
  });
}

async function previewFile(payload) {
  const root = await approvedRoot(payload.root);
  const file = await containedPath(root, payload.path);
  const stat = await fs.stat(file);
  if (!stat.isFile())
    throw new Error("Choose one file inside the approved folder.");
  const extension = path.extname(file).toLowerCase();
  if (!TEXT_EXTENSIONS.has(extension))
    throw new Error(
      "Preview supports bounded text files only (md, txt, csv, json, code).",
    );
  const handle = await fs.open(file, "r");
  try {
    const buffer = Buffer.alloc(Math.min(stat.size, 16 * 1024));
    await handle.read(buffer, 0, buffer.length, 0);
    return receipt("preview-file", root, {
      path: path.relative(root, file),
      bytes: stat.size,
      truncated: stat.size > buffer.length,
      content: buffer.toString("utf8"),
    });
  } finally {
    await handle.close();
  }
}

async function deviceVitals() {
  const cpus = os.cpus();
  const load = os.loadavg();
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  let disk = null;
  let battery = null;

  if (process.platform === "win32") {
    const letter = (process.env.SystemDrive ?? "C:").replace(/[^A-Za-z]/g, "");
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$d=Get-PSDrive -Name '${letter}';` +
          "$b=Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1;" +
          "[pscustomobject]@{Free=$d.Free;Used=$d.Used;Charge=$b.EstimatedChargeRemaining;Status=$b.BatteryStatus} | ConvertTo-Json -Compress",
      ],
      { timeout: 15_000, windowsHide: true },
    ).catch(() => ({ stdout: "" }));
    try {
      const info = JSON.parse(stdout || "{}");
      if (info.Free != null && info.Used != null)
        disk = {
          totalBytes: Number(info.Free) + Number(info.Used),
          usedBytes: Number(info.Used),
          availableBytes: Number(info.Free),
        };
      if (info.Charge != null)
        battery = {
          percent: Number(info.Charge),
          state: Number(info.Status) === 2 ? "charging or AC" : "on battery",
        };
    } catch {
      // Report nothing rather than a guess.
    }
  } else {
    const { stdout } = await execFileAsync("df", ["-k", os.homedir()], {
      timeout: 10_000,
    }).catch(() => ({ stdout: "" }));
    const dfLine = stdout.split("\n")[1];
    if (dfLine) {
      const [, blocks, used, available] = dfLine.trim().split(/\s+/);
      if (blocks && used && available)
        disk = {
          totalBytes: Number(blocks) * 1024,
          usedBytes: Number(used) * 1024,
          availableBytes: Number(available) * 1024,
        };
    }
    if (process.platform === "darwin") {
      const power = await execFileAsync("/usr/bin/pmset", ["-g", "batt"], {
        timeout: 10_000,
      }).catch(() => null);
      const match = power?.stdout.match(/(\d+)%;\s*([^;]+);/);
      if (match)
        battery = { percent: Number(match[1]), state: match[2].trim() };
    } else if (process.platform === "linux") {
      const base = "/sys/class/power_supply";
      const entries = await fs.readdir(base).catch(() => []);
      const batteryDir = entries.find((entry) => /^BAT/i.test(entry));
      if (batteryDir) {
        const capacity = await fs
          .readFile(path.join(base, batteryDir, "capacity"), "utf8")
          .catch(() => null);
        const status = await fs
          .readFile(path.join(base, batteryDir, "status"), "utf8")
          .catch(() => null);
        if (capacity)
          battery = {
            percent: Number(capacity.trim()),
            state: status?.trim() ?? "unknown",
          };
      }
    }
  }
  return receipt("device-vitals", "local device health", {
    platform: process.platform,
    arch: os.arch(),
    hostname: os.hostname(),
    uptimeSeconds: Math.round(os.uptime()),
    cpu: {
      model: cpus[0]?.model ?? "unknown",
      cores: cpus.length,
      loadAverage: load.map((value) => Number(value.toFixed(2))),
    },
    memory: {
      totalBytes: totalMemory,
      freeBytes: freeMemory,
      usedPercent: Number(
        (((totalMemory - freeMemory) / totalMemory) * 100).toFixed(1),
      ),
    },
    disk,
    battery,
  });
}

async function networkStatus() {
  const interfaces = [];
  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.internal) continue;
      interfaces.push({
        name,
        family: address.family,
        address: address.address,
        mac: "hidden",
      });
    }
  }
  // Connectivity is proven by an actual DNS resolution, not assumed from
  // having an IP address.
  let online = false;
  let resolvedIn = null;
  const started = Date.now();
  try {
    await dns.lookup("cloudflare.com");
    online = true;
    resolvedIn = Date.now() - started;
  } catch {
    online = false;
  }
  return receipt("network-status", "local network interfaces", {
    online,
    dnsResolveMs: resolvedIn,
    interfaceCount: interfaces.length,
    interfaces: interfaces.slice(0, 12),
    note: "Hardware addresses are deliberately withheld.",
  });
}

async function compareFolders(payload) {
  const left = await approvedRoot(payload.root);
  const right = await approvedRoot(payload.compareTo);
  if (left === right)
    throw new Error("Choose two different folders to compare.");
  const index = async (root) => {
    const map = new Map();
    for (const item of relativeItems(root, await walk(root))) {
      if (item.type === "file") map.set(item.path, item);
    }
    return map;
  };
  const [a, b] = await Promise.all([index(left), index(right)]);
  const onlyLeft = [];
  const onlyRight = [];
  const changed = [];
  for (const [key, item] of a) {
    const other = b.get(key);
    if (!other) onlyLeft.push(key);
    else if (other.size !== item.size)
      changed.push({ path: key, leftBytes: item.size, rightBytes: other.size });
  }
  for (const key of b.keys()) if (!a.has(key)) onlyRight.push(key);
  return receipt("compare-folders", `${left} ↔ ${right}`, {
    left,
    right,
    onlyInLeft: onlyLeft.slice(0, 100),
    onlyInRight: onlyRight.slice(0, 100),
    differentSize: changed.slice(0, 100),
    identical: a.size - onlyLeft.length - changed.length,
    summary: `${onlyLeft.length} only on the left, ${onlyRight.length} only on the right, ${changed.length} differ in size.`,
  });
}

async function rawClipboardText() {
  let text = "";
  if (process.platform === "darwin") {
    const { stdout } = await execFileAsync("/usr/bin/pbpaste", [], {
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
    text = stdout;
  } else if (process.platform === "win32") {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "Get-Clipboard -Raw"],
      { timeout: 15_000, maxBuffer: 1024 * 1024, windowsHide: true },
    );
    text = stdout;
  } else {
    const { stdout } = await execFileAsync(
      "xclip",
      ["-selection", "clipboard", "-o"],
      { timeout: 10_000, maxBuffer: 1024 * 1024 },
    ).catch(() => {
      throw new Error(
        "Reading the clipboard on Linux needs xclip. Install it and try again.",
      );
    });
    text = stdout;
  }
  return text;
}

async function readClipboard() {
  const text = await rawClipboardText();
  const content = text.slice(0, 16 * 1024);
  return receipt("read-clipboard", "system clipboard", {
    characters: text.length,
    truncated: text.length > content.length,
    content,
  });
}

async function writeClipboard(payload) {
  const text = String(payload.text ?? "");
  if (!text) throw new Error("Clipboard text is required.");
  const bounded = text.slice(0, 64 * 1024);
  const run = async (command, args) => {
    const child = execFile(command, args, { timeout: 10_000 });
    child.stdin.end(bounded);
    await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)),
      );
    });
  };
  if (process.platform === "darwin") await run("/usr/bin/pbcopy", []);
  else if (process.platform === "win32") await run("clip", []);
  else
    await run("xclip", ["-selection", "clipboard"]).catch(() => {
      throw new Error(
        "Writing the clipboard on Linux needs xclip. Install it and try again.",
      );
    });
  // Exit code 0 only proves the helper ran. Read the clipboard back so the
  // receipt reports an observed result rather than an assumed one.
  const readBack = await rawClipboardText().catch(() => null);
  const confirmed =
    readBack !== null && readBack.replace(/\r\n/g, "\n") === bounded;
  return receipt(
    "write-clipboard",
    "system clipboard",
    {
      characters: bounded.length,
      truncated: bounded.length < text.length,
      content: bounded,
      state: confirmed ? "clipboard-confirmed" : "write-dispatched",
      verification: confirmed
        ? "The clipboard was read back and matches exactly."
        : "The write command succeeded but the clipboard could not be read back to confirm it.",
    },
    { verified: confirmed },
  );
}

async function captureScreen(payload) {
  if (process.platform !== "darwin")
    throw new Error(
      `Screen capture has no verified adapter on ${process.platform}.`,
    );
  const root = await approvedRoot(payload.root);
  const name = safeName(payload.name ?? "raimosa-capture", "raimosa-capture");
  const fileName = name.toLowerCase().endsWith(".png") ? name : `${name}.png`;
  const destination = await containedPath(root, fileName, { mustExist: false });
  // Never overwrite: a capture must not silently replace an earlier one.
  const existing = await fs.stat(destination).catch(() => null);
  if (existing) throw new Error(`${fileName} already exists.`);

  // -x silences the shutter; the capture is of the whole screen only, so no
  // hidden window-targeting is possible from a request payload.
  await execFileAsync("/usr/bin/screencapture", ["-x", destination], {
    timeout: 20_000,
  });
  const stat = await fs.stat(destination).catch(() => null);
  if (!stat || stat.size === 0) {
    await fs.rm(destination, { force: true });
    throw new Error(
      "The capture produced no image. Grant Screen Recording permission to RAIMOSA in System Settings > Privacy & Security, then try again.",
    );
  }
  return receipt("capture-screen", root, {
    path: path.relative(root, destination),
    bytes: stat.size,
    verified: true,
    state: "capture-written-and-verified",
  });
}

const POWER_ACTIONS = new Set([
  "sleep",
  "display-sleep",
  "restart",
  "shutdown",
]);

async function systemPower(payload) {
  const action = String(payload.action ?? "");
  if (!POWER_ACTIONS.has(action))
    throw new Error("Choose sleep, display-sleep, restart, or shutdown.");
  // Restart and shutdown end every running session, so they take a typed
  // confirmation on top of All Access — the step-up the doctrine requires.
  const destructive = action === "restart" || action === "shutdown";
  if (destructive && payload.confirmation !== action.toUpperCase())
    throw new Error(`Type ${action.toUpperCase()} to confirm this action.`);

  if (process.platform === "darwin") {
    if (action === "sleep")
      await execFileAsync("/usr/bin/pmset", ["sleepnow"], { timeout: 10_000 });
    else if (action === "display-sleep")
      await execFileAsync("/usr/bin/pmset", ["displaysleepnow"], {
        timeout: 10_000,
      });
    else
      await execFileAsync(
        "/usr/bin/osascript",
        ["-e", `tell application "System Events" to ${action}`],
        { timeout: 15_000 },
      );
  } else if (process.platform === "win32") {
    const args =
      action === "restart"
        ? ["/r", "/t", "0"]
        : action === "shutdown"
          ? ["/s", "/t", "0"]
          : null;
    if (!args)
      throw new Error(
        `${action} has no verified adapter on Windows. Use restart or shutdown.`,
      );
    await execFileAsync("shutdown.exe", args, {
      timeout: 15_000,
      windowsHide: true,
    });
  } else {
    const args =
      action === "sleep"
        ? ["suspend"]
        : action === "restart"
          ? ["reboot"]
          : action === "shutdown"
            ? ["poweroff"]
            : null;
    if (!args)
      throw new Error(
        `${action} has no verified adapter on ${process.platform}.`,
      );
    await execFileAsync("systemctl", args, { timeout: 15_000 });
  }

  return dispatchReceipt("system-power", "this device", {
    action,
    platform: process.platform,
    state: "dispatch-accepted",
    verification: destructive
      ? "The device is going down, so no post-condition can be observed from inside this runtime. This receipt records the accepted dispatch, not a completed shutdown."
      : "The sleep request was accepted by the operating system.",
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

// Each supported platform discovers installed applications from its own
// conventional locations. Discovery is what makes control safe: launch and
// quit only ever accept a path that appeared in this verified list.
async function listApplications() {
  const applications = [];
  let scope = "installed applications";

  if (process.platform === "darwin") {
    scope = "macOS applications";
    const roots = [
      "/Applications",
      "/System/Applications",
      path.join(os.homedir(), "Applications"),
    ];
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
  } else if (process.platform === "linux") {
    scope = "Linux desktop entries";
    const roots = [
      "/usr/share/applications",
      "/usr/local/share/applications",
      "/var/lib/flatpak/exports/share/applications",
      path.join(os.homedir(), ".local", "share", "applications"),
    ];
    for (const root of roots) {
      const entries = await fs
        .readdir(root, { withFileTypes: true })
        .catch(() => []);
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".desktop")) continue;
        const full = path.join(root, entry.name);
        const content = await fs.readFile(full, "utf8").catch(() => "");
        if (/^NoDisplay\s*=\s*true/im.test(content)) continue;
        const name =
          content.match(/^Name\s*=\s*(.+)$/im)?.[1]?.trim() ??
          entry.name.replace(/\.desktop$/i, "");
        applications.push({ name, path: full });
      }
    }
  } else if (process.platform === "win32") {
    scope = "Windows Start Menu applications";
    const roots = [
      path.join(
        process.env.ProgramData ?? "C:\\ProgramData",
        "Microsoft",
        "Windows",
        "Start Menu",
        "Programs",
      ),
      path.join(
        process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"),
        "Microsoft",
        "Windows",
        "Start Menu",
        "Programs",
      ),
    ];
    const collect = async (root, depth = 0) => {
      if (depth > 3 || applications.length >= 200) return;
      const entries = await fs
        .readdir(root, { withFileTypes: true })
        .catch(() => []);
      for (const entry of entries) {
        const full = path.join(root, entry.name);
        if (entry.isDirectory()) await collect(full, depth + 1);
        else if (entry.name.toLowerCase().endsWith(".lnk"))
          applications.push({
            name: entry.name.replace(/\.lnk$/i, ""),
            path: full,
          });
      }
    };
    for (const root of roots) await collect(root);
  } else {
    throw new Error(
      `Application discovery is not implemented for ${process.platform}.`,
    );
  }

  const unique = [...new Map(applications.map((a) => [a.path, a])).values()];
  return receipt("list-applications", scope, {
    platform: process.platform,
    applications: unique
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 120),
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

// Every platform opens a discovered target with its own OS opener, and the
// target is always a validated path from the discovery list — never free text.
async function openWithSystemOpener(target) {
  if (process.platform === "darwin") {
    await execFileAsync("/usr/bin/open", ["-g", target], { timeout: 10_000 });
    return "macos-open";
  }
  if (process.platform === "linux") {
    await execFileAsync("xdg-open", [target], { timeout: 10_000 });
    return "linux-xdg-open";
  }
  if (process.platform === "win32") {
    await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Start-Process -FilePath $args[0]",
        target,
      ],
      { timeout: 15_000, windowsHide: true },
    );
    return "windows-start-process";
  }
  throw new Error(`Opening is not implemented for ${process.platform}.`);
}

async function launchApplication(payload) {
  const app = await validateApplication(payload.appPath);
  const adapter = await openWithSystemOpener(app.path);
  return dispatchReceipt("launch-application", app.path, {
    application: app.name,
    adapter,
    state: "launch-request-accepted",
  });
}

async function closeApplication(payload) {
  const app = await validateApplication(payload.appPath);
  if (process.platform === "darwin") {
    const script = `tell application "${escapeAppleScript(app.name)}" to quit`;
    await execFileAsync("/usr/bin/osascript", ["-e", script], {
      timeout: 10_000,
    });
  } else if (process.platform === "win32") {
    // A Start Menu shortcut name is not necessarily the process name, so the
    // result must report how many windows were actually asked to close.
    // Claiming success when nothing matched would be a false receipt.
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$p=@(Get-Process -Name $args[0] -ErrorAction SilentlyContinue);" +
          "$n=0; foreach($x in $p){ if($x.CloseMainWindow()){ $n++ } };" +
          "Write-Output $n",
        app.name,
      ],
      { timeout: 15_000, windowsHide: true },
    );
    const asked = Number(String(stdout).trim());
    if (!Number.isFinite(asked) || asked === 0) {
      return dispatchReceipt("close-application", app.path, {
        application: app.name,
        windowsAsked: 0,
        state: "no-matching-window",
        detail:
          "No running window matched this application, so nothing was closed. A Start Menu shortcut name can differ from the running process name.",
      });
    }
    return dispatchReceipt("close-application", app.path, {
      application: app.name,
      windowsAsked: asked,
      state: "quit-request-accepted",
    });
  } else {
    throw new Error(
      `Quitting applications is not implemented for ${process.platform}.`,
    );
  }
  return dispatchReceipt("close-application", app.path, {
    application: app.name,
    state: "quit-request-accepted",
  });
}

// Bounded process listing, normalised to {pid, elapsed, command} everywhere.
async function readProcessTable() {
  if (process.platform === "win32") {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-Process | Select-Object Id,ProcessName,StartTime | ConvertTo-Json -Compress",
      ],
      { timeout: 15_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
    );
    const rows = JSON.parse(stdout || "[]");
    const list = Array.isArray(rows) ? rows : [rows];
    return list
      .filter(Boolean)
      .map((row) => {
        const started = row.StartTime ? Date.parse(row.StartTime) : NaN;
        const seconds = Number.isFinite(started)
          ? Math.max(0, Math.round((Date.now() - started) / 1000))
          : null;
        return {
          pid: Number(row.Id),
          elapsed:
            seconds === null
              ? "unknown"
              : `${Math.floor(seconds / 3600)}:${String(
                  Math.floor((seconds % 3600) / 60),
                ).padStart(2, "0")}`,
          command: String(row.ProcessName ?? ""),
        };
      })
      .filter((row) => Number.isFinite(row.pid) && row.command);
  }
  const { stdout } = await execFileAsync("ps", ["-axo", "pid=,etime=,comm="], {
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
  });
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(\S+)\s+(.+)$/);
      return match
        ? { pid: Number(match[1]), elapsed: match[2], command: match[3] }
        : null;
    })
    .filter(Boolean);
}

async function processStatus(payload) {
  const query = String(payload.query ?? "")
    .trim()
    .toLowerCase();
  const processes = (await readProcessTable())
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
  const rawTitle = String(payload.title ?? "RAIMOSA AI").slice(0, 80);
  const rawMessage = String(payload.message ?? "").slice(0, 240);
  if (!rawMessage) throw new Error("Notification text is required.");

  if (process.platform === "darwin") {
    const title = escapeAppleScript(rawTitle);
    const message = escapeAppleScript(rawMessage);
    await execFileAsync(
      "/usr/bin/osascript",
      ["-e", `display notification "${message}" with title "${title}"`],
      { timeout: 10_000 },
    );
  } else if (process.platform === "linux") {
    // Arguments are passed as argv, never interpolated into a shell string.
    await execFileAsync("notify-send", [rawTitle, rawMessage], {
      timeout: 10_000,
    });
  } else if (process.platform === "win32") {
    await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] > $null;" +
          "$t=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02);" +
          "$n=$t.GetElementsByTagName('text');" +
          "$n.Item(0).AppendChild($t.CreateTextNode($args[0])) > $null;" +
          "$n.Item(1).AppendChild($t.CreateTextNode($args[1])) > $null;" +
          "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('RAIMOSA AI').Show([Windows.UI.Notifications.ToastNotification]::new($t))",
        rawTitle,
        rawMessage,
      ],
      { timeout: 15_000, windowsHide: true },
    );
  } else {
    throw new Error(
      `Local notifications are not implemented for ${process.platform}.`,
    );
  }

  return dispatchReceipt("local-notification", "current desktop user", {
    title: rawTitle,
    message: rawMessage,
    platform: process.platform,
    state: "display-request-accepted",
  });
}

async function openDocument(payload) {
  const root = await approvedRoot(payload.root);
  const file = await containedPath(root, payload.path);
  const stat = await fs.stat(file);
  if (!stat.isFile())
    throw new Error("Choose one file inside the approved folder.");
  const adapter = await openWithSystemOpener(file);
  return dispatchReceipt("open-document", root, {
    path: path.relative(root, file),
    adapter,
    state: "open-request-accepted",
  });
}

export function createDesktopToolService(options = {}) {
  const stateDir = raimosaHome();
  const workspaceRoot = defaultWorkspace();
  // Make sure the default approved folder exists, so a fresh install has a
  // usable scope instead of an error on first use.
  try {
    mkdirSync(workspaceRoot, { recursive: true });
  } catch {
    // A read-only home is reported by the health scan, not thrown at boot.
  }
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
    const redactor = LEDGER_REDACTORS[nextReceipt.tool];
    if (!redactor) return ledger.append(nextReceipt);
    const stored = ledger.append({
      ...nextReceipt,
      result: redactor(nextReceipt.result),
    });
    return {
      ...nextReceipt,
      sequence: stored.sequence,
      hash: stored.hash,
    };
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

  // Licensing. RAIMOSA Free is the full governed loop; Pro unlocks the tools
  // that command the machine. The license is a signed token (not a secret),
  // stored durably and verified offline on every check, so a tampered flag
  // cannot grant Pro.
  function licenseStatus() {
    const stored = state.getFlag("license");
    if (!stored?.key) return { tier: "free", pro: false };
    const check = verifyLicenseKey(stored.key);
    if (!check.valid) return { tier: "free", pro: false, error: check.reason };
    return {
      tier: "pro",
      pro: true,
      holder: check.holder,
      issuedAt: check.issuedAt,
    };
  }

  function activateLicense(payload = {}) {
    const check = verifyLicenseKey(payload.key);
    if (!check.valid) throw new Error(check.reason);
    state.setFlag("license", { key: String(payload.key).trim() });
    record(
      receipt("license-activated", "RAIMOSA licensing", {
        tier: check.tier,
        holder: check.holder,
        issuedAt: check.issuedAt,
      }),
    );
    return { ok: true, ...licenseStatus() };
  }

  function removeLicense() {
    const was = licenseStatus();
    state.clearFlag("license");
    if (was.pro)
      record(receipt("license-removed", "RAIMOSA licensing", { tier: "free" }));
    return { ok: true, ...licenseStatus() };
  }

  function requirePro(name) {
    if (!requiresPro(name)) return;
    if (!licenseStatus().pro)
      throw new Error(
        "This is a RAIMOSA Pro tool. Activate a Pro license to unlock the desktop-commander tools (app control, clipboard, screen capture, power, and mobile remote).",
      );
  }

  // Emergency stop is a durable server-side latch, not a UI state. While
  // latched, every adapter dispatch, All Access grant, and pairing action is
  // refused at the server, and the latch survives a runtime restart until the
  // owner explicitly clears it.
  function emergencyStatus() {
    const latch = state.getFlag("emergency-stop");
    return {
      ok: true,
      latched: Boolean(latch),
      since: latch ? new Date(latch.setAt).toISOString() : null,
    };
  }

  function requireNotLatched() {
    if (state.getFlag("emergency-stop"))
      throw new Error(
        "Emergency stop is active. Clear it from the desktop before running anything.",
      );
  }

  function emergencyStop() {
    const accessSessions = state.listSessions("access");
    const remoteCount = state.listSessions("remote").length;
    state.deleteAll("access");
    state.deleteAll("remote");
    state.deleteAll("pairing");
    state.setFlag("emergency-stop", { reason: "owner-request" });
    record(
      receipt("emergency-stop", "local desktop authority", {
        state: "latched",
        revokedAccessSessions: accessSessions.map((session) => session.id),
        revokedRemoteSessions: remoteCount,
        detail:
          "All adapter dispatch is blocked at the server until the latch is cleared.",
      }),
    );
    // Report what was actually revoked. The recovery UI states these as facts,
    // so they must come from the server that did the revoking — never from a
    // static checklist the interface merely asserts.
    return {
      ok: true,
      ...emergencyStatus(),
      revoked: {
        accessSessions: accessSessions.length,
        remoteSessions: remoteCount,
      },
    };
  }

  function emergencyClear() {
    const latch = state.getFlag("emergency-stop");
    if (latch) {
      state.clearFlag("emergency-stop");
      record(
        receipt("emergency-clear", "local desktop authority", {
          state: "cleared",
          latchedSince: new Date(latch.setAt).toISOString(),
        }),
      );
    }
    return { ok: true, ...emergencyStatus() };
  }

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
    requireNotLatched();
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

  // A six-digit code on an open LAN endpoint is brute-forceable without an
  // attempt limit. After MAX_PAIR_ATTEMPTS failures every outstanding code is
  // revoked and a new one must be generated from the desktop.
  const MAX_PAIR_ATTEMPTS = 5;
  let failedPairAttempts = 0;
  // After the attempt limit trips, refuse further guesses for a cooldown window.
  // Revoking the codes alone was not enough: a guesser on the same network could
  // burn the limit, wait for the owner to generate a fresh code, and repeat
  // forever — locking the owner out of pairing indefinitely. The cooldown bounds
  // guessing to MAX_PAIR_ATTEMPTS per window against a 900,000-code space.
  let pairLockedUntil = 0;
  const PAIR_LOCKOUT_MS = 60_000;

  function startRemotePairing(payload = {}) {
    requireNotLatched();
    requirePro("mobile-remote");
    const access = requireAccess(payload.accessToken);
    // Deliberately NOT clearing failedPairAttempts here: generating a fresh code
    // must not hand an active guesser a fresh allowance.
    const code = String(randomInt(100000, 1000000));
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
    requireNotLatched();
    if (Date.now() < pairLockedUntil) {
      const seconds = Math.ceil((pairLockedUntil - Date.now()) / 1000);
      throw new Error(
        `Too many incorrect pairing codes. Try again in ${seconds}s.`,
      );
    }
    const code = String(payload.code ?? "").trim();
    const pairing = state.getSession("pairing", code);
    const access = pairing ? liveAccessByHash(pairing.accessTokenHash) : null;
    if (!pairing || pairing.expiresAt <= Date.now() || !access) {
      state.deleteSession("pairing", code);
      failedPairAttempts += 1;
      if (failedPairAttempts >= MAX_PAIR_ATTEMPTS) {
        state.deleteAll("pairing");
        record(
          receipt("remote-pairing-lockout", "local network", {
            failedAttempts: failedPairAttempts,
            state: "all-pairing-codes-revoked",
            detail:
              "Too many failed pairing attempts. Generate a fresh code from the desktop.",
          }),
        );
        failedPairAttempts = 0;
        pairLockedUntil = Date.now() + PAIR_LOCKOUT_MS;
      }
      throw new Error("The pairing code is invalid or expired.");
    }
    failedPairAttempts = 0;
    pairLockedUntil = 0;
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
        defaultWorkspace: workspaceRoot,
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
    const workspace = workspaceRoot;
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

    // No available capability may carry an adapter built for a different OS.
    const adapterPlatforms = {
      macos: "darwin",
      linux: "linux",
      windows: "win32",
    };
    const foreignAdapters = capabilityCatalog.filter((item) => {
      if (item.status !== "available" || !item.adapter) return false;
      const prefix = item.adapter.split("-")[0];
      const required = adapterPlatforms[prefix];
      return required && required !== process.platform;
    });
    const platformReady = foreignAdapters.length === 0;
    checks.push({
      id: "platform.compatibility",
      status: platformReady ? "pass" : "fail",
      detail: platformReady
        ? `Runtime platform ${process.platform} matches every registered adapter.`
        : `${foreignAdapters.length} adapter(s) built for another OS are marked available on ${process.platform}.`,
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

    const latch = emergencyStatus();
    checks.push({
      id: "authority.emergency-latch",
      status: latch.latched ? "fail" : "pass",
      detail: latch.latched
        ? `Emergency stop has been latched since ${latch.since}; all adapter dispatch is blocked.`
        : "Emergency stop is a durable server-side latch and is currently clear.",
    });
    if (latch.latched) {
      findings.push({
        id: "emergency-stop-latched",
        severity: "high",
        title: "Emergency stop is active",
        detail:
          "Execution is blocked at the server until the owner clears the latch.",
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
    // The plan receipt publishes this hash as the fingerprint of exactly what
    // was approved. Recompute it before acting: without this check the hash is
    // decorative, and a plan altered in the state store between approval and
    // execution would run anyway under a receipt that still cites the original
    // fingerprint.
    const replayHash = createHash("sha256")
      .update(
        JSON.stringify({
          root: approval.root,
          operations: approval.operations,
        }),
      )
      .digest("hex");
    if (approval.hash && replayHash !== approval.hash)
      throw new Error(
        "This approved plan no longer matches its approved fingerprint. Create a new plan.",
      );
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
        const parent = path.dirname(destination);
        await fs.mkdir(parent, { recursive: true });
        // The string check above cannot see through a symlink. A link planted
        // inside the approved folder (e.g. "RAIMOSA Organized/Images" ->
        // /tmp/elsewhere) is silently accepted by mkdir -p, and the rename
        // would then move the owner's files OUT of the folder they approved
        // while the receipt still claimed success. Resolve the real parent
        // after creating it and refuse anything that leaves the root.
        const realParent = await fs.realpath(parent);
        if (
          realParent !== approval.root &&
          !realParent.startsWith(`${approval.root}${path.sep}`)
        )
          throw new Error("A destination leaves the approved folder.");
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
    requireNotLatched();
    requirePro(tool);
    const effectivePayload = { ...payload };
    if (context.remoteToken) {
      const remote = activeRemote(context.remoteToken);
      if (!remote)
        throw new Error("The mobile remote session is expired or revoked.");
      if (!REMOTE_TOOLS.has(tool))
        throw new Error("This tool is not available from the mobile remote.");
      // The remote record holds only a hash of the desktop access token, so
      // control tools are authorised by resolving the live access session
      // through that hash — the raw token never travels to or from the phone.
      if (CONTROL_TOOLS.has(tool) && !liveAccessByHash(remote.accessTokenHash))
        throw new Error(
          "A live OVIA AI All Access session is required for this control.",
        );
    } else if (CONTROL_TOOLS.has(tool)) {
      requireAccess(effectivePayload.accessToken);
    }

    // The capability registry is the authority, not just a source of UI state.
    const governing = TOOL_CAPABILITY[tool];
    const capability = governing
      ? capabilityCatalog.find((item) => item.id === governing)
      : null;
    if (governing && capability?.status !== "available") {
      throw new Error(
        `${capability?.title ?? tool} has no verified adapter on ${process.platform}, so it cannot run here.`,
      );
    }

    let result;
    switch (tool) {
      case "find-files":
        result = await findFiles(effectivePayload);
        break;
      case "summarize-folder":
        result = await summarizeFolder(effectivePayload);
        break;
      case "storage-insights":
        result = await storageInsights(effectivePayload);
        break;
      case "find-duplicates":
        result = await findDuplicates(effectivePayload);
        break;
      case "preview-file":
        result = await previewFile(effectivePayload);
        break;
      case "device-vitals":
        result = await deviceVitals();
        break;
      case "network-status":
        result = await networkStatus();
        break;
      case "compare-folders":
        result = await compareFolders(effectivePayload);
        break;
      case "read-clipboard":
        result = await readClipboard();
        break;
      case "write-clipboard":
        result = await writeClipboard(effectivePayload);
        break;
      case "capture-screen":
        result = await captureScreen(effectivePayload);
        break;
      case "system-power":
        result = await systemPower(effectivePayload);
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
    health({ port } = {}) {
      return {
        ok: true,
        runtime: "local-node-adapter",
        platform: process.platform,
        hostname: os.hostname(),
        defaultWorkspace: workspaceRoot,
        capabilities: capabilityCatalog,
        doctrine: oviaDoctrine(),
        emergency: emergencyStatus(),
        native: process.env.RAIMOSA_NATIVE ?? null,
        license: licenseStatus(),
        proTools: [...PRO_TOOLS, ...PRO_FEATURES],
        remote: {
          available: true,
          mode: "paired-local-network",
          urls: networkUrls(port),
        },
      };
    },
    emergencyStop,
    emergencyClear,
    emergencyStatus,
    licenseStatus,
    activateLicense,
    removeLicense,
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
    /**
     * Export the receipt ledger as verifiable evidence.
     *
     * The export always carries the integrity verdict alongside the rows, so
     * an exported file can never look trustworthy when the chain underneath
     * it is broken.
     */
    exportLedger({ format = "json", tool = "" } = {}) {
      const integrity = ledger.verify();
      const all = ledger.list(100);
      const filter = String(tool ?? "")
        .trim()
        .toLowerCase();
      const rows = filter
        ? all.filter((entry) => entry.tool.toLowerCase().includes(filter))
        : all;

      if (format === "csv") {
        const escape = (value) =>
          `"${String(value ?? "").replaceAll('"', '""')}"`;
        const header = [
          "sequence",
          "id",
          "tool",
          "scope",
          "timestamp",
          "verified",
          "hash",
          "result",
        ];
        const lines = [header.join(",")];
        for (const entry of [...rows].reverse()) {
          lines.push(
            [
              entry.sequence,
              escape(entry.id),
              escape(entry.tool),
              escape(entry.scope),
              escape(entry.timestamp),
              entry.verified,
              escape(entry.hash),
              escape(JSON.stringify(entry.result)),
            ].join(","),
          );
        }
        return {
          ok: true,
          format: "csv",
          filename: `raimosa-receipts-${new Date().toISOString().slice(0, 10)}.csv`,
          integrity,
          content: lines.join("\n"),
        };
      }

      return {
        ok: true,
        format: "json",
        filename: `raimosa-receipts-${new Date().toISOString().slice(0, 10)}.json`,
        integrity,
        content: JSON.stringify(
          {
            product: "RAIMOSA AI",
            exportedAt: new Date().toISOString(),
            host: os.hostname(),
            platform: process.platform,
            ledgerDurable: ledger.durable,
            totalReceipts: ledger.count(),
            exportedReceipts: rows.length,
            filter: filter || null,
            integrity,
            attestation: integrity.intact
              ? "Every exported receipt was verified against an unbroken SHA-256 chain at export time."
              : `CHAIN BROKEN at ${integrity.brokenAt}. Treat receipts after that point as unverified.`,
            receipts: [...rows].reverse(),
          },
          null,
          2,
        ),
      };
    },
    recovery,
    closeLedger() {
      ledger.close();
      state.close();
    },
  };
}

export { MAX_BODY_BYTES };
