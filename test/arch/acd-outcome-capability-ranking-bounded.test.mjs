// Fitness function for milestone 39 / ADR-003:
// "A capability record surfaces for a 'what provides X / is X built' query above
//  verbose ADRs — via the base title-boost + length-normalisation (a terse,
//  well-titled capability is already competitive) PLUS a query-class-conditional
//  capability type-boost that is a BOUNDED tiebreaker (< one title-match term),
//  NEVER a blanket relevance override (05/ADR-006)."
//
// Idiom (mirrors acd-memory-ranking): a NON-VACUOUS live assertion armed TODAY —
// a terse, well-titled capability ranks at or above a verbose keyword-dense ADR on
// a capability query, on the EXISTING ranker (title boost + BM25 length-norm) — so
// a regression in that base mechanism goes RED today. Red-until-built: the bounded
// type-boost boundaries + the four-ADR acceptance self-activate once story 02 lands
// the `TYPE_BOOST_CAPABILITY` (ADR-003 mechanism #2), detected by a live probe.
import assert from "node:assert/strict";
import { rankRecords } from "../../src/memory/local-retrieval.mjs";

function record(partial) {
  return {
    recordType: partial.recordType,
    id: partial.id,
    item: partial.item ?? "39",
    itemSlug: partial.itemSlug ?? "m39",
    title: partial.title ?? "",
    area: partial.area ?? "",
    stage: "",
    kind: "",
    owner: "",
    status: partial.status ?? "",
    summary: partial.summary ?? "",
    text: partial.text ?? "",
    source: partial.source ?? "39/OUTCOME.md:1",
  };
}
const rankOf = (records, id) => records.findIndex((r) => r.id === id);

// A capability-intent query: a trigger word ("provides") + the queried surface.
const CAP_QUERY = "provides warnings delivery";

// A well-authored capability: title NAMES the surface (earns the title boost),
// summary/text are the terse dense delivered statement.
const CAPABILITY = record({
  id: "CAPABILITY",
  recordType: "capability",
  area: "delivery",
  title: "warnings delivery",
  summary: "warnings delivery is provided by the notifier path",
  text: "warnings delivery is provided by the notifier path",
});
// A verbose keyword-dense ADR whose TITLE does NOT carry the surface terms but whose
// body repeats them amid padding (raw repetition, discounted by length-norm).
function verboseAdr(id) {
  return record({
    id,
    recordType: "adr",
    area: "architecture",
    title: "seal discipline is additive-optional with no new hash",
    text: [
      "warnings delivery provides warnings delivery provides warnings delivery provides",
      "warnings delivery provides warnings delivery provides warnings delivery provides",
      "context decision invariant considered alternatives consequences padding rationale",
      "context decision invariant considered alternatives consequences padding rationale",
    ].join(" "),
  });
}

// Probe: is the ADR-003 capability type-boost live? Two records identical in content,
// one `capability` one `adr`, on a capability-intent query — if capability scores
// STRICTLY higher, story 02's TYPE_BOOST_CAPABILITY is in effect. (Today: equal
// content, no capability boost → equal scores → probe false → the boundary tests are
// inert-green.)
function capabilityBoostLive() {
  const A = record({ id: "CAP", recordType: "capability", text: "alpha beta gamma" });
  const B = record({ id: "ADR", recordType: "adr", text: "alpha beta gamma" });
  const ranked = rankRecords([A, B], "provides alpha beta gamma", {}, {});
  const cap = ranked.find((r) => r.id === "CAP");
  const adr = ranked.find((r) => r.id === "ADR");
  return cap.score > adr.score;
}

export const archTests = [
  {
    name: "arch/39 ADR-003: a terse well-titled capability ranks at or above a verbose keyword-dense ADR on a capability query — LIVE, non-vacuous (base title-boost + length-norm)",
    run: () => {
      const ranked = rankRecords([verboseAdr("ADR_A"), CAPABILITY, verboseAdr("ADR_B")], CAP_QUERY, {}, {});
      const capPos = rankOf(ranked, "CAPABILITY");
      const adrAPos = rankOf(ranked, "ADR_A");
      const adrBPos = rankOf(ranked, "ADR_B");
      assert.ok(capPos >= 0, "the capability is in the results");
      assert.ok(
        capPos <= adrAPos && capPos <= adrBPos,
        `CAPABILITY (#${capPos}) ranks at or above the verbose ADRs (#${adrAPos}, #${adrBPos}) — the base mechanism ADR-003 relies on`,
      );
    },
  },
  {
    name: "arch/39 ADR-003: the capability boost is a BOUNDED tiebreaker — inert off a capability-intent trigger, and never inverts a decisively-higher ADR (self-activates)",
    run: () => {
      if (!capabilityBoostLive()) return; // inert-green until story 02 lands TYPE_BOOST_CAPABILITY

      // (a) Query-class-conditional: with NO trigger word, identical-content records
      // score EQUAL — the boost does not lift a capability on a non-capability query
      // (so ADR/lesson recall is unchanged).
      const A = record({ id: "CAP", recordType: "capability", text: "alpha beta gamma" });
      const B = record({ id: "ADR", recordType: "adr", text: "alpha beta gamma" });
      const untriggered = rankRecords([A, B], "alpha beta gamma", {}, {});
      const capU = untriggered.find((r) => r.id === "CAP");
      const adrU = untriggered.find((r) => r.id === "ADR");
      assert.equal(
        capU.score,
        adrU.score,
        "off a capability-intent trigger the capability gets no lift (query-class-conditional)",
      );

      // (b) Tiebreaker, not override: a capability with NO term match must NOT be lifted
      // above an ADR that matches decisively, even on a capability-intent query.
      const capNoMatch = record({ id: "CAP_NM", recordType: "capability", text: "zeta eta theta iota" });
      const adrStrong = record({
        id: "ADR_STRONG",
        recordType: "adr",
        text: "provides alpha beta gamma provides alpha beta gamma provides alpha beta gamma",
      });
      const ranked = rankRecords([capNoMatch, adrStrong], "provides alpha beta gamma", {}, {});
      assert.ok(
        rankOf(ranked, "ADR_STRONG") < rankOf(ranked, "CAP_NM"),
        "a decisively-higher ADR is NOT inverted by the capability boost (05/ADR-006: tiebreaker, never override)",
      );
    },
  },
  {
    name: "arch/39 ADR-003 acceptance: a capability query returns the capability #1 over four verbose ADRs (self-activates)",
    run: () => {
      if (!capabilityBoostLive()) return; // inert-green until story 02 lands the ranking half

      const corpus = [
        verboseAdr("ADR_1"),
        verboseAdr("ADR_2"),
        CAPABILITY,
        verboseAdr("ADR_3"),
        verboseAdr("ADR_4"),
      ];
      const ranked = rankRecords(corpus, CAP_QUERY, {}, {});
      assert.equal(
        ranked[0].id,
        "CAPABILITY",
        "the capability query returns the capability record #1 — not four ADRs (the SPEC acceptance)",
      );
    },
  },
];
