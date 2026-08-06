// Traceability wiring for milestone 43 / story 02 (the authority cut), task
//   .../02_story_cache-authority/tasks/02_author-retraction-is-the-only-deletion.feature
//
// AC4: deletion is by AUTHOR RETRACTION, never by a sweep and never by time. A
// publishing node passes the full ref set it is authoritative for, and the seam deletes
// rows where `node_id = <this node> AND ref NOT IN <that set>`. A node may retract ONLY
// what it itself authored; it may never delete another node's row; and NO deletion may
// ever be predicated on a timestamp.
//
// THE LITMUS is deliberately the COLUMN-FREE one: a fresh read of the cached rows
// through the store's public read surface — the row is either still readable or it is
// not. Survival-vs-deletion proves authorship without reading a provenance column.
//
// A scenario cannot prove an absence, so the never-evict rule is asserted here as the
// OBSERVABLE outcome (the ancient row is still readable after tick upon tick), never as
// "no time-predicated DELETE exists" — that is the arch-test's job
// (acd-cache-staleness-single-predicate).
import assert from "node:assert/strict";
import { upsertWorkItems } from "../src/global-work-store.mjs";
import { invoke } from "../src/command-core.mjs";
import {
  withCacheFixture,
  withStore,
  tick,
  stream,
  rows,
  authorOf,
  projectionErrors,
  itemRow,
  writeItem,
  deleteItem,
  breakItem,
  otherWorkspace,
  CONTROL,
  WORKER_A,
  WORKER_B,
} from "./support/cache-authority-fixture.mjs";

const STREAM = [{ number: "43", stories: ["01", "02", "03"] }];
const withFixture = (body) => () => withCacheFixture(body, { stream: STREAM });

// publish(fx, node, { claims }) — "<node> publishes workspace acme with an authoritative
// ref set that <…>". `claims === undefined` is the ABSENT set (a partial report, which
// claims authority over nothing); `[]` is the explicitly EMPTY set ("I carry none").
async function publish(fx, node, { claims, rows: carried = [] } = {}) {
  return withStore(fx, (store) => upsertWorkItems(store, fx.workspaceId, carried, {
    nodeId: node,
    authority: node === CONTROL ? "disk-derived" : "reported",
    syncedAt: "2026-08-02T12:00:00.000Z",
    authoritativeRefs: claims,
  }));
}

// The three ways a cached row for 43/02 comes to be authored by somebody.
async function authorRow(fx, author) {
  if (author === CONTROL) {
    await tick(fx);
    return;
  }
  if (author === "no recorded author") {
    // THE SCHEMA-v8 MIGRATION RESIDUE: a row written before the provenance columns
    // existed. Every door stamps, so this state is only reachable by writing the row as
    // an upgraded store carries it — which is exactly what a real fleet has on the day
    // it upgrades.
    await withStore(fx, (store) => store.db.prepare(`
      INSERT INTO work_items (workspace_id, ref, type, slug, status, title, parent, source_path, node_id, updated_at)
      VALUES (?, '43/02', 'story', 's43-02', 'not-started', 'Item 43/02', '43', '/repo/wiki/work/43/02/STORY.md', NULL, NULL)
    `).run(fx.workspaceId));
    return;
  }
  await stream(fx, author, [itemRow("43/02", { status: "in-progress" })]);
}

export const cacheAuthorityRetractionTests = [
  // ==========================================================================
  // Scenario: a node retracts a row it authored once that ref leaves its
  // authoritative set
  // ==========================================================================
  {
    name: "cache-authority/02 a node retracts a row it authored once that ref leaves its authoritative set — 43/03 is deleted from the control's disk and drops out, 43/01 and 43/02 stay",
    run: withFixture(async (fx) => {
      await tick(fx);
      assert.ok((await rows(fx)).has("43/03"), "43/03 starts cached (non-vacuous)");

      await deleteItem(fx, "43/03");
      const propagation = await tick(fx);

      const after = await rows(fx);
      assert.equal(after.has("43/03"), false, "the ref that left the control's disk is retracted");
      assert.equal(propagation.result.retracted, 1, "…and the tick reports exactly one retraction");
      assert.ok(after.has("43/01") && after.has("43/02"), "the refs it still carries are untouched");
    }),
  },

  // ==========================================================================
  // Scenario: a node never deletes a row another node authored, even when its own
  // ref set omits it
  // ==========================================================================
  {
    name: "cache-authority/02 a node never deletes a row another node authored — the control's disk loses 43/02 entirely and the worker-authored row survives every tick",
    run: withFixture(async (fx) => {
      await tick(fx);
      await stream(fx, WORKER_A, [itemRow("43/02", { status: "in-progress" })]);

      // The control's own ref set stops naming 43/02 at all — the case today's wholesale
      // delete gets wrong, because it deletes first and asks nothing.
      await deleteItem(fx, "43/02");
      const propagation = await tick(fx);

      assert.equal((await rows(fx)).get("43/02")?.status, "in-progress", "the row another node authored is not the control's to remove");
      assert.equal(propagation.result.retracted, 0, "the tick retracted nothing");
    }),
  },

  // ==========================================================================
  // Scenario Outline: exactly which rows a publish removes
  // ==========================================================================
  ...[
    { author: CONTROL, publisher: CONTROL, set: "names it", outcome: "kept" },
    { author: CONTROL, publisher: CONTROL, set: "omits it", outcome: "deleted" },
    { author: WORKER_A, publisher: CONTROL, set: "omits it", outcome: "kept" },
    { author: WORKER_A, publisher: WORKER_A, set: "omits it", outcome: "deleted" },
    { author: WORKER_A, publisher: WORKER_B, set: "omits it", outcome: "kept" },
    { author: WORKER_A, publisher: WORKER_A, set: "names it", outcome: "kept" },
    { author: CONTROL, publisher: CONTROL, set: "is absent (a partial report)", outcome: "kept" },
    { author: CONTROL, publisher: CONTROL, set: "is present but empty", outcome: "deleted" },
    { author: WORKER_A, publisher: CONTROL, set: "is present but empty", outcome: "kept" },
    { author: "no recorded author", publisher: CONTROL, set: "omits it", outcome: "kept" },
  ].map(({ author, publisher, set, outcome }) => ({
    name: `cache-authority/02 outline: a row authored by ${author}, published by ${publisher} with a ref set that ${set} — the row is ${outcome}`,
    run: withFixture(async (fx) => {
      await authorRow(fx, author);
      assert.ok((await rows(fx)).has("43/02"), "the row under test exists before the publish (non-vacuous)");

      const claims = set === "names it" ? ["43/01", "43/02", "43/03"]
        : set === "omits it" ? ["43/01", "43/03"]
          : set === "is present but empty" ? []
            : undefined;
      await publish(fx, publisher, { claims });

      assert.equal(
        (await rows(fx)).has("43/02"),
        outcome === "kept",
        `${publisher}'s publish should have ${outcome} a row authored by ${author}`,
      );
    }),
  })),

  // ==========================================================================
  // Scenario: publishing one workspace never retracts another workspace's rows
  // ==========================================================================
  {
    name: "cache-authority/02 retraction is workspace-scoped — publishing acme without 43/02 never touches beta's own 43/02",
    run: withFixture(async (fx) => {
      await tick(fx);
      const beta = await otherWorkspace(fx, "beta", ["43", "43/02"]);
      await tick(fx, { workspace: beta.workspace });
      assert.ok((await rows(fx, beta.workspaceId)).has("43/02"), "beta carries a 43/02 of its own");

      await deleteItem(fx, "43/02");
      await tick(fx);

      assert.equal((await rows(fx)).has("43/02"), false, "acme's 43/02 is retracted");
      assert.equal((await rows(fx, beta.workspaceId)).get("43/02")?.title, "beta 43/02", "beta's own 43/02 is untouched");
    }),
  },

  // ==========================================================================
  // Scenario: a ref first authored by the control and later reported by a worker
  // survives a control-side retraction
  // ==========================================================================
  {
    name: "cache-authority/02 a ref the control authored and a worker later reported carries the WORKER's authorship — the control cannot retract it, and worker-a can",
    run: withFixture(async (fx) => {
      await tick(fx);
      await stream(fx, WORKER_A, [itemRow("43/02", { status: "in-progress" })]);

      await deleteItem(fx, "43/02");
      await tick(fx);
      assert.equal((await rows(fx)).get("43/02")?.status, "in-progress", "the worker's copy is the live one and survives the control's retraction");

      await publish(fx, WORKER_A, { claims: ["43/01"] });
      assert.equal((await rows(fx)).has("43/02"), false, "…and a later publish from worker-a whose set omits it does remove it");
    }),
  },

  // ==========================================================================
  // Scenario: a partial report retracts nothing, while an explicitly empty
  // authoritative set retracts everything that node authored
  // ==========================================================================
  {
    name: "cache-authority/02 ABSENT vs EMPTY — a partial report naming only 43/02 retracts nothing, then an explicitly empty set retracts every worker-authored row and no control-authored one",
    run: withFixture(async (fx) => {
      await tick(fx);
      await stream(fx, WORKER_A, [itemRow("43/01", { status: "in-progress" }), itemRow("43/02", { status: "in-progress" })]);

      // A streamed delta IS the partial report: it names 43/02 and claims authority over
      // nothing, so 43/01 (which worker-a also authored) must not fall out.
      const partial = await stream(fx, WORKER_A, [itemRow("43/02", { status: "in-review" })]);
      assert.equal(partial.retracted, 0, "a partial report retracts nothing");
      const afterPartial = await rows(fx);
      assert.ok(afterPartial.has("43/01") && afterPartial.has("43/02"), "both worker-authored rows are still reported");

      await publish(fx, WORKER_A, { claims: [] });
      const afterEmpty = await rows(fx);
      assert.equal(afterEmpty.has("43/01"), false, "an explicitly EMPTY authoritative set retracts what that node authored");
      assert.equal(afterEmpty.has("43/02"), false);
      assert.ok(afterEmpty.has("43"), "…and every row the control authored is still reported");
      assert.ok(afterEmpty.has("43/03"));
    }),
  },

  // ==========================================================================
  // Scenario: an item whose record doc fails to parse this tick is reported as an
  // error, never retracted
  // ==========================================================================
  {
    name: "cache-authority/02 a read fault is not a retraction — 43/03's frontmatter breaks, the publish counts it among its skipped items and names the doc, and the cached row keeps its last good status",
    run: withFixture(async (fx) => {
      await tick(fx);
      assert.equal((await rows(fx)).get("43/03").status, "not-started");

      await breakItem(fx, "43/03");
      const propagation = await tick(fx);

      assert.equal(propagation.result.skipped, 1, "the publish result counts the unreadable item among its skipped items");
      assert.equal(propagation.result.retracted, 0, "…and retracts nothing");
      const errors = await projectionErrors(fx);
      assert.equal(errors.length, 1, "the cached projection errors name that record doc");
      assert.match(errors[0].sourcePath, /03_story_s43-03\/STORY\.md$/);
      assert.equal((await rows(fx)).get("43/03")?.status, "not-started", "and the cached row is still reported with its last good status");
    }),
  },

  // ==========================================================================
  // ADR-012/B6 + the PO's ruling at 43/02's review — THE RENUMBER. Author
  // retraction cannot reach another node's row, which is correct and is the whole
  // cure; its cost is the case where a ref STOPS MEANING what it meant. After
  // `43/03 -> 43/04` the operator's brand-new story owns `43/03`, so a worker's row
  // left there is not a stale copy of the right item — it is a DIFFERENT item's
  // slug, title and status at a live ref, permanently, because every later tick
  // skips it as `authored-elsewhere`. Measured as a regression against HEAD, where
  // the wholesale rebuild self-healed a renumber on the next tick.
  //
  // The cure is the operator door this story already built: the renumber is a
  // control-side operator act, so its publish takes authorship of exactly the refs
  // it rewrote — BOTH ends of every remap entry — and may retract those refs
  // whoever authored them. Driven through the REAL `work:insert-story` verb: the
  // reactor wiring is the fix, and a test that called the seam directly would prove
  // the seam and miss the wiring.
  // ==========================================================================
  {
    name: "cache-authority/02 THE RENUMBER: after a real insert-story renumbers a ref worker-a authored, the cache reports the NEW item at that ref with the control's disk values — never the previous occupant's",
    run: withFixture(async (fx) => {
      await tick(fx);
      await stream(fx, WORKER_A, [itemRow("43/03", { status: "in-progress", title: "worker 43/03" })]);
      assert.equal((await rows(fx)).get("43/03").title, "worker 43/03", "the ref about to be renumbered is worker-authored (non-vacuous)");

      // The operator inserts a story AT that number: 43/03 becomes 43/04, and a brand-new
      // 43/03 takes its place on disk.
      const inserted = await invoke("work:insert-story", { slug: "renumber-probe", at: 3, under: 43, yes: true }, fx.ctx);
      assert.equal(inserted.created.ref, "43/03", "the operator's new story owns 43/03 on disk");
      await tick(fx);

      const after = await rows(fx);
      assert.equal(after.get("43/03").slug, "renumber-probe", "the cache reports the NEW item at that ref");
      assert.equal(await authorOf(fx, "43/03"), CONTROL, "…authored by the node that rewrote the ref");
      assert.notEqual(after.get("43/03").title, "worker 43/03", "…never the previous occupant's title");
      assert.equal(after.get("43/04")?.slug, "s43-03", "and the renumbered item is readable at its new ref");
    }),
  },
  {
    name: "cache-authority/02 THE RENUMBER: a ref the renumber VACATES carries no row at all, whoever authored it — and a ref the operator never touched is untouched",
    run: withFixture(async (fx) => {
      await tick(fx);
      // worker-a authors the last story, and a row the renumber will never name.
      await stream(fx, WORKER_A, [
        itemRow("43/03", { status: "in-progress", title: "worker 43/03" }),
        itemRow("43/07", { status: "in-progress", title: "worker 43/07 — never renumbered" }),
      ]);

      await invoke("work:insert-story", { slug: "renumber-probe", at: 3, under: 43, yes: true }, fx.ctx);
      const afterInsert = await rows(fx);
      // The reindex publish runs BEFORE the caller scaffolds the new item, so at that
      // instant 43/03 exists on no disk — and must therefore carry NO row rather than the
      // worker's row under the ref's old meaning.
      assert.equal(afterInsert.get("43/03")?.title, undefined, "no row survives on a ref the renumber vacated, whoever authored it");
      assert.equal(
        afterInsert.get("43/07")?.title,
        "worker 43/07 — never renumbered",
        "a worker-authored row the renumber never named is untouched — the operator's reach is its own refs, never the workspace",
      );
    }),
  },

  // ==========================================================================
  // Scenario: no publish ever deletes a row because of its age
  // ==========================================================================
  {
    name: "cache-authority/02 NEVER EVICT — a row worker-a reported long past any staleness window survives ten control ticks spread across a year, unchanged",
    run: withFixture(async (fx) => {
      await tick(fx);
      await stream(fx, WORKER_A, [itemRow("43/02", { status: "in-progress", title: "Reported once, long ago" })], {
        at: "2020-01-01T00:00:00.000Z",
      });
      const reported = (await rows(fx)).get("43/02");

      // The worker has stopped reporting entirely; only the control keeps ticking, and
      // its clock runs far past any window this milestone configures.
      for (let n = 0; n < 10; n += 1) {
        const propagation = await tick(fx, { now: `2026-0${(n % 9) + 1}-01T00:00:00.000Z` });
        assert.equal(propagation.result.retracted, 0, `tick ${n} retracted nothing`);
        assert.deepEqual((await rows(fx)).get("43/02"), reported, `tick ${n} left the ancient row byte-identical`);
      }

      // …and the row that is genuinely gone from its own author's disk still goes, so
      // "nothing is ever deleted" is not the reason the assertion above passes.
      await writeItem(fx, "43/02", { status: "not-started" });
      await deleteItem(fx, "43/01");
      await tick(fx);
      assert.equal((await rows(fx)).has("43/01"), false, "age deletes nothing; a retraction still does");
    }),
  },
];
