// Traceability wiring for milestone 41 / story 01 (reindex-engine), task
//   wiki/work/41_milestone_work-item-insertion/stories/01_story_reindex-engine/
//     tasks/00_slot-open-renames-and-bumps-number.feature
// Every @executable scenario (and each Scenario Outline row) below is wired
// against the LOCKED engine `reindexForInsert(workDir, { at, space, parent })`
// (src/work-reindex.mjs). Story 01 has NO command surface (STORY.md) — the
// engine is called directly via its API; the OUTCOME is read back through the
// existing, UNMODIFIED `findWork`/`listItems`/`validateWork` readers
// (src/work.mjs) against the fixture on disk — the feature's own litmus
// ("a fresh `aof work find|validate --json`").
import assert from "node:assert/strict";
import { findWork, listItems, validateWork } from "../src/work.mjs";
import { reindexForInsert } from "../src/work-reindex.mjs";
import { withWork, buildTopLevelStream, folderNames, SLUGS } from "./support/work-reindex-fixture.mjs";

const CONFIG = {};

export const workReindexSlotOpenTests = [
  // Scenario: opening a slot at P renames every item >= P up by exactly one,
  // leaving earlier items untouched.
  {
    name: "work-reindex/slot-open: opening a slot at 3 renames every item >= 3 up by exactly one, leaving 00-02 untouched",
    run: () =>
      withWork(async (work) => {
        await buildTopLevelStream(work, 6); // 00_milestone_alpha .. 05_milestone_foxtrot
        await reindexForInsert(work, { at: 3, space: "top-level" });

        const names = await folderNames(work);
        assert.deepEqual(
          names,
          ["00_milestone_alpha", "01_milestone_bravo", "02_milestone_charlie", "04_milestone_delta", "05_milestone_echo", "06_milestone_foxtrot"],
          `unexpected folder set: ${JSON.stringify(names)}`,
        );
      }),
  },

  // Scenario: opening a slot bumps each shifted item's frontmatter number to
  // match its new folder — confirmed via validate (folder <-> frontmatter
  // number equality) and find (proves the rename by slug).
  {
    name: "work-reindex/slot-open: opening a slot at 3 bumps each shifted item's frontmatter number to match its new folder",
    run: () =>
      withWork(async (work) => {
        await buildTopLevelStream(work, 6);
        await reindexForInsert(work, { at: 3, space: "top-level" });

        const four = await findWork(work, "4");
        assert.equal(four.length, 1, "4 resolves");
        assert.equal(four[0].slug, "delta", "4 resolves (by slug) the item that was numbered 03");

        const six = await findWork(work, "6");
        assert.equal(six.length, 1, "6 resolves");
        assert.equal(six[0].slug, "foxtrot", "6 resolves (by slug) the item that was numbered 05");

        const three = await findWork(work, "3");
        assert.equal(three.length, 0, "3 resolves nothing that predates the insert");

        const findings = await validateWork(work, CONFIG);
        const numberFindings = findings.filter((f) => /≠ folder/.test(f.problem));
        assert.deepEqual(numberFindings, [], `no folder-vs-frontmatter-number finding expected: ${JSON.stringify(findings)}`);
      }),
  },

  // Scenario Outline: the shift is exactly one slot — no gaps, no collisions,
  // no double-shift.
  ...[0, 3, 5, 6].map((at) => ({
    name: `work-reindex/slot-open: the shift at position ${at} is exactly one slot — no gaps, no collisions, no double-shift`,
    run: () =>
      withWork(async (work) => {
        await buildTopLevelStream(work, 6); // numbers 0..5, slugs alpha..foxtrot
        await reindexForInsert(work, { at, space: "top-level" });

        // Every item that was numbered >= at is now exactly one higher.
        for (let n = 0; n < 6; n += 1) {
          const expectedNew = n >= at ? n + 1 : n;
          const matches = await findWork(work, String(expectedNew));
          assert.equal(matches.length, 1, `slug ${SLUGS[n]} expected at ${expectedNew}`);
          assert.equal(matches[0].slug, SLUGS[n], `slug mismatch at ${expectedNew}`);
        }

        // No two items share the same number.
        const items = await listItems(work);
        const topNumbers = items.filter((item) => item.parent == null).map((item) => Number.parseInt(item.number, 10));
        assert.equal(new Set(topNumbers).size, topNumbers.length, "no duplicate numbers");

        // Slot `at` is empty.
        const atSlot = await findWork(work, String(at));
        assert.equal(atSlot.length, 0, `slot ${at} should be empty`);

        // Validate is entirely clean.
        const findings = await validateWork(work, CONFIG);
        assert.deepEqual(findings, [], `expected zero findings at=${at}: ${JSON.stringify(findings)}`);
      }),
  })),

  // Scenario: opening a slot beyond the highest existing number shifts
  // nothing — a well-defined no-op shift.
  {
    name: "work-reindex/slot-open: opening a slot at 9 (beyond the highest existing number) shifts nothing",
    run: () =>
      withWork(async (work) => {
        await buildTopLevelStream(work, 6);
        const before = await folderNames(work);
        await reindexForInsert(work, { at: 9, space: "top-level" });
        const after = await folderNames(work);
        assert.deepEqual(after, before, "no folder should have changed");

        const nine = await findWork(work, "9");
        assert.equal(nine.length, 0, "slot 9 is empty");
      }),
  },
];
