// Traceability wiring for milestone 05 / story 02 (local-backend-retrieval).
//
// Every @executable scenario AND every Scenario-Outline Examples row across the
// story's four task features is covered here, exercised DIRECTLY against the
// retrieval module (`src/memory/local-retrieval.mjs`) over HAND-AUTHORED FIXTURE
// indexes of MemoryRecords (the frozen ADR-005 shape). No CLI, no disk, no
// story-01 parser code — recall obtains its records from an injected `ctx.records`
// array, so these tests are fully independent of stories 00/01.
//
//   00_scope-prefilter.feature   — scope filters (area/stage/kind/owner/item)
//        intersected (AND), applied as a HARD pre-filter BEFORE scoring; empty
//        scope = all candidates; empty-string-present lesson-only fields; no-match.
//   01_ranking-no-inversion.feature — the spike's F1 inversion does NOT recur: a
//        short on-point lesson ranks at/above a long term-heavy adr; title-match
//        + record-type boosts; highest-score-first; limit truncation (default 5).
//   02_recall-result-shape.feature  — recall returns { query, scope, records[],
//        text } over a fixture; scope echoed; each record a MemoryRecord + numeric
//        score; the text view projects the same records.
//   03_brief-digest.feature      — brief surfaces the lesson/adr split (counts) +
//        a recent-lessons-by-area digest; --item NN scopes it to one milestone.
import assert from "node:assert/strict";
import {
  rankRecords,
  applyScope,
  recall,
  brief,
  renderRecallText,
  MEMORY_RECORD_FIELDS
} from "../src/memory/local-retrieval.mjs";

// ── fixture helpers ──────────────────────────────────────────────────────────
// Build a full MemoryRecord (ADR-005) from a partial spec: absent-type fields are
// present as "" (the empty-string-present convention) so filters never undefined-
// guard. This is the frozen shape retrieval reads.
function record(partial) {
  return {
    recordType: partial.recordType,
    id: partial.id,
    item: partial.item ?? "00",
    itemSlug: partial.itemSlug ?? `m${partial.item ?? "00"}`,
    title: partial.title ?? "",
    area: partial.area ?? "",
    stage: partial.stage ?? "",
    kind: partial.kind ?? "",
    owner: partial.owner ?? "",
    status: partial.status ?? "",
    summary: partial.summary ?? "",
    text: partial.text ?? "",
    source: partial.source ?? `${partial.itemSlug ?? "m"}/FILE.md:1`
  };
}

function ids(records) {
  return records.map((r) => r.id);
}

// ── 00_scope-prefilter fixture (the feature Background) ──────────────────────
const SCOPE_FIXTURE = [
  record({ id: "R1", recordType: "lesson", item: "01", area: "architecture", stage: "design", kind: "smell", owner: "architect" }),
  record({ id: "R2", recordType: "lesson", item: "01", area: "tooling", stage: "build", kind: "near-miss", owner: "developer" }),
  record({ id: "R3", recordType: "lesson", item: "04", area: "architecture", stage: "build", kind: "near-miss", owner: "developer" }),
  record({ id: "ADR-002", recordType: "adr", item: "01", area: "architecture" }),
  record({ id: "ADR-009", recordType: "adr", item: "04", area: "architecture" })
];

// Parse a Scenario-Outline `scope` cell ("(empty)", "area tooling",
// "area architecture, stage build", "item 01", …) into a scope object.
function parseScopeCell(cell) {
  if (cell === "(empty)" || cell.trim() === "") return {};
  const scope = {};
  for (const clause of cell.split(",")) {
    const [field, ...rest] = clause.trim().split(/\s+/);
    scope[field] = rest.join(" ");
  }
  return scope;
}

// Parse an `ids` cell ("R1, R2", "(none)") into an array of expected ids.
function parseIdsCell(cell) {
  if (cell === "(none)" || cell.trim() === "") return [];
  return cell.split(",").map((s) => s.trim());
}

// ── 01_ranking fixtures ──────────────────────────────────────────────────────
// The spike's exact inversion fixture (LESSON / ADR / TITLED / OTHER). Texts are
// concrete instantiations of the feature's `text-shape` column:
//   LESSON — short, on-point: states the lesson once, densely (the query terms).
//   ADR    — long, term-heavy: repeats the query terms many times (raw repetition).
//   TITLED — short, on-point: the query terms appear in the TITLE.
//   OTHER  — long, no query-term overlap.
const RANK_FIXTURE = [
  record({
    id: "LESSON",
    recordType: "lesson",
    item: "01",
    area: "architecture",
    title: "requiring-grep is a fitness-fn smell",
    summary: "requiring grep in a fitness function is a smell",
    // short + dense: each on-point term once, no padding.
    text: "requiring grep fitness function smell"
  }),
  record({
    id: "ADR",
    recordType: "adr",
    item: "01",
    area: "architecture",
    title: "content-addressed manifest membership",
    summary: "membership is a content-addressed manifest",
    // long + term-heavy: repeats the query terms many times amid padding, so raw
    // term frequency is high but the text is long (length normalisation discounts it).
    text: [
      "requiring grep requiring grep requiring grep requiring grep",
      "fitness function fitness function fitness function fitness function",
      "smell smell smell smell smell",
      "content addressed manifest membership content addressed manifest membership",
      "content addressed manifest membership content addressed manifest membership",
      "padding context decision invariant rationale considered alternatives consequences",
      "padding context decision invariant rationale considered alternatives consequences"
    ].join(" ")
  }),
  record({
    id: "TITLED",
    recordType: "lesson",
    item: "01",
    area: "tooling",
    title: "pin line endings cross-platform",
    summary: "pin line endings for cross-platform reproducibility",
    // short, on-point; the query "pin line endings" terms appear in the TITLE and
    // once in the body, but NOT the grep/fitness terms.
    text: "normalise checkout reproducible bytes cross platform"
  }),
  record({
    id: "OTHER",
    recordType: "adr",
    item: "04",
    area: "process",
    title: "unrelated decision",
    summary: "an unrelated decision",
    text: [
      "unrelated decision about scheduling cadence and review ceremony",
      "standup retro planning estimation velocity backlog grooming sprint",
      "completely orthogonal vocabulary with no query overlap whatsoever here"
    ].join(" ")
  })
];

// For the "pin line endings" title-boost row the order is "TITLED, LESSON":
// TITLED and LESSON are made EQUALLY relevant on the query (the same on-point body
// terms, equal length), so the only differentiator is the title match — TITLED
// carries "pin line endings" in its TITLE, LESSON does not. The title-match boost
// must lift TITLED above the equally-relevant LESSON. This is the feature's "a
// title-term match lifts a record above an equally-relevant record without it".
const TITLE_BODY = "pin line endings reproducible cross platform bytes";
const TITLE_FIXTURE = RANK_FIXTURE.map((r) => {
  if (r.id === "TITLED") return { ...r, text: TITLE_BODY }; // terms in title AND body
  // LESSON: same on-point body terms, but its title ("requiring-grep …") has none of
  // them — so at equal content relevance the title boost decides in TITLED's favour.
  if (r.id === "LESSON") return { ...r, text: TITLE_BODY };
  return r;
});

// A 2-record corpus mirroring the spike's exact pair, for the inversion order
// assertion ("LESSON, ADR") with no third record diluting it.
const INVERSION_PAIR = RANK_FIXTURE.filter((r) => r.id === "LESSON" || r.id === "ADR");

// 8 records that all match a common query term ("alpha"), for limit truncation.
const EIGHT_MATCHING = Array.from({ length: 8 }, (_, i) =>
  record({
    id: `M${i + 1}`,
    recordType: i % 2 === 0 ? "lesson" : "adr",
    item: "01",
    area: "architecture",
    title: `record ${i + 1}`,
    text: `alpha beta record number ${i + 1} alpha`
  })
);

// ── 02_recall-result-shape fixture (the feature Background) ──────────────────
const SHAPE_FIXTURE = [
  record({
    id: "R1",
    recordType: "lesson",
    item: "01",
    itemSlug: "acd-asset-bundle",
    area: "architecture",
    title: "requiring-grep is a fitness-fn smell",
    summary: "requiring grep is a smell",
    text: "requiring grep is a fitness function smell content addressed manifest",
    source: "01_milestone_acd-asset-bundle/RETROSPECTIVE.md:42"
  }),
  record({
    id: "ADR-002",
    recordType: "adr",
    item: "01",
    itemSlug: "acd-asset-bundle",
    area: "architecture",
    title: "content-addressed manifest membership",
    summary: "membership is a content-addressed manifest",
    text: "content addressed manifest membership content addressed hash",
    source: "01_milestone_acd-asset-bundle/ARCHITECTURE.md:66"
  })
];

// ── 03_brief-digest fixture (the feature Background) ─────────────────────────
const BRIEF_FIXTURE = [
  record({ id: "R1", recordType: "lesson", item: "01", area: "architecture" }),
  record({ id: "R2", recordType: "lesson", item: "01", area: "tooling" }),
  record({ id: "R3", recordType: "lesson", item: "04", area: "architecture" }),
  record({ id: "ADR-002", recordType: "adr", item: "01", area: "architecture" }),
  record({ id: "ADR-007", recordType: "adr", item: "01", area: "architecture" }),
  record({ id: "ADR-009", recordType: "adr", item: "04", area: "architecture" })
];

// rank position of an id within a ranked record list.
function rankOf(ranked, id) {
  return ranked.findIndex((r) => r.id === id);
}

export const memoryRetrievalTests = [
  // ===================================================================
  // 00_scope-prefilter.feature
  // ===================================================================
  {
    name: "scope-prefilter: an empty scope leaves every record a candidate",
    run: () => {
      const survivors = applyScope(SCOPE_FIXTURE, {});
      assert.deepEqual(ids(survivors), ["R1", "R2", "R3", "ADR-002", "ADR-009"]);
    }
  },
  {
    name: "scope-prefilter: a single area filter keeps only records in that area",
    run: () => {
      const survivors = applyScope(SCOPE_FIXTURE, { area: "tooling" });
      assert.deepEqual(ids(survivors), ["R2"]);
    }
  },
  {
    name: "scope-prefilter: intersected filters keep only records matching every filter (AND)",
    run: () => {
      const survivors = applyScope(SCOPE_FIXTURE, { area: "architecture", stage: "build", kind: "near-miss" });
      assert.deepEqual(ids(survivors), ["R3"]);
    }
  },
  {
    name: "scope-prefilter: a filter on a lesson-only field excludes every adr (adr fields are empty-string)",
    run: () => {
      const survivors = applyScope(SCOPE_FIXTURE, { kind: "near-miss" });
      assert.deepEqual(ids(survivors), ["R2", "R3"]);
    }
  },
  {
    name: "scope-prefilter: a scope that no record satisfies yields zero candidates",
    run: () => {
      const survivors = applyScope(SCOPE_FIXTURE, { area: "architecture", owner: "product-owner" });
      assert.deepEqual(ids(survivors), []);
    }
  },
  // Scenario Outline: the scope pre-filter admits exactly the records matching every filter.
  {
    name: "scope-prefilter: outline — scope → surviving ids (all Examples rows)",
    run: () => {
      const rows = [
        // empty scope and single-filter scopes
        { scope: "(empty)", ids: "R1, R2, R3, ADR-002, ADR-009" },
        { scope: "item 01", ids: "R1, R2, ADR-002" },
        { scope: "area tooling", ids: "R2" },
        { scope: "owner developer", ids: "R2, R3" },
        // intersected multi-filter scopes (AND across fields)
        { scope: "area architecture, stage build", ids: "R3" },
        { scope: "area architecture, stage build, kind near-miss", ids: "R3" },
        { scope: "area architecture, item 04", ids: "R3, ADR-009" },
        // lesson-only / adr-only fields under the empty-string-present convention
        { scope: "kind near-miss", ids: "R2, R3" },
        { scope: "stage design", ids: "R1" },
        // no-match scopes yield zero survivors
        { scope: "area security", ids: "(none)" },
        { scope: "area architecture, owner developer-x", ids: "(none)" }
      ];
      for (const row of rows) {
        const survivors = applyScope(SCOPE_FIXTURE, parseScopeCell(row.scope));
        assert.deepEqual(
          ids(survivors),
          parseIdsCell(row.ids),
          `scope "${row.scope}" → ${row.ids}`
        );
      }
    }
  },
  // The scope pre-filter must run BEFORE scoring: a recall over the fixture with a
  // scope never surfaces an off-scope record even when the off-scope record would
  // out-score the survivors. (Reinforces ADR-006's hard-pre-filter ordering.)
  {
    name: "scope-prefilter: the pre-filter runs before scoring (recall never surfaces an off-scope record)",
    run: () => {
      // ADR-002 (area architecture) would match the query strongly; scoping to
      // tooling must exclude it and leave only R2 even though R2 has no query terms.
      const ranked = rankRecords(SHAPE_FIXTURE, "content addressed manifest", { area: "tooling" }, {});
      assert.deepEqual(ids(ranked), []);
      const inArch = rankRecords(SHAPE_FIXTURE, "content addressed manifest", { area: "architecture" }, {});
      assert.ok(inArch.every((r) => r.area === "architecture"), "no off-scope record in results");
    }
  },

  // ===================================================================
  // 01_ranking-no-inversion.feature
  // ===================================================================
  {
    // The spike's exact inversion case: the on-point lesson ranks at/above the
    // longer term-heavy adr, AND is the top-ranked record.
    name: "ranking: the on-point lesson ranks at or above the longer term-heavy adr (and is top)",
    run: () => {
      const ranked = rankRecords(RANK_FIXTURE, "requiring grep fitness function smell", {}, {});
      const lessonPos = rankOf(ranked, "LESSON");
      const adrPos = rankOf(ranked, "ADR");
      assert.ok(lessonPos >= 0, "LESSON is in the results");
      assert.ok(adrPos >= 0, "ADR is in the results");
      assert.ok(lessonPos <= adrPos, `LESSON (#${lessonPos}) ranks at or above ADR (#${adrPos})`);
      assert.equal(ranked[0].id, "LESSON", "LESSON is the top-ranked record");
    }
  },
  {
    // Record-type boost: at otherwise-equal relevance the lesson outranks the adr.
    name: "ranking: at equivalent relevance the lesson outranks the adr on the record-type boost",
    run: () => {
      // Two records, identical text/title length and identical query-term content
      // → identical content score; only the record-type boost differs.
      const equalRelevance = [
        record({ id: "L", recordType: "lesson", item: "01", area: "architecture", title: "alpha topic", text: "alpha bravo charlie delta" }),
        record({ id: "A", recordType: "adr", item: "01", area: "architecture", title: "alpha topic", text: "alpha bravo charlie delta" })
      ];
      const ranked = rankRecords(equalRelevance, "alpha bravo charlie", {}, {});
      assert.ok(rankOf(ranked, "L") < rankOf(ranked, "A"), "lesson L outranks adr A at equal relevance");
    }
  },
  {
    // Title-match boost: a query term in a record's title lifts it.
    name: "ranking: a title-term match lifts a record above an equally-relevant record without the title match",
    run: () => {
      const ranked = rankRecords(TITLE_FIXTURE, "pin line endings", {}, {});
      assert.equal(ranked[0].id, "TITLED", "TITLED (terms in title) is the top-ranked record");
    }
  },
  {
    // Highest-score-first ordering.
    name: "ranking: results are returned highest-score-first",
    run: () => {
      const ranked = rankRecords(RANK_FIXTURE, "requiring grep fitness function smell", {}, {});
      for (let i = 1; i < ranked.length; i++) {
        assert.ok(
          ranked[i - 1].score >= ranked[i].score,
          `score[${i - 1}]=${ranked[i - 1].score} >= score[${i}]=${ranked[i].score}`
        );
      }
    }
  },
  {
    // Default limit of 5.
    name: "ranking: results are truncated to the default limit of 5",
    run: () => {
      const ranked = rankRecords(EIGHT_MATCHING, "alpha", {}, {});
      assert.equal(ranked.length, 5, "exactly 5 records returned by default");
    }
  },
  {
    // Explicit limit truncation.
    name: "ranking: an explicit limit truncates to that many records",
    run: () => {
      const ranked = rankRecords(EIGHT_MATCHING, "alpha", {}, { limit: 3 });
      assert.equal(ranked.length, 3, "exactly 3 records returned with limit 3");
    }
  },
  // Scenario Outline: ranking surfaces the right record first and in the right order.
  {
    name: "ranking: outline — query → top-ranked id + ranked order (all Examples rows)",
    run: () => {
      // Row 1 — the spike's inversion: the short on-point lesson wins, never the
      // long term-heavy adr. Use the exact LESSON/ADR pair so the order is exactly
      // "LESSON, ADR".
      {
        const ranked = rankRecords(INVERSION_PAIR, "requiring grep fitness function smell", {}, {});
        assert.equal(ranked[0].id, "LESSON", "row1: top is LESSON");
        assert.deepEqual(ids(ranked), ["LESSON", "ADR"], "row1: order is LESSON, ADR");
      }
      // Row 2 — title-match boost: the record whose title carries the query terms
      // ranks first, then the body-only lesson. Pair them so order is "TITLED, LESSON".
      {
        const pair = TITLE_FIXTURE.filter((r) => r.id === "TITLED" || r.id === "LESSON");
        const ranked = rankRecords(pair, "pin line endings", {}, {});
        assert.equal(ranked[0].id, "TITLED", "row2: top is TITLED");
        assert.deepEqual(ids(ranked), ["TITLED", "LESSON"], "row2: order is TITLED, LESSON");
      }
      // Row 3 — relevance dominates: a query the adr matches far more strongly than
      // any lesson still ranks the adr first (the type boost is only a tiebreaker).
      {
        const pair = RANK_FIXTURE.filter((r) => r.id === "ADR" || r.id === "LESSON");
        const ranked = rankRecords(pair, "content addressed manifest", {}, {});
        assert.equal(ranked[0].id, "ADR", "row3: top is ADR (relevance dominates the type boost)");
        assert.deepEqual(ids(ranked), ["ADR", "LESSON"], "row3: order is ADR, LESSON");
      }
    }
  },

  // ===================================================================
  // 02_recall-result-shape.feature
  // ===================================================================
  {
    name: "recall-shape: recall returns the four top-level RecallResult keys",
    run: async () => {
      const result = await recall("content addressed manifest", { area: "architecture" }, {}, { records: SHAPE_FIXTURE });
      assert.deepEqual(Object.keys(result).sort(), ["query", "records", "scope", "text"]);
    }
  },
  {
    name: "recall-shape: the result echoes back the query and the applied scope",
    run: async () => {
      const result = await recall("content addressed manifest", { area: "architecture" }, {}, { records: SHAPE_FIXTURE });
      assert.equal(result.query, "content addressed manifest");
      assert.deepEqual(result.scope, { area: "architecture" });
    }
  },
  {
    name: "recall-shape: each returned record carries a numeric score plus the frozen MemoryRecord fields",
    run: async () => {
      const result = await recall("content addressed manifest", { area: "architecture" }, {}, { records: SHAPE_FIXTURE });
      assert.ok(result.records.length > 0, "at least one record returned");
      for (const r of result.records) {
        assert.equal(typeof r.score, "number", `${r.id} carries a numeric score`);
        for (const field of MEMORY_RECORD_FIELDS) {
          assert.ok(Object.prototype.hasOwnProperty.call(r, field), `${r.id} carries MemoryRecord field "${field}"`);
        }
      }
    }
  },
  {
    name: "recall-shape: the text view is a projection of the same records the agent path reads",
    run: async () => {
      const result = await recall("content addressed manifest", { area: "architecture" }, {}, { records: SHAPE_FIXTURE });
      const recordIds = ids(result.records);
      // every record id appears in the text view
      for (const id of recordIds) {
        assert.ok(result.text.includes(id), `text view surfaces record id ${id}`);
      }
      // the text view introduces no id absent from the records array. Check that
      // no OTHER known fixture id (one not in the result) leaked into the text.
      const absentIds = SHAPE_FIXTURE.map((r) => r.id).filter((id) => !recordIds.includes(id));
      for (const id of absentIds) {
        assert.ok(!result.text.includes(id), `text view does not introduce absent id ${id}`);
      }
    }
  },
  {
    name: "recall-shape: a scope echo reflects an empty scope as an empty filter set",
    run: async () => {
      const result = await recall("content addressed manifest", {}, {}, { records: SHAPE_FIXTURE });
      assert.deepEqual(result.scope, {}, "empty scope echoes no applied filters");
    }
  },
  // Scenario Outline: recall returns the frozen shape with an echoed scope and scored records.
  {
    name: "recall-shape: outline — frozen shape + echoed scope + scored records + text projection (all rows)",
    run: async () => {
      const rows = [
        { query: "content addressed", scope: "(empty)", echoed: {} },
        { query: "content addressed", scope: "area architecture", echoed: { area: "architecture" } }
      ];
      for (const row of rows) {
        const result = await recall(row.query, parseScopeCell(row.scope), {}, { records: SHAPE_FIXTURE });
        assert.deepEqual(Object.keys(result).sort(), ["query", "records", "scope", "text"], `${row.scope}: four keys`);
        assert.deepEqual(result.scope, row.echoed, `${row.scope}: echoes ${JSON.stringify(row.echoed)}`);
        for (const r of result.records) {
          assert.equal(typeof r.score, "number", `${row.scope}: ${r.id} has numeric score`);
        }
        // text surfaces exactly the record ids in the records array.
        const recordIds = ids(result.records);
        for (const id of recordIds) assert.ok(result.text.includes(id), `${row.scope}: text surfaces ${id}`);
        const absent = SHAPE_FIXTURE.map((r) => r.id).filter((id) => !recordIds.includes(id));
        for (const id of absent) assert.ok(!result.text.includes(id), `${row.scope}: text omits ${id}`);
      }
    }
  },
  {
    // recall obtains its records from an injected ctx.loadIndex() too (the path the
    // orchestrator's glue uses with the real on-disk index loader).
    name: "recall-shape: recall sources records from ctx.loadIndex() when no ctx.records array is given",
    run: async () => {
      const result = await recall(
        "content addressed manifest",
        { area: "architecture" },
        {},
        { loadIndex: async () => ({ records: SHAPE_FIXTURE }) }
      );
      assert.ok(result.records.length > 0, "records loaded via ctx.loadIndex()");
      assert.deepEqual(Object.keys(result).sort(), ["query", "records", "scope", "text"]);
    }
  },

  // ===================================================================
  // 03_brief-digest.feature
  // ===================================================================
  {
    name: "brief: reports the lesson/adr split for the whole corpus",
    run: async () => {
      const digest = await brief({}, {}, { records: BRIEF_FIXTURE });
      assert.equal(digest.lessonCount, 3, "3 lessons");
      assert.equal(digest.adrCount, 3, "3 adrs");
    }
  },
  {
    name: "brief: surfaces a recent-lessons-by-area digest grouped by area",
    run: async () => {
      const digest = await brief({}, {}, { records: BRIEF_FIXTURE });
      assert.deepEqual(
        (digest.lessonsByArea.architecture || []).map((l) => l.id),
        ["R1", "R3"],
        'area "architecture" lists lessons R1, R3'
      );
      assert.deepEqual(
        (digest.lessonsByArea.tooling || []).map((l) => l.id),
        ["R2"],
        'area "tooling" lists lessons R2'
      );
    }
  },
  {
    name: "brief: the lesson/adr split makes an adr-heavy corpus visible (1 lesson, 5 adrs)",
    run: async () => {
      const adrHeavy = [
        record({ id: "R1", recordType: "lesson", item: "01", area: "architecture" }),
        record({ id: "ADR-001", recordType: "adr", item: "01", area: "architecture" }),
        record({ id: "ADR-002", recordType: "adr", item: "01", area: "architecture" }),
        record({ id: "ADR-003", recordType: "adr", item: "01", area: "architecture" }),
        record({ id: "ADR-004", recordType: "adr", item: "01", area: "architecture" }),
        record({ id: "ADR-005", recordType: "adr", item: "01", area: "architecture" })
      ];
      const digest = await brief({}, {}, { records: adrHeavy });
      assert.equal(digest.lessonCount, 1, "1 lesson");
      assert.equal(digest.adrCount, 5, "5 adrs");
    }
  },
  {
    name: "brief: --item NN scopes the brief to one milestone (item 01 → 2 lessons, 2 adrs)",
    run: async () => {
      const digest = await brief({ item: "01" }, {}, { records: BRIEF_FIXTURE });
      assert.equal(digest.lessonCount, 2, "milestone 01: 2 lessons");
      assert.equal(digest.adrCount, 2, "milestone 01: 2 adrs");
      // only records from milestone 01 are counted: no item-04 lesson/adr in groups.
      for (const lessons of Object.values(digest.lessonsByArea)) {
        for (const l of lessons) assert.equal(l.item, "01", "every counted lesson is from milestone 01");
      }
    }
  },
  {
    name: "brief: --item NN scopes the recent-lessons digest to that milestone (item 04)",
    run: async () => {
      const digest = await brief({ item: "04" }, {}, { records: BRIEF_FIXTURE });
      assert.deepEqual(
        (digest.lessonsByArea.architecture || []).map((l) => l.id),
        ["R3"],
        'item 04: area "architecture" lists lesson R3'
      );
      // no lesson from another milestone appears in the digest.
      for (const lessons of Object.values(digest.lessonsByArea)) {
        for (const l of lessons) assert.equal(l.item, "04", "no lesson from another milestone in the digest");
      }
    }
  },
  // Scenario Outline: brief reports the lesson/adr counts for the scoped corpus.
  {
    name: "brief: outline — item scope → lesson/adr counts (all Examples rows)",
    run: async () => {
      const rows = [
        { item: "(none)", lessons: 3, adrs: 3 },
        { item: "01", lessons: 2, adrs: 2 },
        { item: "04", lessons: 1, adrs: 1 }
      ];
      for (const row of rows) {
        const scope = row.item === "(none)" ? {} : { item: row.item };
        const digest = await brief(scope, {}, { records: BRIEF_FIXTURE });
        assert.equal(digest.lessonCount, row.lessons, `item ${row.item}: ${row.lessons} lessons`);
        assert.equal(digest.adrCount, row.adrs, `item ${row.item}: ${row.adrs} adrs`);
      }
    }
  },
  {
    // brief also renders a text projection (JSON-is-contract / text-is-projection).
    name: "brief: renders a text view surfacing the lesson/adr counts",
    run: async () => {
      const digest = await brief({}, {}, { records: BRIEF_FIXTURE });
      assert.equal(typeof digest.text, "string", "brief carries a rendered text view");
      assert.ok(digest.text.includes("3 lesson"), "text reports the lesson count");
      assert.ok(digest.text.includes("3 adr"), "text reports the adr count");
    }
  },

  // ===================================================================
  // Cross-cutting: renderRecallText is a standalone projection helper.
  // ===================================================================
  {
    name: "render: renderRecallText surfaces exactly the result's record ids",
    run: () => {
      const ranked = rankRecords(SHAPE_FIXTURE, "content addressed manifest", { area: "architecture" }, {});
      const result = { query: "content addressed manifest", scope: { area: "architecture" }, records: ranked, text: "" };
      const text = renderRecallText(result);
      for (const r of ranked) assert.ok(text.includes(r.id), `text surfaces ${r.id}`);
    }
  }
];
