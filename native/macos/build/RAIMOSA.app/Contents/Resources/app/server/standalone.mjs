import http from "node:http";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApiHandler } from "./api-router.mjs";

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
    void serveStatic(req, res);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  return { server, port, url: `http://localhost:${port}` };
}
