import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

let cached;
// Mint a genuine RAIMOSA Pro key (via the real signing CLI) once per run, so
// tests that exercise Pro tools can unlock them the way a buyer would.
export function proKey() {
  if (!cached) {
    const out = execFileSync(
      "node",
      [path.join(repoRoot, "tools/sign-license.mjs"), "tests@econteur.com"],
      { encoding: "utf8" },
    );
    cached = out
      .split("\n")
      .find((l) => l.trim().startsWith("RAIMOSA-"))
      .trim();
  }
  return cached;
}
