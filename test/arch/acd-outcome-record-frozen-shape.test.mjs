// Fitness function for milestone 39 / ADR-001:
// "Delivery records reuse the frozen MemoryRecord (05/ADR-005) — no field added,
//  none omitted; a gap's open/discharged lifecycle lives in the EXISTING `status`
//  field, NOT a new field, so INDEX_VERSION / GRAPHIFY_INDEX_VERSION stay at 1 and
//  move only in lockstep."
//
// Idiom (mirrors acd-spike-chore-record-doc): a NON-VACUOUS live assertion armed
// TODAY — (a) the two index-version constants are equal and both 1, and (b) the
// EXISTING source parsers emit records carrying EXACTLY MEMORY_RECORD_FIELDS — so a
// regression in the frozen shape or an out-of-lockstep version bump goes RED today.
// Red-until-built: the parseOutcome half is inert-green until story 02 exports the
// parser, then self-activates and holds the delivery records to the SAME frozen
// shape (capability/gap, gap.status in {"",open,discharged}).
import assert from "node:assert/strict";
import {
  INDEX_VERSION,
  parseArchitecture,
  parseRetrospective,
  parseAof,
} from "../../src/memory/local-indexing.mjs";
import { GRAPHIFY_INDEX_VERSION } from "../../src/memory/graphify-backend.mjs";
import { MEMORY_RECORD_FIELDS } from "../../src/memory/local-retrieval.mjs";

const FROZEN = [...MEMORY_RECORD_FIELDS].sort();
const META = { item: "39", itemSlug: "39_milestone_delivery-memory-outcome", workRelPath: "39/DOC.md" };

// Minimal fixtures that exercise each EXISTING parser so the frozen-shape assertion
// is over real parser output (not a hand-built object).
const ARCH_FIXTURE = `# 39 · Fixture — Architecture

## ADR-001: A fixture decision

**Status:** Accepted

**Context.** context.

**Decision.** the decision gist.

**Invariant.** the invariant.
`;
const RETRO_FIXTURE = `# 39 · Fixture — Retrospective

## R1 — A fixture lesson

- **Kind:** near-miss · **Area:** architecture · **Stage:** build · **Owner:** developer · **Raised by:** developer
- **What happened:** something happened.
- **Why:** because.
- **Lesson:** the distilled lesson.
`;
const AOF_FIXTURE = `---
imported: true
---
# 39 · Fixture — Digest

## Intent

The one-line intent of the fixture.
`;

function assertFrozen(records, label) {
  assert.ok(records.length > 0, `${label} produced at least one record (non-vacuous)`);
  for (const record of records) {
    assert.deepEqual(
      Object.keys(record).sort(),
      FROZEN,
      `${label} record ${record.id} carries EXACTLY MEMORY_RECORD_FIELDS (no field added/omitted)`,
    );
  }
}

async function outcomeParser() {
  const mod = await import("../../src/memory/local-indexing.mjs");
  return typeof mod.parseOutcome === "function" ? mod.parseOutcome : null;
}

export const archTests = [
  {
    name: "arch/39 ADR-001: INDEX_VERSION === GRAPHIFY_INDEX_VERSION === 1 (no field added → no lockstep bump) — LIVE, non-vacuous",
    run: () => {
      assert.equal(INDEX_VERSION, 1, "local INDEX_VERSION is still 1 (delivery memory added no field)");
      assert.equal(GRAPHIFY_INDEX_VERSION, 1, "graphify GRAPHIFY_INDEX_VERSION is still 1");
      assert.equal(
        INDEX_VERSION,
        GRAPHIFY_INDEX_VERSION,
        "the two index-version constants move only in lockstep (05/ADR-005)",
      );
    },
  },
  {
    name: "arch/39 ADR-001: the EXISTING parsers emit records carrying EXACTLY the frozen MemoryRecord field set — LIVE, non-vacuous",
    run: () => {
      assertFrozen(parseArchitecture(ARCH_FIXTURE, META), "parseArchitecture");
      assertFrozen(parseRetrospective(RETRO_FIXTURE, META), "parseRetrospective");
      assertFrozen(parseAof(AOF_FIXTURE, META), "parseAof");
    },
  },
  {
    name: "arch/39 ADR-001: parseOutcome records are the SAME frozen shape — capability/gap, gap.status in {'',open,discharged} (self-activates when story 02 exports parseOutcome)",
    run: async () => {
      const parseOutcome = await outcomeParser();
      if (!parseOutcome) return; // inert-green until the parser lands

      // Pinned OUTCOME.md grammar (39 SPEC "## Stories" — "### " headings, not
      // bullets; a gap carries a "- **Status:**" + "- **Discharge condition:**"
      // pair). CONTRACT-DRIFT FIX: this fixture predated the grammar pinned at
      // refine, which uses "### " headings under Delivered/Gaps, not bullets.
      const OUTCOME_FIXTURE = `---
doc: outcome
---
# 39 · Fixture — Outcome

## Delivered
### The delivery-memory capability
The capability the milestone now provides.

## Assumptions
- **The assumption the delivery rests on** — a condition placeholder.

## Gaps
### warnings_delivered field
- **Status:** open
- **Discharge condition:** a producer writes it.
\`warnings_delivered\` is written only by test fixtures; no production path populates it.
`;
      const records = parseOutcome(OUTCOME_FIXTURE, META);
      assert.ok(records.length > 0, "parseOutcome produced at least one delivery record (non-vacuous)");
      for (const record of records) {
        assert.deepEqual(
          Object.keys(record).sort(),
          FROZEN,
          `outcome record ${record.id} carries EXACTLY MEMORY_RECORD_FIELDS (ADR-001: no new field)`,
        );
        assert.ok(
          ["capability", "gap"].includes(record.recordType),
          `outcome record ${record.id} is a capability or gap (ADR-002), got "${record.recordType}"`,
        );
        // ADR-001: a gap's lifecycle lives in the REUSED `status` field (never a new
        // field); a standing capability carries "" there.
        assert.ok(
          ["", "open", "discharged"].includes(record.status),
          `outcome record ${record.id} status is the reused open/discharged token (got "${record.status}")`,
        );
        if (record.recordType === "capability") {
          assert.equal(record.status, "", "a capability is a standing fact — status is present-as-''");
        }
      }
    },
  },
];
