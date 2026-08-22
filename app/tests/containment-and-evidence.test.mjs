import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

import { createDesktopToolService } from "../server/desktop-tools.mjs";
import { createStateStore } from "../server/state-store.mjs";
import { proKey } from "./helpers.mjs";

async function sandbox(name) {
  const base = path.join(
    os.tmpdir(),
    `raimosa-${name}-${randomUUID().slice(0, 8)}`,
  );
  const home = path.join(base, "home");
  const root = path.join(base, "workspace");
  const outside = path.join(base, "outside");
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(outside, { recursive: true });
  return { base, home, root, outside };
}

const open = (paths) =>
  createDesktopToolService({ home: paths.home, workspace: paths.root });

// A symlink planted inside an approved folder must never let RAIMOSA act on,
// or report, anything outside the folder the owner actually approved.
test("a symlink inside an approved root cannot move files out of it", async () => {
  const paths = await sandbox("escape");
  const service = open(paths);
  service.activateLicense({ key: proKey() });
  const access = service.startAccess({ duration: 300, confirmed: true });

  await fs.writeFile(path.join(paths.root, "photo.jpg"), "victim data");
  // Pre-plant the category folder as a link pointing outside the root.
  await fs.mkdir(path.join(paths.root, "RAIMOSA Organized"), {
    recursive: true,
  });
  await fs.symlink(
    paths.outside,
    path.join(paths.root, "RAIMOSA Organized", "Images"),
  );

  const plan = await service.handle("plan-organization", {
    root: paths.root,
    accessToken: access.session.token,
  });
  await assert.rejects(
    () =>
      service.handle("execute-organization", {
        approvalId: plan.result.approvalId,
        confirmation: "MOVE",
        accessToken: access.session.token,
      }),
    /leaves the approved folder/,
  );
  // The file must still be where the owner left it.
  assert.deepEqual(await fs.readdir(paths.outside), []);
  assert.ok((await fs.readdir(paths.root)).includes("photo.jpg"));
  service.closeLedger();
});

test("folder listings never report files outside the approved root", async () => {
  const paths = await sandbox("walkleak");
  const service = open(paths);
  await fs.writeFile(path.join(paths.outside, "secret.txt"), "SECRET OUTSIDE");
  await fs.writeFile(path.join(paths.root, "ok.txt"), "fine");
  await fs.symlink(
    path.join(paths.outside, "secret.txt"),
    path.join(paths.root, "leak.txt"),
  );
  await fs.symlink(paths.outside, path.join(paths.root, "leakdir"));

  const found = await service.handle("find-files", {
    root: paths.root,
    query: "",
  });
  const names = found.result.files.map((f) => f.name);
  assert.ok(names.includes("ok.txt"));
  assert.ok(
    !names.includes("leak.txt"),
    "a symlink out of the root must not be listed",
  );
  assert.ok(
    !names.includes("leakdir"),
    "a linked directory out of the root must not be listed",
  );

  const summary = await service.handle("summarize-folder", {
    root: paths.root,
  });
  assert.equal(
    summary.result.files,
    1,
    "only the genuinely in-root file counts",
  );
  service.closeLedger();
});

// `verified` is evidence. It must mean RAIMOSA observed the result.
test("dispatch-only adapters do not claim a verified result", async () => {
  const paths = await sandbox("evidence");
  const service = open(paths);
  service.activateLicense({ key: proKey() });
  const access = service.startAccess({ duration: 300, confirmed: true });

  const note = await service.handle("local-notification", {
    message: "audit check",
    accessToken: access.session.token,
  });
  assert.equal(
    note.verified,
    false,
    "a posted notification cannot be observed from here",
  );
  assert.match(note.result.state, /request-accepted/);

  // A real read is genuinely verified.
  const vitals = await service.handle("device-vitals", {});
  assert.equal(vitals.verified, true);
  service.closeLedger();
});

test("an approved plan is rejected if its operations no longer match its hash", async () => {
  const paths = await sandbox("planhash");
  const stateFile = path.join(paths.base, "state.db");
  const service = createDesktopToolService({
    home: paths.home,
    workspace: paths.root,
    stateFile,
  });
  service.activateLicense({ key: proKey() });
  const access = service.startAccess({ duration: 300, confirmed: true });
  await fs.writeFile(path.join(paths.root, "note.txt"), "hello");

  const plan = await service.handle("plan-organization", {
    root: paths.root,
    accessToken: access.session.token,
  });
  assert.ok(plan.result.hash, "the plan publishes a fingerprint");

  // Rewrite the stored plan the way a tampered state file would, leaving the
  // approved fingerprint untouched. The executor must refuse it.
  const store = createStateStore(stateFile);
  const stored = store.getApproval(plan.result.approvalId);
  assert.ok(stored, "the approval is durable");
  store.putApproval({
    ...stored,
    operations: [
      ...stored.operations,
      { type: "move", source: "note.txt", destination: "elsewhere/note.txt" },
    ],
  });

  await assert.rejects(
    () =>
      service.handle("execute-organization", {
        approvalId: plan.result.approvalId,
        confirmation: "MOVE",
        accessToken: access.session.token,
      }),
    /approved fingerprint/,
  );
  // And the smuggled operation never ran.
  assert.ok(!(await fs.readdir(paths.root)).includes("elsewhere"));
  service.closeLedger();
});
