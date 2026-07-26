// Fitness function: acd-assignment-worktree-path-scoped (milestone 35 / ADR-004,
// fitness #8) — "every worktree materialization joins the ONE defined mesh-worktrees
// root, keyed by assignmentId — no ad-hoc temp path."
//
// This is the ARCHITECTURE-named half of a single invariant shared with SECURITY's F4
// (acd-worktree-path-scoped, T4/T3b) — the second file (acd-worktree-path-scoped.
// test.mjs) enumerates/references THIS file's assertions rather than duplicating the
// assertion body (the repo's "enumerate the re-armed X" house style, e.g.
// acd-fleet-reclaim-guarded's re-arm of acd-run-reclaim-stale-only /
// acd-status-rollback-bounded).
//
// Proofs:
//  1. Structural — src/mesh-worktree.mjs's `git worktree add` target is built ONLY
//     from meshWorktreePath(projectRoot, assignmentId), which itself joins
//     meshWorktreesRoot (".aof/mesh/worktrees"); no os.tmpdir() join, no other
//     hand-built path feeds a `git worktree add` call.
//  2. Behavioural — for a valid ref, the resolved worktree path, normalised, is a
//     prefix-child of the dedicated root; a REAL `git worktree add` lands exactly
//     there.
//  Self-check (m03 non-vacuous): a planted `git worktree add` off an os.tmpdir() path
//  fails the SAME structural detector the real (scoped) source passes.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addWorktree, meshWorktreePath, isUnderMeshWorktreesRoot, removeWorktree } from "../../src/mesh-worktree.mjs";
import { withMeshWorkerExecFixture } from "../support/mesh-worker-exec-fixture.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const worktreeSourcePath = path.join(repoRoot, "src", "mesh-worktree.mjs");

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// Every `git worktree add`/`remove` call site must resolve its path argument through
// meshWorktreePath(...) — never a bare os.tmpdir()/path.join(os.tmpdir(), ...) feed.
function assertStructural(source) {
  const problems = [];
  const code = stripComments(source);
  if (!/function\s+meshWorktreePath\s*\(/.test(code)) {
    problems.push("no meshWorktreePath seam definition found");
  }
  if (!/meshWorktreePath\s*\(\s*projectRoot\s*,\s*assignmentId\s*\)/.test(code)) {
    problems.push("meshWorktreePath is never called with (projectRoot, assignmentId) at the add/remove call sites");
  }
  // The seam itself must derive from meshWorktreesRoot, which joins ".aof","mesh","worktrees".
  if (!/meshWorktreesRoot\s*\([^)]*\)/.test(code) || !/\.aof["'],\s*["']mesh["'],\s*["']worktrees["']/.test(code)) {
    problems.push("meshWorktreesRoot does not join .aof/mesh/worktrees");
  }
  // No os.tmpdir() usage anywhere in the module feeding a worktree path.
  if (/os\.tmpdir\s*\(/.test(code)) {
    problems.push("a bare os.tmpdir() reference exists in the worktree module");
  }
  return problems;
}

export const archTests = [
  {
    name: "arch/35 ADR-004 (acd-assignment-worktree-path-scoped): every worktree add/remove target is built from the ONE meshWorktreePath(assignmentId) seam under .aof/mesh/worktrees/ — never os.tmpdir() or a hand-built path (structural)",
    run: async () => {
      const source = await readFile(worktreeSourcePath, "utf8");
      const problems = assertStructural(source);
      assert.deepEqual(problems, [], `structural problems: ${JSON.stringify(problems)}`);
    },
  },
  {
    name: "arch/35 ADR-004 (acd-assignment-worktree-path-scoped): a real git worktree add lands EXACTLY at meshWorktreePath, a prefix-child of the dedicated root (behavioural)",
    run: async () => withMeshWorkerExecFixture(async ({ root, headSha }) => {
      const assignmentId = "arch-scoped-behavioural";
      const worktreePath = await addWorktree(root, assignmentId, headSha);
      try {
        assert.equal(worktreePath, meshWorktreePath(root, assignmentId));
        assert.ok(isUnderMeshWorktreesRoot(root, worktreePath), "the resolved path is a prefix-child of the dedicated mesh worktrees root");
      } finally {
        await removeWorktree(root, assignmentId, { force: true });
      }
    }),
  },
  {
    name: "arch/35 ADR-004 (acd-assignment-worktree-path-scoped): self-check — a planted worktree add off an os.tmpdir() path trips the SAME detector the real (scoped) source passes",
    run: async () => {
      const source = await readFile(worktreeSourcePath, "utf8");
      assert.deepEqual(assertStructural(source), [], "the real source is clean");

      const planted = `${source}\nimport os from "node:os";\nfunction plantedAdd(id) { return path.join(os.tmpdir(), id); }\n`;
      assert.ok(assertStructural(planted).length > 0, "a planted os.tmpdir() reference trips the detector");
    },
  },
];
