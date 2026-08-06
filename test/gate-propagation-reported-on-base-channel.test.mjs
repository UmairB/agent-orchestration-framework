// test/gate-propagation-reported-on-base-channel.test.mjs — traceability for milestone 43 /
// story 05 (gate-time propagation), task
//   wiki/work/43_milestone_mesh-artifact-authority/stories/05_story_gate-propagation/
//     tasks/02_advance-reported-on-the-worktree-base-channel.feature
//
// The REPORTING half of the advance, which is contractual and not cosmetic: every dispatch
// that reaches the reuse door emits ONE line on the SAME log channel that already carries
// `worker-worktree-base`, carrying the outcome (`already-current` / `fast-forwarded` /
// `merged` / the refusal code) and BOTH COMMITS — so "which base did it actually run on"
// stays one `aof mesh logs --node <id>` read rather than an SSH inspection of a worker's
// checkout.
//
// Every entry is captured through the handler's injected `onLog` seam — the SAME seam
// `worker-worktree-base` is emitted through, so channel identity is itself observable — and
// the two hashes in each entry are compared against real `git rev-parse` output.
//
// The LAUNCHER's wiring is what makes "the same channel" load-bearing rather than a naming
// convention: mesh-launcher.mjs forwards `{ code, level, message }` into `emitWarning` and
// drops every other key, so the two commits must be IN the rendered line to survive to
// `aof mesh logs`. That is why the assertions below parse the message rather than reading a
// structured field the wire would never carry.
import assert from "node:assert/strict";
import {
  withGatePropagationFixture,
  buildItemLine,
  createGateDispatch,
  recordingGitExec,
  dirtyWorktree,
  advanceEntry,
  parseAdvance,
  revParse,
  isAncestor,
  settledFrame,
} from "./support/gate-propagation-fixture.mjs";
import { meshWorktreePath } from "../src/mesh-worktree.mjs";
import { existsSync } from "node:fs";

const NOW = "2026-08-04T09:00:00.000Z";
const DIRTY = "assignment-gate-propagation-dirty-worktree";
const CONFLICT = "assignment-gate-propagation-conflict";

export const gatePropagationReportedTests = [
  // ------------------------------------------------------------------
  // Scenario: the advance emits one entry on the same log channel as `worker-worktree-base`
  // ------------------------------------------------------------------
  {
    name: "task02/43-05 advance-reported: exactly ONE advance entry per dispatch, on the same log sink as `worker-worktree-base`, naming the assignment, the item ref and the branch",
    run: async () => withGatePropagationFixture(async (fx) => {
      const shape = await buildItemLine(fx, { cutFrom: "C1", workerCommits: 2 });

      const { logs } = await createGateDispatch(fx, fx.ws)("asg-report", { commit: shape.C2, now: NOW });

      const entries = advanceEntry(logs);
      assert.equal(entries.length, 1, "exactly one advance entry is recorded for this assignment");
      const base = logs.filter((entry) => entry.code === "worker-worktree-base");
      assert.equal(base.length, 1, "the existing `worker-worktree-base` entry is still emitted, unchanged in meaning");
      assert.ok(base[0].message.includes("EXISTING item branch"), "…still reporting which base the worktree was built from");
      // Same sink: both entries came out of the ONE recorded `onLog` list, in order.
      assert.ok(logs.indexOf(base[0]) < logs.indexOf(entries[0]), "the advance is emitted on the same sink as the worktree-base entry for the same dispatch, beside it");
      assert.ok(entries[0].message.includes("asg-report"), "it names the assignment id, as `worker-worktree-base` does");
      assert.ok(entries[0].message.includes(fx.itemRef), "…and the item ref");
      assert.ok(entries[0].message.includes(shape.branch), "…and the branch aof/mesh/43-05");
    }),
  },

  // ------------------------------------------------------------------
  // Scenario Outline: each outcome reports its own token and BOTH commits (5 rows)
  // ------------------------------------------------------------------
  {
    name: "task02/43-05 advance-reported: Examples — each outcome (and each refusal) reports its own token, BOTH commits, and its level (5 rows)",
    run: async () => {
      const rows = [
        { case: "pinned base already an ancestor of the tip", pin: "C1", cutFrom: "C1", workerCommits: 2, conflict: null, dirt: null, reported: "already-current", relationship: "different", level: "info" },
        { case: "branch strictly behind the pinned base", pin: "C2", cutFrom: "C1", workerCommits: 0, conflict: null, dirt: null, reported: "fast-forwarded", relationship: "identical", level: "info" },
        { case: "branch and pinned base diverged", pin: "C2", cutFrom: "C1", workerCommits: 2, conflict: null, dirt: null, reported: "merged", relationship: "different", level: "info" },
        { case: "the worktree is dirty", pin: "C2", cutFrom: "C1", workerCommits: 2, conflict: null, dirt: "all", reported: DIRTY, relationship: "different", level: "warn" },
        { case: "the merge conflicts and is aborted", pin: "C2", cutFrom: "C1", workerCommits: 2, conflict: "same-line", dirt: null, reported: CONFLICT, relationship: "different", level: "warn" },
      ];
      for (const row of rows) {
        await withGatePropagationFixture(async (fx) => {
          const label = `[${row.case}]`;
          const shape = await buildItemLine(fx, { cutFrom: row.cutFrom, workerCommits: row.workerCommits, conflict: row.conflict });
          const assignmentId = `asg-${row.reported}`;
          const worktreePath = meshWorktreePath(fx.root, assignmentId);
          const exec = row.dirt != null
            ? recordingGitExec([], { afterWorktreeAdd: async () => { if (existsSync(worktreePath)) await dirtyWorktree(worktreePath, { mode: row.dirt }); } })
            : undefined;

          const { logs } = await createGateDispatch(fx, fx.ws)(assignmentId, { commit: shape[row.pin], exec, now: NOW });

          const entries = advanceEntry(logs);
          assert.equal(entries.length, 1, `${label} one advance entry`);
          const parsed = parseAdvance(entries[0]);
          assert.equal(parsed.reported, row.reported, `${label} the advance entry carries \`${row.reported}\` — the outcome, or the refusal code`);
          assert.equal(parsed.base, revParse(fx.root, shape[row.pin]), `${label} it carries the pinned base commit, equal to git rev-parse ${row.pin}`);
          assert.equal(parsed.tip, revParse(fx.root, shape.branch), `${label} it carries the branch tip the agent starts from, equal to git rev-parse <branch> after the dispatch`);
          if (row.relationship === "identical") {
            assert.equal(parsed.tip, parsed.base, `${label} the two hashes it carries are identical — the tip IS the pinned base`);
          } else {
            assert.notEqual(parsed.tip, parsed.base, `${label} the two hashes it carries are different`);
          }
          if (row.reported === "already-current") {
            assert.equal(isAncestor(fx.root, parsed.base, parsed.tip), true, `${label} …the tip is ahead of the pinned base`);
          }
          if (row.level === "warn") {
            assert.equal(parsed.tip, shape.tipBefore, `${label} …the tip is unchanged from before`);
          }
          assert.equal(parsed.level, row.level, `${label} the entry level is \`${row.level}\``);
        });
      }
    },
  },

  // ------------------------------------------------------------------
  // Scenario: a refused advance still reports — the operator sees a refusal, never silence
  // ------------------------------------------------------------------
  {
    name: "task02/43-05 advance-reported: a REFUSED advance still reports — an absent entry would be indistinguishable from a worker that never got the dispatch",
    run: async () => withGatePropagationFixture(async (fx) => {
      const shape = await buildItemLine(fx, { cutFrom: "C1", workerCommits: 2, conflict: "same-line" });

      const { logs, frames } = await createGateDispatch(fx, fx.ws)("asg-refused-report", { commit: shape.C2, now: NOW });

      const entries = advanceEntry(logs);
      assert.equal(entries.length, 1, "an advance entry is still recorded for this assignment");
      const parsed = parseAdvance(entries[0]);
      assert.equal(parsed.reported, CONFLICT, "it carries the refusal code assignment-gate-propagation-conflict");
      assert.equal(parsed.tip, shape.tipBefore, "it carries the branch tip, which is unchanged from before the dispatch");
      assert.equal(settledFrame(frames, "asg-refused-report", "failed")?.code, CONFLICT, "the assignment's settled `failed` frame carries the same code — the log and the fleet agree");
    }),
  },

  // ------------------------------------------------------------------
  // Scenario: a faulting log sink degrades — the advance and the dispatch are unaffected
  // ------------------------------------------------------------------
  {
    name: "task02/43-05 advance-reported: a FAULTING log sink degrades — the advance still happens, every worker commit survives, and the assignment settles on its normal outcome",
    run: async () => withGatePropagationFixture(async (fx) => {
      const shape = await buildItemLine(fx, { cutFrom: "C1", workerCommits: 2 });
      let calls = 0;
      const onLog = () => { calls += 1; throw new Error("the log sink is broken"); };

      const { frames } = await createGateDispatch(fx, fx.ws)("asg-faulting-sink", { commit: shape.C2, onLog, outcome: "done", now: NOW });

      assert.ok(calls > 0, "the faulting sink was genuinely called — the lane is not vacuous");
      assert.equal(isAncestor(fx.root, shape.C2, shape.branch), true, "git merge-base --is-ancestor C2 <branch> still exits 0 — the advance still happened");
      assert.equal(isAncestor(fx.root, shape.W1, shape.branch), true, "git merge-base --is-ancestor W1 <branch> still exits 0");
      const settled = settledFrame(frames, "asg-faulting-sink", "done");
      assert.ok(settled, "the assignment settles on its normal outcome, not on a reporting fault");
      assert.equal(settled.code, undefined, "…with no failure code");
    }),
  },
];
