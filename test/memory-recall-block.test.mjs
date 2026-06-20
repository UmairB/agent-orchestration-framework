// Traceability wiring for milestone 05 / story 03 (memory-hooks), task 00
// `00_recall-block-injectable.feature` (@executable).
//
// Drives the REAL recall pipeline — `recall` from local-retrieval over a
// HAND-AUTHORED fixture index (ctx.records) — then renders the compact injection
// block via `renderRecallBlock`/`HOOK_LIMIT` (the seam, src/work-memory.mjs). No
// CLI, no on-disk index, no story-01 parser code: the block is a pure projection
// of a frozen RecallResult (ADR-004), so the test couples to nothing but the two
// frozen contracts.
//
// The "source opens the live heading" assertion is made deterministic by writing a
// small temp markdown file (os.tmpdir + mkdtemp) with KNOWN headings at KNOWN
// 1-based lines and pointing each fixture record's `source` at "<file>:<line>".
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { recall } from "../src/memory/local-retrieval.mjs";
import { renderRecallBlock, HOOK_LIMIT } from "../src/work-memory.mjs";

// Build a full MemoryRecord (ADR-005) from a partial spec: every field present,
// absent-type fields as "" (the empty-string-present convention retrieval reads).
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

// A non-empty block splits into one line per record (the trailing "\n" yields a
// trailing empty segment we drop).
function blockLines(block) {
  if (block === "") return [];
  return block.replace(/\n$/, "").split("\n");
}

// ── a temp markdown file with KNOWN headings at KNOWN 1-based lines ──────────
// Returns { dir, file, headingLineOf } where headingLineOf(headingText) gives the
// 1-based line a heading sits on, so a fixture record's `source` ("<file>:<line>")
// resolves to live text in the file — the "opens the live heading" check.
async function writeHeadingsFile() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aof-mem-block-"));
  const file = path.join(dir, "ARCHITECTURE.md");
  // 1-based line numbers shown for clarity:
  const lines = [
    "---", //                                                       1
    "doc: architecture", //                                         2
    "---", //                                                       3
    "# milestone architecture", //                                  4
    "", //                                                          5
    "## ADR-002: content-addressed manifest membership", //         6
    "", //                                                          7
    "Some decision prose here.", //                                 8
    "", //                                                          9
    "## ADR-003: the frozen backend interface", //                 10
    "", //                                                         11
    "More prose.", //                                              12
    "", //                                                         13
    "## R1: requiring-grep is a fitness-fn smell", //              14
    "", //                                                         15
    "## ADR-002: round-trip determinism contract", //             16  (same id, different milestone)
    "" //                                                          17
  ];
  await writeFile(file, lines.join("\n"), "utf8");
  const headingLineOf = (headingText) => {
    const idx = lines.findIndex((l) => l.includes(headingText));
    return idx === -1 ? -1 : idx + 1; // 1-based
  };
  return { dir, file, headingLineOf };
}

export const memoryRecallBlockTests = [
  // ===================================================================
  // Scenario: the block is bounded to the hook limit
  //   recall(query, {}, { limit: 3 }, ctx) → block has at most 3 lines.
  // ===================================================================
  {
    name: "recall-block: the block is bounded to the hook limit (limit 3 → ≤ 3 lines)",
    run: async () => {
      // More records than the limit, all matching the query.
      const records = Array.from({ length: 8 }, (_, i) =>
        record({
          id: `R${i + 1}`,
          recordType: "lesson",
          item: "01",
          area: "architecture",
          kind: "near-miss",
          title: `record ${i + 1}`,
          text: `alpha bravo record number ${i + 1} alpha`,
          source: `m01/RETROSPECTIVE.md:${i + 1}`
        })
      );
      const result = await recall("alpha bravo", {}, { limit: 3 }, { records });
      const block = renderRecallBlock(result);
      const lines = blockLines(block);
      assert.ok(lines.length <= 3, `block has at most 3 lines (got ${lines.length})`);
      // The block IS the records — same count as the (already-bounded) result.
      assert.equal(lines.length, result.records.length, "block lines === records");

      // The render ALSO caps independently of recall's truncation: given an
      // un-truncated result, renderRecallBlock's own `limit` bounds the block (so
      // the CLI path `renderRecallBlock(result, { limit })` is load-bearing, not a
      // pass-through). Recall with no limit → all 8, then cap the RENDER at 2.
      const unbounded = await recall("alpha bravo", {}, { limit: 100 }, { records });
      assert.ok(unbounded.records.length > 2, "the unbounded recall returns more than 2 records");
      assert.equal(blockLines(renderRecallBlock(unbounded, { limit: 2 })).length, 2, "the render caps the block at its own limit");
    }
  },

  // ===================================================================
  // Scenario: the block is scope-filtered before it is rendered
  //   recall(query, { area: "architecture" }, {}, ctx) → every line an
  //   architecture record; no off-scope (process) record appears.
  // ===================================================================
  {
    name: "recall-block: scope-filtered before render — only in-scope records, no off-scope record",
    run: async () => {
      const records = [
        record({ id: "ARCH-1", recordType: "lesson", item: "01", area: "architecture", kind: "smell", title: "arch lesson one", text: "manifest content addressed hash decision", source: "m01/RETROSPECTIVE.md:10" }),
        record({ id: "ARCH-2", recordType: "adr", item: "01", area: "architecture", title: "arch adr two", text: "content addressed manifest membership decision", source: "m01/ARCHITECTURE.md:66" }),
        record({ id: "PROC-1", recordType: "lesson", item: "04", area: "process", kind: "near-miss", title: "process lesson", text: "content addressed manifest review cadence standup", source: "m04/RETROSPECTIVE.md:5" }),
        record({ id: "PROC-2", recordType: "adr", item: "04", area: "process", title: "process adr", text: "content addressed manifest planning ceremony", source: "m04/ARCHITECTURE.md:9" })
      ];
      const result = await recall("content addressed manifest", { area: "architecture" }, {}, { records });
      const block = renderRecallBlock(result);
      const lines = blockLines(block);
      assert.ok(lines.length > 0, "at least one architecture record surfaces");
      // Every surfaced record is an architecture-area record …
      for (const r of result.records) {
        assert.equal(r.area, "architecture", `${r.id} is an architecture-area record`);
      }
      // … and no off-scope (process) record leaks into a block line.
      for (const offScopeId of ["PROC-1", "PROC-2"]) {
        assert.ok(!block.includes(offScopeId), `off-scope record ${offScopeId} does not appear in the block`);
      }
      // Each line's area field (3rd " · "-separated field) is "architecture".
      for (const line of lines) {
        const fields = line.split(" · ");
        assert.equal(fields[2], "architecture", `line area field is architecture: ${line}`);
      }
    }
  },

  // ===================================================================
  // Scenario: the block is ordered highest-relevance first
  //   a query the fixture matches at varying strengths → block line order
  //   equals the records' non-increasing score order.
  // ===================================================================
  {
    name: "recall-block: ordered highest-relevance first (block line order === non-increasing score order)",
    run: async () => {
      const records = [
        // strong: many on-point terms, dense.
        record({ id: "STRONG", recordType: "lesson", item: "01", area: "architecture", kind: "near-miss", title: "manifest hash membership", text: "content addressed manifest hash membership content addressed", source: "m01/RETROSPECTIVE.md:1" }),
        // medium: one on-point term.
        record({ id: "MEDIUM", recordType: "adr", item: "01", area: "architecture", title: "membership decision", text: "membership of the bundle is decided by config and lock", source: "m01/ARCHITECTURE.md:2" }),
        // weak: a single passing mention.
        record({ id: "WEAK", recordType: "adr", item: "01", area: "architecture", title: "lock isolation", text: "the lock isolates planning content from work and hashes once", source: "m01/ARCHITECTURE.md:3" })
      ];
      const result = await recall("content addressed manifest hash", { area: "architecture" }, {}, { records });
      // The records' scores are non-increasing (recall returns highest-first).
      for (let i = 1; i < result.records.length; i += 1) {
        assert.ok(
          result.records[i - 1].score >= result.records[i].score,
          `score[${i - 1}]=${result.records[i - 1].score} >= score[${i}]=${result.records[i].score}`
        );
      }
      // The block lines are in that SAME order: line i's id === records[i].id.
      const lines = blockLines(renderRecallBlock(result));
      assert.equal(lines.length, result.records.length, "one line per record");
      for (let i = 0; i < lines.length; i += 1) {
        const idField = lines[i].split(" · ")[0];
        assert.ok(idField.startsWith(result.records[i].id), `block line ${i} matches record ${i} (highest-first)`);
      }
    }
  },

  // ===================================================================
  // Scenario: each line carries the fields an agent needs to act on it
  //   line shows id, kind, area, title, source; source is "path:line" that
  //   opens the live heading.
  // ===================================================================
  {
    name: "recall-block: each line carries id (milestone-qualified), kind, area, title, source — source opens the live heading; colliding ids stay distinct",
    run: async () => {
      const { file, headingLineOf } = await writeHeadingsFile();
      // Point each record's source at a KNOWN heading line in the temp file. The
      // fixture deliberately includes TWO records sharing id "ADR-002" from
      // DIFFERENT milestones (m01, m04) — the dominant real-corpus shape (ids recur
      // every milestone) — so we prove the block disambiguates them by `m<item>`
      // and match each rendered line by its UNIQUE source, never by id-prefix.
      const adrLineM01 = headingLineOf("content-addressed manifest membership");
      const adrLineM04 = headingLineOf("round-trip determinism");
      const lessonLine = headingLineOf("R1:");
      const records = [
        record({
          id: "ADR-002",
          recordType: "adr",
          item: "01",
          area: "architecture",
          kind: "", //                                       adr → kind "" so the line shows recordType "adr"
          title: "content-addressed manifest membership",
          text: "content addressed manifest membership decision invariant",
          source: `${file}:${adrLineM01}`
        }),
        record({
          id: "ADR-002", //                                  SAME id, different milestone (m04)
          recordType: "adr",
          item: "04",
          area: "architecture",
          kind: "",
          title: "round-trip determinism contract",
          text: "content addressed manifest round trip determinism contract decision",
          source: `${file}:${adrLineM04}`
        }),
        record({
          id: "R1",
          recordType: "lesson",
          item: "01",
          area: "architecture",
          kind: "near-miss", //                              lesson → kind shows "near-miss"
          title: "requiring-grep is a fitness-fn smell",
          text: "requiring grep fitness function smell content addressed manifest",
          source: `${file}:${lessonLine}`
        })
      ];
      const result = await recall("content addressed manifest", { area: "architecture" }, {}, { records });
      const block = renderRecallBlock(result);
      const lines = blockLines(block);
      assert.equal(lines.length, result.records.length, "one line per record");

      // Match each line by its UNIQUE source (robust to colliding ids), then parse
      // the 5 ` · `-separated fields and assert each value.
      for (const r of result.records) {
        const line = lines.find((l) => l.endsWith(r.source));
        assert.ok(line, `record sourced at ${r.source} has a block line`);
        const fields = line.split(" · ");
        assert.equal(fields.length, 5, `line has exactly 5 fields: ${line}`);
        const [idField, kindOrType, area, title, source] = fields;
        // field 1 is the milestone-qualified id: `${id} (m${item})`.
        assert.equal(idField, `${r.id} (m${r.item})`, "field 1 is the id, qualified by its milestone");
        assert.ok(idField.startsWith(r.id), "the id is shown");
        assert.ok(idField.includes(`m${r.item}`), "the milestone provenance is shown");
        assert.equal(kindOrType, r.kind || r.recordType, "field 2 is kind || recordType");
        assert.equal(area, r.area, "field 3 is the area");
        assert.equal(title, r.title, "field 4 is the title");
        assert.equal(source, r.source, "field 5 is the source");
        // an adr (kind "") shows "adr"; a lesson shows its kind.
        if (r.recordType === "adr") assert.equal(kindOrType, "adr", "adr shows recordType in the kind slot");
        else assert.equal(kindOrType, r.kind, "lesson shows its kind");

        // The source is a "path:line" that opens the LIVE heading.
        assert.match(source, /:\d+$/, "source ends in :<line>");
        const m = source.match(/^(.*):(\d+)$/);
        const srcPath = m[1];
        const srcLine = Number.parseInt(m[2], 10);
        const fileText = await readFile(srcPath, "utf8");
        const fileLines = fileText.split(/\r?\n/);
        const liveHeading = fileLines[srcLine - 1];
        assert.ok(liveHeading.startsWith("## "), `source line ${srcLine} is a heading: "${liveHeading}"`);
        // The live heading is the one this record was authored from.
        assert.ok(liveHeading.includes(r.id), `live heading at ${source} names ${r.id}`);
      }

      // The two colliding-id records render as TWO DISTINCT lines (different
      // `m<item>` + source) — an agent can tell which milestone each came from.
      const adrLines = lines.filter((l) => l.startsWith("ADR-002 "));
      assert.equal(adrLines.length, 2, "both ADR-002 records render their own line");
      assert.notEqual(adrLines[0], adrLines[1], "the two colliding-id lines are distinguishable");
      assert.ok(adrLines.some((l) => l.includes("(m01)")) && adrLines.some((l) => l.includes("(m04)")), "each carries its own milestone");
    }
  },

  // ===================================================================
  // Scenario: an empty recall renders an empty block, not a placeholder
  //   a scope that matches no record → renderRecallBlock returns "" (=== "",
  //   not "none"); the caller omits it from context.
  // ===================================================================
  {
    name: "recall-block: an empty recall renders an empty block (=== \"\"), never a \"none\" placeholder",
    run: async () => {
      const records = [
        record({ id: "ARCH-1", recordType: "lesson", item: "01", area: "architecture", title: "arch lesson", text: "manifest decision" }),
        record({ id: "ARCH-2", recordType: "adr", item: "01", area: "architecture", title: "arch adr", text: "membership decision" })
      ];
      // A scope no record satisfies → empty RecallResult → empty block.
      const result = await recall("manifest", { area: "security" }, {}, { records });
      assert.equal(result.records.length, 0, "no record survives the off-scope filter");
      const block = renderRecallBlock(result);
      assert.equal(block, "", "an empty recall renders the empty string");
      assert.ok(!block.includes("none"), "the empty block is not a 'none' placeholder");
    }
  }
];
