// test/gate-propagation-refusals-leave-branch.test.mjs — traceability for milestone 43 /
// story 05 (gate-time propagation), task
//   wiki/work/43_milestone_mesh-artifact-authority/stories/05_story_gate-propagation/
//     tasks/01_advance-refusals-leave-the-branch-untouched.feature
//
// The two preconditions of the advance, each a LOUD CODED REFUSAL that leaves the branch
// byte-unchanged: `assignment-gate-propagation-dirty-worktree` (never check out or merge
// over uncommitted work) and `assignment-gate-propagation-conflict` (a conflicting merge is
// `git merge --abort`ed, because handing an agent a half-merged tree is strictly worse than
// not propagating). Every Then is read back from real git state after the dispatch returns —
// the branch tip against a hash captured BEFORE, `git status --porcelain`, the absence of
// MERGE_HEAD, the working files' BYTES — plus the settled assignment state and code from the
// recorded status/effect frames.
//
// ALTITUDE (the feature's own FEASIBILITY NOTE + ADR-010 R5.2, honoured rather than worked
// around): the dispatch path ALWAYS materializes a FRESH worktree (`reuseWorktreeOnBranch`
// releases any holder, prunes, then `git worktree add`), so a dirty tree is not reachable at
// dispatch altitude by ordinary means. This file therefore exercises the dirty guard TWICE,
// and neither is a substitute for the other:
//   (a) at the SEAM's own altitude — `advanceBranchToBase` called directly against a
//       worktree the fixture dirtied, which is where the guard lives and the only altitude
//       at which its byte-level "untouched" proof is meaningful; and
//   (b) at DISPATCH altitude — the uncommitted work is planted through the injected exec
//       seam at the instant the worktree is materialized (the moment an operator's leftovers
//       would already be there), so the settle/never-spawn/retain half of the contract is
//       proven through the real handler exactly as the scenario words it.
// The conflict refusal is routinely reachable at dispatch altitude and is driven there.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { meshWorktreePath, listWorktrees, advanceBranchToBase } from "../src/mesh-worktree.mjs";
import {
  withGatePropagationFixture,
  buildItemLine,
  createGateDispatch,
  recordingGitExec,
  dirtyWorktree,
  captureWorktreeState,
  git,
  gitOk,
  revParse,
  isAncestor,
  settledFrame,
  GATE_EDITED_PATH,
  CONTESTED_PATH,
  DOOMED_PATH,
} from "./support/gate-propagation-fixture.mjs";

const NOW = "2026-08-04T09:00:00.000Z";
const DIRTY = "assignment-gate-propagation-dirty-worktree";
const CONFLICT = "assignment-gate-propagation-conflict";

// mergeHeadAbsent(cwd) — `git rev-parse -q --verify MERGE_HEAD` exits non-zero: the repo is
// NOT left in a MERGING state.
function mergeHeadAbsent(cwd) {
  return git(cwd, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]).status !== 0;
}

// unmergedEntries(cwd) — the `U*` / `*U` / `AA` / `DD` porcelain lines a half-applied merge
// would leave behind.
function unmergedEntries(cwd) {
  return git(cwd, ["status", "--porcelain"]).stdout
    .split(/\r?\n/)
    .filter((line) => /^(U.|.U|AA|DD)/.test(line));
}

// conflictMarkersAnywhere(dir) — a real recursive scan of the worktree's files (never a
// single named path): `<<<<<<<`, `=======`, `>>>>>>>` must exist NOWHERE after the abort.
async function conflictMarkersAnywhere(dir) {
  const hits = [];
  const walk = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === ".aof" || entry.name === "node_modules") continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      const body = await readFile(full, "utf8").catch(() => "");
      if (/^<{7}/m.test(body) || /^={7}$/m.test(body) || /^>{7}/m.test(body)) hits.push(full);
    }
  };
  await walk(dir);
  return hits;
}

// plantDirt(worktreePath, mode) — the dispatch-altitude hook: the uncommitted work appears
// the instant the worktree is materialized, and the BEFORE snapshot is taken right there,
// so "identical to the capture" is a real comparison rather than a re-derivation.
function plantDirt(worktreePath, mode, box) {
  return async () => {
    if (!existsSync(worktreePath) || box.planted) return;
    box.planted = true;
    await dirtyWorktree(worktreePath, { mode });
    box.before = await captureWorktreeState(worktreePath);
  };
}

export const gatePropagationRefusalsTests = [
  // ------------------------------------------------------------------
  // Scenario: uncommitted work in the tree refuses the advance and survives it untouched
  // ------------------------------------------------------------------
  {
    name: "task01/43-05 advance-refusals: uncommitted work refuses the advance with `assignment-gate-propagation-dirty-worktree` and survives it byte-untouched — at the seam's own altitude AND through the real dispatch",
    run: async () => withGatePropagationFixture(async (fx) => {
      const shape = await buildItemLine(fx, { cutFrom: "C1", workerCommits: 2 });
      const worktreePath = meshWorktreePath(fx.root, "asg-dirty");
      const box = { planted: false, before: null };
      const exec = recordingGitExec([], { afterWorktreeAdd: plantDirt(worktreePath, "all", box) });

      const { frames } = await createGateDispatch(fx, fx.ws)("asg-dirty", { commit: shape.C2, exec, now: NOW });

      // (a) the settle — through the real handler, exactly as the scenario words it
      const failed = settledFrame(frames, "asg-dirty", "failed");
      assert.equal(failed?.code, DIRTY, "the assignment settles `failed` with code assignment-gate-propagation-dirty-worktree");

      // (b) the branch — unchanged from the hash captured BEFORE the dispatch
      assert.equal(revParse(fx.root, shape.branch), shape.tipBefore, "git rev-parse <branch> equals the hash captured before the dispatch");

      // (c) the operator's uncommitted bytes — the one thing git itself cannot recover
      const after = await captureWorktreeState(worktreePath);
      assert.ok(box.before != null, "the fixture captured the worktree state at the moment the dirt was planted");
      assert.equal(after.status, box.before.status, "git status --porcelain in the worktree is identical to the capture before the advance");
      assert.equal(after.tracked, box.before.tracked, "the modified tracked file's bytes on disk are identical");
      assert.equal(after.untracked, box.before.untracked, "the untracked file is still present with identical bytes");
      assert.ok(String(after.untracked ?? "").length > 0, "…and it is genuinely still there, not merely equal-and-absent");

      assert.equal(mergeHeadAbsent(worktreePath), true, "git rev-parse -q --verify MERGE_HEAD exits non-zero — no merge was ever begun");
      assert.notEqual(git(fx.root, ["cat-file", "-e", `${shape.branch}:${GATE_EDITED_PATH}`]).status, 0, "git cat-file -e <branch>:<the-gate-edited-path> exits non-zero — the gate edit did NOT arrive");

      // (d) the SEAM's own altitude — the guard called directly against a dirty worktree,
      // the altitude ADR-010 R5.2 requires it to be exported and callable at.
      const direct = await advanceBranchToBase(worktreePath, shape.C2, {});
      assert.equal(direct.outcome, "refused", "advanceBranchToBase refuses outright");
      assert.equal(direct.code, DIRTY, "…with the dirty-worktree code");
      assert.equal(direct.tip, shape.tipBefore, "…reporting the branch tip unchanged");
      assert.equal(direct.base, shape.C2, "…and the pinned base it refused to advance to");
      const afterDirect = await captureWorktreeState(worktreePath);
      assert.equal(afterDirect.status, box.before.status, "the direct call left the porcelain status identical too");
      assert.equal(afterDirect.tracked, box.before.tracked, "…and the tracked file's bytes");
    }),
  },

  // ------------------------------------------------------------------
  // Scenario: a conflicting merge is aborted and the branch is left byte-unchanged
  // ------------------------------------------------------------------
  {
    name: "task01/43-05 advance-refusals: a conflicting merge is `git merge --abort`ed and refused — the branch is byte-unchanged, the repo is not MERGING, and no conflict marker exists anywhere",
    run: async () => withGatePropagationFixture(async (fx) => {
      const shape = await buildItemLine(fx, { cutFrom: "C1", workerCommits: 2, conflict: "same-line" });
      const worktreePath = meshWorktreePath(fx.root, "asg-conflict");
      const w1Contested = git(fx.root, ["show", `${shape.W1}:${CONTESTED_PATH}`]).stdout;

      const { frames } = await createGateDispatch(fx, fx.ws)("asg-conflict", { commit: shape.C2, now: NOW });

      const failed = settledFrame(frames, "asg-conflict", "failed");
      assert.equal(failed?.code, CONFLICT, "the assignment settles `failed` with code assignment-gate-propagation-conflict");
      assert.equal(revParse(fx.root, shape.branch), shape.tipBefore, "git rev-parse <branch> equals the hash captured before the dispatch");
      assert.notEqual(git(fx.root, ["rev-parse", "--verify", `${shape.branch}^2`]).status, 0, "git rev-parse --verify <branch>^2 exits non-zero — no merge commit was created");
      assert.equal(mergeHeadAbsent(worktreePath), true, "git rev-parse -q --verify MERGE_HEAD exits non-zero — the repo is NOT left in a MERGING state");
      assert.deepEqual(unmergedEntries(worktreePath), [], "git status --porcelain carries no unmerged entry (no UU, AA, DD, AU or UA line)");
      assert.deepEqual(await conflictMarkersAnywhere(worktreePath), [], "no conflict-marker text exists in ANY file in the worktree");
      // "identical to their content at W1" is compared against the BLOB, with line endings
      // normalised on both sides: a Windows checkout with `core.autocrlf=true` materialises
      // an LF blob as CRLF on disk, so a raw byte compare would assert the platform's
      // checkout filter rather than the abort's completeness. The filter-independent half of
      // the same claim — that the working tree matches the branch exactly — is asserted
      // beside it with `git diff --quiet` and the HEAD identity.
      const onDisk = await readFile(path.join(worktreePath, CONTESTED_PATH), "utf8");
      const normalise = (text) => String(text).replace(/\r\n/g, "\n");
      assert.equal(normalise(onDisk), normalise(w1Contested), "the contested file's bytes on disk are identical to their content at W1");
      assert.equal(git(worktreePath, ["diff", "--quiet"]).status, 0, "…and the working tree carries no difference from the branch at all");
      assert.equal(revParse(worktreePath, "HEAD"), shape.W2, "…with HEAD still at the worker's own tip");
      assert.equal(isAncestor(fx.root, shape.W1, shape.branch), true, "git merge-base --is-ancestor W1 <branch> exits 0 — the worker's commit is untouched");
    }),
  },

  // ------------------------------------------------------------------
  // Scenario Outline: each refusal settles `failed` with its code, preserves every worker
  // commit, and never starts the agent (5 rows)
  // ------------------------------------------------------------------
  {
    name: "task01/43-05 advance-refusals: Examples — each refusal settles `failed` with its code, preserves every worker commit, never starts the agent and retains the worktree (5 rows)",
    run: async () => {
      const rows = [
        { precondition: "an uncommitted modification to a tracked file", code: DIRTY, dirt: "tracked", conflict: null },
        { precondition: "an untracked file the operator left in the tree", code: DIRTY, dirt: "untracked", conflict: null },
        { precondition: "a staged-but-uncommitted change in the index", code: DIRTY, dirt: "staged", conflict: null },
        { precondition: "a merge that conflicts on the same line of the same file", code: CONFLICT, dirt: null, conflict: "same-line" },
        { precondition: "a merge that conflicts on a delete/modify pair", code: CONFLICT, dirt: null, conflict: "delete-modify" },
      ];
      for (const row of rows) {
        await withGatePropagationFixture(async (fx) => {
          const label = `[${row.precondition}]`;
          const shape = await buildItemLine(fx, { cutFrom: "C1", workerCommits: 2, conflict: row.conflict });
          const assignmentId = `asg-${row.code}-${row.dirt ?? row.conflict}`;
          const worktreePath = meshWorktreePath(fx.root, assignmentId);
          const box = { planted: false, before: null };
          const exec = row.dirt != null
            ? recordingGitExec([], { afterWorktreeAdd: plantDirt(worktreePath, row.dirt, box) })
            : undefined;
          const spawns = [];
          const spawnRuntime = async (brief) => {
            spawns.push(brief);
            return { outcome: "failed", failureReason: "agent_error" };
          };

          const { frames } = await createGateDispatch(fx, fx.ws)(assignmentId, { commit: shape.C2, exec, spawnRuntime, now: NOW });

          assert.equal(settledFrame(frames, assignmentId, "failed")?.code, row.code, `${label} the assignment settles \`failed\` with code ${row.code}`);
          assert.equal(revParse(fx.root, shape.branch), shape.tipBefore, `${label} git rev-parse <branch> equals the hash captured before the dispatch`);
          assert.equal(isAncestor(fx.root, shape.W1, shape.branch), true, `${label} W1 is still reachable — every worker commit survives`);
          assert.equal(isAncestor(fx.root, shape.W2, shape.branch), true, `${label} …and W2`);
          assert.equal(mergeHeadAbsent(worktreePath), true, `${label} MERGE_HEAD is absent — nothing is left half-applied`);
          assert.deepEqual(spawns, [], `${label} the runtime is never spawned — no agent begins a phase on this state`);
          assert.equal(existsSync(worktreePath), true, `${label} the worktree is RETAINED for inspection`);
          const entries = await listWorktrees(fx.root);
          assert.equal(entries.some((entry) => entry.path.includes(assignmentId)), true, `${label} …and git itself still lists it`);

          // the row's own untouched_proof
          if (row.dirt === "tracked" || row.dirt === "untracked") {
            const after = await captureWorktreeState(worktreePath);
            const which = row.dirt === "tracked" ? "tracked" : "untracked";
            assert.ok(String(box.before?.[which] ?? "").length > 0, `${label} the fixture genuinely planted the ${which} change`);
            assert.equal(after[which], box.before[which], `${label} it is still on disk with identical bytes`);
          } else if (row.dirt === "staged") {
            const staged = git(worktreePath, ["diff", "--cached", "--name-only"]).stdout;
            assert.ok(staged.includes("c1.md"), `${label} the fixture genuinely staged a change`);
            assert.equal(staged, box.before.staged, `${label} git diff --cached --name-only lists the same paths as before`);
          } else if (row.conflict === "same-line") {
            assert.deepEqual(unmergedEntries(worktreePath), [], `${label} git status --porcelain carries no unmerged entry after the abort`);
          } else {
            assert.equal(existsSync(path.join(worktreePath, DOOMED_PATH)), false, `${label} the deleted-on-one-side file is in the state W1 left it in — deleted`);
            assert.equal(git(fx.root, ["cat-file", "-e", `${shape.branch}:${DOOMED_PATH}`]).status !== 0, true, `${label} …and absent from the branch's tree too`);
          }
        });
      }
    },
  },

  // ------------------------------------------------------------------
  // Scenario: the refusal is visible on the fleet as a coded failure, exactly as an
  // unavailable base commit is
  // ------------------------------------------------------------------
  {
    name: "task01/43-05 advance-refusals: the refusal reaches the OPERATOR — the terminal frame carries `failed` + the code, the detail names the branch and the pinned base, and the code is never conflated with assignment-base-commit-unavailable",
    run: async () => withGatePropagationFixture(async (fx) => {
      const shape = await buildItemLine(fx, { cutFrom: "C1", workerCommits: 2, conflict: "same-line" });

      const { frames, recorder, logs } = await createGateDispatch(fx, fx.ws)("asg-fleet", { commit: shape.C2, now: NOW });

      const terminal = settledFrame(frames, "asg-fleet", "failed");
      assert.ok(terminal, "the worker reports a terminal frame for this assignment");
      assert.equal(terminal.state, "failed", "…carrying state `failed`");
      assert.equal(terminal.code, CONFLICT, "…and the code assignment-gate-propagation-conflict");
      assert.ok(recorder.effectSteps.length > 0, "…on the DURABLE terminal channel, the same one every other coded failure settles through");

      const detail = logs.find((entry) => entry.code === CONFLICT);
      assert.ok(detail, "the coded failure also rides the worker's log channel");
      assert.equal(detail.level, "warn", "…at warn level");
      assert.ok(detail.message.includes(shape.branch), "the failure detail names the branch, so the cause is readable without an SSH inspection");
      assert.ok(detail.message.includes(shape.C2), "…and the pinned base commit");

      assert.notEqual(CONFLICT, "assignment-base-commit-unavailable", "the code is distinct from assignment-base-commit-unavailable");
      assert.equal(frames.some((frame) => frame.code === "assignment-base-commit-unavailable"), false, "…and the two causes are never conflated on the wire");
    }),
  },
];
