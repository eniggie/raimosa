import { createDesktopToolService, MAX_BODY_BYTES } from "./desktop-tools.mjs";

// The RAIMOSA adapter API, independent of any host server.
//
// This used to live inside the Vite plugin, which meant the product could
// only run inside a development checkout. The same router now backs both the
// dev server and the installed standalone runtime, so what ships is what was
// tested.

export function isLoopback(address = "") {
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}

export function isLocalNetwork(address = "") {
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

/**
 * Build the adapter API handler.
 *
 * @param {object} options
 * @param {() => number} options.getPort Resolve the port the UI is served on,
 *   used for mobile-remote pairing URLs.
 * @param {object} [options.service] Inject a service (tests).
 */
export function createApiHandler({ getPort, service: injected } = {}) {
  const service = injected ?? createDesktopToolService();

  return async function handleApiRequest(req, res) {
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
      if (origin) {
        const host = (() => {
          try {
            return new URL(origin).hostname;
          } catch {
            return "";
          }
        })();
        const localhostOrigin = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(
          host,
        );
        const allowed = remoteRoute
          ? localhostOrigin || isLocalNetwork(host)
          : localhostOrigin;
        if (!allowed) {
          send(res, 403, {
            ok: false,
            error: "Cross-origin adapter requests are blocked.",
          });
          return;
        }
      }
      const serverPort = getPort?.() ?? 4173;
      if (req.method === "GET" && route === "/health") {
        send(res, 200, service.health({ port: serverPort }));
        return;
      }
      if (req.method === "GET" && route === "/receipts") {
        const params = new URL(req.url ?? "/", "http://localhost").searchParams;
        if (params.has("since") || params.has("q") || params.has("limit")) {
          send(
            res,
            200,
            service.queryReceipts({
              since: params.get("since"),
              text: params.get("q") ?? "",
              limit: params.get("limit") ?? 100,
            }),
          );
          return;
        }
        send(res, 200, service.listReceipts());
        return;
      }
      // Realtime: a server-sent stream of new receipts. Same loopback gate as
      // every other desktop route; nothing is pushed that /receipts would not
      // return. The client falls back to polling if the stream closes.
      if (req.method === "GET" && route === "/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        let lastCount = service.ledgerCount();
        res.write(
          `event: hello\ndata: ${JSON.stringify({ count: lastCount })}\n\n`,
        );
        const tick = setInterval(() => {
          try {
            const count = service.ledgerCount();
            if (count > lastCount) {
              const fresh = service.listReceipts(
                Math.min(20, count - lastCount),
              ).receipts;
              lastCount = count;
              for (const r of fresh.reverse())
                res.write(`event: receipt\ndata: ${JSON.stringify(r)}\n\n`);
            } else {
              res.write(`: keep-alive\n\n`);
            }
          } catch {
            // The stream ends on any error; the client re-polls.
            clearInterval(tick);
            res.end();
          }
        }, 1000);
        req.on("close", () => clearInterval(tick));
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
        send(res, 200, { ok: true, receipt: await service.scanRuntime() });
        return;
      }
      if (route === "/receipts/export") {
        send(res, 200, service.exportLedger(payload));
        return;
      }
      // ---- Sentinel ----
      if (route === "/sentinel/status") {
        send(res, 200, await service.sentinelStatus());
        return;
      }
      if (route === "/sentinel/policy") {
        send(res, 200, { ok: true, ...service.sentinel.policy() });
        return;
      }
      if (route === "/sentinel/policy/set") {
        send(res, 200, {
          ok: true,
          ...service.sentinel.setLevel(payload.tool, payload.level),
        });
        return;
      }
      if (route === "/sentinel/agents/register") {
        send(res, 200, {
          ok: true,
          agent: service.sentinel.registerAgent(payload),
        });
        return;
      }
      if (route === "/sentinel/agents/pause") {
        send(res, 200, {
          ok: true,
          agent: service.sentinel.pauseAgent(payload.agentId, payload.reason),
        });
        return;
      }
      if (route === "/sentinel/agents/resume") {
        send(res, 200, {
          ok: true,
          agent: service.sentinel.resumeAgent(payload.agentId),
        });
        return;
      }
      if (route === "/sentinel/agents/revoke") {
        send(res, 200, {
          ok: true,
          agent: service.sentinel.revokeAgent(payload.agentId),
        });
        return;
      }
      if (route === "/sentinel/agents/usage") {
        send(res, 200, {
          ok: true,
          ...service.sentinel.recordUsage(payload.agentId, payload),
        });
        return;
      }
      if (route === "/sentinel/tasks/create") {
        const created = service.sentinel.createTask(payload);
        // Anchor a restore point before the agent touches anything.
        const restorePoint = await service.sentinel.recordRestorePoint(
          created.id,
        );
        send(res, 200, { ok: true, task: { ...created, restorePoint } });
        return;
      }
      if (route === "/sentinel/tasks/claim") {
        send(res, 200, {
          ok: true,
          task: service.sentinel.claimComplete(payload.taskId, payload),
        });
        return;
      }
      if (route === "/sentinel/tasks/verify") {
        send(res, 200, {
          ok: true,
          task: await service.sentinel.verifyTask(payload.taskId, payload),
        });
        return;
      }
      if (route === "/sentinel/tasks/step") {
        send(res, 200, {
          ok: true,
          ...service.sentinel.reportStep(payload.taskId, payload),
        });
        return;
      }
      if (route === "/sentinel/tasks/progress") {
        send(res, 200, {
          ok: true,
          ...service.sentinel.reportProgress(payload.taskId, payload),
        });
        return;
      }
      if (route === "/sentinel/tasks/steps") {
        send(res, 200, {
          ok: true,
          steps: service.sentinel.stepsFor(payload.taskId),
        });
        return;
      }
      if (route === "/sentinel/tasks/priority") {
        send(res, 200, {
          ok: true,
          task: service.sentinel.setPriority(payload.taskId, payload.priority),
        });
        return;
      }
      if (route === "/sentinel/tasks/cancel") {
        send(res, 200, {
          ok: true,
          task: service.sentinel.cancelTask(payload.taskId, payload.reason),
        });
        return;
      }
      if (route === "/sentinel/tasks/proof") {
        send(res, 200, {
          ok: true,
          proof: service.sentinel.proofRecord(payload.taskId),
        });
        return;
      }
      if (route === "/sentinel/tasks/verifications") {
        send(res, 200, {
          ok: true,
          verifications: service.sentinel.verificationsFor(payload.taskId),
        });
        return;
      }
      if (route === "/sentinel/approvals/request") {
        send(res, 200, {
          ok: true,
          approval: service.sentinel.requestApproval(payload),
        });
        return;
      }
      if (route === "/sentinel/approvals/decide") {
        send(res, 200, {
          ok: true,
          approval: service.decideApproval(payload.approvalId, payload),
        });
        return;
      }
      // ---- Credential vault (names only ever leave the server) ----
      if (route === "/vault/status") {
        send(res, 200, service.vaultStatus());
        return;
      }
      if (route === "/vault/put") {
        send(res, 200, await service.vaultPut(payload));
        return;
      }
      if (route === "/vault/remove") {
        send(res, 200, await service.vaultRemove(payload));
        return;
      }
      // ---- Memory ----
      if (route === "/memory/status") {
        send(res, 200, service.memoryStatus());
        return;
      }
      if (route === "/memory/remember") {
        send(res, 200, service.memoryRemember(payload));
        return;
      }
      if (route === "/memory/forget") {
        send(res, 200, service.memoryForget(payload));
        return;
      }
      if (route === "/memory/clear") {
        send(res, 200, service.memoryClear(payload));
        return;
      }
      if (route === "/memory/enabled") {
        send(res, 200, service.memorySetEnabled(payload));
        return;
      }
      if (route === "/memory/export") {
        send(res, 200, service.memoryExport());
        return;
      }
      // ---- OVIA AI (records-only answers) ----
      if (route === "/ovia/ask") {
        send(res, 200, await service.oviaAsk(payload));
        return;
      }
      if (route === "/license/status") {
        send(res, 200, service.licenseStatus());
        return;
      }
      if (route === "/license/activate") {
        send(res, 200, service.activateLicense(payload));
        return;
      }
      if (route === "/license/remove") {
        send(res, 200, service.removeLicense());
        return;
      }
      if (route === "/stop") {
        send(res, 200, service.emergencyStop());
        return;
      }
      if (route === "/stop/clear") {
        send(res, 200, service.emergencyClear());
        return;
      }
      if (route === "/stop/status") {
        send(res, 200, service.emergencyStatus());
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
          service.startRemotePairing({ ...payload, port: serverPort }),
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
      if (route === "/remote/sentinel/status") {
        send(res, 200, await service.remoteSentinelStatus(payload.remoteToken));
        return;
      }
      if (route === "/remote/sentinel/cancel") {
        await service.remoteSentinelStatus(payload.remoteToken);
        send(res, 200, {
          ok: true,
          task: service.sentinel.cancelTask(payload.taskId, "mobile-remote"),
        });
        return;
      }
      if (route === "/remote/sentinel/priority") {
        await service.remoteSentinelStatus(payload.remoteToken);
        send(res, 200, {
          ok: true,
          task: service.sentinel.setPriority(payload.taskId, payload.priority),
        });
        return;
      }
      if (route === "/remote/sentinel/proof") {
        await service.remoteSentinelStatus(payload.remoteToken);
        send(res, 200, {
          ok: true,
          proof: service.sentinel.proofRecord(payload.taskId),
        });
        return;
      }
      if (route === "/remote/sentinel/decide") {
        send(res, 200, {
          ok: true,
          approval: service.remoteDecideApproval(
            payload.remoteToken,
            payload.approvalId,
            payload.decision,
          ),
        });
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
          error instanceof Error ? error.message : "Adapter request failed.",
      });
    }
  };
}
