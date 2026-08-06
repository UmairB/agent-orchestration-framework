// Traceability wiring for milestone 43 / story 02 (the authority cut), task
//   .../02_story_cache-authority/tasks/01_one-upsert-seam-stamped-by-the-writing-node.feature
//
// AC2: ONE row-level upsert seam — the structural twin of `upsertWorkItemContent` —
// used by BOTH writers: the control's publish with its own node id, and the worker's
// frame with the CONNECTION-AUTHENTICATED node id, never a self-reported one (the rule
// `applyWorktreeContentFrame` already keeps).
//
// THE LITMUS, as the task's header sets it: a fresh read of the cached rows through the
// store's public read surface, or the seam's own result counts. Authorship is proved the
// COLUMN-FREE way wherever it can be — by WHOSE RETRACTION THE ROW OBEYS (task 02's
// rule: a node may retract only what it authored), because a row stamped `worker-a`
// behaves differently from one stamped `worker-b` in exactly that observable way.
//
// The provenance READBACK the feature's Outline flags as 43/04-gated is asserted here
// against the COLUMN this story writes (`work_items.node_id`, schema v8, which ADR-010/D2
// moved into this story precisely because the retraction predicate has to read it). The
// storage->wire mapper that renders it as `reportedBy` on the read surface stays 43/04's;
// what is proved here is the STAMP, which is this story's half.
import assert from "node:assert/strict";
import { upsertWorkItems } from "../src/global-work-store.mjs";
import {
  withCacheFixture,
  withStore,
  tick,
  stream,
  rows,
  authorOf,
  itemRow,
  writeItem,
  CONTROL,
  WORKER_A,
  WORKER_B,
} from "./support/cache-authority-fixture.mjs";

// The Background's stream: the control's disk carries milestone 43 with 43/01 and 43/02.
const STREAM = [{ number: "43", stories: ["01", "02"] }];
const withFixture = (body) => () => withCacheFixture(body, { stream: STREAM });

// publishAuthoritative(fx, node, claimedRefs) — "<node> publishes an authoritative ref
// set". The seam's own door (ADR-004: "a publishing node passes the full ref set it is
// authoritative for"), carrying no rows: the question is only which rows the publisher
// still claims.
async function publishAuthoritative(fx, node, claimedRefs) {
  return withStore(fx, (store) => upsertWorkItems(store, fx.workspaceId, [], {
    nodeId: node,
    authority: node === CONTROL ? "disk-derived" : "reported",
    syncedAt: "2026-08-02T12:00:00.000Z",
    authoritativeRefs: claimedRefs,
  }));
}

// The five writers that reach the shared seam, and the node each row ends up carrying.
const WRITERS = [
  {
    writer: "the control's own publish tick",
    stamped: CONTROL,
    write: (fx) => tick(fx),
  },
  {
    writer: "a delta frame on worker-a's authenticated connection",
    stamped: WORKER_A,
    write: (fx) => stream(fx, WORKER_A, [itemRow("43/02", { status: "in-progress" })]),
  },
  {
    writer: "a full snapshot frame on worker-a's authenticated connection",
    stamped: WORKER_A,
    write: (fx) => stream(fx, WORKER_A, [itemRow("43/02", { status: "in-progress" })], { kind: "snapshot" }),
  },
  {
    writer: "a frame on worker-a's connection self-reporting the id worker-b",
    stamped: WORKER_A,
    write: (fx) => stream(fx, WORKER_A, [itemRow("43/02", { status: "in-progress" })], { selfReports: WORKER_B }),
  },
  {
    writer: "a frame on worker-a's connection carrying no self-reported node id",
    stamped: WORKER_A,
    write: (fx) => stream(fx, WORKER_A, [itemRow("43/02", { status: "in-progress" })], { selfReports: null }),
  },
];

export const cacheAuthorityUpsertSeamTests = [
  // ==========================================================================
  // Scenario: the control's publish updates a changed row in place and adds a
  // newly-created one
  // ==========================================================================
  {
    name: "cache-authority/01 the control's publish updates a changed row IN PLACE and adds a newly-created one, leaving the untouched row alone",
    run: withFixture(async (fx) => {
      await tick(fx);
      assert.equal((await rows(fx)).get("43/01").status, "not-started", "43/01 is cached as not-started");
      const before = (await rows(fx)).get("43/02");

      await writeItem(fx, "43/01", { status: "in-progress", title: "Item 43/01" });
      await writeItem(fx, "43/03", { status: "not-started", title: "A brand new story" });
      await tick(fx);

      const after = await rows(fx);
      assert.equal(after.get("43/01").status, "in-progress", "the changed row reads back changed");
      const created = after.get("43/03");
      assert.deepEqual(
        { type: created.type, slug: created.slug, title: created.title, parent: created.parent },
        { type: "story", slug: "s43-03", title: "A brand new story", parent: "43" },
        "the new row carries the type, slug, title and parent from the control's disk",
      );
      assert.match(created.sourcePath, /43_milestone_m43\/stories\/03_story_s43-03\/STORY\.md$/, "…and its source path");
      assert.deepEqual(after.get("43/02"), before, "and 43/02 is reported unchanged");
    }),
  },

  // ==========================================================================
  // Scenario: re-publishing an unchanged stream leaves exactly one row per ref
  // ==========================================================================
  {
    name: "cache-authority/01 re-publishing an unchanged stream leaves exactly ONE row per ref, with type, slug, status, title, parent and source path unchanged",
    run: withFixture(async (fx) => {
      await tick(fx, { now: "2026-08-02T12:00:00.000Z" });
      const before = await rows(fx);

      await tick(fx, { now: "2026-08-02T12:05:00.000Z" });
      const after = await rows(fx);

      const refCount = await withStore(fx, (store) => store.db
        .prepare("SELECT ref, COUNT(*) AS n FROM work_items WHERE workspace_id = ? GROUP BY ref HAVING n > 1").all(fx.workspaceId));
      assert.deepEqual(refCount, [], "the (workspace_id, ref) key means a re-publish can never duplicate a ref");
      assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort());
      for (const [ref, row] of before) assert.deepEqual(after.get(ref), row, `${ref} is byte-identical after the re-publish`);
    }),
  },

  // ==========================================================================
  // Scenario: a frame self-reporting another node's id is stored under the
  // identity its connection authenticated as
  // ==========================================================================
  {
    name: "cache-authority/01 a frame self-reporting worker-b's id on worker-a's connection lands, and obeys only worker-a's retraction — the connection wins over the claim",
    run: withFixture(async (fx) => {
      await tick(fx);
      assert.equal(await authorOf(fx, "43/02"), CONTROL, "43/02 starts out cached from the control's own disk");

      await stream(fx, WORKER_A, [itemRow("43/02", { status: "in-progress" })], { selfReports: WORKER_B });
      assert.equal((await rows(fx)).get("43/02").status, "in-progress", "the frame landed");

      // The COLUMN-FREE proof of the stamp: whose retraction the row obeys.
      await publishAuthoritative(fx, WORKER_B, ["43/01"]);
      assert.ok((await rows(fx)).has("43/02"), "the impostor's own later retraction leaves the row in place");

      await publishAuthoritative(fx, WORKER_A, ["43/01"]);
      assert.equal((await rows(fx)).has("43/02"), false, "the TRUE author's retraction removes it");
    }),
  },

  // ==========================================================================
  // Scenario Outline: every writer stamps the node that actually reported the row
  // ==========================================================================
  ...WRITERS.map(({ writer, stamped, write }) => ({
    name: `cache-authority/01 outline: ${writer} — only ${stamped} can retract the row it wrote, and the row reads back stamped ${stamped}`,
    run: withFixture(async (fx) => {
      await write(fx);
      assert.ok((await rows(fx)).has("43/02"), "the writer's row is in the cache (non-vacuous)");

      // Then 1 (column-free): the OTHER node's authoritative set omitting the ref does
      // not remove it; the stamped node's does.
      const other = stamped === CONTROL ? WORKER_A : CONTROL;
      await publishAuthoritative(fx, other, ["43/01"]);
      assert.ok((await rows(fx)).has("43/02"), `${other} cannot retract a row ${stamped} authored`);

      // Then 2: the direct provenance readback. The feature marks the WIRE rendering
      // (`reportedBy`) as 43/04-gated; the COLUMN this story stamps is asserted now,
      // because the retraction above has no predicate to read without it.
      assert.equal(await authorOf(fx, "43/02"), stamped, "the row records the node that actually reported it");

      await publishAuthoritative(fx, stamped, ["43/01"]);
      assert.equal((await rows(fx)).has("43/02"), false, `${stamped} — and only ${stamped} — can retract it`);
    }),
  })),

  // ==========================================================================
  // Scenario: an upsert with no resolvable node id is refused, and writes nothing
  // ==========================================================================
  {
    name: "cache-authority/01 an upsert with no resolvable node id is refused with a coded error at the seam AND with a coded skip at the frame door — and neither writes a row",
    run: withFixture(async (fx) => {
      // The seam itself: a caller with no identity cannot write an unattributable row
      // (one nobody could ever retract, and the lock could never protect).
      const thrown = await withStore(fx, (store) => {
        try {
          upsertWorkItems(store, fx.workspaceId, [itemRow("43/02")], { authority: "reported", syncedAt: "2026-08-02T12:00:00.000Z" });
          return null;
        } catch (error) {
          return error;
        }
      });
      assert.equal(thrown?.code, "missing-node-id", "the write is refused with a coded error");
      assert.equal((await rows(fx)).has("43/02"), false, "…and no row for 43/02 exists");

      // The same rule at the door a real frame comes through: neither an authenticated
      // connection nor a self-reported id (the `applyLogEntriesFrame` precedent).
      const skipped = await stream(fx, null, [itemRow("43/02")], { selfReports: null });
      assert.equal(skipped.code, "missing-node-id", "the frame door answers the same coded skip");
      assert.equal(skipped.published, false);
      assert.equal((await rows(fx)).has("43/02"), false, "…and still no row for 43/02");
    }),
  },

  // ==========================================================================
  // The seam has no safe DEFAULT for "whose slice is this" (ADR-011/A1): both
  // possible defaults are a shipped defect, so a caller that does not say is
  // refused rather than guessed for.
  // ==========================================================================
  {
    name: "cache-authority/01 the seam refuses a write that does not say whose slice it is — neither authority may be assumed (ADR-011/A1)",
    run: withFixture(async (fx) => {
      const thrown = await withStore(fx, (store) => {
        try {
          upsertWorkItems(store, fx.workspaceId, [itemRow("43/02")], { nodeId: CONTROL, syncedAt: "2026-08-02T12:00:00.000Z" });
          return null;
        } catch (error) {
          return error;
        }
      });
      assert.equal(thrown?.code, "upsert-authority-unknown", "an unstated authority is refused, never defaulted");
      assert.equal((await rows(fx)).has("43/02"), false, "…and nothing was written");
    }),
  },
];
