// Traceability wiring for milestone 43 / story 01 (the exclusive item lock), task
//   wiki/work/43_milestone_mesh-artifact-authority/stories/01_story_item-lock/
//     tasks/00_scope-rule-one-home-faces-unchanged.feature
//
// AC1's NO-REGRESSION half: `executionScopeRef` moved DOWN out of the
// `board-mesh-execution.mjs` face into the `assignment-record.mjs` leaf, and every
// existing consumer of the rule — the continue/refine/verify door, the board's row
// overlay, run-status' streamed-run lookup — answers EXACTLY as it did at HEAD. (The
// "defined exactly once in the repo" half is a PLACEMENT invariant and lives in
// test/arch/acd-item-lock-single-door.test.mjs; it is not restated here.)
//
// TWO CHANNEL NOTES, recorded rather than papered over — both are places where the
// feature's litmus names a command surface that does not carry the field at HEAD, and
// where publishing it there would BREAK the very byte-identity this task exists to
// prove:
//
//  1. `dispatchRef` (and `scopeRef` on a LOCAL continue) live on
//     `resolveContinueDecision`'s verdict, not on `work:continue`'s envelope: the
//     running branch publishes `scopeRef` but no `dispatchRef`, and the local branch
//     publishes neither. The feature's own FEASIBILITY note names
//     `resolveContinueDecision` as where those fields are, so the decision is asserted
//     directly — it is the exported, pure function the command's `run` calls verbatim.
//     Adding the keys to the envelope would be a face change inside a task whose whole
//     contract is "not one answer moves".
//  2. `execution` on a list row rides the `mesh: true` OPT-IN (`commands/list.mjs`) —
//     the board face passes it, the CLI never does, and `acd-work-list-contract`
//     asserts the CLI's rows carry EXACTLY seven keys. So the overlay scenario is read
//     through `invoke("work:list", { mesh: true })`, which is the only channel where
//     the rule is observable at all.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { invoke } from "../src/command-core.mjs";
import { globalMeshPaths } from "../src/workspace.mjs";
import { resolveContinueDecision } from "../src/commands/continue.mjs";
import { readExecutionOverlay } from "../src/board-mesh-execution.mjs";
import { openGlobalWorkProjectionStore, upsertWorkItemContent } from "../src/global-work-store.mjs";
import { withItemLockFixture, seedActive } from "./support/item-lock-fixture.mjs";

const HOLDER = "aof-wsl";

// The decision the continue door actually publishes, read through the SAME overlay the
// command reads (never a hand-built map).
async function continueDecision(fx, ref) {
  const overlay = await readExecutionOverlay(fx.workspace, { globalWorkStoreOptions: fx.ctx.globalWorkStoreOptions });
  return resolveContinueDecision(overlay, ref, { requestedNode: "", localNodeId: fx.nodeId });
}

async function seedStreamedRun(fx, ref, runId) {
  const store = await openGlobalWorkProjectionStore({ env: fx.env });
  try {
    upsertWorkItemContent(store, fx.workspaceId, {
      nodeId: HOLDER,
      runs: [{ ref, runId, record: { runId, itemRef: ref, state: "running", node: HOLDER } }],
    }, { now: "2026-08-01T10:00:00.000Z" });
  } finally {
    store.close?.();
  }
}

export const itemLockScopeOneHomeTests = [
  // ==========================================================================
  // Scenario Outline: the continue door reports the same execution scope for a
  // milestone and every story under it
  // ==========================================================================
  ...[
    { label: "the scope itself", ref: "42", scopeRef: "42" },
    { label: "the first story under it", ref: "42/01", scopeRef: "42" },
    { label: "a later story under it", ref: "42/03", scopeRef: "42" },
  ].map(({ label, ref, scopeRef }) => ({
    name: `item-lock/00 scope-one-home: continue "${ref}" (${label}) reports scopeRef ${scopeRef}, where running on ${HOLDER}, dispatchRef ${scopeRef}, and mints nothing locally`,
    run: () =>
      withItemLockFixture(async (fx) => {
        await seedActive(fx, { itemRef: "42", node: HOLDER, state: "running" });

        const envelope = await invoke("work:continue", { ref }, fx.ctx);
        assert.equal(envelope.scopeRef, scopeRef, "the envelope's scopeRef is the execution scope");
        assert.equal(envelope.where, "running", "the envelope's where is running");
        assert.equal(envelope.node, HOLDER, "the envelope's node is the holder");

        const decision = await continueDecision(fx, ref);
        assert.equal(decision.dispatchRef, scopeRef, "the unit of mesh execution is the scope, never the child");

        // Nothing was minted locally by that command.
        const status = await invoke("work:run-status", { ref }, fx.ctx);
        assert.deepEqual(status.runs, [], `no run was minted on ${fx.nodeId} by the continue door`);
      }),
  })),

  // ==========================================================================
  // Scenario Outline: an item OUTSIDE the held scope resolves to its own scope
  // and is offered locally
  // ==========================================================================
  ...[
    { label: "an unrelated milestone", ref: "43", scopeRef: "43" },
    { label: "a story of that milestone", ref: "43/01", scopeRef: "43" },
  ].map(({ label, ref, scopeRef }) => ({
    name: `item-lock/00 scope-one-home: "${ref}" (${label}) is outside the held scope — scopeRef ${scopeRef}, where local, resolvedBy no-prior-run`,
    run: () =>
      withItemLockFixture(async (fx) => {
        await seedActive(fx, { itemRef: "42", node: HOLDER, state: "running" });

        const decision = await continueDecision(fx, ref);
        assert.equal(decision.scopeRef, scopeRef, "the ref resolves to its OWN scope — the rule never leaks sideways");
        assert.equal(decision.where, "local");
        assert.equal(decision.resolvedBy, "no-prior-run");

        const envelope = await invoke("work:continue", { ref }, fx.ctx);
        assert.equal(envelope.where, "local");
        assert.equal(envelope.resolvedBy, "no-prior-run");
      }),
  })),

  // ==========================================================================
  // Scenario: a story row inherits its milestone's execution in the list
  // envelope, and its own status is left alone
  // ==========================================================================
  {
    name: "item-lock/00 scope-one-home: a story row inherits its milestone's execution in the list envelope; its own status is untouched, and an unrelated milestone carries no execution key",
    run: () =>
      withItemLockFixture(async (fx) => {
        await seedActive(fx, { itemRef: "42", node: HOLDER, state: "running" });

        const rows = await invoke("work:list", { mesh: true }, fx.ctx);
        const row = (ref) => rows.find((entry) => entry.ref === ref);

        assert.equal(row("42").execution.scopeRef, "42");
        assert.equal(row("42").status, "in-progress", "the milestone is genuinely running");
        assert.equal(row("42/03").execution.scopeRef, "42", "the story inherits its milestone's execution scope");
        assert.equal(row("42/03").execution.nodeId, HOLDER);
        assert.equal(row("42/03").status, "not-started", "the story's own frontmatter stays the truth");
        assert.equal(Object.prototype.hasOwnProperty.call(row("43"), "execution"), false, "an unheld milestone carries no execution key at all");
      }),
  },

  // ==========================================================================
  // Scenario: run-status for a story falls back to its milestone's streamed runs
  // ==========================================================================
  {
    name: "item-lock/00 scope-one-home: run-status for a story with no runs of its own answers from its milestone's streamed runs, naming the ref they were recorded under",
    run: () =>
      withItemLockFixture(async (fx) => {
        await seedActive(fx, { itemRef: "42", node: HOLDER, state: "running" });
        await seedStreamedRun(fx, "42", "run-42-a");

        const status = await invoke("work:run-status", { ref: "42/03" }, fx.ctx);
        assert.equal(status.runs.length, 1, "the milestone's streamed runs answer the story");
        assert.equal(status.runs[0].runId, "run-42-a");
        assert.equal(status.runs[0].itemRef, "42", "the envelope names the ref they were recorded under");
        assert.equal(status.fromWorker, true);
      }),
  },

  // ==========================================================================
  // Scenario Outline: with no assignment row for the scope, every face answers
  // exactly as a non-mesh workspace does
  // ==========================================================================
  // The three rows are three DIFFERENT store states and the fixture makes each one
  // real: row 1 opens the store so the database file exists with a full schema and
  // zero assignment rows; row 2 adds an active row under another workspace id; row 3
  // asserts the database file is genuinely ABSENT before it reads. (Row 3 is the
  // reason: a fixture that merely never touched the store would make it a duplicate
  // of row 1 and prove nothing about the absent-store path.)
  ...[
    {
      label: "a store with no assignment rows at all",
      seed: async (fx) => {
        const store = await openGlobalWorkProjectionStore({ env: fx.env });
        try {
          assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM global_assignments").get().n, 0, "the store exists and holds no assignment rows");
        } finally {
          store.close?.();
        }
        assert.equal(existsSync(globalMeshPaths({ env: fx.env }).databasePath), true, "…and its database file is on disk");
      },
    },
    {
      label: "rows for another workspace",
      seed: async (fx) => {
        const store = await openGlobalWorkProjectionStore({ env: fx.env });
        try {
          store.db.prepare(`
            INSERT INTO global_assignments (assignment_id, item_ref, workspace_id, target_node_id, issuer, state, assigned_at, updated_at)
            VALUES ('asg-elsewhere', '42', 'a-different-workspace', 'aof-wsl', 'control-a', 'running', '2026-08-01T09:00:00.000Z', '2026-08-01T09:00:00.000Z')
          `).run();
        } finally {
          store.close?.();
        }
      },
    },
    {
      label: "no global store at all",
      seed: async (fx) => {
        assert.equal(
          existsSync(globalMeshPaths({ env: fx.env }).databasePath),
          false,
          "the store's database file genuinely does not exist for this row — otherwise this is row 1 again",
        );
      },
    },
  ].map(({ label, seed }) => ({
    name: `item-lock/00 scope-one-home: with ${label}, no list row carries an execution key and continue answers local at the EXACT ref`,
    run: () =>
      withItemLockFixture(async (fx) => {
        await seed(fx);

        const rows = await invoke("work:list", { mesh: true }, fx.ctx);
        assert.equal(rows.some((row) => Object.prototype.hasOwnProperty.call(row, "execution")), false, "no row carries an execution key");

        const decision = await continueDecision(fx, "42/03");
        assert.equal(decision.where, "local");
        assert.equal(decision.resolvedBy, "no-prior-run");
        assert.equal(decision.dispatchRef, "42/03", "a local act keeps the EXACT ref");
        assert.equal(decision.scopeRef, "42", "…while still reporting the execution scope it belongs to");
      }),
  })),

  // ==========================================================================
  // Scenario: a terminal assignment is reported as not-active and routes
  // continue to the last node, never to "running"
  // ==========================================================================
  {
    name: "item-lock/00 scope-one-home: a TERMINAL assignment is reported active:false and routes continue remote/last-node at the scope ref — HEAD behaviour, unmoved by the relocation",
    run: () =>
      withItemLockFixture(async (fx) => {
        await seedActive(fx, { itemRef: "42", node: HOLDER, state: "done" });

        const rows = await invoke("work:list", { mesh: true }, fx.ctx);
        const story = rows.find((entry) => entry.ref === "42/03");
        assert.equal(story.execution.scopeRef, "42");
        assert.equal(story.execution.active, false, "a terminal row is reported, but never as a live run");
        assert.equal(story.status, "not-started", "the row reports its own frontmatter status, unchanged");

        const decision = await continueDecision(fx, "42/03");
        assert.equal(decision.where, "remote");
        assert.equal(decision.resolvedBy, "last-node");
        assert.equal(decision.node, HOLDER);
        assert.equal(decision.dispatchRef, "42");
      }),
  },
];
