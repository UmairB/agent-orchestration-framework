// test/gate-propagation-create-path-regression.test.mjs — traceability for milestone 43 /
// story 05 (gate-time propagation), task
//   wiki/work/43_milestone_mesh-artifact-authority/stories/05_story_gate-propagation/
//     tasks/03_create-path-and-unavailable-base-regression.feature
//
// The REGRESSION GUARD around the gating change. This story flips a condition that read
// `baseBranch == null && !branchExists && directive.commit != null`, so the two behaviours
// that condition protected are pinned here: (a) the CREATE path still builds a fresh branch
// from exactly the pinned commit, and (b) `assignment-base-commit-unavailable` still fires —
// now at EVERY door — when the pinned commit is unreachable after the one `git fetch origin`
// that `ensureCommitAvailable` performs. It also pins the two m42 invariants the advance
// runs through: ONE derivable branch per item, and the plain `git push origin <branch>`
// still landing the whole line on origin.
//
// THE ONE GENUINELY NEW BEHAVIOUR, flagged rather than smuggled in (the task's own @qa note
// and ADR-010 R5.1): the reuse-door rows of the unavailable-base table are a BEHAVIOUR
// CHANGE. Today a continuing item with an unreachable pinned commit RUNS (the pin is ignored
// at that door); after this story it REFUSES with the existing code. That is ADR-008's
// posture applied consistently — a refine already refused, so this removes an inconsistency
// — but it turns a previously-runnable continue into a coded failure whenever the control's
// checkout has unpushed commits, which is why the refusal message names the cure.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { meshWorktreePath, meshItemBranchName, listWorktrees } from "../src/mesh-worktree.mjs";
import { createRecordingGitExec } from "./support/mesh-worker-push-fixture.mjs";
import {
  withGatePropagationFixture,
  buildItemLine,
  createGateDispatch,
  seedOriginOnlyCommit,
  advanceEntry,
  git,
  gitOk,
  revParse,
  isAncestor,
  settledFrame,
  GATE_EDITED_PATH,
} from "./support/gate-propagation-fixture.mjs";

const NOW = "2026-08-04T09:00:00.000Z";
const UNAVAILABLE = "assignment-base-commit-unavailable";
// A commit that exists nowhere — the "typo'd hash / unpushed control checkout" shape.
const NOWHERE = "0".repeat(40);

// meshBranches(cwd) — every `aof/mesh/*` branch the checkout holds.
function meshBranches(cwd) {
  return git(cwd, ["branch", "--list", "aof/mesh/*"]).stdout
    .split(/\r?\n/)
    .map((line) => line.replace(/^[*+ ]+/, "").trim())
    .filter(Boolean);
}

export const gatePropagationCreatePathRegressionTests = [
  // ------------------------------------------------------------------
  // Scenario: a fresh branch is still built from exactly the pinned commit, with no merge
  // ------------------------------------------------------------------
  {
    name: "task03/43-05 create-path-regression: the CREATE path is unchanged — a fresh branch is built from exactly the pinned commit, with no merge commit, and the worktree-base line still says so",
    run: async () => withGatePropagationFixture(async (fx) => {
      // No local branch, and the checkout has drifted PAST the pinned commit (C2 exists), so
      // "built from the pin" is distinguishable from "built from HEAD".
      const shape = await buildItemLine(fx, { createBranch: false });
      const branch = meshItemBranchName(fx.itemRef);
      assert.equal(meshBranches(fx.root).length, 0, "the item has no local aof/mesh/43-05 branch before the dispatch");
      assert.notEqual(revParse(fx.root, "HEAD"), shape.C1, "…and the checkout has genuinely drifted past the pinned commit");

      const { logs } = await createGateDispatch(fx, fx.ws)("asg-create", { commit: shape.C1, now: NOW });
      const worktreePath = meshWorktreePath(fx.root, "asg-create");

      assert.equal(revParse(worktreePath, "HEAD"), shape.C1, "inside the worktree git rev-parse HEAD is exactly C1 — the state the assignment was made against, not the drifted HEAD");
      assert.notEqual(git(fx.root, ["rev-parse", "--verify", `${branch}^2`]).status, 0, "git rev-parse --verify <branch>^2 exits non-zero — no merge commit was created on the create path");
      assert.equal(git(worktreePath, ["symbolic-ref", "--short", "HEAD"]).stdout.trim(), branch, "git symbolic-ref --short HEAD inside the worktree resolves to the item branch");

      const base = logs.find((entry) => entry.code === "worker-worktree-base");
      assert.ok(base, "the worker-worktree-base entry is still emitted");
      assert.ok(base.message.includes(`fresh branch ${branch} off ${shape.C1}`), "…still reporting a fresh branch off the pinned commit");
      assert.deepEqual(advanceEntry(logs), [], "and NO advance is reported — there is nothing to advance on the create path");
    }),
  },

  // ------------------------------------------------------------------
  // Scenario Outline: an unreachable pinned commit refuses with
  // `assignment-base-commit-unavailable` at every door (3 rows)
  // ------------------------------------------------------------------
  {
    name: "task03/43-05 create-path-regression: Examples — an unreachable pinned commit refuses with `assignment-base-commit-unavailable` at EVERY door (create, derived-branch reuse, directive-baseBranch reuse — 3 rows)",
    run: async () => {
      const rows = [
        { door: "the CREATE door (no local branch, no base branch)", createBranch: false, baseBranch: null, branch: "aof/mesh/43-05", worktreeMaterialized: false },
        { door: "the REUSE door via the existing derived branch", createBranch: true, baseBranch: null, branch: "aof/mesh/43-05", worktreeMaterialized: true },
        { door: "the REUSE door via a directive-carried `baseBranch`", createBranch: true, baseBranch: "aof/mesh/43-05-old", branch: "aof/mesh/43-05-old", worktreeMaterialized: true },
      ];
      for (const row of rows) {
        await withGatePropagationFixture(async (fx) => {
          const label = `[${row.door}]`;
          const shape = await buildItemLine(fx, { createBranch: row.createBranch, branch: row.branch, workerCommits: 2 });
          const assignmentId = `asg-unavail-${row.branch.replace(/[^a-z0-9]/gi, "-")}-${row.createBranch ? "reuse" : "create"}`;
          const worktreePath = meshWorktreePath(fx.root, assignmentId);
          // The fixture has NO reachable origin at all, so the one `git fetch origin` cannot
          // rescue the commit — the refusal is genuine, not a network timing artefact.
          assert.equal(git(fx.root, ["remote"]).stdout.trim(), "", `${label} the fixture has no origin to fetch from`);

          const { frames } = await createGateDispatch(fx, fx.ws)(assignmentId, {
            commit: NOWHERE,
            baseBranch: row.baseBranch ?? undefined,
            now: NOW,
          });

          assert.equal(settledFrame(frames, assignmentId, "failed")?.code, UNAVAILABLE, `${label} the assignment settles \`failed\` with code assignment-base-commit-unavailable`);

          if (!row.createBranch) {
            assert.deepEqual(meshBranches(fx.root), [], `${label} no aof/mesh/43-05 branch was created`);
          } else {
            assert.equal(revParse(fx.root, row.branch), shape.tipBefore, `${label} git rev-parse ${row.branch} is unchanged from before the dispatch`);
          }

          // No advance anywhere: not one merge commit exists under aof/mesh/.
          for (const branch of meshBranches(fx.root)) {
            assert.equal(git(fx.root, ["rev-list", "--merges", branch]).stdout.trim(), "", `${label} no merge commit exists anywhere under aof/mesh/ (${branch})`);
          }

          const entries = await listWorktrees(fx.root);
          const listed = entries.some((entry) => entry.path.includes(assignmentId));
          if (row.worktreeMaterialized) {
            assert.equal(existsSync(worktreePath), true, `${label} the worktree is retained for inspection`);
            assert.equal(listed, true, `${label} …and git still lists it`);
            assert.equal(git(worktreePath, ["status", "--porcelain"]).stdout.trim(), "", `${label} …its tree untouched`);
            assert.equal(revParse(worktreePath, "HEAD"), shape.tipBefore, `${label} …still at the branch tip it was materialized on`);
          } else {
            assert.equal(existsSync(worktreePath), false, `${label} no worktree was materialized for the assignment`);
            assert.equal(listed, false, `${label} …and none is listed`);
          }
        });
      }
    },
  },

  // ------------------------------------------------------------------
  // Scenario: a pinned commit the worker's clone lacks is fetched once and then advanced from
  // ------------------------------------------------------------------
  {
    name: "task03/43-05 create-path-regression: a pinned commit the worker's clone LACKS is fetched once from a real bare origin and then advanced from — the one fetch is still one fetch, at the reuse door too",
    run: async () => withGatePropagationFixture(async (fx) => {
      const shape = await buildItemLine(fx, { cutFrom: "C1", workerCommits: 2, withC2: false });
      const c2 = await seedOriginOnlyCommit(fx);
      assert.notEqual(git(fx.root, ["cat-file", "-e", `${c2}^{commit}`]).status, 0, "the worker's clone genuinely does not have C2 before the dispatch");

      const { frames } = await createGateDispatch(fx, fx.ws)("asg-fetch-once", { commit: c2, now: NOW });

      assert.equal(git(fx.root, ["cat-file", "-e", `${c2}^{commit}`]).status, 0, "git cat-file -e C2^{commit} in the worker's checkout exits 0 — the commit was fetched");
      assert.equal(isAncestor(fx.root, c2, shape.branch), true, "git merge-base --is-ancestor C2 <branch> exits 0 — the advance used it");
      assert.equal(isAncestor(fx.root, shape.W1, shape.branch), true, "git merge-base --is-ancestor W1 <branch> exits 0");
      assert.equal(settledFrame(frames, "asg-fetch-once", "failed")?.code, undefined, "the assignment does not settle `failed` with a coded refusal");
    }, { origin: true }),
  },

  // ------------------------------------------------------------------
  // Scenario: two successive dispatches for the same item still converge on ONE branch
  // ------------------------------------------------------------------
  {
    name: "task03/43-05 create-path-regression: two successive dispatches for the same item still converge on ONE branch — no per-assignment fork, and both pinned bases plus every worker commit stay reachable",
    run: async () => withGatePropagationFixture(async (fx) => {
      const shape = await buildItemLine(fx, { cutFrom: "C1", workerCommits: 2 });
      const dispatch = createGateDispatch(fx, fx.ws);

      await dispatch("asg-first", { commit: shape.C2, now: NOW });
      assert.equal(isAncestor(fx.root, shape.C2, shape.branch), true, "the first continuing dispatch advanced the branch to C2");

      // C3 — a LATER control HEAD, carrying a second gate edit.
      await writeFile(path.join(fx.root, "gate-edit-2.md"), "# a second gate edit\n", "utf8");
      gitOk(fx.root, ["add", "--", "gate-edit-2.md"]);
      gitOk(fx.root, ["commit", "-q", "-m", "c3-later-control-head"]);
      const c3 = revParse(fx.root, "HEAD");

      await dispatch("asg-second", { commit: c3, now: NOW });

      assert.deepEqual(meshBranches(fx.root), [shape.branch], "git branch --list aof/mesh/* lists exactly one branch — no per-assignment fork was minted");
      assert.equal(isAncestor(fx.root, shape.C2, shape.branch), true, "git merge-base --is-ancestor C2 <branch> exits 0");
      assert.equal(isAncestor(fx.root, c3, shape.branch), true, "git merge-base --is-ancestor C3 <branch> exits 0");
      assert.equal(isAncestor(fx.root, shape.W1, shape.branch), true, "every worker commit made before either dispatch is still reachable (W1)");
      assert.equal(isAncestor(fx.root, shape.W2, shape.branch), true, "…and W2");
    }),
  },

  // ------------------------------------------------------------------
  // Scenario: after an advance, the plain push still lands the whole line on origin
  // ------------------------------------------------------------------
  {
    name: "task03/43-05 create-path-regression: after an advance the PLAIN push still lands the whole line on a real bare origin — W1, W2 and the gate edit all arrive, with no force flag",
    run: async () => withGatePropagationFixture(async (fx) => {
      const shape = await buildItemLine(fx, { cutFrom: "C1", workerCommits: 2 });
      const calls = [];
      const pushExec = createRecordingGitExec(calls);

      const { frames } = await createGateDispatch(fx, fx.ws)("asg-push", { commit: shape.C2, outcome: "done", pushExec, now: NOW });

      assert.ok(settledFrame(frames, "asg-push", "done"), "the worker completed the run with a `done` outcome and pushed the branch");
      assert.ok(git(fx.bareOrigin, ["branch", "--list", shape.branch]).stdout.includes(shape.branch), "the bare origin's git branch --list <branch> shows the branch");
      assert.equal(isAncestor(fx.bareOrigin, shape.W1, shape.branch), true, "in the bare origin git merge-base --is-ancestor W1 <branch> exits 0");
      assert.equal(isAncestor(fx.bareOrigin, shape.W2, shape.branch), true, "in the bare origin git merge-base --is-ancestor W2 <branch> exits 0");
      assert.equal(isAncestor(fx.bareOrigin, shape.C2, shape.branch), true, "in the bare origin git merge-base --is-ancestor C2 <branch> exits 0 — the gate edit travelled with it");
      assert.equal(git(fx.bareOrigin, ["cat-file", "-e", `${shape.branch}:${GATE_EDITED_PATH}`]).status, 0, "…and the gate-edited file is in the pushed tree");

      const pushes = calls.filter((call) => call.args.includes("push"));
      assert.equal(pushes.length, 1, "exactly one push ran");
      assert.deepEqual(
        pushes[0].args.filter((arg) => arg === "--force" || arg === "-f" || arg === "--force-with-lease"),
        [],
        "the push was a plain `push origin <branch>` — no force flag was passed",
      );
      assert.ok(pushes[0].args.includes("origin") && pushes[0].args.includes(shape.branch), "…naming origin and the item branch");
    }, { origin: true }),
  },
];
