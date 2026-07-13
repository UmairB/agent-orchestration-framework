// Fitness function: acd-desktop-read-only-fleet (milestone 36 / ADR-004, fitness #3) —
// "The desktop app is strictly READ-ONLY over the fleet. It NEVER invokes a mesh
//  mutation — no `aof mesh assign`, no `aof mesh issue`, no `aof mesh revoke`, no
//  `aof mesh invite`/`join`. The only writes it performs are LOCAL process supervision
//  (spawning `aof mesh serve`/`aof mesh ui` on THIS machine). Assignment stays CLI-only
//  (`aof mesh assign`, milestone 35), never dispatched from this surface."
//
// GUARD-IF-PRESENT (refine, pre-build): a clean no-op while `app/desktop/` is absent;
// a hard assertion the moment the crate lands. Green now, RED-if-violated once built.
//
// Proof, over every `app/desktop/**/*.rs` (Rust comments stripped): NO mesh-MUTATING
// verb is ever spawned. The allow-list of spawnable `aof mesh` verbs is EXACTLY
// {status (read), serve (supervise), ui (supervise)}. A spawn of assign/issue/revoke/
// invite/join is a read-only violation.
//   Self-check (m03 non-vacuous): a planted `["mesh","assign", ...]` argv trips the
//   SAME detector; the allowed status/serve/ui spawns do NOT.
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DESKTOP_DIR = path.join(repoRoot, "app", "desktop");

// The fleet-MUTATING mesh verbs the read-only app must NEVER spawn — argv-array form
// (`["mesh","assign"`) and joined-string form (`mesh assign`).
const FORBIDDEN_MUTATION_VERBS = ["assign", "issue", "revoke", "invite", "join"];

function stripRustComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function detectMutation(source) {
  const stripped = stripRustComments(source);
  const hits = [];
  for (const verb of FORBIDDEN_MUTATION_VERBS) {
    const argvForm = new RegExp(`["']mesh["']\\s*,\\s*["']${verb}["']`);
    const strForm = new RegExp(`\\bmesh\\s+${verb}\\b`);
    if (argvForm.test(stripped) || strForm.test(stripped)) hits.push(`mesh ${verb}`);
  }
  return hits;
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
    name: "arch/36 ADR-004 (acd-desktop-read-only-fleet): the app NEVER spawns a mesh-mutating verb (assign/issue/revoke/invite/join) — read-only over the fleet (guard-if-present)",
    run: async () => {
      if (!(await dirExists(DESKTOP_DIR))) {
        assert.equal(await dirExists(DESKTOP_DIR), false, "app/desktop/ absent (pre-build); armed at build by story 00");
        return;
      }
      const files = await collectRustFiles(DESKTOP_DIR);
      assert.ok(files.length > 0, "the Rust subtree exists and was scanned (non-vacuous)");
      const offenders = [];
      for (const file of files) {
        const hits = detectMutation(await readFile(file, "utf8"));
        if (hits.length > 0) offenders.push({ file: path.relative(repoRoot, file), hits });
      }
      assert.deepEqual(offenders, [], `no mesh-mutating verb is spawned (read-only over the fleet), got: ${JSON.stringify(offenders)}`);
    },
  },
  {
    name: "arch/36 ADR-004 (acd-desktop-read-only-fleet): self-check — a planted `mesh assign`/`mesh issue` spawn trips the SAME detector; status/serve/ui do NOT (non-vacuous)",
    run: async () => {
      // The allowed spawns (read + local supervision) are clean.
      assert.deepEqual(detectMutation('args(["mesh","status","--json"]);\n'), [], "mesh status (read) is allowed");
      assert.deepEqual(detectMutation('args(["mesh","serve","--serve"]);\n'), [], "mesh serve (local supervision) is allowed");
      assert.deepEqual(detectMutation('args(["mesh","ui"]);\n'), [], "mesh ui (local supervision) is allowed");

      // The mutations are caught, both argv and string form.
      assert.ok(detectMutation('args(["mesh","assign","35/00","--to","worker-a"]);\n').length > 0, "a planted `mesh assign` spawn trips the detector");
      assert.ok(detectMutation('args(["mesh","issue","35/00"]);\n').length > 0, "a planted `mesh issue` spawn trips the detector");
      assert.ok(detectMutation('let cmd = format!("aof mesh revoke {}", node);\n').length > 0, "a planted string-form `mesh revoke` trips the detector");
    },
  },
];
