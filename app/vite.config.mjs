import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import os from "node:os";
import { raimosaLocalTools } from "./server/raimosa-plugin.mjs";

const localHosts = Object.values(os.networkInterfaces())
  .flatMap((addresses) => addresses ?? [])
  .filter((address) => address.family === "IPv4")
  .map((address) => address.address);

export default defineConfig({
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["localhost", ...localHosts],
    strictPort: true,
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [raimosaLocalTools(), react()],
});
