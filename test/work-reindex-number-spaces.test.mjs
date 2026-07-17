// Traceability wiring for milestone 41 / story 01 (reindex-engine), task
//   wiki/work/41_milestone_work-item-insertion/stories/01_story_reindex-engine/
//     tasks/03_two-number-space-axes.feature
// Every @executable scenario below is wired against the LOCKED engine
// `reindexForInsert(workDir, { at, space, parent })` (src/work-reindex.mjs),
// confirmed via a fresh `findWork`/`listItems` read (src/work.mjs) of the
// fixture stream after the engine call.
import assert from "node:assert/strict";
import { findWork, listItems } from "../src/work.mjs";
import { reindexForInsert } from "../src/work-reindex.mjs";
import { withWork, buildTopLevelStream, writeStoryItem } from "./support/work-reindex-fixture.mjs";

async function buildFixture(work) {
  const dirs = await buildTopLevelStream(work, 4); // 00-03: alpha, bravo, charlie, delta
  await writeStoryItem(dirs.charlie, "00", "02");
  await writeStoryItem(dirs.charlie, "01", "02");
  await writeStoryItem(dirs.charlie, "02", "02");
  await writeStoryItem(dirs.delta, "00", "03");
  await writeStoryItem(dirs.delta, "01", "03");
  return dirs;
}

export const workReindexNumberSpacesTests = [
  // Scenario: a top-level slot-open shifts only top-level items, leaving
  // every milestone's nested story numbers untouched.
  {
    name: "work-reindex/number-spaces: a top-level slot-open shifts only top-level items, leaving nested story numbers untouched",
    run: () =>
      withWork(async (work) => {
        await buildFixture(work);
        await reindexForInsert(work, { at: 2, space: "top-level" });

        // charlie (was 02) is now renumbered to 03, but its stories are still
        // locally numbered 00, 01, 02.
        const charlie = await findWork(work, "3");
        assert.equal(charlie.length, 1);
        assert.equal(charlie[0].slug, "charlie");
        for (const local of ["00", "01", "02"]) {
          const story = await findWork(work, `03/${local}`);
          assert.equal(story.length, 1, `story 03/${local} should resolve`);
        }

        // delta (was 03) is now renumbered to 04, but its stories are still
        // locally numbered 00 and 01.
        const delta = await findWork(work, "4");
        assert.equal(delta.length, 1);
        assert.equal(delta[0].slug, "delta");
        for (const local of ["00", "01"]) {
          const story = await findWork(work, `04/${local}`);
          assert.equal(story.length, 1, `story 04/${local} should resolve`);
        }
      }),
  },

  // Scenario: a nested slot-open shifts only the target milestone's own
  // stories, leaving other milestones and top-level items untouched.
  {
    name: "work-reindex/number-spaces: a nested slot-open shifts only the target milestone's own stories",
    run: () =>
      withWork(async (work) => {
        await buildFixture(work);
        await reindexForInsert(work, { at: 1, space: "nested", parent: "02" });

        // 02/01 -> 02/02, 02/02 -> 02/03.
        const two = await findWork(work, "02/02");
        assert.equal(two.length, 1);
        const three = await findWork(work, "02/03");
        assert.equal(three.length, 1);
        // 02/00 is still 02/00.
        const zero = await findWork(work, "02/00");
        assert.equal(zero.length, 1);

        // milestone 03 and its nested stories 03/00 and 03/01 are unchanged.
        const m03 = await findWork(work, "3");
        assert.equal(m03.length, 1);
        assert.equal(m03[0].slug, "delta");
        const s00 = await findWork(work, "03/00");
        assert.equal(s00.length, 1);
        const s01 = await findWork(work, "03/01");
        assert.equal(s01.length, 1);

        // No top-level item's number changes.
        const items = await listItems(work);
        const topNumbers = items.filter((item) => item.parent == null).map((item) => item.number).sort();
        assert.deepEqual(topNumbers, ["00", "01", "02", "03"], "no top-level item's number changes");
      }),
  },

  // Scenario: nested slot-opens under different milestones are independent
  // of each other.
  {
    name: "work-reindex/number-spaces: nested slot-opens under different milestones are independent of each other",
    run: () =>
      withWork(async (work) => {
        await buildFixture(work);
        await reindexForInsert(work, { at: 1, space: "nested", parent: "02" });

        const s00 = await findWork(work, "03/00");
        assert.equal(s00.length, 1, "milestone 03's story 03/00 is unchanged");
        const s01 = await findWork(work, "03/01");
        assert.equal(s01.length, 1, "milestone 03's story 03/01 is unchanged");
      }),
  },
];
