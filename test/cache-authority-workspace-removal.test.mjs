// Traceability wiring for milestone 43 / story 02 (the authority cut), task
//   .../02_story_cache-authority/tasks/06_deliberate-workspace-row-removal.feature
//
// AC7: a workspace's rows can still be removed ON PURPOSE, but only through an
// explicitly NAMED path — never through the publish tick. This is a real coverage
// obligation rather than a footnote, because the sweep that used to carry it is gone
// with AC1, and author retraction (AC4) deliberately cannot do it: no node may remove
// another node's rows, so nothing else in the system can ever clear a worker-authored
// row for a workspace being forgotten.
//
// THE NAMED PATH, this story's to choose: `removeWorkspaceFromCache(store, workspaceId)`
// — one explicit, operator-initiated call, not a flag on the publish. Per the QA-proposed
// bound the feature carries, it clears the workspace's WHOLE cache footprint (rows AND
// cached artifact bodies / run records), because a path that cleared only `work_items`
// would leave the artifact rows orphaned under an id nothing will ever publish again —
// the same "removable only by a sweep that no longer exists" corner one level down.
import assert from "node:assert/strict";
import {
  removeWorkspaceFromCache,
  upsertWorkItemContent,
  readWorkItemDoc,
  readWorkItemRuns,
} from "../src/global-work-store.mjs";
import {
  withCacheFixture,
  withStore,
  tick,
  stream,
  rows,
  itemRow,
  writeItem,
  breakItem,
  deleteItem,
  removeStream,
  otherWorkspace,
  registerDescriptor,
  WORKER_A,
} from "./support/cache-authority-fixture.mjs";

const STREAM = [{ number: "43", stories: ["01", "02", "03"] }];

// Background: acme and beta registered; acme carries rows the control authored PLUS a
// 43/02 authored by worker-a, and record-doc bodies + run records worker-a streamed.
const withFixture = (body) => () => withCacheFixture(async (fx) => {
  await tick(fx);
  await stream(fx, WORKER_A, [itemRow("43/02", { status: "in-progress", title: "worker 43/02" })]);
  await withStore(fx, (store) => upsertWorkItemContent(store, fx.workspaceId, {
    docs: [{ ref: "43/02", doc: "STORY", body: "# streamed by worker-a\n" }],
    runs: [{ ref: "43/02", runId: "run-1", record: { runId: "run-1", itemRef: "43/02", state: "running" } }],
    nodeId: WORKER_A,
  }, { now: "2026-08-02T10:00:00.000Z" }));
  return body(fx);
}, { stream: STREAM });

const remove = (fx, workspaceId = fx.workspaceId) => withStore(fx, (store) => removeWorkspaceFromCache(store, workspaceId));

export const cacheAuthorityWorkspaceRemovalTests = [
  // ==========================================================================
  // Scenario: the named removal path clears the workspace's cached rows
  // regardless of which node authored them
  // ==========================================================================
  {
    name: "cache-authority/06 the named removal path clears acme's whole cache footprint — rows whoever authored them, streamed doc bodies and run records — reports what it removed, and leaves beta alone",
    run: withFixture(async (fx) => {
      const beta = await otherWorkspace(fx, "beta", ["43", "43/02"]);
      await tick(fx, { workspace: beta.workspace });
      const betaBefore = await rows(fx, beta.workspaceId);
      assert.ok(betaBefore.size > 0, "beta has cached rows to protect (non-vacuous)");

      const before = await rows(fx);
      assert.ok(before.size > 0, "acme has cached rows to remove (non-vacuous)");

      const result = await remove(fx);
      assert.equal(result.items, before.size, "it reports how many cached rows it removed");
      assert.equal(result.docs, 1, "…and the streamed bodies");
      assert.equal(result.runs, 1, "…and the streamed run records");

      const after = await rows(fx);
      assert.equal(after.size, 0, "a fresh read of acme's cached rows reports no rows at all");
      assert.equal(await withStore(fx, (store) => readWorkItemDoc(store, fx.workspaceId, "43/02", "STORY")), null, "the cached record-doc bodies are gone");
      assert.deepEqual(await withStore(fx, (store) => readWorkItemRuns(store, fx.workspaceId, "43/02")), [], "…and the run records");
      // The WHOLE footprint: its own bookkeeping too. A `lastPublishedAt` or a reindex
      // watermark left behind outlives the workspace under an id nothing will publish
      // again — the orphan-one-level-down shape this scenario's bound exists to close.
      assert.deepEqual(
        await withStore(fx, (store) => store.db.prepare("SELECT key FROM projection_metadata WHERE workspace_id = ?").all(fx.workspaceId)),
        [],
        "…and the workspace's own projection metadata",
      );

      const betaAfter = await rows(fx, beta.workspaceId);
      assert.deepEqual([...betaAfter.keys()].sort(), [...betaBefore.keys()].sort(), "a fresh read of beta's cached rows is unchanged");
      // …VALUES too: a removal that blanked beta's rows rather than deleting them would
      // keep every key and pass the line above.
      for (const [ref, row] of betaBefore) assert.deepEqual(betaAfter.get(ref), row, `beta's ${ref} is byte-identical`);
    }),
  },

  // The worker-authored row is the reason this door has to exist at all: no publishing
  // node can ever reach it, so without a named path it would outlive the workspace.
  {
    name: "cache-authority/06 the removal reaches the row worker-a authored — the one row no publishing node could ever retract",
    run: withFixture(async (fx) => {
      // Prove the negative FIRST: the control cannot remove it, however it publishes.
      await deleteItem(fx, "43/02");
      await tick(fx);
      assert.ok((await rows(fx)).has("43/02"), "author retraction cannot touch it (that is the point of the rule)");

      await remove(fx);
      assert.equal((await rows(fx)).has("43/02"), false, "the named removal path can, because it is a different door");
    }),
  },

  // ==========================================================================
  // Scenario: a removed workspace can be registered and published again, and
  // comes back
  // ==========================================================================
  {
    name: "cache-authority/06 removal leaves no tombstone — acme registers and publishes again and every ref on its disk is cached again",
    run: withFixture(async (fx) => {
      await remove(fx);
      assert.equal((await rows(fx)).size, 0);

      await registerDescriptor(fx, fx.workspaceId, fx.root, fx.workDir);
      await tick(fx);

      assert.deepEqual([...(await rows(fx)).keys()].sort(), ["43", "43/01", "43/02", "43/03"], "every ref the control's disk carries is cached again");
    }),
  },

  // ==========================================================================
  // Scenario Outline: no publish tick removes a workspace's rows, whatever the
  // publishing node's disk looks like
  // ==========================================================================
  ...[
    { disk: "unchanged", expectation: "its own rows still report their disk values" },
    { disk: "missing entirely, so the read fails", expectation: "its own rows are still readable, and the failure is reported" },
    { disk: "unreadable, so every item read errors", expectation: "its own rows are still readable, and the failures are reported" },
    { disk: "genuinely empty, with every item deleted", expectation: "its own rows are retracted, as their author" },
  ].map(({ disk, expectation }) => ({
    name: `cache-authority/06 outline: the control's work stream is ${disk} — the row worker-a authored still reads, and ${expectation}`,
    run: withFixture(async (fx) => {
      const before = await rows(fx);

      if (disk === "missing entirely, so the read fails") {
        await removeStream(fx);
      } else if (disk === "unreadable, so every item read errors") {
        for (const ref of ["43", "43/01", "43/02", "43/03"]) await breakItem(fx, ref);
      } else if (disk === "genuinely empty, with every item deleted") {
        await deleteItem(fx, "43");
      }

      const propagation = await tick(fx);
      const after = await rows(fx);
      assert.equal(after.get("43/02")?.title, "worker 43/02", "the row worker-a authored is still reported");

      if (disk === "unchanged") {
        assert.equal(after.get("43/01").title, before.get("43/01").title, "the control's own rows still report their disk values");
        assert.equal(propagation.result.retracted, 0);
      } else if (disk === "genuinely empty, with every item deleted") {
        assert.equal(after.has("43/01"), false, "the control's own rows are retracted, as their author");
        assert.equal(after.has("43"), false);
        assert.ok(propagation.result.retracted >= 2, "…and the retraction is counted");
      } else {
        assert.ok(after.has("43/01"), "the control's own rows are still readable");
        assert.ok(propagation.result.skipped >= 1, "…and the read failure(s) are reported");
        assert.equal(propagation.result.retracted, 0, "…and nothing is retracted on a failed read");
      }
    }),
  })),

  // ==========================================================================
  // Scenario: a publish whose own disk read fails retracts nothing and reports the
  // failure
  // ==========================================================================
  {
    name: "cache-authority/06 a FAILED read is not an authoritative empty set — the publish reports the read failure, claims nothing, and every row it reported before the tick still reads",
    run: withFixture(async (fx) => {
      const before = await rows(fx);
      assert.ok(before.size >= 4, "acme carries its rows before the tick (non-vacuous)");

      await removeStream(fx);
      const propagation = await tick(fx);

      assert.equal(propagation.result.authoritative, false, "the publish reports that it could not claim a complete slice");
      assert.equal(propagation.result.itemCount, 0);
      assert.equal(propagation.result.skipped, 1, "…and reports the read failure");
      assert.equal(propagation.result.retracted, 0, "…rather than an empty item set");

      const after = await rows(fx);
      for (const [ref, row] of before) assert.deepEqual(after.get(ref), row, `${ref} still reads exactly as before the tick`);

      // FALSIFIABILITY of the distinction itself: an EMPTY stream that really IS empty
      // does retract, so the assertion above is about the read having failed and not
      // about retraction being switched off.
      await writeItem(fx, "43/01", { status: "not-started" });
      await deleteItem(fx, "43/01");
      const emptied = await tick(fx);
      assert.equal(emptied.result.authoritative, true, "a readable, genuinely empty stream IS an authoritative claim");
      assert.ok(emptied.result.retracted > 0, "…and it retracts what its author no longer carries");
    }),
  },
];
