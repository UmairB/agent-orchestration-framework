// Traceability wiring for milestone 39 / story 02, task 00
// (00_parse-outcome-records.feature).
//
// Every @executable scenario AND every Scenario-Outline Examples row is covered
// here, exercised DIRECTLY against `parseOutcome` (`src/memory/local-indexing.mjs`)
// over the feature's own FIXTURE OUTCOME.md (the Background block, copied
// verbatim) — no CLI, no story-01 authoring path, so this story stays independent
// of story 01's code (per the story Notes).
//
//   00_parse-outcome-records.feature — parseOutcome emits capability records from
//   "## Delivered" and gap records from "## Gaps", each the frozen MemoryRecord
//   (39/ADR-001/ADR-002): area="delivery" always, a capability's status="" and a
//   gap's status ∈ {open, discharged} (default open), assumptions folded into the
//   nearest-preceding capability's searchable text, source resolving to
//   OUTCOME.md:<heading-line>, and the records reaching both backends via the
//   shared buildRecords seam.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseOutcome, buildRecords, reindex } from "../src/memory/local-indexing.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---- the Background fixture (copied verbatim from the .feature) ----------------
const META = {
  item: "39",
  itemSlug: "39_milestone_delivery-memory-outcome",
  workRelPath: "39_milestone_delivery-memory-outcome/OUTCOME.md",
};

const OUTCOME_FIXTURE = `# 39 · Delivery Memory — Outcome

## Delivered
### OUTCOME records reach recall
parseOutcome emits capability and gap records into buildRecords, so recall answers what the product provides.

### area delivery hard pre-filter
recall --area delivery returns only product records and excludes the architecture ADRs entirely.

## Assumptions
- **OUTCOME.md is authored at Accept** — the delivery records exist only once aof:verify writes the doc.

## Gaps
### warnings_delivered field
- **Status:** open
- **Discharge condition:** a production code path assigns warnings_delivered.
warnings_delivered is written only by test fixtures; no production path populates it.

### per-story OUTCOME authoring
- **Status:** discharged
- **Discharge condition:** a story-level OUTCOME.md is scaffolded and parsed by parseOutcome.
A story's delivery rolls up into its milestone OUTCOME; there is no per-story record yet.
`;

function recordById(records, id) {
  return records.find((r) => r.id === id);
}

// Resolve a record's "<relPath>:<line>" `source` against the ORIGINAL fixture
// text (no disk needed — parseOutcome is exercised directly), asserting the
// relPath matches and the resolved line is the record's own "### " heading.
function assertSourceLine(record, fixtureText, expectedRelPath) {
  const lastColon = record.source.lastIndexOf(":");
  const relPath = record.source.slice(0, lastColon);
  const line = Number.parseInt(record.source.slice(lastColon + 1), 10);
  assert.equal(relPath, expectedRelPath, `${record.id} source path is ${expectedRelPath}`);
  const lines = fixtureText.split(/\r?\n/);
  assert.ok(line >= 1 && line <= lines.length, `${record.id} source line ${line} in range`);
  return lines[line - 1];
}

// A gap-only OUTCOME fixture (no Delivered section needed) for the Status outline.
function gapOnlyFixture(statusLine) {
  const lines = ["## Gaps", "### sample gap"];
  if (statusLine) lines.push(statusLine);
  lines.push("- **Discharge condition:** a producer exists.");
  lines.push("a gap statement placeholder.");
  return `${lines.join("\n")}\n`;
}

// A minimal temp work-stream (milestone 39) carrying the fixture OUTCOME.md, for
// the "reaches both backends" scenario (buildRecords is the seam both consume).
async function tempStreamWithOutcome() {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "aof-outcome-"));
  const workDir = path.join(projectRoot, "wiki", "work");
  const dir = path.join(workDir, "39_milestone_delivery-memory-outcome");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "OUTCOME.md"), OUTCOME_FIXTURE, "utf8");
  await mkdir(path.join(projectRoot, ".aof"), { recursive: true });
  return { projectRoot, workDir, ctx: { workDir, projectRoot, configMemory: {} } };
}

export const outcomeParseRecordsTests = [
  // ====================================================================
  // Scenario: a Delivered "### " heading becomes a capability record with its
  // delivery fields populated.
  // ====================================================================
  {
    name: "00/outcome: a Delivered '### ' heading becomes a capability record with its delivery fields populated",
    run: () => {
      const records = parseOutcome(OUTCOME_FIXTURE, META);
      const cap = recordById(records, "area-delivery-hard-pre-filter");
      assert.ok(cap, "area-delivery-hard-pre-filter record exists");
      assert.equal(cap.recordType, "capability");
      assert.equal(cap.item, "39");
      assert.equal(cap.itemSlug, "39_milestone_delivery-memory-outcome");
      assert.equal(cap.title, "area delivery hard pre-filter");
      assert.equal(cap.area, "delivery");
      assert.equal(cap.stage, "");
      assert.equal(cap.kind, "");
      assert.equal(cap.owner, "");
      assert.equal(cap.status, "", "a capability's status is '' — a standing fact, not a lifecycle token");
      assert.ok(
        cap.summary.includes("recall --area delivery returns only product records"),
        "summary is the one-line delivered statement under the heading",
      );
      assert.ok(cap.text.includes(cap.title), "text covers the capability title");
      assert.ok(cap.text.includes("excludes the architecture ADRs entirely"), "text covers the delivered statement");
      assert.ok(cap.text.includes("authored at Accept"), "text covers the folded assumption (nearest-preceding == last capability)");
      const headingLine = assertSourceLine(cap, OUTCOME_FIXTURE, "39_milestone_delivery-memory-outcome/OUTCOME.md");
      assert.match(headingLine, /^###\s+area delivery hard pre-filter\s*$/, "source resolves to its own ### heading line");
    },
  },

  // ====================================================================
  // Scenario: a capability record fixes area to "delivery" and carries
  // stage/kind/owner and status as empty strings.
  // ====================================================================
  {
    name: "00/outcome: a capability record fixes area to 'delivery' and carries stage/kind/owner and status as empty strings",
    run: () => {
      const records = parseOutcome(OUTCOME_FIXTURE, META);
      const cap = recordById(records, "outcome-records-reach-recall");
      assert.ok(cap, "outcome-records-reach-recall record exists");
      assert.equal(cap.area, "delivery");
      for (const key of ["stage", "kind", "owner", "status"]) {
        assert.ok(key in cap, `${key} present (not omitted)`);
        assert.equal(cap[key], "", `${key} is ""`);
      }
      // Not the LAST capability — the assumption folds only onto the last one.
      assert.ok(!cap.text.includes("authored at Accept"), "the non-last capability does not carry the folded assumption");
    },
  },

  // ====================================================================
  // Scenario: a Gaps "### " heading becomes a gap record carrying its Status and
  // discharge condition.
  // ====================================================================
  {
    name: "00/outcome: a Gaps '### ' heading becomes a gap record carrying its Status and discharge condition",
    run: () => {
      const records = parseOutcome(OUTCOME_FIXTURE, META);
      const gap = recordById(records, "warnings-delivered-field");
      assert.ok(gap, "warnings-delivered-field record exists");
      assert.equal(gap.recordType, "gap");
      assert.equal(gap.item, "39");
      assert.equal(gap.itemSlug, "39_milestone_delivery-memory-outcome");
      assert.equal(gap.title, "warnings_delivered field");
      assert.equal(gap.area, "delivery");
      assert.equal(gap.stage, "");
      assert.equal(gap.kind, "");
      assert.equal(gap.owner, "");
      assert.equal(gap.status, "open");
      assert.ok(
        gap.summary.includes("written only by test fixtures") && gap.summary.includes("production code path assigns"),
        "summary is the gap statement together with its discharge-condition gist",
      );
      assert.ok(gap.text.includes(gap.title), "text covers the gap title");
      assert.ok(gap.text.includes("written only by test fixtures"), "text covers the gap statement");
      assert.ok(gap.text.includes("production code path assigns"), "text covers the discharge condition");
      const headingLine = assertSourceLine(gap, OUTCOME_FIXTURE, "39_milestone_delivery-memory-outcome/OUTCOME.md");
      assert.match(headingLine, /^###\s+warnings_delivered field\s*$/, "source resolves to its own ### heading line");
    },
  },

  // ====================================================================
  // Scenario: an Assumptions bullet folds into its capability's searchable text
  // and never becomes its own record.
  // ====================================================================
  {
    name: "00/outcome: an Assumptions bullet folds into its capability's searchable text and never becomes its own record",
    run: () => {
      const records = parseOutcome(OUTCOME_FIXTURE, META);
      assert.ok(!records.some((r) => r.recordType === "assumption"), "no record has recordType 'assumption'");
      assert.ok(
        !records.some((r) => r.title === "OUTCOME.md is authored at Accept"),
        "no record's title is the assumption's bolded lead-in",
      );
      const cap = recordById(records, "area-delivery-hard-pre-filter");
      assert.ok(
        cap.text.includes("OUTCOME.md is authored at Accept") && cap.text.includes("aof:verify writes the doc"),
        "the capability record has the assumption statement folded into its searchable text",
      );
    },
  },

  // ====================================================================
  // Scenario: every "### " heading under Delivered or Gaps produces exactly one
  // record, and nothing else does.
  // ====================================================================
  {
    name: "00/outcome: every '### ' heading under Delivered or Gaps produces exactly one record, and nothing else does",
    run: () => {
      const records = parseOutcome(OUTCOME_FIXTURE, META);
      assert.equal(records.length, 4, "4 delivery records, one per ### heading");
      assert.equal(records.filter((r) => r.recordType === "capability").length, 2, "2 capability records from ## Delivered");
      assert.equal(records.filter((r) => r.recordType === "gap").length, 2, "2 gap records from ## Gaps");
      const titles = records.map((r) => r.title);
      assert.ok(!titles.includes("39 · Delivery Memory — Outcome"), "no record for the h1 title");
      assert.ok(!titles.some((t) => t === "Delivered" || t === "Assumptions" || t === "Gaps"), "no record for a ## section heading");
      assert.ok(!titles.includes("OUTCOME.md is authored at Accept"), "no record for the Assumptions bullet");
    },
  },

  // ====================================================================
  // Scenario: the delivery records reach both the local and graphify backends
  // through the shared buildRecords.
  // ====================================================================
  {
    name: "00/outcome: the delivery records reach both the local and graphify backends through the shared buildRecords",
    run: async () => {
      const { projectRoot, ctx } = await tempStreamWithOutcome();
      try {
        // Local: reindex(only, ctx) IS local-backend.mjs's reindex delegate — it
        // calls buildIndex -> buildRecords internally (05/story-01).
        const localResult = await reindex(null, ctx);
        // Graphify: buildStore (graphify-backend.mjs, unexported) calls buildRecords
        // with the identical (only, ctx) signature — calling it directly here proves
        // the SAME record set graphify's store-builder would produce, without
        // reaching into graphify's network/binary-touching reindex path.
        const graphifyRecords = await buildRecords(null, ctx);

        for (const [label, records] of [["local", localResult.records], ["graphify", graphifyRecords]]) {
          assert.ok(
            records.some((r) => r.id === "area-delivery-hard-pre-filter" && r.recordType === "capability"),
            `${label} record set contains the capability record`,
          );
          assert.ok(
            records.some((r) => r.id === "warnings-delivered-field" && r.recordType === "gap"),
            `${label} record set contains the gap record`,
          );
        }
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    },
  },

  // ====================================================================
  // Scenario Outline: a gap's status comes from its Status line, defaulting to
  // open when absent.
  // ====================================================================
  {
    name: "00/outcome outline: a gap's status comes from its Status line, defaulting to open when absent (all Examples rows)",
    run: () => {
      const rows = [
        { statusLine: "- **Status:** open", status: "open" },
        { statusLine: "- **Status:** discharged", status: "discharged" },
        { statusLine: null, status: "open" }, // (no Status line) -> default open
      ];
      for (const row of rows) {
        const records = parseOutcome(gapOnlyFixture(row.statusLine), META);
        assert.equal(records.length, 1, `statusLine=${row.statusLine ?? "(none)"}: exactly one gap record`);
        const gap = records[0];
        assert.equal(gap.recordType, "gap");
        assert.equal(gap.area, "delivery");
        assert.equal(gap.stage, "");
        assert.equal(gap.kind, "");
        assert.equal(gap.owner, "");
        assert.equal(gap.status, row.status, `statusLine=${row.statusLine ?? "(none)"}: status is ${row.status}`);
      }
    },
  },

  // ====================================================================
  // Review fix (FIX 2): a foreign "## " section after "## Gaps" is a section
  // BOUNDARY (recognized or not) — its own "### " subheadings never fold into
  // the last recognized section (Gaps runs to EOF otherwise) and mint spurious
  // gap records; nor does the foreign heading's text corrupt the last real
  // gap's statement.
  // ====================================================================
  {
    name: "00/outcome: regression — a foreign '## Notes' section after '## Gaps' yields no record for its own subheading and does not corrupt the last real gap's statement",
    run: () => {
      const withTrailer = `${OUTCOME_FIXTURE}\n## Notes\n### Follow-up\n- detail\n`;
      const records = parseOutcome(withTrailer, META);

      assert.ok(!records.some((r) => r.title === "Follow-up"), "no record is minted for the foreign section's own subheading");
      assert.equal(records.length, 4, "still exactly 4 delivery records — the foreign section contributes none");

      const lastGap = recordById(records, "per-story-outcome-authoring");
      assert.ok(lastGap, "the last real gap record still exists");
      assert.ok(
        !lastGap.text.includes("Follow-up") && !lastGap.text.includes("Notes") && !lastGap.text.includes("detail"),
        `the last real gap's text is not corrupted by the trailing foreign section; got "${lastGap.text}"`,
      );
      assert.ok(
        lastGap.text.includes("no per-story record yet"),
        `the last real gap's own statement is still intact; got "${lastGap.text}"`,
      );
    },
  },

  // ====================================================================
  // Review fix (FIX 3): the SHIPPED OUTCOME.md template's own unauthored
  // "<Capability name>" / "<declared-but-unfilled surface, …>" placeholder
  // headings are skipped — an unauthored template indexes to ZERO records.
  // ====================================================================
  {
    name: "00/outcome: regression — parsing the shipped OUTCOME.md template produces zero delivery records",
    run: async () => {
      const templatePath = path.join(repoRoot, "src", "bundle", "templates", "milestone", "OUTCOME.md");
      const templateText = await readFile(templatePath, "utf8");
      const records = parseOutcome(templateText, META);
      assert.deepEqual(records, [], `the unauthored template yields zero records; got ${JSON.stringify(records)}`);
    },
  },

  // ====================================================================
  // Review fix (FIX 4): a gap-statement line shaped "- **Label:** value" whose
  // label is NOT Status/Discharge condition (e.g. "- **Owner:** platform
  // team") is routed into the free-form prose statement, never silently
  // dropped.
  // ====================================================================
  {
    name: "00/outcome: regression — a gap-statement line shaped '- **Owner:** value' (not Status/Discharge) survives in the gap's searchable text",
    run: () => {
      const fixture = [
        "## Gaps",
        "### sample gap",
        "- **Status:** open",
        "- **Owner:** platform team",
        "- **Discharge condition:** a producer exists.",
        "a gap statement placeholder.",
      ].join("\n") + "\n";
      const records = parseOutcome(fixture, META);
      assert.equal(records.length, 1, "exactly one gap record");
      const gap = records[0];
      assert.equal(gap.status, "open", "the Status field is still extracted correctly");
      assert.ok(gap.text.includes("platform team"), `the non-Status/Discharge field line survives in the searchable text; got "${gap.text}"`);
      assert.ok(gap.text.includes("a producer exists"), "the Discharge condition field is still extracted correctly");
    },
  },

  // ====================================================================
  // FIX 12(a): two "### " headings with IDENTICAL text both survive as
  // distinct records (the current id-collision behaviour, pinned as a
  // decision — not silently deduped, not silently overwritten).
  // ====================================================================
  {
    name: "00/outcome: pinned behaviour — two '### ' headings with identical text both survive with the same id but distinct source lines",
    run: () => {
      const dupFixture = [
        "## Delivered",
        "### Same title",
        "First delivered statement.",
        "",
        "### Same title",
        "Second delivered statement.",
      ].join("\n") + "\n";
      const records = parseOutcome(dupFixture, META);
      const same = records.filter((r) => r.id === "same-title");
      assert.equal(same.length, 2, "both identically-titled headings survive as distinct records");
      assert.notEqual(same[0].source, same[1].source, "the two records resolve to distinct source lines");
      assert.ok(same[0].summary.includes("First delivered statement"), "the first record carries its own statement");
      assert.ok(same[1].summary.includes("Second delivered statement"), "the second record carries its own statement");
    },
  },

  // ====================================================================
  // FIX 12(b): multiple "## Assumptions" bullets across multiple capabilities
  // all fold onto the LAST capability only (the pinned-grammar limitation) —
  // never distributed, never onto an earlier capability.
  // ====================================================================
  {
    name: "00/outcome: pinned behaviour — multiple Assumptions bullets fold ONLY onto the last capability, never an earlier one",
    run: () => {
      const fixture = [
        "## Delivered",
        "### Capability One",
        "Statement one.",
        "",
        "### Capability Two",
        "Statement two.",
        "",
        "## Assumptions",
        "- **Assumption A** — condition A.",
        "- **Assumption B** — condition B.",
      ].join("\n") + "\n";
      const records = parseOutcome(fixture, META);
      const one = recordById(records, "capability-one");
      const two = recordById(records, "capability-two");
      assert.ok(one && two, "both capability records exist");
      assert.ok(!one.text.includes("condition A") && !one.text.includes("condition B"), "the earlier capability carries neither assumption");
      assert.ok(two.text.includes("condition A") && two.text.includes("condition B"), "the LAST capability carries both assumption bullets");
    },
  },

  // ====================================================================
  // FIX 12(c): an empty/absent section produces no spurious record and never
  // crashes — a "## Delivered"/"## Gaps" with no "### " subheading, a "### "
  // with an empty body, and wholly empty input.
  // ====================================================================
  {
    name: "00/outcome: pinned behaviour — an empty/absent section yields no spurious record and never crashes",
    run: () => {
      assert.deepEqual(parseOutcome("", META), [], "wholly empty input parses to zero records, no crash");

      const noSubheadings = "## Delivered\n\n## Gaps\n\n";
      assert.deepEqual(parseOutcome(noSubheadings, META), [], "sections with no '### ' subheading yield zero records");

      const emptyBody = "## Delivered\n### Only heading\n\n## Gaps\n";
      const records = parseOutcome(emptyBody, META);
      assert.equal(records.length, 1, "a '### ' heading with an empty body still yields exactly its own (non-spurious) record");
      assert.equal(records[0].recordType, "capability");
      assert.equal(records[0].summary, "", "the empty-body record's statement is the empty string, not a crash or a phantom value");
    },
  },
];
