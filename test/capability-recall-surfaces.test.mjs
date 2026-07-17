// Traceability wiring for milestone 39 / story 02, task 01
// (01_capability-recall-surfaces.feature).
//
// Every @executable scenario AND every Scenario-Outline Examples row is covered
// here, exercised DIRECTLY against `rankRecords` (`src/memory/local-retrieval.mjs`)
// over the feature's own FIXTURE index (the Background table) — no CLI, no disk,
// no story-01 authoring path, so this stays independent of story 01's code.
//
//   01_capability-recall-surfaces.feature — the ranking (39/ADR-003). THE
//   CALIBRATION GATE: a capability record + four verbose keyword-dense ADRs on a
//   "what provides X" query -> the capability returns #1. Plus: a decision-intent
//   query still returns the decisive ADR (tiebreaker, not override); the boost
//   never inverts a decisively-stronger base match; the boost is inert on a
//   non-capability query (ADR/lesson recall unchanged); --area delivery HARD
//   pre-filters (ADRs excluded from the candidate set entirely); a query-class ->
//   expected-top-record Scenario Outline.
import assert from "node:assert/strict";
import { rankRecords } from "../src/memory/local-retrieval.mjs";

// ---- fixture helpers ------------------------------------------------------------
function record(partial) {
  return {
    recordType: partial.recordType,
    id: partial.id,
    item: partial.item ?? "39",
    itemSlug: partial.itemSlug ?? "39_milestone_delivery-memory-outcome",
    title: partial.title ?? "",
    area: partial.area ?? "",
    stage: partial.stage ?? "",
    kind: partial.kind ?? "",
    owner: partial.owner ?? "",
    status: partial.status ?? "",
    summary: partial.summary ?? "",
    text: partial.text ?? "",
    source: partial.source ?? "39_milestone_delivery-memory-outcome/OUTCOME.md:1",
  };
}

function rankOf(records, id) {
  return records.findIndex((r) => r.id === id);
}

// ---- the Background fixture (the feature's table, instantiated) ----------------
// CAP — terse, dense: the title NAMES the queried surface (earns the title boost).
const CAP = record({
  id: "CAP",
  recordType: "capability",
  area: "delivery",
  title: "warnings delivery",
  summary: "warnings delivery is provided by the notifier path",
  text: "warnings delivery is provided by the notifier path",
});

// ADR-1..4 — long, keyword-dense: the TITLE does not carry the surface terms, but
// the body repeats "warnings delivery provides" amid padding (raw repetition,
// discounted by length-normalisation).
//
// The last two body lines (review fix, FIX 9): a STRICTLY DECREASING count of
// the two query terms that live in the body ("padding"/"rationale") from
// ADR-1 (highest) down to ADR-4 (zero) — every variant keeps the SAME total
// word count (8 words/line, "filler" swapped in for the dropped occurrence) so
// each ADR's own token length stays identical across all four, which keeps
// their relative score order CORPUS-INVARIANT (BM25 length-normalisation
// applies the same per-doc offset regardless of which other records share the
// candidate set). Previously all four bodies were byte-identical, so their
// relative order was tie-broken purely by array-insertion position — a
// re-rank regression that shuffled tied records could never have been caught.
const PADDING_LINE_VARIANTS = {
  "ADR-1": [
    "context decision invariant considered alternatives consequences padding rationale",
    "context decision invariant considered alternatives consequences padding rationale",
  ],
  "ADR-2": [
    "context decision invariant considered alternatives consequences padding filler",
    "context decision invariant considered alternatives consequences filler rationale",
  ],
  "ADR-3": [
    "context decision invariant considered alternatives consequences padding filler",
    "context decision invariant considered alternatives consequences filler filler",
  ],
  "ADR-4": [
    "context decision invariant considered alternatives consequences filler filler",
    "context decision invariant considered alternatives consequences filler filler",
  ],
};

function verboseAdr(id) {
  const [line3, line4] = PADDING_LINE_VARIANTS[id] ?? PADDING_LINE_VARIANTS["ADR-4"];
  return record({
    id,
    recordType: "adr",
    area: "architecture",
    title: "seal discipline is additive-optional, no new hash",
    text: [
      "warnings delivery provides warnings delivery provides warnings delivery provides",
      "warnings delivery provides warnings delivery provides warnings delivery provides",
      line3,
      line4,
    ].join(" "),
  });
}
const ADR_1 = verboseAdr("ADR-1");
const ADR_2 = verboseAdr("ADR-2");
const ADR_3 = verboseAdr("ADR-3");
const ADR_4 = verboseAdr("ADR-4");

// GAP — the gap statement plus its discharge condition.
const GAP = record({
  id: "GAP",
  recordType: "gap",
  area: "delivery",
  title: "warnings_delivered field",
  status: "open",
  summary: "warnings_delivered is written only by test fixtures — a production code path assigns warnings_delivered.",
  text: "warnings_delivered field warnings_delivered is written only by test fixtures a production code path assigns warnings_delivered",
});

// LESSON — short, on-point: about producers, NO "warnings delivery" term overlap.
const LESSON = record({
  id: "LESSON",
  recordType: "lesson",
  area: "process",
  title: "fill a field only when a producer exists",
  summary: "fill a field only when a producer exists",
  text: "fill a field only when a producer writer assignment exists before authoring a record format field",
});

const FIXTURE = [CAP, ADR_1, ADR_2, ADR_3, ADR_4, GAP, LESSON];

export const capabilityRecallSurfacesTests = [
  // ====================================================================
  // Scenario: the calibration gate — a capability query returns the capability
  // record #1 over four verbose ADRs.
  // ====================================================================
  {
    name: "01/recall: the calibration gate — a capability query returns the capability record #1 over four verbose ADRs",
    run: () => {
      const ranked = rankRecords(FIXTURE, "what provides warnings delivery", {}, {});
      assert.equal(ranked[0].id, "CAP", "the capability is the top-ranked record");
      const capPos = rankOf(ranked, "CAP");
      for (const id of ["ADR-1", "ADR-2", "ADR-3", "ADR-4"]) {
        assert.ok(capPos < rankOf(ranked, id), `CAP ranks above ${id}`);
      }
    },
  },

  // ====================================================================
  // Scenario: a decision-intent query still returns the decisive ADR first — the
  // capability boost is not an override.
  // ====================================================================
  {
    name: "01/recall: a decision-intent query still returns the decisive ADR first — the capability boost is not an override",
    run: () => {
      const ranked = rankRecords(FIXTURE, "seal discipline additive optional no new hash", {}, {});
      assert.notEqual(ranked[0].id, "CAP", "the capability is NOT top on a decision-intent query");
      assert.match(ranked[0].id, /^ADR-/, "the top-ranked record is a seal-discipline ADR");
    },
  },

  // ====================================================================
  // Scenario: even on a capability-intent query the boost never inverts a
  // decisively-stronger base match.
  // ====================================================================
  {
    name: "01/recall: even on a capability-intent query the boost never inverts a decisively-stronger base match",
    run: () => {
      // A capability-intent trigger ("provides") whose SURFACE terms only the
      // "seal discipline" ADRs match densely — CAP shares none of them. limit is
      // raised past the fixture's 7 records so a low-scoring CAP is still present
      // to compare positions against (the default limit is 5).
      const ranked = rankRecords(FIXTURE, "what provides seal discipline additive optional hash", {}, { limit: 10 });
      const capPos = rankOf(ranked, "CAP");
      const bestAdrPos = Math.min(...["ADR-1", "ADR-2", "ADR-3", "ADR-4"].map((id) => rankOf(ranked, id)));
      assert.ok(
        bestAdrPos < capPos,
        "a decisively-matched ADR ranks above the capability CAP even on a capability-intent query",
      );
    },
  },

  // ====================================================================
  // Scenario: the capability boost is inert on a non-capability query — ADR and
  // lesson recall are unchanged.
  // ====================================================================
  {
    name: "01/recall: the capability boost is inert on a non-capability query — ADR and lesson recall are unchanged",
    run: () => {
      // (a) Off-trigger: two records equally relevant in content — a capability and
      // an adr — score EQUAL (no lift).
      const equalPair = [
        record({ id: "CAP2", recordType: "capability", area: "delivery", title: "alpha topic", text: "alpha bravo charlie delta" }),
        record({ id: "ADR-EQ", recordType: "adr", area: "architecture", title: "alpha topic", text: "alpha bravo charlie delta" }),
      ];
      const equalRanked = rankRecords(equalPair, "alpha bravo charlie", {}, {});
      const cap2 = equalRanked.find((r) => r.id === "CAP2");
      const adrEq = equalRanked.find((r) => r.id === "ADR-EQ");
      assert.equal(cap2.score, adrEq.score, "off a capability-intent trigger the capability earns no lift");

      // (b) The relative order of ADR/lesson records over a non-capability query is
      // exactly what it was BEFORE the delivery records (CAP/GAP) were indexed —
      // compare the full fixture's ADR/lesson order against an ADR/lesson-only corpus.
      const queryNoTrigger = "additive optional new hash padding rationale";
      const fullRanked = rankRecords(FIXTURE, queryNoTrigger, {}, {});
      const adrLessonOnly = FIXTURE.filter((r) => ["adr", "lesson"].includes(r.recordType));
      const baselineRanked = rankRecords(adrLessonOnly, queryNoTrigger, {}, {});
      const fullOrder = fullRanked.filter((r) => ["adr", "lesson"].includes(r.recordType)).map((r) => r.id);
      const baselineOrder = baselineRanked.map((r) => r.id);
      // The four ADRs carry a genuinely NON-TRIVIAL, strictly-decreasing term
      // density (review fix, FIX 9) — pin that this comparison is actually
      // exercising order preservation, not merely confirming a tie stays a
      // tie (which would pass trivially even under a re-rank regression).
      assert.deepEqual(
        fullOrder,
        ["ADR-1", "ADR-2", "ADR-3", "ADR-4", "LESSON"],
        `the four ADRs carry a genuine, non-trivial order (ADR-1 densest .. ADR-4 sparsest); got ${JSON.stringify(fullOrder)}`,
      );
      assert.deepEqual(fullOrder, baselineOrder, "ADR/lesson relative order is unchanged by the presence of delivery records");
    },
  },

  // ====================================================================
  // Scenario: recall --area delivery hard pre-filters to delivery records,
  // excluding the ADRs from the candidate set entirely.
  // ====================================================================
  {
    name: "01/recall: recall --area delivery hard pre-filters to delivery records, excluding the ADRs from the candidate set entirely",
    run: () => {
      const ranked = rankRecords(FIXTURE, "what provides warnings delivery", { area: "delivery" }, {});
      const ids = ranked.map((r) => r.id);
      assert.deepEqual(new Set(ids), new Set(["CAP", "GAP"]), "only the delivery records CAP and GAP can rank");
      for (const id of ["ADR-1", "ADR-2", "ADR-3", "ADR-4"]) {
        assert.ok(!ids.includes(id), `${id} is excluded from the candidate set entirely`);
      }
      assert.equal(ranked[0].id, "CAP", "the top-ranked record is the capability CAP");
    },
  },

  // ====================================================================
  // Scenario Outline: the query class decides which record surfaces first (all
  // Examples rows across both tables).
  // ====================================================================
  {
    name: "01/recall outline: query class -> expected top-ranked record (all Examples rows)",
    run: () => {
      const rows = [
        // capability-intent — the calibration gate (unscoped)
        { query: "what provides warnings delivery", scope: {}, top: "CAP" },
        { query: "is warnings delivery built", scope: {}, top: "CAP" },
        // decision-intent — the decisive ADR is unchanged (tiebreaker, not override)
        { query: "seal discipline additive optional hash", scope: {}, top: "ADR-1" },
        // the area="delivery" hard pre-filter guarantees the capability regardless
        { query: "what provides warnings delivery", scope: { area: "delivery" }, top: "CAP" },
      ];
      for (const row of rows) {
        const ranked = rankRecords(FIXTURE, row.query, row.scope, {});
        assert.equal(ranked[0].id, row.top, `query "${row.query}" (scope ${JSON.stringify(row.scope)}) -> top ${row.top}`);
      }
    },
  },
];
