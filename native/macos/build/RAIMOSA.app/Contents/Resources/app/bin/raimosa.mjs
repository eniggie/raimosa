#!/usr/bin/env node
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startRaimosa } from "../server/standalone.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const MIN_NODE_MAJOR = 22; // node:sqlite ships built in from Node 22.

function parseArgs(argv) {
  const args = { port: process.env.RAIMOSA_PORT ?? 4173, open: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--port" || arg === "-p") args.port = argv[++i];
    else if (arg === "--no-open") args.open = false;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--version" || arg === "-v") args.version = true;
  }
  return args;
}

function openBrowser(url) {
  const [command, commandArgs] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    spawn(command, commandArgs, { stdio: "ignore", detached: true }).unref();
  } catch {
    // Opening a browser is a convenience, never a requirement.
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(`RAIMOSA AI — local desktop commander

  raimosa                 Start RAIMOSA and open it in your browser
  raimosa --port 5000     Use a specific port (default 4173)
  raimosa --no-open       Start without opening a browser
  raimosa --version       Print the version

RAIMOSA runs entirely on this machine. The adapter API accepts loopback
requests only; a paired phone is limited to your local network.`);
    return;
  }

  const pkg = JSON.parse(
    await fs.readFile(path.join(root, "package.json"), "utf8"),
  );
  if (args.version) {
    console.log(pkg.version);
    return;
  }

  const major = Number(process.versions.node.split(".")[0]);
  if (major < MIN_NODE_MAJOR) {
    console.error(
      `RAIMOSA needs Node ${MIN_NODE_MAJOR} or newer (found ${process.versions.node}).\n` +
        "Node 22+ ships the built-in SQLite used for the receipt ledger.\n" +
        "Install from https://nodejs.org and run this again.",
    );
    process.exitCode = 1;
    return;
  }

  const built = await fs
    .stat(path.join(root, "dist", "index.html"))
    .catch(() => null);
  if (!built) {
    console.error(
      "RAIMOSA interface assets are missing.\n" +
        "From a source checkout run: npm install && npm run build",
    );
    process.exitCode = 1;
    return;
  }

  const { url, port } = await startRaimosa({ port: args.port });
  console.log(`\n  RAIMOSA AI ${pkg.version}`);
  console.log(`  Running at ${url}`);
  console.log(`  Platform   ${process.platform} (${process.arch})`);
  console.log(`  Press Ctrl+C to stop.\n`);
  if (args.open) openBrowser(url);

  const shutdown = () => {
    console.log("\n  RAIMOSA stopped. Receipts are preserved on disk.");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  void port;
}

main().catch((error) => {
  console.error(`RAIMOSA failed to start: ${error.message}`);
  process.exitCode = 1;
});
