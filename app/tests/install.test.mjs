import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startRaimosa } from "../server/standalone.mjs";
import { capabilityCatalog } from "../server/ovia-core.mjs";

const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

test("the installed runtime serves the interface and the API without Vite", async () => {
  const { server, url } = await startRaimosa({ port: 4290, host: "127.0.0.1" });
  try {
    const page = await fetch(url);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type"), /text\/html/);
    assert.match(await page.text(), /RAIMOSA/i);

    // Client-side routes fall back to the app shell, not a 404.
    const deep = await fetch(`${url}/ledger`);
    assert.equal(deep.status, 200);

    const health = await fetch(`${url}/api/raimosa/health`);
    const body = await health.json();
    assert.equal(body.ok, true);
    assert.equal(body.platform, process.platform);
    assert.ok(Array.isArray(body.capabilities));

    // A real adapter call works over the installed runtime.
    const vitals = await fetch(`${url}/api/raimosa/tools/device-vitals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const vitalsBody = await vitals.json();
    assert.equal(vitalsBody.ok, true);
    assert.ok(vitalsBody.receipt.result.memory.totalBytes > 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("the standalone runtime refuses to serve files outside dist", async () => {
  const { server, url } = await startRaimosa({ port: 4291, host: "127.0.0.1" });
  try {
    // Escape attempts fall back to the app shell rather than leaking a file.
    const escaped = await fetch(`${url}/../package.json`);
    const text = await escaped.text();
    assert.ok(
      !text.includes('"devDependencies"'),
      "must not serve source files",
    );
    assert.match(text, /<!doctype html>/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("the package installs a raimosa command and declares its platforms", async () => {
  const pkg = JSON.parse(
    await fs.readFile(path.join(appRoot, "package.json"), "utf8"),
  );
  assert.equal(pkg.name, "raimosa");
  assert.equal(pkg.bin.raimosa, "bin/raimosa.mjs");
  assert.deepEqual(pkg.os, ["darwin", "linux", "win32"]);
  // node:sqlite is built in from Node 22; the engine floor must say so.
  assert.match(pkg.engines.node, />=22/);
  // Everything the installed runtime needs must ship in the package.
  for (const entry of ["bin", "server", "dist"])
    assert.ok(pkg.files.includes(entry), `${entry} must be published`);
  // Vite must not be a runtime dependency of the installed product.
  assert.equal(pkg.dependencies.vite, undefined);
  assert.ok(pkg.devDependencies.vite);

  const cli = await fs.readFile(
    path.join(appRoot, "bin", "raimosa.mjs"),
    "utf8",
  );
  assert.match(cli, /^#!\/usr\/bin\/env node/);
  const stat = await fs.stat(path.join(appRoot, "bin", "raimosa.mjs"));
  assert.ok(stat.mode & 0o111, "the CLI must be executable");
});

test("no capability claims an adapter built for a different operating system", () => {
  const required = { macos: "darwin", linux: "linux", windows: "win32" };
  for (const item of capabilityCatalog) {
    if (item.status !== "available" || !item.adapter) continue;
    const needs = required[item.adapter.split("-")[0]];
    if (!needs) continue;
    assert.equal(
      needs,
      process.platform,
      `${item.id} exposes a ${needs} adapter on ${process.platform}`,
    );
  }
  // Cross-platform capabilities must be available on every desktop we support.
  for (const id of ["local-notification", "open-document"]) {
    const item = capabilityCatalog.find((entry) => entry.id === id);
    assert.equal(item.status, "available");
    assert.ok(item.adapter);
  }
});
