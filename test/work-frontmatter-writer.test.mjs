// Traceability wiring for milestone 40 / story 01 (version stamp & reader), task
//   wiki/work/40_milestone_work-item-versioning-upgrade/stories/
//     01_story_version-stamp-and-reader/tasks/02_transform-scoped-writer-body-preserving.feature
// Every @executable scenario (and each Scenario Outline row) below is wired
// against the LOCKED ADR-004 transform-scoped writer `applyItemFrontmatter`
// (src/work.mjs) and against `rollbackItemStatus` (proving its own bound stays
// untouched — the SAME export, not widened). Confirmed by byte-diffing the
// record doc's raw bytes before/after each call, cross-checked through the
// story-01 reader — no source read.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { applyItemFrontmatter, rollbackItemStatus, readItemSchema } from "../src/work.mjs";
import { withWork, writeWriterFixtureDoc } from "./support/work-version-fixture.mjs";

const bodyOf = (text) => text.slice(text.indexOf("\n---", 3) + "\n---".length);
const blockOf = (text) => text.match(/^---\r?\n([\s\S]*?)\r?\n---/)[1];
const docPathOf = (dir) => path.join(dir, "STORY.md");

const UNRELATED_LINES = {
  title: 'title: "Subject"',
  status: "status: in-progress",
  type: "type: story",
  number: "number: 00",
  slug: "slug: subject",
  parent: "parent: 00",
  owner: "owner: developer",
  created: "created: 2026-07-17",
  updated: "updated: 2026-07-17",
  comment: "# internal note: reviewed at refine — this comment must survive verbatim",
};

function assertUnrelatedLinesSurvive(afterText, { skip = [] } = {}) {
  for (const [key, line] of Object.entries(UNRELATED_LINES)) {
    if (skip.includes(key)) continue;
    assert.ok(afterText.includes(line), `expected unrelated line "${line}" (key "${key}") to survive unchanged`);
  }
}

export const workFrontmatterWriterTests = [
  // Headline: adding the version keys touches only the leading block — body
  // and every existing key byte-identical.
  {
    name: "work-frontmatter-writer: adding the version keys leaves the body and every existing key byte-identical",
    run: () =>
      withWork(async (work) => {
        const { item, dir, text: before } = await writeWriterFixtureDoc(work, { extraLines: [] });
        await applyItemFrontmatter(item, (block) => `${block}\nschema: 1\naofVersion: 0.1.0`);
        const after = await readFile(docPathOf(dir), "utf8");

        assert.equal(bodyOf(after), bodyOf(before), "the record doc's body is byte-identical to before");
        assertUnrelatedLinesSurvive(after);
        const block = blockOf(after);
        assert.ok(/^schema:\s*1\s*$/m.test(block), 'the leading block now declares "schema"');
        assert.ok(/^aofVersion:\s*0\.1\.0\s*$/m.test(block), 'the leading block now declares "aofVersion"');
      }),
  },

  // The 0 -> 1 restamp move: re-valuing an existing key changes only that
  // value line.
  {
    name: "work-frontmatter-writer: re-valuing an existing key changes only that value line",
    run: () =>
      withWork(async (work) => {
        const { item, dir, text: before } = await writeWriterFixtureDoc(work, { extraLines: ["schema: 0"] });
        await applyItemFrontmatter(item, (block) => block.replace(/^schema:.*$/m, "schema: 1"));
        const after = await readFile(docPathOf(dir), "utf8");

        assert.ok(/^schema:\s*1\s*$/m.test(after), 'the "schema" line now reads "schema: 1"');
        assert.equal(bodyOf(after), bodyOf(before), "the record doc's body is byte-identical to before");
        assertUnrelatedLinesSurvive(after);
      }),
  },

  // Body-preservation holds across every frontmatter operation the writer is
  // allowed (add / re-value / rename).
  ...[
    {
      operation: 'add a new "schema" key',
      setupExtraLines: [],
      mutate: (block) => `${block}\nschema: 1`,
      assertChange: (block) => assert.ok(/^schema:\s*1\s*$/m.test(block), 'the new block declares "schema: 1"'),
    },
    {
      operation: 'add a new "aofVersion" key',
      setupExtraLines: [],
      mutate: (block) => `${block}\naofVersion: 0.1.0`,
      assertChange: (block) => assert.ok(/^aofVersion:\s*0\.1\.0\s*$/m.test(block), 'the new block declares "aofVersion: 0.1.0"'),
    },
    {
      operation: 're-value the existing "schema" key',
      setupExtraLines: ["schema: 0"],
      mutate: (block) => block.replace(/^schema:.*$/m, "schema: 1"),
      assertChange: (block) => assert.ok(/^schema:\s*1\s*$/m.test(block), 'the new block declares "schema: 1"'),
    },
    {
      operation: "rename a legacy key to its new name",
      setupExtraLines: ["legacyKey: legacy-value"],
      mutate: (block) => block.replace(/^legacyKey:(.*)$/m, "renamedKey:$1"),
      assertChange: (block) => {
        assert.ok(/^renamedKey:\s*legacy-value\s*$/m.test(block), "the new block declares the renamed key with its original value");
        assert.ok(!/^legacyKey:/m.test(block), "the legacy key name is gone");
      },
    },
  ].map(({ operation, setupExtraLines, mutate, assertChange }) => ({
    name: `work-frontmatter-writer: whatever the frontmatter operation (${operation}), the body stays byte-identical`,
    run: () =>
      withWork(async (work) => {
        const { item, dir, text: before } = await writeWriterFixtureDoc(work, { extraLines: setupExtraLines });
        await applyItemFrontmatter(item, mutate);
        const after = await readFile(docPathOf(dir), "utf8");

        assert.equal(bodyOf(after), bodyOf(before), "the record doc's body is byte-identical to before");
        assertChange(blockOf(after));
        assertUnrelatedLinesSurvive(after);
      }),
  })),

  // The writer never gratuitously bumps `updated` — it changes only the keys
  // the caller's mutate function actually touches.
  {
    name: "work-frontmatter-writer: the writer does not gratuitously bump updated",
    run: () =>
      withWork(async (work) => {
        const { item, dir } = await writeWriterFixtureDoc(work, { extraLines: [] });
        await applyItemFrontmatter(item, (block) => `${block}\nschema: 1`);
        const after = await readFile(docPathOf(dir), "utf8");
        assert.ok(after.includes("updated: 2026-07-17"), 'the "updated" line is byte-identical to before');
      }),
  },

  // No parseFrontmatter round-trip: comments, key order, and formatting
  // survive.
  {
    name: "work-frontmatter-writer: the writer preserves comments, key order, and formatting",
    run: () =>
      withWork(async (work) => {
        const { item, dir, text: before } = await writeWriterFixtureDoc(work, { extraLines: [] });
        await applyItemFrontmatter(item, (block) => `${block}\nschema: 1`);
        const after = await readFile(docPathOf(dir), "utf8");

        assert.ok(after.includes(UNRELATED_LINES.comment), "the comment line inside the frontmatter block survives verbatim");
        const beforeOrder = blockOf(before).split(/\r?\n/).filter((l) => !/^schema:|^aofVersion:/.test(l));
        const afterOrder = blockOf(after).split(/\r?\n/).filter((l) => !/^schema:|^aofVersion:/.test(l));
        assert.deepEqual(afterOrder, beforeOrder, "the pre-existing keys keep their original relative order");
        assert.ok(after.includes("<!--\n  A body HTML comment block"), "the body HTML comment block is present, unchanged");
      }),
  },

  // The write landed and the doc re-reads whole — the observable half of
  // atomic persistence.
  {
    name: "work-frontmatter-writer: after the write the item resolves at its new schema and the doc re-reads whole",
    run: () =>
      withWork(async (work) => {
        const { item, dir } = await writeWriterFixtureDoc(work, { extraLines: [] });
        const before = await readItemSchema(item);
        assert.equal(before, 0, "the reader resolves the item's schema as 0 before the stamp");

        await applyItemFrontmatter(item, (block) => `${block}\nschema: 1`);
        const after = await readItemSchema(item);
        assert.equal(after, 1, "the reader now resolves the item's schema as 1");

        const text = await readFile(docPathOf(dir), "utf8");
        assert.ok(text.startsWith("---\n") || text.startsWith("---\r\n"), 'the record doc on disk opens with "---"');
        assert.match(text, /\r?\n---/, "the record doc carries a closing fence");
        assert.ok(bodyOf(text).includes("## Acceptance"), "the record doc's body is intact");
      }),
  },

  // ADR-004 / criterion 6: adding this writer does NOT widen rollbackItemStatus.
  {
    name: "work-frontmatter-writer: the status-only rollback writer's bound is preserved",
    run: () =>
      withWork(async (work) => {
        const { item, dir, text: before } = await writeWriterFixtureDoc(work, { status: "in-progress" });
        await rollbackItemStatus(item, "not-started");
        const after = await readFile(docPathOf(dir), "utf8");

        assert.ok(/^status:\s*not-started\s*$/m.test(after), "the status line changed to not-started");
        assert.equal(bodyOf(after), bodyOf(before), "the record doc's body is byte-identical to before");
        assertUnrelatedLinesSurvive(after, { skip: ["status"] });
      }),
  },

  // rollbackItemStatus still refuses the moves its bound forbids.
  ...[
    { from: "in-progress", target: "done", code: "forbidden-rollback" },
    { from: "in-progress", target: "in-review", code: "forbidden-rollback" },
    { from: "not-started", target: "not-started", code: "rollback-not-applicable" },
  ].map(({ from, target, code }) => ({
    name: `work-frontmatter-writer: rollbackItemStatus refuses rolling from "${from}" to "${target}" with "${code}", leaving the doc byte-unchanged`,
    run: () =>
      withWork(async (work) => {
        const { item, dir, text: before } = await writeWriterFixtureDoc(work, { status: from });
        await assert.rejects(
          () => rollbackItemStatus(item, target),
          (error) => {
            assert.equal(error.code, code, `expected error code "${code}" (got "${error.code}")`);
            return true;
          },
        );
        const after = await readFile(docPathOf(dir), "utf8");
        assert.equal(after, before, "the record doc is byte-unchanged from before the rejected call");
      }),
  })),
];
