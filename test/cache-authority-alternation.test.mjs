// Traceability wiring for milestone 43 / story 02 (the authority cut), task
//   .../02_story_cache-authority/tasks/03_alternation-proof-the-worker-row-survives.feature
//
// AC6, THE CENTREPIECE — ADR-004's own prose fitness criterion made executable: publish,
// stream a worker delta, publish again, and assert THE WORKER'S ROW SURVIVES. Its sibling
// is the case that fails PERMANENTLY today: after a successful push the worker removes
// its worktree and never ticks again, while the control keeps publishing from a disk that
// still holds the pre-run scaffold.
//
// THE LITMUS: a fresh read of the cached rows through the store's public read surface,
// plus the publish tick's own result counts. No assertion about cadence, sleep or timing —
// the proof is that N further control ticks against an UNCHANGED control disk never move
// the worker's row.
import assert from "node:assert/strict";
import { readWorkItemDoc, upsertWorkItemContent } from "../src/global-work-store.mjs";
import {
  withCacheFixture,
  withStore,
  tick,
  stream,
  rows,
  itemRow,
  writeItem,
  WORKER_A,
} from "./support/cache-authority-fixture.mjs";

const SCAFFOLD_TITLE = "The authority cut";
const STREAM = [{ number: "43", stories: ["01", "02", "05"] }];

// Background: the control's own disk carries 43/02 as the PRE-RUN SCAFFOLD, and never
// changes for the duration of each scenario.
const withFixture = (body) => () => withCacheFixture(async (fx) => {
  await writeItem(fx, "43/02", { status: "not-started", title: SCAFFOLD_TITLE });
  return body(fx);
}, { stream: STREAM });

const skippedRef = (result, ref) => (result.skippedRefs ?? []).find((entry) => entry.ref === ref);

export const cacheAuthorityAlternationTests = [
  // ==========================================================================
  // Scenario: publish, stream a worker delta, publish again — the worker's row
  // survives
  // ==========================================================================
  {
    name: "cache-authority/03 THE ALTERNATION PROOF: publish -> worker delta -> publish again, and the worker's row survives with its own status and title, counted among the refs that tick skipped",
    run: withFixture(async (fx) => {
      await tick(fx);
      assert.equal((await rows(fx)).get("43/02").status, "not-started", "43/02 is cached with the control's scaffold status");

      await stream(fx, WORKER_A, [itemRow("43/02", { status: "in-progress", title: `${SCAFFOLD_TITLE} — WIP` })]);
      assert.equal((await rows(fx)).get("43/02").status, "in-progress", "the worker's delta landed");

      const propagation = await tick(fx);
      const row = (await rows(fx)).get("43/02");
      assert.equal(row.status, "in-progress", "…and the next control tick left it alone");
      assert.equal(row.title, `${SCAFFOLD_TITLE} — WIP`, "…title included");
      const skip = skippedRef(propagation.result, "43/02");
      assert.ok(skip != null, "that tick's result counts 43/02 among the refs it skipped rather than wrote");
      assert.equal(skip.reason, "authored-elsewhere");
      assert.equal(skip.reportedBy, WORKER_A, "…naming the node whose row it stepped over");
    }),
  },

  // ==========================================================================
  // Scenario Outline: however many control ticks follow the worker's report, the
  // row does not move
  // ==========================================================================
  ...[1, 2, 10].map((ticks) => ({
    name: `cache-authority/03 outline: ${ticks} further control tick(s) against an unchanged disk never move the worker's row, and every one of them counts 43/02 as skipped`,
    run: withFixture(async (fx) => {
      await tick(fx);
      await stream(fx, WORKER_A, [itemRow("43/02", { status: "in-progress", title: `${SCAFFOLD_TITLE} — WIP` })]);
      const reported = (await rows(fx)).get("43/02");

      for (let n = 0; n < ticks; n += 1) {
        const propagation = await tick(fx, { now: `2026-08-02T1${n}:00:00.000Z` });
        assert.ok(skippedRef(propagation.result, "43/02") != null, `tick ${n + 1} counted 43/02 among its skipped refs`);
        assert.deepEqual((await rows(fx)).get("43/02"), reported, `tick ${n + 1} left the row byte-identical`);
      }
      assert.equal((await rows(fx)).get("43/02").status, "in-progress", "it is settled, not a race one more tick resolves");
    }),
  })),

  // ==========================================================================
  // Scenario: an item settled by a worker still reads correctly after the worktree
  // is deleted and the worker stops ticking
  // ==========================================================================
  {
    name: "cache-authority/03 THE SIBLING CASE (permanent today): after the worktree is removed and the worker stops ticking, every read still reports 43/02 done with the worker's settled title — never back at the control's scaffold — and the streamed doc bodies still answer",
    run: withFixture(async (fx) => {
      await tick(fx);
      // The worker settles: its final delta plus the record-doc body it streamed for the
      // same ref (the two halves the board reads together).
      await stream(fx, WORKER_A, [itemRow("43/02", { status: "done", title: "The authority cut — shipped" })], {
        at: "2026-08-02T10:00:00.000Z",
      });
      await withStore(fx, (store) => upsertWorkItemContent(store, fx.workspaceId, {
        docs: [{ ref: "43/02", doc: "STORY", body: "# settled by worker-a\n" }],
        nodeId: WORKER_A,
      }, { now: "2026-08-02T10:00:00.000Z" }));

      // The worktree is gone and the worker reports nothing further; only the control
      // keeps publishing, from a disk that still holds the pre-run scaffold.
      for (let n = 0; n < 6; n += 1) {
        await tick(fx, { now: `2026-08-0${n + 3}T10:00:00.000Z` });
        const row = (await rows(fx)).get("43/02");
        assert.equal(row.status, "done", `read ${n}: still the worker's settled status`);
        assert.equal(row.title, "The authority cut — shipped", `read ${n}: still the worker's settled title`);
        assert.notEqual(row.status, "not-started", `read ${n}: never back at the control's scaffold status`);
        assert.notEqual(row.title, SCAFFOLD_TITLE);
      }

      const doc = await withStore(fx, (store) => readWorkItemDoc(store, fx.workspaceId, "43/02", "STORY"));
      assert.equal(doc?.body, "# settled by worker-a\n", "the streamed record-doc body still answers, so the row and its artifacts agree");
    }),
  },

  // ==========================================================================
  // Scenario: the control's own rows still refresh on every tick while the
  // worker's row is left alone
  // ==========================================================================
  {
    name: "cache-authority/03 the cure is not 'the tick does nothing' — the control's own 43/01 still tracks its disk on every tick while the worker's 43/02 is left alone",
    run: withFixture(async (fx) => {
      await tick(fx);
      await stream(fx, WORKER_A, [itemRow("43/02", { status: "in-progress" })]);

      await writeItem(fx, "43/01", { status: "done", title: "Item 43/01" });
      await tick(fx);

      const after = await rows(fx);
      assert.equal(after.get("43/01").status, "done", "the control's own row reflects the control's own disk");
      assert.equal(after.get("43/02").status, "in-progress", "…and the worker's row is untouched");
    }),
  },

  // ==========================================================================
  // Scenario Outline: whatever the interleaving, each ref carries its own author's
  // latest report
  // ==========================================================================
  ...[
    { sequence: "C,W,C", ref4302: "worker", ref4305: "control" },
    { sequence: "W,C", ref4302: "worker", ref4305: "control" },
    { sequence: "C,W,C,C,C", ref4302: "worker", ref4305: "control" },
    { sequence: "C,W,W,C", ref4302: "worker-latest", ref4305: "control" },
    { sequence: "C,C,C", ref4302: "control", ref4305: "control" },
  ].map(({ sequence, ref4302, ref4305 }) => ({
    name: `cache-authority/03 outline: the sequence ${sequence} leaves 43/02 as ${ref4302 === "control" ? "the control's disk status" : ref4302 === "worker" ? "the worker's reported status" : "the worker's LATEST report"} and 43/05 as the control's disk status`,
    run: withFixture(async (fx) => {
      let workerReports = 0;
      const steps = sequence.split(",");
      const controlOnly = !sequence.includes("W");
      for (const [index, step] of steps.entries()) {
        if (index === 1) {
          // MID-SEQUENCE, the control's own disk moves. Without this the 43/05 column
          // would expect the value the fixture already wrote before the sequence began,
          // and could not fail; and in the control-only row every tick after the first
          // would be asserting what the first one already wrote. The moved value is what
          // "the control's disk status" means at the end of the sequence.
          await writeItem(fx, "43/05", { status: "in-review", title: "43/05 moved mid-sequence" });
          if (controlOnly) await writeItem(fx, "43/02", { status: "blocked", title: SCAFFOLD_TITLE });
        }
        if (step === "C") {
          await tick(fx);
        } else {
          workerReports += 1;
          await stream(fx, WORKER_A, [itemRow("43/02", { status: workerReports === 1 ? "in-progress" : "in-review", title: `worker report ${workerReports}` })], {
            at: `2026-08-02T1${workerReports}:00:00.000Z`,
          });
        }
      }

      const after = await rows(fx);
      const expected4302 = ref4302 === "control" ? "blocked" : ref4302 === "worker" ? "in-progress" : "in-review";
      assert.equal(after.get("43/02").status, expected4302, `43/02 carries ${ref4302 === "control" ? "the control's LATEST disk status" : "its author's latest report"}`);
      assert.equal(after.get("43/05").status, "in-review", "43/05 — a ref only the control ever carries — tracks the control's disk THROUGH the sequence");
      assert.equal(after.get("43/05").title, "43/05 moved mid-sequence");
      assert.ok(after.has("43/05"), "…and it is present at all (neither writer's report can remove the other's ref)");
    }),
  })),
];
