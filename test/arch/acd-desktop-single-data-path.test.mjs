// Fitness function: acd-desktop-single-data-path (milestone 36 / ADR-004, fitness #2) —
// "The supervisor reaches fleet data through EXACTLY ONE aof command: `aof mesh status`.
//  No second fleet-data command (no `aof mesh identity`, no direct read of aof's git
//  records / config, no second projection query) — the m25 single-data-command
//  discipline, carried forward to the native face."
//
// GUARD-IF-PRESENT (refine, pre-build): a clean no-op while `app/desktop/` is absent;
// a hard assertion the moment the crate lands. Green now, RED-if-violated once built.
//
// Proof, over every `app/desktop/**/*.rs` (Rust comments stripped):
//  1. The ONLY `aof mesh <verb>` invocation that reads FLEET DATA is `mesh status`.
//     `mesh serve` (supervised process) and `mesh ui` (supervised process) are process
//     LIFECYCLE spawns, not data reads — allowed. `mesh identity`/`mesh sync`/any other
//     data-bearing read verb is forbidden as a SECOND data path.
//  2. No Rust source builds a path into aof's on-disk record store to read fleet state
//     directly (`.aof/mesh/nodes`, `.aof/aof.config.json`) — the data path is the
//     command, not the file system.
//  3. Self-check (m03 non-vacuous): a planted `["mesh","identity"]` argv or a planted
//     `.aof/mesh/nodes` path read trips the SAME detector the real (clean/absent) tree
//     passes; a legitimate `["mesh","status","--json"]` does NOT.
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DESKTOP_DIR = path.join(repoRoot, "app", "desktop");

// A SECOND fleet-data read path — either a data-bearing mesh verb other than `status`,
// or a direct read of aof's on-disk record/config store.
const FORBIDDEN_SECOND_DATA_PATH = [
  // a data-bearing mesh read verb other than `status` (argv array form or a joined
  // command string) — `identity`/`sync` read/write fleet records, not the app's job.
  /["']mesh["']\s*,\s*["']identity["']/,
  /["']mesh["']\s*,\s*["']sync["']/,
  /\bmesh\s+identity\b/,
  /\bmesh\s+sync\b/,
  // a direct read of aof's record/config store (the data path is the command, not fs)
  /\.aof[\/\\]mesh[\/\\]nodes/,
  /\.aof[\/\\]aof\.config\.json/,
];

function stripRustComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function detectSecondDataPath(source) {
  const stripped = stripRustComments(source);
  return FORBIDDEN_SECOND_DATA_PATH.filter((re) => re.test(stripped)).map((re) => re.source);
}

async function dirExists(dir) {
  try { return (await stat(dir)).isDirectory(); } catch { return false; }
}

async function collectRustFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "target") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collectRustFiles(full)));
    else if (entry.isFile() && entry.name.endsWith(".rs")) out.push(full);
  }
  return out;
}

export const archTests = [
  {
    name: "arch/36 ADR-004 (acd-desktop-single-data-path): fleet data is read ONLY via `aof mesh status` — no second data command, no direct record-store read (guard-if-present)",
    run: async () => {
      if (!(await dirExists(DESKTOP_DIR))) {
        assert.equal(await dirExists(DESKTOP_DIR), false, "app/desktop/ absent (pre-build); armed at build by story 00");
        return;
      }
      const files = await collectRustFiles(DESKTOP_DIR);
      assert.ok(files.length > 0, "the Rust subtree exists and was scanned (non-vacuous)");
      const offenders = [];
      let sawStatus = false;
      for (const file of files) {
        const source = await readFile(file, "utf8");
        const stripped = stripRustComments(source);
        if (/["']mesh["']\s*,\s*["']status["']/.test(stripped) || /\bmesh\s+status\b/.test(stripped)) sawStatus = true;
        const violations = detectSecondDataPath(source);
        if (violations.length > 0) offenders.push({ file: path.relative(repoRoot, file), violations });
      }
      assert.deepEqual(offenders, [], `no second fleet-data path exists, got: ${JSON.stringify(offenders)}`);
      // Non-vacuity: the ONE data path must actually be present once the app is built.
      assert.ok(sawStatus, "the supervisor invokes `aof mesh status` (the single fleet-data path is present)");
    },
  },
  {
    name: "arch/36 ADR-004 (acd-desktop-single-data-path): self-check — a planted second data command / direct record read trips the SAME detector (non-vacuous)",
    run: async () => {
      const clean = 'Command::new(aof).args(["mesh","status","--json"]).output();\n';
      assert.deepEqual(detectSecondDataPath(clean), [], "the single `mesh status` data path is not flagged");

      assert.ok(detectSecondDataPath('Command::new(aof).args(["mesh","identity","--json"]);\n').length > 0, "a planted `mesh identity` second data read trips the detector");
      assert.ok(detectSecondDataPath('let p = home.join(".aof/mesh/nodes");\n').length > 0, "a planted direct record-store read trips the detector");
      assert.ok(detectSecondDataPath('let cfg = home.join(".aof/aof.config.json");\n').length > 0, "a planted direct config read trips the detector");

      // `mesh serve` / `mesh ui` are process-lifecycle spawns, NOT data reads — allowed.
      assert.deepEqual(detectSecondDataPath('Command::new(aof).args(["mesh","serve","--serve"]);\n'), [], "supervising `mesh serve` is a lifecycle spawn, not a data path");
      assert.deepEqual(detectSecondDataPath('Command::new(aof).args(["mesh","ui"]);\n'), [], "supervising `mesh ui` is a lifecycle spawn, not a data path");
    },
  },
];
