import http from "node:http";
import {
  createReadStream,
  promises as fs,
  readFileSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createApiHandler,
  isLoopback,
  isLocalNetwork,
} from "./api-router.mjs";
import { raimosaHome } from "./desktop-tools.mjs";

// The installed RAIMOSA runtime: serves the built interface and the adapter
// API from one local Node process, with no build tooling present.

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(here, "..", "dist");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

// A paired phone loads http://<lan-ip>:<port>/remote and the hashed bundle it
// references, so those two must answer on the local network. Nothing else
// does. The adapter API was already gated — loopback for desktop tools, LAN
// plus a paired token for /remote — but the pages themselves were not, so any
// device on a shared network could pull up the whole desktop console just by
// finding the port. This closes that gap without touching pairing.
export function staticAllowed(pathname, address) {
  if (isLoopback(address)) return true;
  if (!isLocalNetwork(address)) return false;
  return (
    pathname === "/remote" ||
    pathname === "/remote/" ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/assets/")
  );
}

async function serveStatic(req, res) {
  const raw = new URL(req.url ?? "/", "http://localhost").pathname;
  // Decode percent-escapes so hashed asset names containing encoded
  // characters resolve. A malformed escape is treated as a literal path.
  let requested = raw;
  try {
    requested = decodeURIComponent(raw);
  } catch {
    requested = raw;
  }
  if (requested.includes("\0")) {
    res.statusCode = 400;
    res.end("Bad request.");
    return;
  }
  // Resolve inside dist and refuse anything that escapes it.
  const candidate = path.resolve(DIST, `.${requested}`);
  const inside =
    candidate === DIST || candidate.startsWith(`${DIST}${path.sep}`);
  const stat = inside ? await fs.stat(candidate).catch(() => null) : null;
  const file =
    stat?.isFile() && requested !== "/"
      ? candidate
      : path.join(DIST, "index.html");
  const exists = await fs.stat(file).catch(() => null);
  if (!exists) {
    res.statusCode = 500;
    res.end(
      "RAIMOSA interface assets are missing. Reinstall, or run `npm run build`.",
    );
    return;
  }
  const extension = path.extname(file).toLowerCase();
  res.statusCode = 200;
  res.setHeader("Content-Type", MIME[extension] ?? "application/octet-stream");
  res.setHeader(
    "Cache-Control",
    extension === ".html" ? "no-store" : "public, max-age=3600",
  );
  createReadStream(file).pipe(res);
}

async function firstFreePort(preferred, host) {
  for (let port = preferred; port < preferred + 40; port += 1) {
    const free = await new Promise((resolve) => {
      const probe = http.createServer();
      probe.once("error", () => resolve(false));
      probe.once("listening", () => probe.close(() => resolve(true)));
      probe.listen(port, host);
    });
    if (free) return port;
  }
  throw new Error(
    `No free port between ${preferred} and ${preferred + 39}. Pass --port.`,
  );
}

/**
 * Where a running instance publishes the port it actually bound. Lives beside
 * the ledger in RAIMOSA_HOME, which is already user-only state, so this adds no
 * new surface: it names a loopback port that is open anyway.
 */
export function runtimeFilePath() {
  return path.join(raimosaHome(), "runtime.json");
}

async function writeRuntimeFile(port) {
  const file = runtimeFilePath();
  const mine = JSON.stringify({
    port,
    pid: process.pid,
    url: `http://127.0.0.1:${port}`,
    startedAt: new Date().toISOString(),
  });
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${mine}\n`, { mode: 0o600 });
  } catch {
    // A read-only home is reported by the health scan, not thrown at boot.
    return;
  }
  // Remove it on the way out, but only while it is still ours. A second
  // instance overwrites the file, and deleting that on our exit would strand
  // the one still running.
  const clean = () => {
    try {
      const held = JSON.parse(readFileSync(file, "utf8"));
      if (held.pid === process.pid) unlinkSync(file);
    } catch {
      // Already gone, replaced, or unreadable: nothing to take back.
    }
  };
  process.once("exit", clean);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.once(signal, () => {
      clean();
      process.exit(0);
    });
  }
}

export async function startRaimosa({
  port: requestedPort = 4173,
  host = "0.0.0.0",
} = {}) {
  const port = await firstFreePort(Number(requestedPort) || 4173, host);
  const handleApiRequest = createApiHandler({ getPort: () => port });

  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    if (url.startsWith("/api/raimosa")) {
      req.url = url.slice("/api/raimosa".length) || "/";
      void handleApiRequest(req, res);
      return;
    }
    const pathname = new URL(url, "http://localhost").pathname;
    if (!staticAllowed(pathname, req.socket.remoteAddress)) {
      res.statusCode = 403;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(
        "RAIMOSA serves its interface to this machine only. To use a phone, pair it from the desktop and open /remote.\n",
      );
      return;
    }
    void serveStatic(req, res);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  // Advertise where we actually ended up. The macOS shell launches the runtime
  // on a random port (RAIMOSA.swift picks 4200-4899), and firstFreePort moves
  // us again if that one is taken, so nothing else can guess the port. The MCP
  // bridge used to assume 4173, which meant Sentinel-over-MCP could never reach
  // the installed app: every agent silently lost its supervisor. The file is
  // written after listen() so it only ever names a port that is actually open.
  await writeRuntimeFile(port);

  return { server, port, url: `http://localhost:${port}` };
}
