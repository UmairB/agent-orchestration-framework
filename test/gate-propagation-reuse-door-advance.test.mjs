// test/gate-propagation-reuse-door-advance.test.mjs — traceability for milestone 43 /
// story 05 (gate-time propagation), task
//   wiki/work/43_milestone_mesh-artifact-authority/stories/05_story_gate-propagation/
//     tasks/00_reuse-door-advances-to-the-pinned-base.feature
//
// THE BUG THIS STORY FIXES, asserted end-to-end: the pin check used to be gated
// `baseBranch == null && !branchExists && directive.commit != null`, so a CONTINUING item —
// which by definition takes the reuse door — never saw the control's edit. Every scenario
// here drives the REAL `createMeshWorkerExecutionHandler` against a REAL local git fixture
// repo through a real `git` binary (no mocked git, no network), and every Then is read back
// from git state in the worker's checkout / the materialized worktree, exactly as the task's
// LITMUS requires — `git merge-base --is-ancestor`, `git rev-parse <branch>^1/^2`,
// `git rev-list --count`, `git cat-file -e <branch>:<path>` — plus the advance's own
// REPORTED outcome on the log channel (task 02 pins the rendering).
//
// NOT ASSERTED HERE: that no history-rewriting git operation exists on this path. That is an
// ABSENCE, and it lives in test/arch/acd-gate-propagation-never-discards.test.mjs. What this
// file asserts is its OBSERVABLE consequence, per case: every commit the worker had already
// made is still reachable from the branch afterwards.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { meshWorktreePath } from "../src/mesh-worktree.mjs";
import {
  withGatePropagationFixture,
  buildItemLine,
  createGateDispatch,
  recordingGitExec,
  advanceEntry,
  parseAdvance,
  git,
  revParse,
  isAncestor,
  GATE_EDITED_PATH,
} from "./support/gate-propagation-fixture.mjs";

const NOW = "2026-08-04T09:00:00.000Z";

// count(cwd, rev) — `git rev-list --count`, the shape assertion that distinguishes "nothing
// was created" from "a real merge commit was added".
function count(cwd, rev) {
  return Number(git(cwd, ["rev-list", "--count", rev]).stdout.trim());
}

export const gatePropagationReuseDoorAdvanceTests = [
  // ------------------------------------------------------------------
  // Scenario: a control-side gate edit reaches a CONTINUING item on an existing branch
  // ------------------------------------------------------------------
  {
    name: "task00/43-05 reuse-door-advance: a control-side gate edit reaches a CONTINUING item on an existing branch — the pinned base lands on it and both worker commits survive",
    run: async () => withGatePropagationFixture(async (fx) => {
      const shape = await buildItemLine(fx, { cutFrom: "C1", workerCommits: 2 });
      const dispatch = createGateDispatch(fx, fx.ws);
      assert.equal(isAncestor(fx.root, shape.C2, shape.branch), false, "the fixture is genuinely NOT already-current before the dispatch");

      const { logs } = await dispatch("asg-headline", { commit: shape.C2, now: NOW });

      assert.equal(isAncestor(fx.root, shape.C2, shape.branch), true, "git merge-base --is-ancestor C2 aof/mesh/43-05 exits 0 — the pinned base is now on the branch");
      assert.equal(git(fx.root, ["cat-file", "-e", `${shape.branch}:${GATE_EDITED_PATH}`]).status, 0, "git cat-file -e <branch>:<the-gate-edited-path> exits 0 — the gate edit is in the branch's tree");
      const worktreePath = meshWorktreePath(fx.root, "asg-headline");
      assert.equal(existsSync(path.join(worktreePath, GATE_EDITED_PATH)), true, "the gate-edited file is present on disk inside the materialized worktree");
      assert.equal(isAncestor(fx.root, shape.W1, shape.branch), true, "git merge-base --is-ancestor W1 <branch> exits 0");
      assert.equal(isAncestor(fx.root, shape.W2, shape.branch), true, "git merge-base --is-ancestor W2 <branch> exits 0 — both worker commits are still reachable");
      assert.equal(parseAdvance(advanceEntry(logs)[0]).reported, "merged", "the reported advance outcome is `merged`");
    }),
  },

  // ------------------------------------------------------------------
  // Scenario Outline: the advance resolves to exactly one of three outcomes, each with
  // its own observable git shape (3 rows)
  // ------------------------------------------------------------------
  {
    name: "task00/43-05 reuse-door-advance: Examples — the advance resolves to exactly one of three outcomes, each pinned to its own git shape (already-current / fast-forwarded / merged, 3 rows)",
    run: async () => {
      const rows = [
        // `branch_tip` W2 descended from C2 → the pinned base is already an ancestor.
        { case: "pinned base already on it", cutFrom: "C2", workerCommits: 2, pin: "C2", outcome: "already-current", secondParent: false, grew: 0 },
        // `branch_tip` C1 with NO worker commits → strictly behind.
        { case: "branch strictly behind", cutFrom: "C1", workerCommits: 0, pin: "C2", outcome: "fast-forwarded", secondParent: false, grew: "C1..C2" },
        // `branch_tip` W2 descended from C1, pinned base C2 on its own line → diverged.
        { case: "the two lines diverged", cutFrom: "C1", workerCommits: 2, pin: "C2", outcome: "merged", secondParent: true, grew: "C1..C2+1" },
      ];
      for (const row of rows) {
        await withGatePropagationFixture(async (fx) => {
          const shape = await buildItemLine(fx, { cutFrom: row.cutFrom, workerCommits: row.workerCommits });
          const pinned = shape[row.pin];
          const carriedBefore = git(fx.root, ["log", "--format=%H", shape.branch]).stdout.trim().split(/\r?\n/).filter(Boolean);
          const countBefore = count(fx.root, shape.branch);
          const gap = count(fx.root, `${shape.C1}..${shape.C2}`);

          const { logs } = await createGateDispatch(fx, fx.ws)(`asg-${row.outcome}`, { commit: pinned, now: NOW });

          const reported = parseAdvance(advanceEntry(logs)[0]);
          assert.equal(reported.reported, row.outcome, `[${row.case}] the reported advance outcome is \`${row.outcome}\``);

          const tipAfter = revParse(fx.root, shape.branch);
          if (row.outcome === "already-current") {
            assert.equal(tipAfter, shape.tipBefore, `[${row.case}] the tip is byte-identical to before — nothing was created`);
          } else if (row.outcome === "fast-forwarded") {
            assert.equal(tipAfter, pinned, `[${row.case}] the tip is exactly the pinned base`);
          } else {
            assert.notEqual(tipAfter, shape.tipBefore, `[${row.case}] the tip is a NEW merge commit`);
          }

          const second = git(fx.root, ["rev-parse", "--verify", `${shape.branch}^2`]);
          if (row.secondParent) {
            assert.equal(second.status, 0, `[${row.case}] <branch>^2 resolves — two parents`);
            assert.equal(second.stdout.trim(), pinned, `[${row.case}] …and the SECOND parent is the pinned base`);
          } else {
            assert.notEqual(second.status, 0, `[${row.case}] <branch>^2 exits non-zero — one parent, no merge commit was created`);
          }

          assert.equal(isAncestor(fx.root, pinned, shape.branch), true, `[${row.case}] git merge-base --is-ancestor <pinned_base> <branch> exits 0`);
          for (const carried of carriedBefore) {
            assert.equal(isAncestor(fx.root, carried, shape.branch), true, `[${row.case}] every commit the branch carried before the dispatch (${carried.slice(0, 8)}) is still reachable`);
          }

          const countAfter = count(fx.root, shape.branch);
          const expectedGrowth = row.grew === 0 ? 0 : row.grew === "C1..C2" ? gap : gap + 1;
          assert.equal(countAfter - countBefore, expectedGrowth, `[${row.case}] git rev-list --count grew by ${row.grew === 0 ? "nothing" : row.grew}`);
        });
      }
    },
  },

  // ------------------------------------------------------------------
  // Scenario: the diverged case produces a real merge of the pinned base INTO the item branch
  // ------------------------------------------------------------------
  {
    name: "task00/43-05 reuse-door-advance: the diverged case produces a REAL merge of the pinned base INTO the item branch — ^1 is the item's own tip, ^2 is the pinned base, no commit rewritten",
    run: async () => withGatePropagationFixture(async (fx) => {
      const shape = await buildItemLine(fx, { cutFrom: "C1", workerCommits: 2 });
      assert.equal(isAncestor(fx.root, shape.C2, shape.branch), false, "git merge-base --is-ancestor C2 <branch> exits non-zero before the dispatch (genuinely diverged)");
      assert.equal(isAncestor(fx.root, shape.branch, shape.C2), false, "git merge-base --is-ancestor <branch> C2 exits non-zero before the dispatch (not merely behind)");

      await createGateDispatch(fx, fx.ws)("asg-diverged", { commit: shape.C2, now: NOW });

      assert.equal(revParse(fx.root, `${shape.branch}^1`), shape.W2, "git rev-parse <branch>^1 resolves to W2 — the item branch's own tip is the FIRST parent");
      assert.equal(revParse(fx.root, `${shape.branch}^2`), shape.C2, "git rev-parse <branch>^2 resolves to C2 — the pinned base is merged IN, not the other way round");
      // FLAGGED, NOT CHANGED (the .feature cell is left alone — 43/05 task 00): the
      // scenario asks for `git rev-list --count <branch>^1..<branch>` to be 1. That range
      // is "reachable from the merge, not reachable from W2", which for a GENUINELY
      // diverged pair is the merge commit PLUS every commit on the control's own line
      // (here C2) — so the command it names can only read 1 when the two lines were never
      // diverged, i.e. in exactly the case this scenario excludes. The INTENT ("exactly one
      // merge commit was added") is asserted with the command that measures it, and the
      // literal range is asserted at its arithmetically correct value so the cell's own
      // number is still pinned rather than dropped.
      assert.equal(Number(git(fx.root, ["rev-list", "--count", "--merges", `${shape.branch}^1..${shape.branch}`]).stdout.trim()), 1, "exactly ONE merge commit was added (git rev-list --count --merges <branch>^1..<branch>)");
      const gap = count(fx.root, `${shape.C1}..${shape.C2}`);
      assert.equal(count(fx.root, `${shape.branch}^1..${shape.branch}`), gap + 1, "…and the literal range <branch>^1..<branch> is that one merge plus the control-line commits it brought in");
      const log = git(fx.root, ["log", "--format=%H", shape.branch]).stdout;
      assert.ok(log.includes(shape.W1), "git log --format=%H <branch> contains W1 with its ORIGINAL hash — no commit was rewritten");
      assert.ok(log.includes(shape.W2), "…and W2 with its original hash");
      assert.equal(git(fx.root, ["cat-file", "-e", `${shape.branch}:${GATE_EDITED_PATH}`]).status, 0, "git cat-file -e <branch>:<the-gate-edited-path> exits 0");
    }),
  },

  // ------------------------------------------------------------------
  // Scenario: the advance completes before the agent starts — the agent's first read sees
  // the gate edit
  // ------------------------------------------------------------------
  {
    name: "task00/43-05 reuse-door-advance: the advance completes BEFORE the agent starts — at spawn time the gate edit is already in worktreeCwd, and the call order is worktree-add → advance → spawn",
    run: async () => withGatePropagationFixture(async (fx) => {
      const shape = await buildItemLine(fx, { cutFrom: "C1", workerCommits: 2 });
      const calls = [];
      const exec = recordingGitExec(calls);
      // The spawn's OWN observation, taken at the instant the runtime is handed the brief —
      // never reconstructed afterwards.
      let atSpawn = null;
      const spawnRuntime = async (brief) => {
        calls.push({ kind: "spawn", args: [] });
        atSpawn = {
          gateEditPresent: existsSync(path.join(brief.worktreeCwd, GATE_EDITED_PATH)),
          pinnedBaseOnHead: isAncestor(brief.worktreeCwd, shape.C2, "HEAD"),
        };
        return { outcome: "failed", failureReason: "agent_error" };
      };

      await createGateDispatch(fx, fx.ws)("asg-timing", { commit: shape.C2, exec, spawnRuntime, now: NOW });

      assert.equal(atSpawn?.gateEditPresent, true, "at the moment the runtime is spawned, the gate-edited file is already present in the spawn's worktreeCwd");
      assert.equal(atSpawn?.pinnedBaseOnHead, true, "at that same moment git merge-base --is-ancestor C2 HEAD inside the worktree exits 0");

      const addIdx = calls.findIndex((c) => c.kind === "worktree-add");
      const advanceIdx = calls.findIndex((c) => c.args.includes("merge") && !c.args.includes("--abort"));
      const spawnIdx = calls.findIndex((c) => c.kind === "spawn");
      assert.ok(addIdx !== -1, "the recorded git call order shows the `worktree add` that materialized the tree");
      assert.ok(advanceIdx !== -1, "…and the advance's own merge");
      assert.ok(spawnIdx !== -1, "…and the runtime spawn");
      assert.ok(addIdx < advanceIdx, "the advance runs strictly AFTER the worktree add that materialized the tree");
      assert.ok(advanceIdx < spawnIdx, "the advance runs strictly BEFORE the runtime spawn");
    }),
  },

  // ------------------------------------------------------------------
  // Scenario: the advance leaves HEAD on the item branch, never detached and never on
  // another branch
  // ------------------------------------------------------------------
  {
    name: "task00/43-05 reuse-door-advance: the advance leaves HEAD ON the item branch — never detached, never a second aof/mesh/* line, and the worktree HEAD equals the checkout's branch",
    run: async () => withGatePropagationFixture(async (fx) => {
      const shape = await buildItemLine(fx, { cutFrom: "C1", workerCommits: 2 });
      const { logs } = await createGateDispatch(fx, fx.ws)("asg-head", { commit: shape.C2, now: NOW });
      const worktreePath = meshWorktreePath(fx.root, "asg-head");
      // The premise, asserted rather than assumed: this scenario is about the advance not
      // disturbing the checkout's shape, so a dispatch in which no advance ran would satisfy
      // every assertion below for the wrong reason.
      assert.equal(parseAdvance(advanceEntry(logs)[0]).reported, "merged", "an advance genuinely ran on this dispatch");
      assert.equal(isAncestor(fx.root, shape.C2, shape.branch), true, "…and landed the pinned base on the branch");

      const symbolic = git(worktreePath, ["symbolic-ref", "--short", "HEAD"]);
      assert.equal(symbolic.status, 0, "git symbolic-ref --short HEAD resolves (it fails on a detached HEAD)");
      assert.equal(symbolic.stdout.trim(), shape.branch, "…to the item branch");
      const abbrev = git(worktreePath, ["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim();
      assert.equal(abbrev, shape.branch, "git rev-parse --abbrev-ref HEAD is that branch name");
      assert.notEqual(abbrev, "HEAD", "…never the literal HEAD");

      const branches = git(fx.root, ["branch", "--list", "aof/mesh/*"]).stdout
        .split(/\r?\n/)
        .map((line) => line.replace(/^[*+ ]+/, "").trim())
        .filter(Boolean);
      assert.deepEqual(branches, [shape.branch], "git branch --list aof/mesh/* lists exactly one branch — the item's line did not fork");
      assert.equal(revParse(worktreePath, "HEAD"), revParse(fx.root, shape.branch), "git rev-parse HEAD inside the worktree equals git rev-parse <branch> in the checkout");
    }),
  },

  // ------------------------------------------------------------------
  // Scenario Outline: both reuse doors see the pin — the derived branch and the
  // directive-carried base branch (2 rows)
  // ------------------------------------------------------------------
  {
    name: "task00/43-05 reuse-door-advance: Examples — BOTH reuse doors see the pin (the derived branch already existing locally, and a directive-carried baseBranch, 2 rows)",
    run: async () => {
      const rows = [
        { door: "the derived branch already existing locally (no `baseBranch`)", branch: "aof/mesh/43-05", carryBaseBranch: false },
        { door: "the directive carrying an explicit `baseBranch` (the cache's answer)", branch: "aof/mesh/43-05-old", carryBaseBranch: true },
      ];
      for (const row of rows) {
        await withGatePropagationFixture(async (fx) => {
          const shape = await buildItemLine(fx, { cutFrom: "C1", workerCommits: 2, branch: row.branch });
          assert.equal(shape.branch, row.branch, `[${row.door}] the fixture built the line on ${row.branch}`);

          const { logs } = await createGateDispatch(fx, fx.ws)(`asg-door-${row.carryBaseBranch ? "cache" : "derived"}`, {
            commit: shape.C2,
            baseBranch: row.carryBaseBranch ? row.branch : undefined,
            now: NOW,
          });

          assert.equal(isAncestor(fx.root, shape.C2, row.branch), true, `[${row.door}] git merge-base --is-ancestor C2 ${row.branch} exits 0 — the pinned base reached this door too`);
          assert.equal(isAncestor(fx.root, shape.W1, row.branch), true, `[${row.door}] W1 is still reachable`);
          assert.equal(isAncestor(fx.root, shape.W2, row.branch), true, `[${row.door}] W2 is still reachable`);
          assert.equal(parseAdvance(advanceEntry(logs)[0]).reported, "merged", `[${row.door}] the reported advance outcome is \`merged\``);
        });
      }
    },
  },
];
