// Traceability wiring for milestone 40 / story 01 (version stamp & reader), task
//   wiki/work/40_milestone_work-item-versioning-upgrade/stories/
//     01_story_version-stamp-and-reader/tasks/00_reader-schema-and-provenance.feature
// Every @executable scenario (and each Scenario Outline row) below is wired
// against the LOCKED reader seam — `readItemSchema`/`readItemVersion`
// (src/work.mjs, ADR-001/ADR-003) — and the exported `WORK_ITEM_SCHEMA_VERSION`
// constant, read back over a hand-authored fixture on disk, cross-checked
// against a fresh `parseFrontmatter` call proving the shared parser is
// UNCHANGED (18/ADR-007): it hands back the raw scalar, never a coerced value —
// the reader's coercion is the reader's job, not the parser's.
import assert from "node:assert/strict";
import { readItemSchema, readItemVersion, parseFrontmatter, WORK_ITEM_SCHEMA_VERSION } from "../src/work.mjs";
import { withWork, writeMilestoneRecordDoc } from "./support/work-version-fixture.mjs";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const workVersionReaderTests = [
  // Scenario Outline: a present schema value resolves to that integer; a
  // non-integer falls to the baseline 0.
  ...[
    { value: "1", resolved: 1 },
    { value: "0", resolved: 0 },
    { value: "2", resolved: 2 },
    { value: "latest", resolved: 0 },
  ].map(({ value, resolved }) => ({
    name: `work-version/reader: schema value "${value}" resolves to the integer ${resolved}, a whole number never a string`,
    run: () =>
      withWork(async (work) => {
        const { item } = await writeMilestoneRecordDoc(work, { extraLines: [`schema: ${value}`] });
        const result = await readItemSchema(item);
        assert.equal(result, resolved, `readItemSchema resolved ${JSON.stringify(result)}, expected ${resolved}`);
        assert.equal(Number.isInteger(result), true, "the resolved schema is a whole number, never a string");
      }),
  })),

  // The unstamped baseline (ADR-003): no schema key at all reads as 0.
  {
    name: "work-version/reader: an item with no schema key at all resolves to the baseline schema 0",
    run: () =>
      withWork(async (work) => {
        const { item } = await writeMilestoneRecordDoc(work, { extraLines: [] });
        const result = await readItemSchema(item);
        assert.equal(result, 0, "no schema key ⇒ the pre-versioning baseline 0");
      }),
  },

  // aofVersion is provenance, never parsed for logic — resolves to the
  // verbatim string.
  {
    name: "work-version/reader: aofVersion resolves to a plain string, never parsed for logic",
    run: () =>
      withWork(async (work) => {
        const { item } = await writeMilestoneRecordDoc(work, { extraLines: ["aofVersion: 0.1.0"] });
        const result = await readItemVersion(item);
        assert.equal(result, "0.1.0", `readItemVersion resolved ${JSON.stringify(result)}`);
        assert.notEqual(typeof result, "number", "aofVersion is not a number");
      }),
  },

  // ADR-001: WORK_ITEM_SCHEMA_VERSION is a single exported integer constant,
  // value 1 at this milestone.
  {
    name: "work-version/reader: WORK_ITEM_SCHEMA_VERSION is a single exported integer constant with value 1",
    run: () =>
      withWork(async () => {
        assert.equal(WORK_ITEM_SCHEMA_VERSION, 1, "WORK_ITEM_SCHEMA_VERSION is 1 at this milestone");
        assert.equal(Number.isInteger(WORK_ITEM_SCHEMA_VERSION), true, "it is a whole number, never a string");
      }),
  },

  // 18/ADR-007: parseFrontmatter is unchanged — both version keys still parse
  // as raw scalars. If the parser had changed, `schema` would come back a
  // number; it must come back the raw scalar string, so the int coercion is
  // proven to be the READER's job, not the parser's.
  {
    name: "work-version/reader: parseFrontmatter is unchanged — it returns both version keys as raw scalars",
    run: () =>
      withWork(async (work) => {
        const { dir } = await writeMilestoneRecordDoc(work, { extraLines: ["schema: 1", "aofVersion: 0.1.0"] });
        const text = await readFile(path.join(dir, "SPEC.md"), "utf8");
        const meta = parseFrontmatter(text);
        assert.equal(meta.schema, "1", `parsed "schema" should be the raw scalar "1" (got ${JSON.stringify(meta.schema)})`);
        assert.equal(typeof meta.schema, "string", "parseFrontmatter hands back schema as a string, not a coerced integer");
        assert.equal(meta.aofVersion, "0.1.0", `parsed "aofVersion" should be the raw scalar "0.1.0" (got ${JSON.stringify(meta.aofVersion)})`);
      }),
  },
];
