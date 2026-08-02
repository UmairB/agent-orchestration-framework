// Traceability wiring for milestone 43 / story 02 (the authority cut), task
//   .../02_story_cache-authority/tasks/05_frames-land-row-by-row-no-collateral-rollback.feature
//
// AC5: `applyDeltaFrame` collapses to a call on the shared seam — its read-merge-
// republish dance existed only to feed the wholesale writer — and that RETIRES its P0.3
// hazard, recorded in its own source comment: "one partial delta rolls back the ENTIRE
// BEGIN IMMEDIATE txn and silently drops every OTHER item in the same frame". The same
// collapse applies to `applySnapshotFrame`, which used to feed the frame's items to the
// wholesale writer and therefore REPLACED the whole workspace's rows with whatever
// subtree the worker happened to send.
//
// THE LITMUS: a fresh read of the cached rows plus the frame apply's own RESULT — the
// counted skips and coded refusals it returns. No source read: "there is no longer a
// whole-workspace transaction" is proven by what SURVIVES a bad row, never by reading
// the transaction's absence.
import assert from "node:assert/strict";
import {
  withCacheFixture,
  tick,
  stream,
  rows,
  itemRow,
  writeItem,
  writeItemRaw,
  WORKER_A,
} from "./support/cache-authority-fixture.mjs";

const STREAM = [{ number: "43", stories: ["01", "02", "03"] }];

// Background: the control has published, so 43/01, 43/02 and 43/03 are cached rows it
// authored, and worker-a's connection is authenticated as worker-a.
const withFixture = (body) => () => withCacheFixture(async (fx) => {
  await tick(fx);
  return body(fx);
}, { stream: STREAM });

const skipCount = (result) => (result.skippedRows ?? []).length;

export const cacheAuthorityFrameRowByRowTests = [
  // ==========================================================================
  // Scenario: a frame carrying one unstorable row and several good ones lands
  // every good row
  // ==========================================================================
  {
    name: "cache-authority/05 THE P0.3 REGRESSION: one unstorable row among good ones lands every good row, adds the new ref, leaves the ref the frame never named, and counts exactly one skip",
    run: withFixture(async (fx) => {
      const before = (await rows(fx)).get("43/03");

      const result = await stream(fx, WORKER_A, [
        itemRow("43/01", { status: "in-progress", title: "worker 43/01" }),
        itemRow("43/02", { status: "in-progress", title: "worker 43/02" }),
        { ref: "43/09", status: "in-progress" }, // never reported before, and unstorable
        itemRow("43/04", { status: "not-started", title: "worker 43/04" }),
      ]);

      const after = await rows(fx);
      assert.equal(after.get("43/01").title, "worker 43/01", "the good rows in the frame landed");
      assert.equal(after.get("43/02").title, "worker 43/02");
      assert.equal(after.get("43/04")?.title, "worker 43/04", "…including the brand-new ref");
      assert.deepEqual(after.get("43/03"), before, "…and the ref the frame never named is untouched");
      assert.equal(after.has("43/09"), false, "the unstorable row is never half-written");
      assert.equal(skipCount(result), 1, "the frame's result counts exactly one skipped row");
    }),
  },

  // ==========================================================================
  // Scenario Outline: every unstorable row shape is skipped and counted, and the
  // frame's other rows still land
  // ==========================================================================
  ...[
    { shape: "a row with no `ref`", row: { type: "story", slug: "s", sourcePath: "/x/A.md" } },
    { shape: "a row whose `ref` is an empty string", row: { ref: "", type: "story", slug: "s", sourcePath: "/x/A.md" } },
    { shape: "a row with no `type`", row: { ref: "43/07", slug: "s", sourcePath: "/x/A.md" } },
    { shape: "a row with no `slug`", row: { ref: "43/07", type: "story", sourcePath: "/x/A.md" } },
    { shape: "a row with no `sourcePath`", row: { ref: "43/07", type: "story", slug: "s" } },
    { shape: 'a row for "43/02" carrying only a `status`', row: { ref: "43/02", status: "done" } },
    { shape: "an entry that is null", row: null },
    { shape: "an entry that is not an object", row: "43/07" },
    // ADDED at 43/02's structural review (ADR-012/B5). The eight rows above are all
    // MISSING-or-EMPTY required strings, so none of them can reach the defect AC5 claims
    // to retire: they were screened out before the statement ran. These four are
    // PRESENT, well-formed to a reader, and unbindable as a SQLite parameter — the shape
    // that threw out of the batch and landed ZERO rows.
    { shape: "a row whose `title` is a list", row: { ref: "43/07", type: "story", slug: "s", sourcePath: "/x/A.md", title: ["alpha", "beta"] } },
    { shape: "a row whose `status` is a list", row: { ref: "43/07", type: "story", slug: "s", sourcePath: "/x/A.md", status: ["a", "b"] } },
    { shape: "a row whose `parent` is a map", row: { ref: "43/07", type: "story", slug: "s", sourcePath: "/x/A.md", parent: { of: "43" } } },
    { shape: "a row whose `status` is a boolean", row: { ref: "43/07", type: "story", slug: "s", sourcePath: "/x/A.md", status: true } },
  ].map(({ shape, row }) => ({
    name: `cache-authority/05 outline: ${shape} is skipped and counted, the frame's good row still lands, and the cached 43/02 keeps its status`,
    run: withFixture(async (fx) => {
      // "Given the cached row for 43/02 reports status in-progress" — reported by the
      // worker, so the last of the shapes above (a partial row for an EXISTING ref)
      // cannot pass merely because nothing was there to protect.
      await stream(fx, WORKER_A, [itemRow("43/02", { status: "in-progress", title: "worker 43/02" })], { at: "2026-08-02T09:00:00.000Z" });
      assert.equal((await rows(fx)).get("43/02").status, "in-progress");

      const result = await stream(fx, WORKER_A, [row, itemRow("43/01", { status: "done", title: "worker 43/01" })], { at: "2026-08-02T10:00:00.000Z" });

      // The apply COMPLETED — it did not throw out into the accept loop's `.catch`,
      // where a whole frame's loss is swallowed into a degrade sink nothing reads.
      assert.equal(result.published, true, "the frame applied rather than throwing out of the door");
      assert.equal(skipCount(result), 1, "the frame's result counts that row among its skipped rows");
      const after = await rows(fx);
      assert.equal(after.get("43/01").title, "worker 43/01", "the frame's good row still lands");
      assert.equal(after.get("43/01").status, "done");
      assert.equal(after.get("43/02").status, "in-progress", "and the cached row for 43/02 is never blanked by a half-row");
      assert.equal(after.has("43/07"), false, "no half-row is stored for the unstorable ref");
    }),
  })),

  // ==========================================================================
  // Scenario: a frame carrying two rows for the same ref stores the last one and
  // never aborts the frame
  // ==========================================================================
  {
    name: "cache-authority/05 two rows for the SAME ref in one frame settle on the last one (a primary-key collision the wholesale INSERT could not survive) and the rest of the frame still lands",
    run: withFixture(async (fx) => {
      const result = await stream(fx, WORKER_A, [
        itemRow("43/02", { status: "in-progress", title: "first" }),
        itemRow("43/02", { status: "done", title: "last" }),
        itemRow("43/01", { status: "in-review", title: "worker 43/01" }),
      ]);

      const after = await rows(fx);
      assert.equal(after.get("43/02").status, "done", "the LAST row for that ref wins");
      assert.equal(after.get("43/02").title, "last");
      assert.equal(after.get("43/01").title, "worker 43/01", "…and the frame's other row landed");
      assert.equal(skipCount(result), 0, "nothing was refused — a duplicate ref is an upsert, not a collision");
      const duplicates = [...after.keys()].filter((ref) => ref === "43/02");
      assert.equal(duplicates.length, 1, "exactly one row for that ref");
    }),
  },

  // ==========================================================================
  // Scenario: a worker's full snapshot frame adds and updates only the refs it
  // carries
  // ==========================================================================
  {
    name: "cache-authority/05 a worker's FULL SNAPSHOT frame adds and updates only what it carries — 43/01 and 43/03 survive a snapshot that names neither, whether the control or the worker itself authored them",
    run: withFixture(async (fx) => {
      const before = await rows(fx);

      await stream(fx, WORKER_A, [
        itemRow("43/02", { status: "in-progress", title: "worker 43/02" }),
        itemRow("43/05", { status: "not-started", title: "worker 43/05" }),
      ], { kind: "snapshot" });

      const after = await rows(fx);
      assert.equal(after.get("43/02").title, "worker 43/02", "the refs it carries are updated");
      assert.equal(after.get("43/05")?.title, "worker 43/05", "…and added");
      assert.deepEqual(after.get("43/01"), before.get("43/01"), "the refs it never named are untouched");
      assert.deepEqual(after.get("43/03"), before.get("43/03"));

      // …AND the case the Background's control-authored rows could never catch: a
      // snapshot frame that claimed authority over its own subtree would retract the
      // reporter's OWN unnamed rows, which no control-authored row can detect (a worker
      // can never retract the control's). So the same assertion is repeated against rows
      // worker-a itself authored — the only shape in which "a snapshot removes nothing"
      // is a falsifiable claim.
      await stream(fx, WORKER_A, [
        itemRow("43/01", { status: "in-progress", title: "worker 43/01" }),
        itemRow("43/03", { status: "in-progress", title: "worker 43/03" }),
      ], { at: "2026-08-02T11:00:00.000Z" });
      const mine = await rows(fx);

      await stream(fx, WORKER_A, [itemRow("43/02", { status: "done", title: "worker 43/02 settled" })], {
        kind: "snapshot",
        at: "2026-08-02T12:00:00.000Z",
      });

      const settled = await rows(fx);
      assert.deepEqual(settled.get("43/01"), mine.get("43/01"), "a snapshot naming only 43/02 does not retract the reporter's OWN 43/01");
      assert.deepEqual(settled.get("43/03"), mine.get("43/03"), "…nor its own 43/03");
      assert.equal(settled.get("43/02").title, "worker 43/02 settled", "…while the ref it did name is updated");
    }),
  },

  // ==========================================================================
  // Scenario: one record doc whose frontmatter carries a list-valued title never
  // stops the workspace publishing (ADR-012/B5 — the DISK half, which no frame
  // Examples row can reach: it arrives from ordinary operator input, because
  // `parseFrontmatter` deliberately turns `title: [alpha, beta]` into an array)
  // ==========================================================================
  {
    name: "cache-authority/05 THE DISK HALF: one record doc with a list-valued title is skipped and NAMED, while every other item in the workspace still publishes — and the row keeps its last good title",
    run: withFixture(async (fx) => {
      const goodTitle = (await rows(fx)).get("43/03").title;
      assert.ok(goodTitle != null && goodTitle.length > 0, "43/03 starts cached with a good title (non-vacuous)");

      // The operator writes a perfectly ordinary inline list into ONE record doc, and
      // moves an unrelated item on the same disk.
      await writeItemRaw(fx, "43/03", "title: [alpha, beta]");
      await writeItem(fx, "43/01", { status: "done", title: "Item 43/01" });

      const propagation = await tick(fx);

      assert.equal(propagation.published, true, "the tick completed rather than failing the whole workspace");
      assert.equal(propagation.warning, undefined, "…and reported no store fault");
      assert.equal((await rows(fx)).get("43/01").status, "done", "every OTHER item still publishes — the litmus");

      const skip = (propagation.result.skippedRefs ?? []).find((entry) => entry.ref === "43/03");
      assert.ok(skip != null, "the publish result counts 43/03 among its skipped rows, naming that ref");
      assert.equal(skip.reason, "unstorable-value");
      assert.equal(skip.column, "title", "…and the column that caused it, never a bind-parameter index");
      assert.match(skip.sourcePath ?? "", /03_story_s43-03\/STORY\.md$/, "…and the doc the operator has to edit");

      assert.equal((await rows(fx)).get("43/03")?.title, goodTitle, "the cached row for 43/03 still reports its last good title");

      // …and it is not a one-tick escape: the workspace keeps publishing while the doc
      // stays broken, and recovers the moment it is repaired.
      await writeItem(fx, "43/02", { status: "in-review", title: "Item 43/02" });
      await tick(fx);
      assert.equal((await rows(fx)).get("43/02").status, "in-review", "the next tick still publishes the rest");
      await writeItem(fx, "43/03", { status: "done", title: "Repaired" });
      await tick(fx);
      assert.equal((await rows(fx)).get("43/03").title, "Repaired", "and the repaired doc lands again");
    }),
  },

  // ==========================================================================
  // Regression guards on the frame gate that must survive the collapse
  // ==========================================================================
  {
    name: "cache-authority/05 a frame for an unregistered workspace is still refused with unknown-workspace, and acme's rows are unchanged",
    run: withFixture(async (fx) => {
      const before = await rows(fx);

      const result = await stream(fx, WORKER_A, [itemRow("43/02", { status: "done" })], { workspaceId: "ws-nobody-registered" });
      assert.equal(result.code, "unknown-workspace", "the apply returns the coded skip");
      assert.equal(result.published, false);

      const after = await rows(fx);
      assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort(), "acme's cached rows are unchanged");
      for (const [ref, row] of before) assert.deepEqual(after.get(ref), row);
    }),
  },
  {
    name: "cache-authority/05 a frame carrying a malformed timestamp still lands, and the apply's result reports a valid ISO instant rather than the malformed value verbatim",
    run: withFixture(async (fx) => {
      const before = Date.now();
      // No server-side `now` — the ONLY candidate is the malformed frame.at.
      const result = await stream(fx, WORKER_A, [itemRow("43/02", { status: "in-progress", title: "worker 43/02" })], {
        at: "not-a-real-instant",
        now: null,
      });
      const after = Date.now();

      assert.equal((await rows(fx)).get("43/02").title, "worker 43/02", "the frame's values landed");
      assert.notEqual(result.publishedAt, "not-a-real-instant");
      const stampedMs = Date.parse(result.publishedAt);
      assert.ok(Number.isFinite(stampedMs), "the result reports a valid ISO instant");
      assert.ok(stampedMs >= before - 1000 && stampedMs <= after + 1000, "…taken from the server clock");
    }),
  },
];
