// Traceability wiring for milestone 43 / story 02 (the authority cut), task
//   wiki/work/43_milestone_mesh-artifact-authority/stories/02_story_cache-authority/
//     tasks/00_work-items-is-a-fact-not-a-rebuilt-projection.feature
//
// AC1: `work_items` is reclassified projection -> fact in effects/stores.mjs, and THE
// RECLASSIFICATION IS THE ENFORCEMENT — `wholesaleDelete` already throws before it runs
// for any table not classified "projection", so the control's delete-and-rebuild cannot
// survive the reclassification even by accident. The cut is scoped to exactly ONE table:
// `projection_errors`, swept on the very next line, stays a projection and keeps being
// rebuilt per publish.
//
// THE LITMUS CHANNELS, exactly as the task's header names them — no source read:
//   (a) the CODED ERROR a wholesale sweep now raises (`fact-table-wholesale-delete`),
//       reached through the guard's own exported door;
//   (b) a fresh read of the workspace's CACHED ROWS through the store's public read
//       surface (`readWorkspaceItems`);
//   (c) the publish call's own RESULT ENVELOPE plus the workspace's `last_published_at`.
// "The sweep call no longer exists anywhere in src/" is a source ABSENCE and stays the
// arch-test's job (acd-work-items-single-writer, armed at this cut; and the amended
// acd-fact-projection-split), never a scenario's.
import assert from "node:assert/strict";
import { wholesaleDelete, readWorkspaceItems } from "../src/global-work-store.mjs";
import {
  withCacheFixture,
  withStore,
  tick,
  rows,
  projectionErrors,
  writeItem,
  breakItem,
  CACHE_STREAM,
} from "./support/cache-authority-fixture.mjs";

const DISK_REFS = ["43", "43/01", "43/02", "43/03"];

// attemptWholesaleDelete(fx, table) — "a wholesale delete of <table> is attempted for
// workspace acme", through the store's own class-gated sweep door. Returns the coded
// error, or null when the sweep ran.
async function attemptWholesaleDelete(fx, table) {
  return withStore(fx, (store) => {
    try {
      wholesaleDelete(store.db, table, fx.workspaceId);
      return null;
    } catch (error) {
      return error;
    }
  });
}

async function countIn(fx, table) {
  return withStore(fx, (store) => store.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE workspace_id = ?`).get(fx.workspaceId).n);
}

// Background: "a fresh mesh cache with the workspace acme registered" + "the control
// node's own work stream on disk carries milestone 43 and its stories".
const background = (body, options) => () => withCacheFixture(body, options);

export const cacheAuthorityFactNotProjectionTests = [
  // ==========================================================================
  // Scenario: the control's publish tick completes and records itself, with no
  // wholesale delete of work_items
  // ==========================================================================
  {
    name: "cache-authority/00 the publish tick completes, reports its count and timestamp, raises no fact-table-wholesale-delete, advances last_published_at, and caches every ref on disk",
    run: background(async (fx) => {
      const at = "2026-08-02T11:00:00.000Z";
      const propagation = await tick(fx, { now: at });

      assert.equal(propagation.published, true, "the tick completed");
      // "no `fact-table-wholesale-delete` error is raised by the tick" — the publisher
      // turns a store fault into a WARNING rather than a throw, so a reclassification
      // without the publish rewrite would surface here, not as an exception.
      assert.equal(propagation.warning, undefined, `the tick raised no store error (got: ${JSON.stringify(propagation.warning)})`);
      assert.equal(propagation.result.itemCount, DISK_REFS.length, "the result reports the item count");
      assert.equal(propagation.result.publishedAt, at, "…and the publish timestamp");

      const lastPublishedAt = await withStore(fx, (store) => store.db
        .prepare("SELECT last_published_at FROM workspaces WHERE workspace_id = ?").get(fx.workspaceId)?.last_published_at);
      assert.equal(lastPublishedAt, at, "the workspace's last_published_at advances to that tick's timestamp");

      assert.deepEqual([...(await rows(fx)).keys()].sort(), DISK_REFS, "a fresh read reports every ref the control's disk carries");
    }),
  },

  // ==========================================================================
  // Scenario: a wholesale delete of work_items is refused with a coded error and
  // changes nothing
  // ==========================================================================
  {
    name: "cache-authority/00 a wholesale delete of work_items is refused with fact-table-wholesale-delete and every previously readable row is still readable",
    run: background(async (fx) => {
      await tick(fx);
      const before = await rows(fx);
      assert.ok(before.size > 0, "the control has published, so acme has cached rows (non-vacuous)");

      const error = await attemptWholesaleDelete(fx, "work_items");
      assert.equal(error?.code, "fact-table-wholesale-delete", "the sweep is refused with the coded error");

      const after = await rows(fx);
      for (const [ref, row] of before) {
        assert.deepEqual(after.get(ref), row, `${ref} is still readable, byte-identical, after the refusal`);
      }
      assert.equal(after.size, before.size, "the refusal removed nothing at all");
    }),
  },

  // ==========================================================================
  // Scenario Outline: only work_items changes class — the tables around it keep
  // theirs
  // ==========================================================================
  ...[
    { table: "work_items", outcome: "refused", seed: null },
    { table: "work_item_docs", outcome: "refused", seed: "docs" },
    { table: "work_item_runs", outcome: "refused", seed: "runs" },
    { table: "projection_errors", outcome: "swept", seed: "error" },
  ].map(({ table, outcome, seed }) => ({
    name: `cache-authority/00 outline: a wholesale delete of "${table}" is ${outcome === "refused" ? 'refused with "fact-table-wholesale-delete"' : "performed — it is still a rebuilt projection"}`,
    run: background(async (fx) => {
      // "the control has published, so acme has rows in each cache table" — the two
      // streamed-content tables are filled by a worker's content frame in the real
      // world; here they are seeded through their own single writer so the row the
      // sweep would destroy actually exists (a refusal over an empty table proves
      // nothing).
      await tick(fx);
      if (seed === "docs" || seed === "runs") {
        const { upsertWorkItemContent } = await import("../src/global-work-store.mjs");
        await withStore(fx, (store) => upsertWorkItemContent(store, fx.workspaceId, {
          docs: [{ ref: "43/02", doc: "STORY", body: "# streamed\n" }],
          runs: [{ ref: "43/02", runId: "run-1", record: { runId: "run-1", itemRef: "43/02", state: "running" } }],
          nodeId: "worker-a",
        }, { now: "2026-08-02T11:00:00.000Z" }));
      }
      if (seed === "error") {
        await breakItem(fx, "43/03");
        await tick(fx);
      }

      const target = table === "projection_errors" ? "projection_errors" : table;
      const before = await countIn(fx, target);
      assert.ok(before > 0, `${target} carries at least one row for acme before the attempt (non-vacuous)`);

      const error = await attemptWholesaleDelete(fx, table);
      if (outcome === "refused") {
        assert.equal(error?.code, "fact-table-wholesale-delete", `${table} is a fact — the sweep is refused`);
        assert.equal(await countIn(fx, target), before, "…and its rows are untouched");
      } else {
        assert.equal(error, null, `${table} is a projection — the sweep runs`);
        assert.equal(await countIn(fx, target), 0, "…and removes that workspace's rows");
      }
    }),
  })),

  // ==========================================================================
  // Scenario: a repaired record doc drops out of the cached projection errors on
  // the next publish
  // ==========================================================================
  {
    name: "cache-authority/00 projection_errors is still a REBUILT projection — a repaired record doc drops out of the cached errors on the next publish, and the item's row reports its repaired status",
    run: background(async (fx) => {
      await breakItem(fx, "43/03");
      await tick(fx);

      const broken = await projectionErrors(fx);
      assert.equal(broken.length, 1, "the unparseable record doc is reported");
      assert.match(broken[0].sourcePath, /43\/stories\/03_story_[^/]+\/STORY\.md$/, "…naming that item's record doc");

      await writeItem(fx, "43/03", { status: "done", title: "Repaired" });
      await tick(fx);

      assert.deepEqual(await projectionErrors(fx), [], "the repaired doc is no longer reported — the error list was rebuilt, not patched");
      assert.equal((await rows(fx)).get("43/03").status, "done", "and the cached row reports its repaired status");
    }),
  },

  // ==========================================================================
  // FALSIFIABILITY of the litmus channel itself: the guard's refusal is not a
  // blanket refusal, and the cached-row read is not a dead channel.
  // ==========================================================================
  {
    name: "cache-authority/00 self-check: the cached-row channel is live (a publish moves it) and the sweep door really can delete (it clears a projection table)",
    run: background(async (fx) => {
      assert.equal((await rows(fx)).size, 0, "before any publish the channel reads empty");
      await tick(fx);
      assert.equal((await rows(fx)).size, DISK_REFS.length, "…and the publish moves it — the channel is live");

      // The same door that refuses work_items performs a real delete elsewhere, so the
      // refusal above is about the CLASS and not about the door being inert.
      await withStore(fx, (store) => {
        store.db.prepare("INSERT INTO projection_errors (workspace_id, source_path, message, code, occurred_at) VALUES (?, '/x/A.md', 'm', 'c', '2026-08-02T11:00:00.000Z')").run(fx.workspaceId);
      });
      assert.equal(await countIn(fx, "projection_errors"), 1);
      assert.equal(await attemptWholesaleDelete(fx, "projection_errors"), null);
      assert.equal(await countIn(fx, "projection_errors"), 0, "the door deletes when the class allows it");

      // And the public read surface is the one the fleet renders.
      const direct = await withStore(fx, (store) => readWorkspaceItems(store, fx.workspaceId));
      assert.deepEqual(direct.map((row) => row.ref).sort(), CACHE_STREAM[0].stories.map((s) => `43/${s}`).concat(["43"]).sort());
    }),
  },
];
