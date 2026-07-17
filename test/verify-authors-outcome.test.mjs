// Traceability wiring for milestone 39 / story 01
// tasks/01_verify-authors-outcome.feature — ONLY the @executable scenarios:
//   - "an item's primary record doc is its identity doc — never OUTCOME.md"
//     (Scenario Outline, every Examples row)
//   - "a milestone carrying an OUTCOME.md still validates on its identity
//     record doc"
//
// The @manual scenarios in the same feature ("OUTCOME.md is authored at Accept,
// never at insert" and the product-state-vs-motive Examples Outline) are
// agent-run at aof:verify — NOT asserted here (ADR-004: aof:verify, not the
// executable suite, judges "product state vs motive" prose).
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { recordDoc, validateWork } from "../src/work.mjs";

// ---------------------------------------------------------------------------
// Scenario Outline: an item's primary record doc is its identity doc — never
// OUTCOME.md
// Examples: the primary record doc per type (unchanged by this milestone —
// ADR-004)
// ---------------------------------------------------------------------------
const RECORD_DOC_BY_TYPE = [
  { type: "milestone", recordDocName: "SPEC.md" },
  { type: "story", recordDocName: "STORY.md" },
  { type: "uat", recordDocName: "SESSION.md" },
  { type: "spike", recordDocName: "SPIKE.md" },
  { type: "chore", recordDocName: "CHORE.md" },
];

const recordDocOutlineTests = RECORD_DOC_BY_TYPE.map(({ type, recordDocName }) => ({
  name: `verify-authors-outcome: the primary record doc resolved for a "${type}" item is "${recordDocName}", never "OUTCOME.md"`,
  run: async () => {
    // "dir" is irrelevant to recordDoc's mapping (a pure type -> filename
    // function for every non-milestone type; the milestone branch only probes
    // for a co-located AOF.md, absent here so it falls to SPEC.md) — mirrors
    // test/arch/acd-outcome-authored-by-verify.test.mjs's own live probe.
    //
    // Review fix (FIX 11): a FRESH temp dir (never `path.resolve(".")`, the
    // test-run cwd) makes the "no co-located AOF.md" precondition explicit
    // and immune to cwd/repo-layout drift — `path.resolve(".")` merely
    // happened to carry no AOF.md; it never GUARANTEED it.
    const dir = await mkdtemp(path.join(os.tmpdir(), "aof-record-doc-"));
    try {
      const resolved = recordDoc({ type, dir });
      assert.equal(resolved, recordDocName, `record doc for type "${type}" is "${recordDocName}"; got "${resolved}"`);
      assert.notEqual(resolved, "OUTCOME.md", `record doc for type "${type}" never resolves to "OUTCOME.md"`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
}));

// ---------------------------------------------------------------------------
// Scenario: a milestone carrying an OUTCOME.md still validates on its identity
// record doc
// ---------------------------------------------------------------------------
function frontmatter(fields) {
  const body = Object.entries(fields)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? `[${value.join(", ")}]` : value}`)
    .join("\n");
  return `---\n${body}\n---\n`;
}

async function withWork(body) {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-verify-outcome-"));
  const work = path.join(root, "work");
  await mkdir(work, { recursive: true });
  try {
    return await body(work);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

// A minimal, valid, frontmatter-less OUTCOME.md — no identity, per ADR-004.
// (Content shape doesn't matter to validate: it never resolves/reads this
// file, since recordDoc(milestone) → SPEC.md, not OUTCOME.md.)
const OUTCOME_BODY = `# 00 · Sample Milestone — Outcome

## Delivered

### Sample capability
The system now does the sample thing.

## Assumptions

- **A precondition** — the condition the capability rests on.

## Gaps

### An unfilled surface
- **Status:** open
- **Discharge condition:** a producer exists.
The gap statement.
`;

export const verifyAuthorsOutcomeTests = [
  ...recordDocOutlineTests,
  {
    name: "verify-authors-outcome: a milestone carrying an OUTCOME.md still validates on its identity SPEC.md, and OUTCOME.md is never flagged",
    run: () =>
      withWork(async (work) => {
        const dir = path.join(work, "00_milestone_sample");
        await mkdir(dir, { recursive: true });
        await writeFile(
          path.join(dir, "SPEC.md"),
          frontmatter({
            type: "milestone",
            number: "00",
            slug: "sample",
            status: "done",
            created: "2026-01-01",
            updated: "2026-01-02",
            schema: 1,
          }),
        );
        await writeFile(path.join(dir, "OUTCOME.md"), OUTCOME_BODY);

        const findings = await validateWork(work, {}, null);
        const aboutMilestone = findings.filter((f) => f.path && f.path.startsWith(dir));
        assert.deepEqual(
          aboutMilestone,
          [],
          `the milestone validates clean on SPEC.md with a co-present OUTCOME.md; got ${JSON.stringify(aboutMilestone)}`,
        );

        const aboutOutcome = findings.filter((f) => f.path && f.path.includes("OUTCOME.md"));
        assert.deepEqual(
          aboutOutcome,
          [],
          `validate never reports OUTCOME.md as a missing/empty record doc; got ${JSON.stringify(aboutOutcome)}`,
        );
      }),
  },
];
