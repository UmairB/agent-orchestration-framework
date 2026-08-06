// Traceability wiring for milestone 43 / story 01 (the exclusive item lock), task
//   wiki/work/43_milestone_mesh-artifact-authority/stories/01_story_item-lock/
//     tasks/01_lock-is-symmetric-over-execution-scope.feature
//
// AC2: an active assignment holds the WHOLE execution scope, in BOTH directions —
// running "42" locks "42/03" and running "42/03" locks "42" — while a sibling scope, a
// string-prefix near-miss ("420") and every terminal state stay free. This task varies
// the REF PAIR and holds the door constant; task 02 varies the door.
//
// THE AMBIGUITY THE FEATURE HEADER FLAGGED IS SETTLED, in the contract itself:
// ADR-010/R1.1 (cited verbatim in the story's `## Notes`) rules that the EXACT-REF
// duplicate-assign gate KEEPS `assignment-already-active` — it is HTTP-409-mapped and
// asserted twice by an m38 feature — and that only the NEW scope predicate raises
// `item-locked-by-assignment`. Row 1 of the first table is wired to that ruling, which
// is what the table already says.
//
// Every door is driven through the REAL registered command (the `invoke` house style —
// a command's `run` result IS its `--json` payload), and every refusal is cross-checked
// against the store's own row counts: a refusal that left a row behind would not be a
// lock, it would be a message.
import assert from "node:assert/strict";
import { invoke } from "../src/command-core.mjs";
import { openGlobalWorkProjectionStore } from "../src/global-work-store.mjs";
import { assignWork } from "../src/mesh-assignment.mjs";
import { withItemLockFixture, seedActive, seedWorker, countAssignments, refuse } from "./support/item-lock-fixture.mjs";

const HOLDER = "aof-wsl";
const TARGET = "worker-b";

async function assign(fx, ref) {
  return invoke("mesh:assign", { ref, to: TARGET }, fx.ctx);
}

async function runsFor(fx, ref) {
  const status = await invoke("work:run-status", { ref }, fx.ctx);
  return status.runs;
}

export const itemLockSymmetricScopeTests = [
  // ==========================================================================
  // Scenario Outline: a held scope refuses a SECOND ASSIGNMENT for any ref in
  // that scope — upward, downward or sideways
  // ==========================================================================
  ...[
    { direction: "the same ref (pre-existing)", holder: "42", requested: "42", outcome: "refused", code: "assignment-already-active" },
    { direction: "downward — scope holds a child", holder: "42", requested: "42/03", outcome: "refused", code: "item-locked-by-assignment" },
    { direction: "upward — a child holds a scope", holder: "42/03", requested: "42", outcome: "refused", code: "item-locked-by-assignment" },
    { direction: "sideways — sibling stories", holder: "42/03", requested: "42/01", outcome: "refused", code: "item-locked-by-assignment" },
    { direction: "a different scope entirely", holder: "42", requested: "43", outcome: "admitted", code: null },
    { direction: "a child of a different scope", holder: "42", requested: "43/03", outcome: "admitted", code: null },
    { direction: "a string-prefix near-miss", holder: "42", requested: "420", outcome: "admitted", code: null },
    { direction: "a child of the near-miss", holder: "42", requested: "420/00", outcome: "admitted", code: null },
  ].map(({ direction, holder, requested, outcome, code }) => ({
    name: `item-lock/01 symmetry: assign "${requested}" while "${holder}" is held (${direction}) — ${outcome}${code ? ` with ${code}` : ""}`,
    run: () =>
      withItemLockFixture(async (fx) => {
        await seedWorker(fx, TARGET);
        await seedActive(fx, { itemRef: holder, node: HOLDER, state: "running" });
        const before = await countAssignments(fx);

        if (outcome === "admitted") {
          const result = await assign(fx, requested);
          assert.equal(result.ok, true, "the assign is admitted");
          assert.equal(result.itemRef, requested);
          assert.equal(await countAssignments(fx), before + 1, "exactly one new row was minted");
          return;
        }

        const error = await refuse(() => assign(fx, requested));
        assert.equal(error.code, code, `the refusal code is ${code}`);
        assert.equal(await countAssignments(fx), before, "the store holds EXACTLY the assignments it held before — no second row was minted");
      }),
  })),

  // ==========================================================================
  // Scenario Outline: a held scope refuses a LOCAL RUN MINT for any ref in that
  // scope — the rule cannot be true where the mesh verb enforces it and false
  // where a local operator mints straight past it
  // ==========================================================================
  ...[
    { direction: "downward — scope holds a child", holder: "42", requested: "42/03", outcome: "refused", runs: 0 },
    { direction: "the held ref itself", holder: "42", requested: "42", outcome: "refused", runs: 0 },
    { direction: "upward — a child holds a scope", holder: "42/03", requested: "42", outcome: "refused", runs: 0 },
    { direction: "sideways — sibling stories", holder: "42/03", requested: "42/01", outcome: "refused", runs: 0 },
    { direction: "a different scope entirely", holder: "42", requested: "43", outcome: "admitted", runs: 1 },
    { direction: "a string-prefix near-miss", holder: "42", requested: "420", outcome: "admitted", runs: 1 },
  ].map(({ direction, holder, requested, outcome, runs }) => ({
    name: `item-lock/01 symmetry: run-start "${requested}" while "${holder}" is held (${direction}) — ${outcome}, ${runs} run record(s)`,
    run: () =>
      withItemLockFixture(async (fx) => {
        await seedActive(fx, { itemRef: holder, node: HOLDER, state: "running" });

        if (outcome === "admitted") {
          const record = await invoke("work:run-start", { ref: requested }, fx.ctx);
          assert.equal(record.itemRef, requested);
          assert.equal(record.state, "running");
        } else {
          const error = await refuse(() => invoke("work:run-start", { ref: requested }, fx.ctx));
          assert.equal(error.code, "item-locked-by-assignment");
        }
        assert.equal((await runsFor(fx, requested)).length, runs, `run-status reports ${runs} run record(s) for the requested ref`);
      }),
  })),

  // ==========================================================================
  // Scenario Outline: only an ACTIVE assignment holds the scope — every terminal
  // state releases it
  // ==========================================================================
  ...[
    { state: "assigned", classification: "active", outcome: "refused" },
    { state: "accepted", classification: "active", outcome: "refused" },
    { state: "running", classification: "active", outcome: "refused" },
    { state: "done", classification: "terminal", outcome: "admitted" },
    { state: "failed", classification: "terminal", outcome: "admitted" },
    { state: "withdrawn", classification: "terminal", outcome: "admitted" },
    { state: "reclaimed", classification: "terminal", outcome: "admitted" },
  ].map(({ state, classification, outcome }) => ({
    name: `item-lock/01 symmetry: the only assignment for "42" is ${classification} (state "${state}") — run-start 42/03 is ${outcome}`,
    run: () =>
      withItemLockFixture(async (fx) => {
        await seedActive(fx, { itemRef: "42", node: HOLDER, state });

        if (outcome === "admitted") {
          const record = await invoke("work:run-start", { ref: "42/03" }, fx.ctx);
          assert.equal(record.state, "running", "a terminal assignment is a gate — everything is allowed again");
          return;
        }
        const error = await refuse(() => invoke("work:run-start", { ref: "42/03" }, fx.ctx));
        assert.equal(error.code, "item-locked-by-assignment");
      }),
  })),

  // ==========================================================================
  // Scenario: an active assignment in ANOTHER workspace does not hold this
  // workspace's identically-numbered item
  // ==========================================================================
  {
    name: "item-lock/01 symmetry: an active assignment for \"42\" in a DIFFERENT workspace does not hold this workspace's \"42\" — the lock is the workspace's item, never the ref string globally",
    run: () =>
      withItemLockFixture(async (fx) => {
        const store = await openGlobalWorkProjectionStore({ env: fx.env });
        try {
          store.db.prepare(`
            INSERT INTO global_assignments (assignment_id, item_ref, workspace_id, target_node_id, issuer, state, assigned_at, updated_at)
            VALUES ('asg-other-ws', '42', 'the-second-workspace', 'aof-wsl', 'control-a', 'running', '2026-08-01T09:00:00.000Z', '2026-08-01T09:00:00.000Z')
          `).run();
        } finally {
          store.close?.();
        }

        const record = await invoke("work:run-start", { ref: "42" }, fx.ctx);
        assert.equal(record.state, "running", "a run is minted");
        const runs = await runsFor(fx, "42");
        assert.equal(runs.filter((run) => run.state === "running").length, 1, "exactly one running run");
        assert.equal(record.propagationWarnings, undefined, "no refusal is reported");
      }),
  },

  // ==========================================================================
  // Scenario: an item with no assignment at all mints exactly as it did before
  // the lock existed
  // ==========================================================================
  {
    name: "item-lock/01 symmetry: with no rows at all in global_assignments, run-start 42/03 mints byte-identically and the envelope carries no lock-related key",
    run: () =>
      withItemLockFixture(async (fx) => {
        const record = await invoke("work:run-start", { ref: "42/03" }, fx.ctx);
        assert.equal(typeof record.runId, "string");
        assert.equal(record.itemRef, "42/03");
        assert.equal(record.state, "running");

        const runs = await runsFor(fx, "42/03");
        assert.equal(runs.length, 1, "that run is the only one");
        assert.equal(runs[0].runId, record.runId);

        for (const key of ["itemLocked", "lock", "locked", "scopeRef", "holderNode", "heldBy"]) {
          assert.equal(Object.prototype.hasOwnProperty.call(record, key), false, `the envelope carries no "${key}" key`);
        }
      }),
  },

  // ==========================================================================
  // Scenario: the EXACT-REF uniqueness gate is byte-unchanged — same code, same
  // holder field, same re-assignability
  // ==========================================================================
  {
    name: "item-lock/01 symmetry: the exact-ref uniqueness gate keeps `assignment-already-active` + its holder field, and a withdrawn row makes the SAME ref re-assignable",
    run: () =>
      withItemLockFixture(async (fx) => {
        await seedWorker(fx, TARGET);
        await seedActive(fx, { assignmentId: "asg-1", itemRef: "42", node: HOLDER, state: "running" });

        // The `holder` FIELD lives on the core's structured refusal (the m35 suite's
        // own channel, `test/mesh-assign-verb.test.mjs:102`) — the verb turns it into a
        // thrown coded error, and this task's promise is that neither half moved.
        const core = await assignWork(fx.workspace, "42", TARGET, {});
        assert.equal(core.ok, false);
        assert.equal(core.code, "assignment-already-active");
        assert.equal(core.holder, HOLDER, "the refusal names the holder in its own field, as it always has");

        const error = await refuse(() => assign(fx, "42"));
        assert.equal(error.code, "assignment-already-active");
        assert.equal(await countAssignments(fx), 1, "exactly one assignment row exists for 42");

        await invoke("mesh:assign", { ref: "42", withdraw: true }, fx.ctx);
        const minted = await invoke("mesh:assign", { ref: "42", to: TARGET }, fx.ctx);
        assert.equal(minted.ok, true, "a withdrawn row makes the exact ref re-assignable");
        assert.equal(minted.targetNodeId, TARGET);
      }),
  },
];
