// Fitness function: acd-worker-checkout-reuses-worktree (milestone 38 / ADR-006) —
// "the worker-repo-checkout story introduces NO second `git worktree add` call site
// outside the mesh-worktree.mjs addWorktree seam" — re-arming the m35 worktree-scope
// invariant (acd-assignment-worktree-path-scoped) against a regression from THIS
// milestone's clone-on-miss work.
//
// ARCHITECTURE 38/ADR-006: worker-worktrees has ZERO net-new work — clone-on-miss
// (ADR-005) is a PREFIX before the existing m35 addWorktree->run flow, never a second
// worktree implementation. The ONLY place `git worktree add` may ever be spawned is
// inside mesh-worktree.mjs's addWorktree(); mesh-worker-execution.mjs (this
// milestone's clone/register/fall-through module) may CALL that seam but must never
// spawn `worktree add` itself.
//
// Proofs:
//  1. Structural — src/mesh-worktree.mjs is the ONLY module containing a literal
//     `"worktree", "add"` (or `worktree add`) argv shape.
//  2. Structural — src/mesh-worker-execution.mjs calls addWorktree(...) (the existing
//     m35 seam) and contains NO second `"worktree"` / `"add"` argv pairing of its own.
//  3. Structural — the ARCHITECTURE #8 sibling (acd-assignment-worktree-path-scoped)
//     stays registered in the suite — this file re-arms it, never duplicates its body
//     (the repo's "enumerate the re-armed X" house style).
//  Self-check (m03 non-vacuous): a planted SECOND `git worktree add` call site inside
//  mesh-worker-execution.mjs trips the detector; the real (single-seam) source does not.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const workerSourcePath = path.join(repoRoot, "src", "mesh-worker-execution.mjs");
const worktreeSourcePath = path.join(repoRoot, "src", "mesh-worktree.mjs");
const testSuitePath = path.join(repoRoot, "scripts", "test.mjs");

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// A "worktree add" argv shape: two adjacent argv-array string literals "worktree",
// "add" (allowing for --detach etc between/after), OR the shell-form "worktree add".
const WORKTREE_ADD_PATTERN = /["']worktree["']\s*,\s*["']add["']|worktree\s+add\b/;

function callsAddWorktreeSeam(code) {
  return /\baddWorktree\s*\(/.test(code);
}

export const archTests = [
  {
    name: "arch/38 ADR-006 (acd-worker-checkout-reuses-worktree): mesh-worktree.mjs is the ONLY module that spawns `git worktree add`",
    run: async () => {
      const worktreeSource = stripComments(await readFile(worktreeSourcePath, "utf8"));
      assert.ok(WORKTREE_ADD_PATTERN.test(worktreeSource), "mesh-worktree.mjs still contains the ONE worktree-add call site");
    },
  },
  {
    name: "arch/38 ADR-006 (acd-worker-checkout-reuses-worktree): mesh-worker-execution.mjs calls the EXISTING addWorktree seam and introduces NO second `git worktree add` call site (structural)",
    run: async () => {
      const workerSource = stripComments(await readFile(workerSourcePath, "utf8"));
      assert.ok(callsAddWorktreeSeam(workerSource), "mesh-worker-execution.mjs calls addWorktree(...) — the existing m35 seam");
      assert.ok(!WORKTREE_ADD_PATTERN.test(workerSource), "no second `worktree add` argv shape exists inside mesh-worker-execution.mjs itself — clone-on-miss is a prefix, not a second worktree implementation");
    },
  },
  {
    name: "arch/38 ADR-006 (acd-worker-checkout-reuses-worktree): the ARCHITECTURE #8 sibling (acd-assignment-worktree-path-scoped) is registered — re-armed, not duplicated",
    run: async () => {
      const suite = await readFile(testSuitePath, "utf8");
      assert.ok(
        suite.includes("test/arch/acd-assignment-worktree-path-scoped.test.mjs"),
        "acd-assignment-worktree-path-scoped is imported into the registered suite (the ONE-worktree-seam invariant this file re-arms against a clone-on-miss regression)",
      );
    },
  },
  {
    name: "arch/38 ADR-006 (acd-worker-checkout-reuses-worktree): self-check — a planted SECOND `git worktree add` call site inside mesh-worker-execution.mjs trips the detector; the real (single-seam) source does not",
    run: async () => {
      const workerSource = stripComments(await readFile(workerSourcePath, "utf8"));
      assert.ok(!WORKTREE_ADD_PATTERN.test(workerSource), "the real source has no second worktree-add call site");

      const plantedSecondSeam = `${workerSource}\nasync function plantedSecondWorktreeAdd(exec, dest, commitish) { return exec(["worktree", "add", "--detach", dest, commitish]); }\n`;
      assert.ok(WORKTREE_ADD_PATTERN.test(plantedSecondSeam), "a planted second `worktree add` call site trips the detector");
    },
  },
];
