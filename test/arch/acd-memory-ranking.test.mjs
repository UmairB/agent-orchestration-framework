// Fitness function for milestone 05 / ADR-006 (acd-memory-ranking):
//
//   "recall applies scope filters as a HARD pre-filter before scoring (no
//    off-scope record appears in results), and scoring is length-normalised so
//    raw term repetition in a longer record cannot outrank a shorter, denser
//    match of equivalent relevance — the spike's documented F1 inversion does
//    NOT recur."
//
// Behavioural proof over a HAND-AUTHORED fixture index (the frozen ADR-005
// MemoryRecord shape) — no indexer code (story 01), no seam/argv (story 00). The
// fixture mirrors the spike's scenario: one LONG, term-heavy `adr` that repeats
// the query terms many times, and one SHORT, on-point `lesson` of equivalent
// relevance, plus an OFF-SCOPE record that would out-score the survivors if scope
// were a soft signal rather than a hard pre-filter.
import assert from "node:assert/strict";
import { recall, rankRecords } from "../../src/memory/local-retrieval.mjs";

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

// The query the inversion turns on (the spike's "fitness function grep" family).
const QUERY = "requiring grep fitness function smell";

// A hand-authored fixture index:
//   ON_POINT_LESSON — short, on-point: states the lesson once, densely, in `area`
//                     architecture (the IN-SCOPE area).
//   TERM_HEAVY_ADR  — long: repeats the query terms many times amid padding (raw
//                     repetition), also in architecture.
//   OFF_SCOPE_ADR   — in a DIFFERENT area (tooling); also repeats the query terms,
//                     so it would out-score the survivors if scope were soft. The
//                     hard pre-filter must exclude it entirely from an architecture
//                     scoped recall.
const FIXTURE = [
  record({
    id: "ON_POINT_LESSON",
    recordType: "lesson",
    item: "01",
    area: "architecture",
    title: "requiring-grep is a fitness-fn smell",
    summary: "requiring grep in a fitness function is a smell",
    text: "requiring grep fitness function smell"
  }),
  record({
    id: "TERM_HEAVY_ADR",
    recordType: "adr",
    item: "01",
    area: "architecture",
    title: "content-addressed manifest membership",
    summary: "membership is a content-addressed manifest",
    text: [
      "requiring grep requiring grep requiring grep requiring grep requiring grep",
      "fitness function fitness function fitness function fitness function",
      "smell smell smell smell smell smell",
      "padding rationale context decision invariant considered alternatives consequences",
      "padding rationale context decision invariant considered alternatives consequences"
    ].join(" ")
  }),
  record({
    id: "OFF_SCOPE_ADR",
    recordType: "adr",
    item: "01",
    area: "tooling",
    title: "off-scope but term-heavy",
    summary: "off-scope, would out-score if scope were soft",
    text: [
      "requiring grep requiring grep requiring grep requiring grep requiring grep",
      "fitness function fitness function fitness function fitness function fitness function",
      "smell smell smell smell smell smell smell smell"
    ].join(" ")
  })
];

function rankOf(records, id) {
  return records.findIndex((r) => r.id === id);
}

export const archTests = [
  {
    name: "arch/ADR-006: a scoped recall returns ZERO off-scope records (scope is a hard pre-filter)",
    run: async () => {
      const result = await recall(QUERY, { area: "architecture" }, {}, { records: FIXTURE });
      // No off-scope (tooling) record survives, even though it repeats the query
      // terms most aggressively and would top a soft-filter ranking.
      assert.ok(
        result.records.every((r) => r.area === "architecture"),
        `no off-scope record in results — got areas: ${result.records.map((r) => r.area).join(", ")}`
      );
      assert.equal(
        rankOf(result.records, "OFF_SCOPE_ADR"),
        -1,
        "the off-scope (tooling) record is excluded by the hard pre-filter, not merely out-ranked"
      );
      // The applied scope is echoed back.
      assert.deepEqual(result.scope, { area: "architecture" }, "scope echoed");
    }
  },
  {
    name: "arch/ADR-006: the short on-point lesson ranks at or above the long term-heavy adr (F1 inversion does not recur)",
    run: async () => {
      const result = await recall(QUERY, { area: "architecture" }, {}, { records: FIXTURE });
      const lessonPos = rankOf(result.records, "ON_POINT_LESSON");
      const adrPos = rankOf(result.records, "TERM_HEAVY_ADR");
      assert.ok(lessonPos >= 0, "the on-point lesson is in the results");
      assert.ok(adrPos >= 0, "the term-heavy adr is in the results");
      // Length normalisation (BM25-lite) + the record-type tiebreaker: the short
      // dense lesson must NOT lose to the long adr that wins on raw repetition.
      assert.ok(
        lessonPos <= adrPos,
        `ON_POINT_LESSON (#${lessonPos}) must rank at or above TERM_HEAVY_ADR (#${adrPos}) — the spike's inversion must not recur`
      );
    }
  },
  {
    name: "arch/ADR-006: with the record-type boost removed, length-normalisation + title-match still hold the dense match at or above the long padded record",
    run: async () => {
      // Same fixture but BOTH records are adrs, so the record-type tiebreaker cannot
      // be the thing that saves the short record. NOTE (honesty): this isolates the
      // type boost, NOT length-normalisation in isolation — the surviving signal is
      // length-norm + the title-match boost combined (the short record's title carries
      // the query terms). On THIS small corpus the query terms saturate in both texts,
      // so length-normalisation alone does not strictly win; the anti-inversion
      // guarantee is the COMBINED signal stack (see STATE `## Feedback (for retro)`,
      // and the ADR-006 wording correction carried there). The behaviour — the dense
      // on-point record never loses to the long padded one — is what ADR-006 promises.
      const bothAdr = [
        { ...FIXTURE[0], id: "SHORT_DENSE_ADR", recordType: "adr" },
        { ...FIXTURE[1], id: "LONG_PADDED_ADR", recordType: "adr" }
      ];
      const ranked = rankRecords(bothAdr, QUERY, { area: "architecture" }, {});
      const shortPos = rankOf(ranked, "SHORT_DENSE_ADR");
      const longPos = rankOf(ranked, "LONG_PADDED_ADR");
      assert.ok(shortPos >= 0 && longPos >= 0, "both adrs ranked");
      assert.ok(
        shortPos <= longPos,
        `the short dense adr (#${shortPos}) ranks at or above the long padded adr (#${longPos}) on the combined length-norm + title-match signal`
      );
    }
  }
];
