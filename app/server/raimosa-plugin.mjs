import { createDesktopToolService, MAX_BODY_BYTES } from "./desktop-tools.mjs";

function isLoopback(address = "") {
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}

function isLocalNetwork(address = "") {
  const normalized = address.replace(/^::ffff:/, "");
  return (
    isLoopback(address) ||
    /^10\./.test(normalized) ||
    /^192\.168\./.test(normalized) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(normalized) ||
    /^fe80:/i.test(normalized)
  );
}

function isRemoteRoute(route) {
  return (
    route === "/remote/pair" ||
    route === "/remote/status" ||
    route === "/remote/end" ||
    route.startsWith("/remote/tools/")
  );
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_BODY_BYTES)
      throw new Error("Request body is too large.");
  }
  return body ? JSON.parse(body) : {};
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

export function raimosaLocalTools() {
  const service = createDesktopToolService();
  return {
    name: "raimosa-local-tools",
    configureServer(server) {
      server.middlewares.use("/api/raimosa", async (req, res) => {
        try {
          const route = new URL(req.url ?? "/", "http://localhost").pathname;
          const remoteRoute = isRemoteRoute(route);
          if (
            remoteRoute
              ? !isLocalNetwork(req.socket.remoteAddress)
              : !isLoopback(req.socket.remoteAddress)
          ) {
            send(res, 403, {
              ok: false,
              error: remoteRoute
                ? "Mobile remote requests must come from the local network."
                : "Desktop adapters accept loopback requests only.",
            });
            return;
          }
          const origin = req.headers.origin;
          if (
            !remoteRoute &&
            origin &&
            !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)
          ) {
            send(res, 403, {
              ok: false,
              error: "Cross-origin desktop adapter requests are blocked.",
            });
            return;
          }
          if (req.method === "GET" && route === "/health") {
            send(res, 200, service.health());
            return;
          }
          if (req.method === "GET" && route === "/receipts") {
            send(res, 200, service.listReceipts());
            return;
          }
          if (req.method !== "POST") {
            send(res, 405, { ok: false, error: "Method not allowed." });
            return;
          }
          const payload = await readJson(req);
          if (route === "/plan") {
            send(res, 200, {
              ok: true,
              plan: service.plan(payload.command, { root: payload.root }),
            });
            return;
          }
          if (route === "/scan") {
            const scanReceipt = await service.scanRuntime();
            send(res, 200, { ok: true, receipt: scanReceipt });
            return;
          }
          if (route === "/access/start") {
            send(res, 200, service.startAccess(payload));
            return;
          }
          if (route === "/access/end") {
            send(res, 200, service.endAccess(payload));
            return;
          }
          if (route === "/access/status") {
            send(res, 200, service.accessStatus(payload.token));
            return;
          }
          if (route === "/remote/start") {
            send(
              res,
              200,
              service.startRemotePairing({
                ...payload,
                port: server.config.server.port ?? 4173,
              }),
            );
            return;
          }
          if (route === "/remote/pair") {
            send(res, 200, service.pairRemote(payload));
            return;
          }
          if (route === "/remote/status") {
            send(res, 200, service.remoteStatus(payload.token));
            return;
          }
          if (route === "/remote/end") {
            send(res, 200, service.endRemote(payload));
            return;
          }
          if (route.startsWith("/remote/tools/")) {
            const tool = route.slice("/remote/tools/".length);
            const result = await service.handle(tool, payload, {
              remoteToken: payload.remoteToken,
            });
            send(res, 200, { ok: true, receipt: result });
            return;
          }
          if (route.startsWith("/tools/")) {
            const tool = route.slice("/tools/".length);
            const result = await service.handle(tool, payload);
            send(res, 200, { ok: true, receipt: result });
            return;
          }
          send(res, 404, { ok: false, error: "Route not found." });
        } catch (error) {
          send(res, 400, {
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : "Adapter request failed.",
          });
        }
      });
    },
  };
}
