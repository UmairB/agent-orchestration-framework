// Fitness function: acd-gate-propagation-never-discards (milestone 43 / ADR-008) —
//
//   "Gate propagation advances the item branch by fast-forward when possible and a real
//    MERGE otherwise — NEVER a rebase, a force-update or a reset. No worker commit is
//    ever discarded. A conflicting merge is aborted and refused, never left half-applied."
//
// WHY an ABSENCE is the right shape of guard. The gap is exact and is stated in the source
// itself (mesh-worker-execution.mjs:2369-2375): "The reuse doors ignore it by design: an
// existing line continues from where it is." Closing it means running a git operation
// against a branch that already carries the worker's commits — and every CONVENIENT way to
// do that destroys them: `rebase` rewrites the worker's history, `push --force` /
// `reset --hard` / `checkout -B` / `branch -f` / `update-ref` discard it outright. No
// scenario can prove an absence; a source guard can.
//
// The baseline is clean at HEAD and worth locking before the story lands: the only force
// in the path is `git worktree remove --force` (removing a WORKTREE, not a branch —
// sanctioned, and excluded from the detector by name), the only reset is a path-scoped
// `git reset -q -- .aof`, and the only push is a plain `git push origin <branch>`
// (mesh-worker-execution.mjs:583).
//
// Proofs:
//  1. GREEN — no history-rewriting or force git operation exists in the branch-advance
//     path (mesh-worktree.mjs, mesh-worker-execution.mjs, mesh-recovery-push.mjs).
//  2. ARMED — once a `merge` verb appears in mesh-worktree.mjs (the module that owns every
//     git verb, ADR-008's required home), an abort path must exist beside it: a conflicting
//     merge is `--abort`ed, never left for an agent to start a phase on.
//  Self-check (m03 non-vacuous): each forbidden form trips the detector, and the two
//  sanctioned forms (worktree remove --force, a path-scoped reset) do not.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// The modules that may run git against the item branch.
const BRANCH_PATH_MODULES = [
  path.join("src", "mesh-worktree.mjs"),
  path.join("src", "mesh-worker-execution.mjs"),
  path.join("src", "mesh-recovery-push.mjs"),
];
const WORKTREE = path.join(repoRoot, "src", "mesh-worktree.mjs");

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// Every git argv array in the module (the repo's exec seam is argv-only, never a shell
// string — mesh-worktree.mjs's own rule), flattened to a scannable token list.
function gitArgvTokens(code) {
  const groups = [];
  const re = /\[\s*((?:"[^"]*"|'[^']*'|`[^`]*`|[^[\]])*?)\s*\]/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    const tokens = [...m[1].matchAll(/["'`]([^"'`]*)["'`]/g)].map((t) => t[1]);
    if (tokens.length > 0) groups.push(tokens);
  }
  return groups;
}

// Forbidden = any git invocation that can DISCARD a commit. `worktree remove --force` is
// sanctioned by name (it removes a worktree, not history); `reset -- <path>` is a
// path-scoped unstage, not `reset --hard`.
function discardingOps(tokenGroups) {
  const found = [];
  for (const tokens of tokenGroups) {
    const verb = tokens.find((t) => /^[a-z][a-z-]*$/.test(t)) ?? "";
    const joined = tokens.join(" ");
    if (tokens.includes("rebase")) found.push(`rebase: ${joined}`);
    if (tokens.includes("--hard")) found.push(`reset --hard: ${joined}`);
    if (tokens.includes("update-ref")) found.push(`update-ref: ${joined}`);
    if (tokens.includes("checkout") && tokens.includes("-B")) found.push(`checkout -B: ${joined}`);
    if (tokens.includes("branch") && (tokens.includes("-f") || tokens.includes("--force"))) found.push(`branch -f: ${joined}`);
    if (tokens.includes("push") && (tokens.includes("--force") || tokens.includes("--force-with-lease") || tokens.includes("-f"))) {
      found.push(`force push: ${joined}`);
    }
    // A bare `--force` is only sanctioned on `worktree remove`.
    if (tokens.includes("--force") && !(verb === "worktree" && tokens.includes("remove"))) {
      if (!found.some((f) => f.endsWith(joined))) found.push(`unsanctioned --force: ${joined}`);
    }
  }
  return found;
}

export const archTests = [
  {
    name: "arch/43 ADR-008 (acd-gate-propagation-never-discards): no history-rewriting or force git operation exists on the branch-advance path — a worker commit can never be discarded",
    run: async () => {
      const offenders = [];
      for (const rel of BRANCH_PATH_MODULES) {
        const code = stripComments(await readFile(path.join(repoRoot, rel), "utf8"));
        for (const hit of discardingOps(gitArgvTokens(code))) offenders.push(`${rel} — ${hit}`);
      }
      assert.deepEqual(
        offenders,
        [],
        `the branch advance must never rebase/force/reset (ADR-008) — offenders: ${JSON.stringify(offenders)}`,
      );
    },
  },
  {
    name: "arch/43 ADR-008 (acd-gate-propagation-never-discards): ARMED — once mesh-worktree.mjs runs a `merge`, a `--abort` path exists beside it (a conflicted tree is never handed to an agent)",
    run: async () => {
      const code = stripComments(await readFile(WORKTREE, "utf8"));
      const groups = gitArgvTokens(code);
      const merges = groups.filter((tokens) => tokens.includes("merge") && !tokens.includes("--abort"));
      if (merges.length === 0) return; // pre-build: a clean skip that arms the moment the advance lands

      const aborts = groups.filter((tokens) => tokens.includes("merge") && tokens.includes("--abort"));
      assert.ok(
        aborts.length > 0,
        "src/mesh-worktree.mjs performs a merge with no `git merge --abort` path — a conflicting advance must abort cleanly and refuse (assignment-gate-propagation-conflict), never leave a half-merged tree for an agent to start a phase on",
      );
      // The advance must also be able to take the cheap door when it exists.
      assert.ok(
        groups.some((tokens) => tokens.includes("--ff-only")) || /ff-only/.test(code),
        "src/mesh-worktree.mjs merges without ever attempting --ff-only — the fast-forward case must not create a merge commit it does not need",
      );
    },
  },
  {
    name: "arch/43 ADR-008 (acd-gate-propagation-never-discards): self-check — every forbidden form trips the detector; `worktree remove --force` and a path-scoped reset do not",
    run: async () => {
      assert.ok(discardingOps([["rebase", "origin/main"]]).length > 0, "rebase trips the detector");
      assert.ok(discardingOps([["reset", "--hard", "HEAD~1"]]).length > 0, "reset --hard trips the detector");
      assert.ok(discardingOps([["push", "--force", "origin", "aof/mesh/43"]]).length > 0, "force push trips the detector");
      assert.ok(discardingOps([["push", "--force-with-lease", "origin", "aof/mesh/43"]]).length > 0, "force-with-lease trips the detector");
      assert.ok(discardingOps([["checkout", "-B", "aof/mesh/43", "origin/main"]]).length > 0, "checkout -B trips the detector");
      assert.ok(discardingOps([["branch", "-f", "aof/mesh/43", "HEAD"]]).length > 0, "branch -f trips the detector");
      assert.ok(discardingOps([["update-ref", "refs/heads/aof/mesh/43", "HEAD"]]).length > 0, "update-ref trips the detector");

      assert.deepEqual(discardingOps([["worktree", "remove", "--force", "/path"]]), [], "worktree remove --force is sanctioned (a worktree, not history)");
      assert.deepEqual(discardingOps([["reset", "-q", "--", ".aof"]]), [], "a path-scoped reset is sanctioned");
      assert.deepEqual(discardingOps([["merge", "--ff-only", "abc123"]]), [], "a fast-forward merge is the sanctioned advance");
      assert.deepEqual(discardingOps([["merge", "--no-ff", "abc123"]]), [], "a real merge is the sanctioned fallback (nothing is lost)");
      assert.deepEqual(discardingOps([["push", "origin", "aof/mesh/43"]]), [], "the existing plain push is untouched");

      // The argv extractor sees the module's real call forms.
      const sample = 'const args = ["worktree", "add", "-b", options.branch, worktreePath, commitish];';
      const tokens = gitArgvTokens(sample);
      assert.ok(tokens.some((g) => g.includes("worktree") && g.includes("add")), "the argv extractor reads a real git argv array");
    },
  },
];
