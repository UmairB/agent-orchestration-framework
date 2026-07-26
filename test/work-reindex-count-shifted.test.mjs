// Traceability wiring for milestone 41 / story 01 (reindex-engine), task
//   wiki/work/41_milestone_work-item-insertion/stories/01_story_reindex-engine/
//     tasks/04_count-shifted-primitive.feature
// Every @executable scenario (and each Scenario Outline row) below is wired
// against the LOCKED engine `countShiftedByInsert(workDir, { at, space, parent })`
// (src/work-reindex.mjs), cross-checked against a fresh `listItems`/`findWork`
// read (src/work.mjs) and (for the last scenario) against
// `reindexForInsert`'s own reported shift count — the ADR-004 "one source of
// truth" guarantee.
import assert from "node:assert/strict";
import { listItems } from "../src/work.mjs";
import { countShiftedByInsert, reindexForInsert } from "../src/work-reindex.mjs";
import { withWork, buildTopLevelStream, writeStoryItem, folderNames } from "./support/work-reindex-fixture.mjs";

async function buildFixture(work) {
  const dirs = await buildTopLevelStream(work, 6); // 00-05
  await writeStoryItem(dirs.charlie, "00", "02");
  await writeStoryItem(dirs.charlie, "01", "02");
  await writeStoryItem(dirs.charlie, "02", "02");
  return dirs;
}

export const workReindexCountShiftedTests = [
  // Scenario Outline: the count primitive reports exactly the number of
  // top-level items at/after P.
  ...[
    { at: 0, count: 6 },
    { at: 3, count: 3 },
    { at: 5, count: 1 },
    { at: 6, count: 0 },
  ].map(({ at, count }) => ({
    name: `work-reindex/count-shifted: the count primitive at position ${at} reports exactly ${count} top-level items`,
    run: () =>
      withWork(async (work) => {
        await buildFixture(work);
        const before = await folderNames(work);

        const reported = await countShiftedByInsert(work, { at, space: "top-level" });
        assert.equal(reported, count, `expected count ${count} at at=${at}, got ${reported}`);

        const after = await folderNames(work);
        assert.deepEqual(after, before, "no folder or frontmatter number has changed");
      }),
  })),

  // Scenario: a nested count counts only the target milestone's own stories,
  // not top-level items.
  {
    name: "work-reindex/count-shifted: a nested count counts only the target milestone's own stories, not top-level items",
    run: () =>
      withWork(async (work) => {
        await buildFixture(work);
        const before = await folderNames(work);

        const reported = await countShiftedByInsert(work, { at: 1, space: "nested", parent: "02" });
        assert.equal(reported, 2, `expected 2 (stories 02/01 and 02/02), got ${reported}`);

        const after = await folderNames(work);
        assert.deepEqual(after, before, "no folder or frontmatter number has changed");
      }),
  },

  // Scenario: calling the count primitive mutates nothing.
  {
    name: "work-reindex/count-shifted: calling the count primitive mutates nothing",
    run: () =>
      withWork(async (work) => {
        await buildFixture(work);
        const before = await listItems(work);

        await countShiftedByInsert(work, { at: 2, space: "top-level" });

        const after = await listItems(work);
        assert.deepEqual(after, before, "a fresh listItems read over the fixture stream is unchanged from before the call");
      }),
  },

  // Scenario: the count primitive's answer equals the number of items a
  // slot-open at the same P actually shifts.
  {
    name: "work-reindex/count-shifted: the count primitive's answer equals the number of items a slot-open at the same P actually shifts",
    run: () =>
      withWork(async (work) => {
        await buildFixture(work);
        const recordedCount = await countShiftedByInsert(work, { at: 3, space: "top-level" });

        const result = await reindexForInsert(work, { at: 3, space: "top-level" });

        assert.equal(result.shifted, recordedCount, "the number of items actually renamed equals the previously recorded count");
      }),
  },
];
