import { createApiHandler } from "./api-router.mjs";

// Development host for the adapter API. The routing, guards, and adapters all
// live in api-router.mjs so the dev server and the installed standalone
// runtime execute the same code path.
export function raimosaLocalTools() {
  return {
    name: "raimosa-local-tools",
    configureServer(server) {
      const handleApiRequest = createApiHandler({
        getPort: () =>
          server.config.server.port ??
          server.httpServer?.address()?.port ??
          4173,
      });
      server.middlewares.use("/api/raimosa", handleApiRequest);
    },
  };
}
