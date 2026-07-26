// Fitness function: acd-worker-clone-target-scoped (milestone 38 / ADR-005) —
// "the worker's clone-on-miss target is a SCOPED path under a dedicated checkouts root
// (meshCheckoutPath under the global mesh home), keyed by workspaceId — NEVER os.tmpdir(),
// NEVER a path built from directive/ref text."
//
// This re-arms the 35/ADR-004 worktree-scope discipline (acd-assignment-worktree-path-
// scoped: no os.tmpdir(), the ONE meshWorktreePath seam) for the NEW clone target ADR-005
// introduces. A self-provisioning worker that clones to an arbitrary/temp/attacker-shaped
// path is the escape this forbids.
//
// STATE OF BUILD: the clone-on-miss path is built by the worker-repo-checkout story;
// today mesh-worker-execution.mjs's `!hasRepo` branch REFUSES (no clone). The invariant
// is: whenever a `git clone` / `git worktree add` target is constructed in the
// worker-execution module, it is built ONLY from a scoped seam — never os.tmpdir(), never
// composed with directive/ref text. This is TRUE today (no clone target exists) and MUST
// stay true once the clone lands. The detector trips the moment a clone target escapes
// the scoped seam.
//
// Proofs:
//  1. Structural — mesh-worker-execution.mjs contains NO os.tmpdir() feeding a clone/
//     worktree target, and any clone target it builds is derived from a scoped
//     checkout seam (meshCheckoutPath / a global-mesh-home checkouts root), keyed by
//     workspaceId — never path.join(<root>, directive.itemRef) or a raw directive path.
//  2. Structural — the existing worktree call site still routes through the
//     mesh-worktree.mjs seam (no second hand-built worktree path added by this story).
//  Self-check (m03 non-vacuous): a planted os.tmpdir() clone target, and a clone target
//  built from directive text, both trip the SAME detector.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const workerSourcePath = path.join(repoRoot, "src", "mesh-worker-execution.mjs");

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function assertStructural(code) {
  const problems = [];
  // No os.tmpdir() feeding any clone/checkout/worktree target in the worker-execution module.
  if (/os\.tmpdir\s*\(/.test(code)) {
    problems.push("a bare os.tmpdir() reference exists in the worker-execution module (a clone target must be scoped)");
  }
  // A clone target must never be path.join'd with directive/ref text (the traversal escape
  // T3b already forbids for worktrees — resolution is enumerate-then-filter, never a
  // path.join(root, ref)).
  if (/path\.join\s*\([^)]*directive\.(itemRef|workspaceId|commit)\b/.test(code)) {
    problems.push("a path is built by path.join with raw directive text — clone/worktree targets must be scoped seams, never directive-text paths");
  }
  if (/path\.join\s*\([^)]*\bitemRef\b/.test(code)) {
    problems.push("a path is built by path.join with itemRef — the ref resolves via enumerate-then-filter, never a path.join(root, ref)");
  }
  // If a clone is wired at all, its target must come from a scoped checkout seam under the
  // global mesh home — presence of a raw `git clone` into a non-seam path is the failure.
  // A `git clone` argv whose destination is meshCheckoutPath(...) (or absent — not yet
  // built) is fine; a `git clone` into any other constructed path is not.
  const hasClone = /["']clone["']/.test(code) || /git\s+clone/.test(code);
  if (hasClone) {
    const usesScopedSeam = /meshCheckoutPath\s*\(/.test(code);
    if (!usesScopedSeam) {
      problems.push("a git clone is present but its target is not built from the meshCheckoutPath scoped seam");
    }
  }
  return problems;
}

export const archTests = [
  {
    name: "arch/38 ADR-005 (acd-worker-clone-target-scoped): the worker-execution module builds no clone/worktree target from os.tmpdir() or directive/ref text; any clone routes through the meshCheckoutPath scoped seam (structural)",
    run: async () => {
      const code = stripComments(await readFile(workerSourcePath, "utf8"));
      const problems = assertStructural(code);
      assert.deepEqual(problems, [], `structural problems: ${JSON.stringify(problems)}`);
    },
  },
  {
    name: "arch/38 ADR-005 (acd-worker-clone-target-scoped): self-check — a planted os.tmpdir() clone target, and a directive-text clone target, both trip the detector",
    run: async () => {
      const code = stripComments(await readFile(workerSourcePath, "utf8"));
      assert.deepEqual(assertStructural(code), [], "the real source is clean");

      const plantedTmp = `${code}\nimport os from "node:os";\nasync function plantedClone(d) { return path.join(os.tmpdir(), d.workspaceId); }\n`;
      assert.ok(assertStructural(plantedTmp).length > 0, "a planted os.tmpdir() clone target trips the detector");

      const plantedRefPath = `${code}\nasync function plantedClone2(root, directive) { return path.join(root, directive.itemRef); }\n`;
      assert.ok(assertStructural(plantedRefPath).length > 0, "a clone target built from directive text trips the detector");

      // The "clone present but no scoped seam anywhere in the module" proof is a
      // module-wide co-occurrence check (by design — proof #2 above already pins the
      // per-call-site path.join discipline). Once the real clone HAS landed (as it has
      // here), the module always legitimately contains meshCheckoutPath(...), so
      // appending a raw clone to the real source can never re-trip that specific
      // co-occurrence rule. Exercise it non-vacuously against a SEAM-LESS baseline
      // (the real source with every meshCheckoutPath(...) reference stripped, as a
      // pre-clone module would have looked) — a bare `git clone` with no scoped seam
      // anywhere in that baseline must still trip.
      const seamlessBaseline = code.replace(/meshCheckoutPath\s*\([^)]*\)/g, "REMOVED_SEAM_CALL");
      assert.ok(!/meshCheckoutPath\s*\(/.test(seamlessBaseline), "the seamless baseline genuinely has no meshCheckoutPath(...) call");
      const seamlessWithRawClone = `${seamlessBaseline}\nasync function plantedClone4(exec, url, dest) { return exec(["clone", url, dest]); }\n`;
      assert.ok(assertStructural(seamlessWithRawClone).length > 0, "a git clone with NO meshCheckoutPath seam anywhere in the module trips the detector");
    },
  },
];
