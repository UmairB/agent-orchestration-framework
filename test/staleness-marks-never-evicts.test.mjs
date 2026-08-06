// Traceability wiring for milestone 43 / story 04 (staleness, never eviction), task
//   .../04_story_staleness-and-resync/tasks/02_stale-marks-never-evicts.feature
//
// AC 2 / AC 4 / AC 6 / AC 12: what the window actually DOES — it MARKS. The shared strict-`>`
// predicate decides freshness for two subjects (the row and each artifact), a missing instant
// yields `unknown` rather than `stale`, and no row is ever removed because it got old. The
// only sanctioned removal in the whole cache is ADR-004's author retraction, predicated on
// authorship and ref-set membership.
//
// THE LITMUS, as the task's header sets it: every Then is confirmable from a value the
// server-side read boundary RETURNS for a planted store state at an INJECTED `now` — the
// freshness verdict on a serialised row, the verdict on a serialised artifact, and the row's
// own content read back after the fact. No source read and no wall clock.
//
// WHERE THE VERDICT COMES FROM, and why it is not a row field. The window is ONE number for
// the whole response (task 01: "no individual row carries a window, a threshold or a
// pre-computed stale flag of its own"), so the boundary is the shared predicate APPLIED to a
// serialised record with the window taken off the SAME serialised envelope the board sends.
// Every verdict below is therefore computed exactly the way a reader must compute it, from
// facts that actually crossed the wire — never from a flag the server pre-baked.
//
// WHY THE BOUNDARY IS THE WHOLE TASK. The predicate is strict `>` — `now − syncedAt > window`
// — so a record EXACTLY AT the window is still FRESH (`300 > 300` is false). That is not a
// detail: DESIGN has the badge recomputed in the BROWSER against a live 1-second tick, so the
// rule genuinely runs on two sides of the wire and the two must agree at the threshold
// instant. A `>=` implementation passes every other row in the first Outline and fails only
// the one named "EXACTLY at the window".
import assert from "node:assert/strict";
import { invoke, loadWorkspace } from "../src/command-core.mjs";
import { cacheFreshness } from "../src/cache-provenance.mjs";
import { upsertWorkItems } from "../src/global-work-store.mjs";
import {
  withStalenessFixture,
  setStalenessWindow,
  listResponse,
  docResponse,
  streamDoc,
  streamRun,
  storeRow,
  plantRow,
  counts,
  tick,
  withStore,
  at,
  NOW,
  NOW_MS,
  WINDOW_SECONDS,
  CONTROL_NODE,
  WORKER_NODE,
} from "./support/staleness-fixture.mjs";

const REF = "43/04";

// THE READ BOUNDARY, in one function: serialise the response, take the window from the
// envelope the board actually sent, and apply the SHARED predicate at the injected `now`.
// Nothing here re-derives a comparison — `cacheFreshness` calls run-store's `isStale`, the
// same definition the run layer, the node layer and session TTL already share.
async function verdicts(fx, ref = REF, doc = "SPEC") {
  const { body } = await listResponse(fx);
  const row = body.items.find((item) => item.ref === ref) ?? null;
  const artifact = await docResponse(fx, ref, doc);
  return {
    stalenessSeconds: body.stalenessSeconds,
    row,
    rowState: row == null ? null : cacheFreshness(row, { nowMs: NOW_MS, stalenessSeconds: body.stalenessSeconds }),
    artifact,
    // A cache MISS is not a stale artifact — there is no artifact to judge, so there is no
    // artifact verdict at all. `present:false` is the miss; `syncedAt` absent from a present
    // doc would be the unknown case, which is a different answer.
    docState: artifact?.present === true
      ? cacheFreshness(artifact, { nowMs: NOW_MS, stalenessSeconds: body.stalenessSeconds })
      : null,
  };
}

const withWindow = (body) => () => withStalenessFixture(async (fx) => {
  await setStalenessWindow(fx, WINDOW_SECONDS);
  return body(fx);
});

export const stalenessMarksNeverEvictsTests = [
  // ==========================================================================
  // HEADLINE (AC 4), Scenario Outline: the ROW's freshness is decided by strict
  // `>` — at the window it is still fresh, past it it is stale
  // ==========================================================================
  ...[
    { label: "brand new", age: 0, state: "fresh" },
    { label: "well inside", age: 120, state: "fresh" },
    { label: "one second under", age: 299, state: "fresh" },
    { label: "EXACTLY at the window", age: 300, state: "fresh" },
    { label: "one second over", age: 301, state: "stale" },
    { label: "far past", age: 86400, state: "stale" },
  ].map(({ label, age, state }) => ({
    name: `staleness/02 the ROW's freshness is strict-\`>\` at an injected now — ${label} (${age}s) is ${state}, and the row is served either way`,
    run: withWindow(async (fx) => {
      await plantRow(fx, REF, { node: WORKER_NODE, at: at(age) });

      const seen = await verdicts(fx);
      assert.equal(seen.stalenessSeconds, WINDOW_SECONDS, "the window on the wire is the configured 300 seconds");
      assert.equal(seen.rowState, state, `a row ${age}s old against a ${WINDOW_SECONDS}s window is ${state}`);
      // …and the row is PRESENT in the response regardless of the verdict. Staleness is a
      // mark on a copy that is still being served, never a reason to withhold it.
      assert.ok(seen.row != null, "the row is present in the response regardless of the verdict");
      assert.equal(seen.row.reportedBy, WORKER_NODE, "…still attributed");
      assert.equal(seen.row.syncedAt, at(age), "…still carrying the instant the verdict was computed from");
    }),
  })),

  // The threshold instant asserted directly against the SHARED predicate, so the property
  // the browser half must agree with is pinned independently of any serialisation: `300 >
  // 300` is false. A `>=` implementation differs from this on exactly one input.
  {
    name: "staleness/02 the shared predicate disagrees with the forbidden `>=` form at exactly the threshold instant — 300s against a 300s window is FRESH, 301s is STALE",
    run: async () => {
      assert.equal(cacheFreshness({ syncedAt: at(300) }, { nowMs: NOW_MS, stalenessSeconds: 300 }), "fresh");
      assert.equal(cacheFreshness({ syncedAt: at(301) }, { nowMs: NOW_MS, stalenessSeconds: 300 }), "stale");
      assert.equal(cacheFreshness({ syncedAt: NOW }, { nowMs: NOW_MS, stalenessSeconds: 0 }), "fresh", "a zero window still calls the instant itself fresh (0 > 0 is false)");
      assert.equal(cacheFreshness({ syncedAt: at(1) }, { nowMs: NOW_MS, stalenessSeconds: 0 }), "stale", "…and anything older stale, which is what a zero window means");
    },
  },

  // ==========================================================================
  // AC 6, Scenario Outline: each ARTIFACT is judged on its OWN syncedAt,
  // independently of the row that names it
  // ==========================================================================
  ...[
    { label: "both fresh", rowAge: 60, docAge: 60, rowState: "fresh", docState: "fresh" },
    { label: "a doc OLDER than the row that names it", rowAge: 60, docAge: 7200, rowState: "fresh", docState: "stale" },
    { label: "a row older than its freshly-pushed doc", rowAge: 7200, docAge: 60, rowState: "stale", docState: "fresh" },
    { label: "both stale", rowAge: 7200, docAge: 7200, rowState: "stale", docState: "stale" },
    { label: "doc EXACTLY at the window, row past it", rowAge: 301, docAge: 300, rowState: "stale", docState: "fresh" },
    { label: "no cached doc at all", rowAge: 60, docAge: null, rowState: "fresh", docState: null },
  ].map(({ label, rowAge, docAge, rowState, docState }) => ({
    name: `staleness/02 the ARTIFACT is judged on its OWN instant, never the row's — ${label}`,
    run: withWindow(async (fx) => {
      await plantRow(fx, REF, { node: WORKER_NODE, at: at(rowAge) });
      if (docAge != null) await streamDoc(fx, { ref: REF, doc: "SPEC", node: WORKER_NODE, at: at(docAge) });

      const seen = await verdicts(fx);
      assert.equal(seen.rowState, rowState, `the row's freshness state is ${rowState}`);
      if (docState == null) {
        // The doc is a cache MISS, not a stale doc — there is no artifact verdict at all.
        assert.equal(seen.artifact.present, false, "an absent doc is a cache miss, reported absent-not-error");
        assert.equal(seen.docState, null, "…and carries no freshness verdict — there is nothing to judge");
      } else {
        assert.equal(seen.docState, docState, `the doc's freshness state is ${docState}`);
        assert.equal(seen.artifact.syncedAt, at(docAge), "…computed from the doc's OWN syncedAt");
      }
      // Neither verdict was INHERITED from the other, shown by a counterfactual rather
      // than by comparing two instants that `at()` already built apart: judge the row on
      // the DOC's instant and, wherever the two straddle the window, the answer is a
      // different verdict from the one the boundary actually returned. An implementation
      // that let either subject's instant decide both would have produced that other
      // answer for one of them.
      if (docAge != null && rowState !== docState) {
        const rowJudgedOnTheDocsInstant = cacheFreshness(
          { syncedAt: seen.artifact.syncedAt },
          { nowMs: NOW_MS, stalenessSeconds: seen.stalenessSeconds },
        );
        assert.equal(rowJudgedOnTheDocsInstant, docState, "the doc's instant genuinely yields the doc's verdict under the one predicate");
        assert.notEqual(seen.rowState, rowJudgedOnTheDocsInstant, "…and the ROW's verdict is not the one its doc's instant would have produced — it was computed from its own");
      }
    }),
  })),

  // ==========================================================================
  // AC 2, Scenario Outline: a missing or unusable instant yields `unknown` —
  // never `stale`, and never a fabricated freshness
  // ==========================================================================
  ...[
    { label: "never stamped (pre-v8 row)", stored: null, state: "unknown" },
    { label: "empty string", stored: "", state: "unknown" },
    { label: "unparseable text", stored: "sometime last tuesday", state: "unknown" },
    { label: "a future instant (clock skew)", stored: at(-120), state: "fresh" },
    { label: "the epoch", stored: "1970-01-01T00:00:00.000Z", state: "stale" },
  ].map(({ label, stored, state }) => ({
    name: `staleness/02 an unusable instant is \`unknown\`, never \`stale\` — ${label} reads ${state}`,
    run: withWindow(async (fx) => {
      await plantRow(fx, REF, { node: WORKER_NODE, at: stored });

      const before = await storeRow(fx, REF);
      const seen = await verdicts(fx);
      assert.equal(seen.rowState, state, `a syncedAt of ${JSON.stringify(stored)} reads ${state}`);
      if (state !== "stale") {
        assert.notEqual(seen.rowState, "stale", "it is never reported stale on the strength of a missing instant");
      }

      // The read boundary did NOT write a value back into the row to make it judgeable —
      // reading is not a licence to stamp, which would be ADR-006's forbidden backfill
      // arriving through the read path instead of the write path.
      const after = await storeRow(fx, REF);
      assert.equal(after.updated_at, before.updated_at, "the read boundary wrote nothing back into updated_at");
      assert.equal(after.node_id, before.node_id, "…nor into node_id");
      assert.equal(after.updated_at, stored, "…so the stored value is exactly what was planted");
    }),
  })),

  // The future instant, stated as its own claim: it is PARSEABLE, so it is judged, and
  // `now − t` is negative — which is not `> window`. That is the honest answer for a skewed
  // peer clock: not "unknown" (we have an instant) and certainly not "stale".
  {
    name: "staleness/02 a FUTURE syncedAt (a skewed peer clock) reads `fresh` — it is parseable, so it is judged, and a negative age is not past any window",
    run: async () => {
      assert.equal(cacheFreshness({ syncedAt: at(-1) }, { nowMs: NOW_MS, stalenessSeconds: 300 }), "fresh");
      assert.equal(cacheFreshness({ syncedAt: at(-86400) }, { nowMs: NOW_MS, stalenessSeconds: 300 }), "fresh");
      assert.equal(cacheFreshness({ syncedAt: at(-1) }, { nowMs: NOW_MS, stalenessSeconds: 0 }), "fresh", "…even against a zero window");
      assert.notEqual(cacheFreshness({ syncedAt: at(-1) }, { nowMs: NOW_MS, stalenessSeconds: 300 }), "unknown", "never `unknown` — an instant IS known");
    },
  },

  // ==========================================================================
  // HEADLINE (AC 12): a row aged far past the window is MARKED stale and is
  // STILL FULLY READABLE — it is never deleted
  // ==========================================================================
  {
    name: "staleness/02 a 30-DAY-OLD row survives a propagation tick and a store close/reopen — marked stale, still fully readable, with its doc body, both run records and every row count intact",
    run: withWindow(async (fx) => {
      const THIRTY_DAYS = 30 * 24 * 60 * 60;
      const ancient = at(THIRTY_DAYS);

      // The row as its author reported it 30 days ago, with a cached SPEC doc and two
      // cached run records of the same age.
      await plantRow(fx, REF, {
        node: WORKER_NODE,
        at: ancient,
        fields: { status: "in-review", title: "Staleness, never eviction", slug: "staleness-and-resync", parent: "43" },
      });
      await streamDoc(fx, { ref: REF, doc: "SPEC", body: "# 43/04 · the ancient cached body\n", node: WORKER_NODE, at: ancient });
      await streamRun(fx, { ref: REF, runId: "20260704T090000000Z-0001", node: WORKER_NODE, at: ancient });
      await streamRun(fx, { ref: REF, runId: "20260704T100000000Z-0002", node: WORKER_NODE, at: ancient });

      const before = await counts(fx);
      const stored = await storeRow(fx, REF);

      // …the control node runs its ORDINARY propagation tick (the one that used to sweep
      // and rebuild), and the store is closed and re-opened.
      await tick(fx, { now: NOW });
      const reopened = await storeRow(fx, REF);

      const seen = await verdicts(fx);
      assert.equal(seen.rowState, "stale", "the row is reported stale");
      assert.ok(seen.row != null, "…and is still present");

      // Its own facts read back exactly as they were reported 30 days ago. The tick's
      // disk-derived writer saw another node's author stamp and stepped over the row.
      assert.deepEqual(
        [reopened.status, reopened.title, reopened.type, reopened.slug, reopened.parent],
        [stored.status, stored.title, stored.type, stored.slug, stored.parent],
        "status, title, type, slug and parent read back exactly as reported",
      );
      assert.equal(reopened.node_id, WORKER_NODE, "…still attributed to the node that reported it");
      assert.equal(reopened.updated_at, ancient, "…and its instant was never refreshed by being read");

      // The cached SPEC body is still served IN FULL, attributed to the reporting node.
      assert.equal(seen.artifact.present, true, "the cached SPEC body is still served");
      assert.equal(seen.artifact.body, "# 43/04 · the ancient cached body\n", "…in full, byte-identical");
      assert.equal(seen.artifact.reportedBy, WORKER_NODE, "…attributed to umairs-mac-mini");
      assert.equal(seen.docState, "stale", "…and honestly marked stale, not hidden");

      // Both cached run records are still readable.
      const workspace = await loadWorkspace(fx.root, undefined, { env: fx.env });
      const runs = await invoke("work:run-status", { ref: REF }, { workspace, globalWorkStoreOptions: { env: fx.env } });
      assert.equal(runs.runs.length, 2, "both cached run records are still readable");
      assert.deepEqual(
        runs.runs.map((run) => run.runId).sort(),
        ["20260704T090000000Z-0001", "20260704T100000000Z-0002"],
        "…and are the two that were reported",
      );

      // The row counts across all three cache tables are unchanged BY THE AGE of the rows —
      // i.e. nothing was removed. `work_items` may legitimately GROW, because the control's
      // ordinary tick also publishes its own disk slice (here: the milestone row above
      // 43/04); what the never-evict rule forbids is a count going DOWN because a row got
      // old. Asserted as "no ancient row left" plus a non-decreasing count, which is the
      // claim; a bare deepEqual would fail on the tick doing its normal job.
      const after = await counts(fx);
      assert.ok(after.items >= before.items, "no work_items row was removed for being old");
      assert.equal(after.docs, before.docs, "no work_item_docs row was removed for being old");
      assert.equal(after.runs, before.runs, "no work_item_runs row was removed for being old");
      assert.ok(await storeRow(fx, REF), "…and the ancient row itself is still there, which is what the counts are about");
    }),
  },

  // ==========================================================================
  // AC 12 / ADR-004, Scenario Outline: removal is by AUTHOR RETRACTION only —
  // age neither causes a removal nor prevents one
  // ==========================================================================
  ...[
    { label: "ancient row its author still claims", author: WORKER_NODE, age: 30 * 24 * 3600, publisher: WORKER_NODE, includes: true, outcome: "retained" },
    { label: "ancient row its author has dropped", author: WORKER_NODE, age: 30 * 24 * 3600, publisher: WORKER_NODE, includes: false, outcome: "removed" },
    { label: "brand-new row its author has dropped", author: WORKER_NODE, age: 5, publisher: WORKER_NODE, includes: false, outcome: "removed" },
    { label: "ancient row belonging to ANOTHER node", author: WORKER_NODE, age: 30 * 24 * 3600, publisher: CONTROL_NODE, includes: false, outcome: "retained" },
  ].map(({ label, author, age, publisher, includes, outcome }) => ({
    name: `staleness/02 removal is by AUTHOR RETRACTION only — ${label} is ${outcome}`,
    run: withWindow(async (fx) => {
      await plantRow(fx, REF, { node: author, at: at(age) });
      assert.ok(await storeRow(fx, REF), "the row is cached before the episode");

      // The publisher states the full ref set it is authoritative for. That set — and the
      // row's own recorded AUTHOR — is the whole predicate; no clock is consulted.
      await withStore(fx, (store) => upsertWorkItems(store, fx.workspaceId, [], {
        nodeId: publisher,
        authority: publisher === CONTROL_NODE ? "disk-derived" : "reported",
        syncedAt: NOW,
        authoritativeRefs: includes ? [REF] : [],
      }));

      const after = await storeRow(fx, REF);
      if (outcome === "retained") {
        assert.ok(after != null, "the row is retained");
        assert.equal(after.node_id, author, "…still carrying its author's stamp");
        assert.equal(after.updated_at, at(age), "…and its own instant, untouched by the episode");
      } else {
        assert.equal(after, null, "the row is removed");
      }
    }),
  })),

  // The SHAPE of the rule, asserted as the pairing the Examples table encodes: rows 2 and 3
  // differ ONLY in age and share an outcome; rows 1 and 2 differ ONLY in membership and
  // differ in outcome. Together they say age decides nothing and membership decides
  // everything — which one row on its own can never say.
  {
    name: "staleness/02 age decides NOTHING and membership decides everything — two rows differing only in age share an outcome, two differing only in membership do not",
    run: withWindow(async (fx) => {
      const ANCIENT = "43/04";
      const NEW = "43";

      // Same author, same publisher, same dropped ref set — the ONLY difference is age.
      await plantRow(fx, ANCIENT, { node: WORKER_NODE, at: at(30 * 24 * 3600) });
      await plantRow(fx, NEW, { node: WORKER_NODE, at: at(5) });
      await withStore(fx, (store) => upsertWorkItems(store, fx.workspaceId, [], {
        nodeId: WORKER_NODE,
        authority: "reported",
        syncedAt: NOW,
        authoritativeRefs: [],
      }));
      assert.equal(await storeRow(fx, ANCIENT), null, "the 30-day-old row its author dropped is removed");
      assert.equal(await storeRow(fx, NEW), null, "…and so is the 5-second-old one — age changed nothing");

      // Now the same two ages with the ref CLAIMED: both survive, for the same reason.
      await plantRow(fx, ANCIENT, { node: WORKER_NODE, at: at(30 * 24 * 3600) });
      await plantRow(fx, NEW, { node: WORKER_NODE, at: at(5) });
      await withStore(fx, (store) => upsertWorkItems(store, fx.workspaceId, [], {
        nodeId: WORKER_NODE,
        authority: "reported",
        syncedAt: NOW,
        authoritativeRefs: [ANCIENT, NEW],
      }));
      assert.ok(await storeRow(fx, ANCIENT), "claimed, the ancient row is retained");
      assert.ok(await storeRow(fx, NEW), "claimed, the new row is retained");
    }),
  },
];
