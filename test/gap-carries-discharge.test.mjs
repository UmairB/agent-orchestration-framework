// Traceability wiring for milestone 39 / story 03 (gap-to-chore), task
//   wiki/work/39_milestone_delivery-memory-outcome/stories/03_story_gap-to-chore/
//     tasks/00_gap-carries-discharge.feature
//
// Every @executable scenario (and every Scenario Outline Examples row) below is
// wired against a HAND-AUTHORED FIXTURE INDEX of MemoryRecords (the frozen
// ADR-005 shape) — the feature's own note: "these scenarios read a fixture
// index … so they exercise RETRIEVAL alone; the `## Gaps` authoring/parse is
// stories 01/02's contract, not this story's." Mirrors test/memory-retrieval.test.mjs's
// fixture-index idiom.
//
// The "aof work memory recall …" steps are driven through the REAL seam
// (`runMemory` in src/work-memory.mjs, exercising the 39/ADR-001 `--status`
// SCOPE_FLAGS wiring) over a STUB backend whose `recall` delegates to the REAL
// `recall` in src/memory/local-retrieval.mjs (exercising the 39/ADR-001
// `status` SCOPE_FIELDS wiring) against the fixture array — so both halves of
// feasibility flag 3 (work-memory.mjs's SCOPE_FLAGS + local-retrieval.mjs's
// SCOPE_FIELDS) are exercised together, end to end, exactly as
// "aof work memory recall --status open" behaves for real.
import assert from "node:assert/strict";
import { runMemory } from "../src/work-memory.mjs";
import { recall as localRecall } from "../src/memory/local-retrieval.mjs";

// Build a full MemoryRecord (ADR-005) from a partial spec: absent-type fields
// present as "" (the empty-string-present convention retrieval reads).
function record(partial) {
  return {
    recordType: partial.recordType,
    id: partial.id,
    item: partial.item ?? "39",
    itemSlug: partial.itemSlug ?? "delivery-memory-outcome",
    title: partial.title ?? "",
    area: partial.area ?? "",
    stage: partial.stage ?? "",
    kind: partial.kind ?? "",
    owner: partial.owner ?? "",
    status: partial.status ?? "",
    summary: partial.summary ?? "",
    text: partial.text ?? "",
    source: partial.source ?? "OUTCOME.md:1"
  };
}

// ── the feature's Background fixture ──────────────────────────────────────
// | id      | recordType | area         | title                       | status     | discharge condition (folded into text) |
const FIXTURE = [
  record({
    id: "G1",
    recordType: "gap",
    area: "delivery",
    title: "warnings_delivered field",
    status: "open",
    text: "warnings_delivered field — a production path writes warnings_delivered"
  }),
  record({
    id: "G2",
    recordType: "gap",
    area: "delivery",
    title: "legacy_flag field",
    status: "discharged",
    text: "legacy_flag field — the legacy_flag reader was removed"
  }),
  record({
    id: "G3",
    recordType: "gap",
    area: "delivery",
    title: "audit_trail field",
    status: "open",
    text: "audit_trail field — an emitter populates audit_trail on every write"
  }),
  record({
    id: "ADR-007",
    recordType: "adr",
    area: "architecture",
    title: "seal discipline is additive",
    status: "Accepted",
    text: "seal discipline is additive — no new hash"
  })
];

// A stub backend whose recall() delegates to the REAL local-retrieval `recall`
// over the fixture array — so `runMemory`'s argv/scope wiring (work-memory.mjs)
// AND local-retrieval.mjs's applyScope/rankRecords both run for real, exactly
// as "aof work memory recall --status open" behaves in production.
function fixtureBackend(records) {
  return {
    name: "fixture",
    async recall(query, scope, opts, ctx) {
      return await localRecall(query, scope, opts, { records: ctx?.records ?? records });
    },
    async reindex() {
      return { recordCount: records.length };
    },
    async status() {
      return { backend: "fixture", recordCount: records.length };
    }
  };
}

async function runRecallJson(argv, records = FIXTURE) {
  const backend = fixtureBackend(records);
  const lines = [];
  const outcome = await runMemory([...argv, "--json"], {
    config: {},
    resolveBackend: async () => backend,
    log: (line) => lines.push(line)
  });
  assert.equal(outcome.exitCode, 0, `"aof work memory ${argv.join(" ")}" exits 0`);
  return JSON.parse(lines.join("\n"));
}

function ids(records) {
  return records.map((r) => r.id);
}

export const gapCarriesDischargeTests = [
  // ==========================================================================
  // Scenario: a gap record's open/discharged lifecycle lives in the reused
  //   status field
  //
  // Review fix (FIX 8): the original wiring asserted directly on the
  // hand-authored `FIXTURE` array — no production code ran, so the check was
  // tautological. Reframed to route the SAME "Then the gap X has status Y"
  // assertions through the REAL recall path (an unscoped-by-status recall so
  // both the open and discharged gaps surface), proving `status` survives the
  // full applyScope/rankRecords pipeline rather than merely echoing the JS
  // object literal that defines it. The `--status open`/`--status discharged`
  // FILTERING behaviour is already proven non-vacuously by the scenarios
  // below; this one proves the field's VALUE is carried through, unfiltered.
  // ==========================================================================
  {
    name: "gap-carries-discharge: a gap record's open/discharged lifecycle lives in the reused status field",
    run: async () => {
      const result = await runRecallJson(["recall", "--area", "delivery"]);
      const warnings = result.find((r) => r.title === "warnings_delivered field");
      const legacy = result.find((r) => r.title === "legacy_flag field");
      assert.ok(warnings, 'recall surfaces the gap "warnings_delivered field"');
      assert.ok(legacy, 'recall surfaces the gap "legacy_flag field" (its status is not an implicit filter)');
      assert.equal(warnings.status, "open", 'the recalled gap "warnings_delivered field" has status "open"');
      assert.equal(legacy.status, "discharged", 'the recalled gap "legacy_flag field" has status "discharged"');
    }
  },

  // ==========================================================================
  // Scenario: a gap record carries its discharge condition in its recallable
  //   text
  // ==========================================================================
  {
    name: 'gap-carries-discharge: a gap record carries its discharge condition in its recallable text (recall "warnings_delivered")',
    run: async () => {
      const result = await runRecallJson(["recall", "warnings_delivered"]);
      const warnings = result.find((r) => r.title === "warnings_delivered field");
      assert.ok(warnings, 'recall "warnings_delivered" surfaces the "warnings_delivered field" gap');
      assert.ok(
        warnings.text.includes("a production path writes warnings_delivered"),
        `the recalled gap states its discharge condition; got text "${warnings.text}"`
      );
    }
  },

  // ==========================================================================
  // Scenario: recall --status open returns only the still-open gaps and
  //   excludes discharged debt
  // ==========================================================================
  {
    name: "gap-carries-discharge: recall --status open returns only the still-open gaps (G1, G3) and excludes discharged debt (G2) and an adr (ADR-007)",
    run: async () => {
      const result = await runRecallJson(["recall", "--status", "open"]);
      assert.deepEqual(ids(result).sort(), ["G1", "G3"], `recalled record ids are "G1, G3"; got ${JSON.stringify(ids(result))}`);
      assert.ok(!ids(result).includes("G2"), 'the gap "legacy_flag field" (G2) is not recalled');
      assert.ok(!ids(result).includes("ADR-007"), 'the adr "ADR-007" is not recalled — its status "Accepted" is never open debt');
    }
  },

  // ==========================================================================
  // Scenario Outline: recall --status <status> returns only the debt in that
  //   lifecycle state
  //   | status     | present | excluded |
  //   | open       | G1, G3  | G2       |
  //   | discharged | G2      | G1, G3   |
  // ==========================================================================
  ...[
    { status: "open", present: ["G1", "G3"], excluded: ["G2"] },
    { status: "discharged", present: ["G2"], excluded: ["G1", "G3"] }
  ].map((row) => ({
    name: `gap-carries-discharge: outline — recall --status ${row.status} returns exactly {${row.present.join(", ")}} and excludes {${row.excluded.join(", ")}}`,
    run: async () => {
      const result = await runRecallJson(["recall", "--status", row.status]);
      assert.deepEqual(
        ids(result).sort(),
        [...row.present].sort(),
        `--status ${row.status}: recalled record ids are "${row.present.join(", ")}"; got ${JSON.stringify(ids(result))}`
      );
      for (const excludedId of row.excluded) {
        assert.ok(!ids(result).includes(excludedId), `--status ${row.status}: record id "${excludedId}" is not recalled`);
      }
    }
  })),

  // ==========================================================================
  // Regression guard: an UNSCOPED recall (no --status) still returns every
  // record — the new "status" scope dimension is additive, it does not turn
  // into an implicit default filter.
  // ==========================================================================
  {
    name: "gap-carries-discharge: regression — an unscoped recall (no --status) still surfaces every record, open/discharged/adr alike",
    run: async () => {
      const result = await runRecallJson(["recall", "--area", "delivery"]);
      assert.deepEqual(ids(result).sort(), ["G1", "G2", "G3"], "an unscoped-by-status recall over area delivery returns all three gaps regardless of status");
    }
  },

  // ==========================================================================
  // Regression guard: existing scope dimensions (area/item) keep filtering
  // correctly alongside the new "status" dimension (they intersect, AND).
  // ==========================================================================
  {
    name: "gap-carries-discharge: regression — --status intersects with an existing scope dimension (--area) rather than replacing it",
    run: async () => {
      const mixed = [
        ...FIXTURE,
        record({ id: "OTHER-OPEN", recordType: "gap", area: "tooling", title: "other field", status: "open", text: "other field — a producer exists" })
      ];
      const result = await runRecallJson(["recall", "--status", "open", "--area", "delivery"], mixed);
      assert.deepEqual(
        ids(result).sort(),
        ["G1", "G3"],
        "area delivery + status open intersect to exactly G1, G3 — the tooling-area open gap is excluded"
      );
    }
  }
];
