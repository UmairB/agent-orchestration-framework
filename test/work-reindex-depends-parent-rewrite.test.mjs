// Traceability wiring for milestone 41 / story 01 (reindex-engine), task
//   wiki/work/41_milestone_work-item-insertion/stories/01_story_reindex-engine/
//     tasks/01_depends-and-parent-rewrite-stays-resolvable.feature
// Every @executable scenario below is wired against the LOCKED engine
// `reindexForInsert(workDir, { at, space, parent })` (src/work-reindex.mjs).
// The outcome is read back via `findWork`/`validateWork` (src/work.mjs) and —
// for the exact rewritten `depends`/`parent` VALUE, which find/list --json do
// not expose — by reading the referencing item's record-doc frontmatter line
// directly, exactly as the feature's own litmus prescribes.
import assert from "node:assert/strict";
import { findWork, validateWork } from "../src/work.mjs";
import { reindexForInsert } from "../src/work-reindex.mjs";
import { withWork, buildTopLevelStream, writeMilestoneItem, writeStoryItem, writeUatItem, readDocText } from "./support/work-reindex-fixture.mjs";

const CONFIG = {};

function extractLine(text, keyPrefix) {
  const match = text.match(new RegExp(`^${keyPrefix}:[^\\n\\r]*`, "m"));
  return match ? match[0] : null;
}

export const workReindexDependsParentRewriteTests = [
  // Scenario: a depends value pointing at a shifted top-level item is
  // rewritten to the item's new number.
  {
    name: "work-reindex/depends-parent: a depends value pointing at a shifted top-level item is rewritten to the item's new number",
    run: () =>
      withWork(async (work) => {
        await buildTopLevelStream(work, 5); // 00-04
        await writeMilestoneItem(work, "05", { depends: ["2"] }); // foxtrot depends on charlie (02)
        await reindexForInsert(work, { at: 2, space: "top-level" });

        const shifted = await findWork(work, "6"); // foxtrot (was 05) now at 06
        assert.equal(shifted.length, 1);
        assert.equal(shifted[0].slug, "foxtrot");
        const text = await readDocText(shifted[0].dir, "SPEC.md");
        assert.equal(extractLine(text, "depends"), "depends: [3]", `depends should point at the new number of what was 02: ${text}`);

        const findings = await validateWork(work, CONFIG);
        const onThatDoc = findings.filter((f) => f.path.includes(shifted[0].dir));
        assert.deepEqual(onThatDoc, [], `expected zero findings for that item's record doc: ${JSON.stringify(onThatDoc)}`);
      }),
  },

  // Regression test for QA coverage gap F-1 (behavioural review of the review
  // fast-follow, 2026-07-16): "mixed-type top-level shift set." Every prior
  // fixture in this file builds the shifting set as milestones ONLY, even
  // though the top-level number space is SHARED across milestone/uat/spike/
  // chore/adhoc-story (ADR-005). This exercises `rewriteReferences` routing a
  // non-story item (a `uat`) to `applyDependsRewrite` — the affected set
  // includes a pre-existing uat declaring `depends:[k]` where k is a
  // milestone that ALSO shifts under the same insert.
  {
    name: "work-reindex/depends-parent: a shifted top-level uat's own depends entry (pointing at a milestone that ALSO shifted) is rewritten to that milestone's new number",
    run: () =>
      withWork(async (work) => {
        await buildTopLevelStream(work, 5); // 00-04 (alpha, bravo, charlie, delta, echo)
        await writeUatItem(work, "05", { depends: ["3"] }); // a uat depending on delta (03)
        await reindexForInsert(work, { at: 2, space: "top-level" }); // shifts 02,03,04,05 (the uat itself is IN the affected set)

        // The uat (was 05) itself shifted (>= P=2) to 06.
        const uat = await findWork(work, "6");
        assert.equal(uat.length, 1, "the uat resolves at its new ref 6");
        assert.equal(uat[0].type, "uat", "the shifted item is a uat, not a milestone");

        const uatText = await readDocText(uat[0].dir, "SESSION.md");
        assert.equal(
          extractLine(uatText, "depends"),
          "depends: [4]",
          `the uat's depends entry is rewritten to delta's new number (delta was 03, now 04): ${uatText}`,
        );

        const findings = await validateWork(work, CONFIG);
        assert.deepEqual(findings, [], `the whole stream (including the shifted uat) validates clean: ${JSON.stringify(findings)}`);
      }),
  },

  // Scenario: a nested story's parent is rewritten when its owning milestone
  // shifts.
  {
    name: "work-reindex/depends-parent: a nested story's parent is rewritten when its owning milestone shifts",
    run: () =>
      withWork(async (work) => {
        const dirs = await buildTopLevelStream(work, 6); // 00-05
        await writeStoryItem(dirs.echo, "00", "04"); // 04/00 under echo (was 04)
        await reindexForInsert(work, { at: 2, space: "top-level" });

        // echo (was 04) shifts to 05; its nested story now resolves at 05/00.
        const story = await findWork(work, "05/00");
        assert.equal(story.length, 1, "a fresh find for the story's new ref returns exactly one result");
        assert.equal(story[0].slug, "story00");

        const findings = await validateWork(work, CONFIG);
        const onThatDoc = findings.filter((f) => f.path.includes(story[0].dir));
        assert.deepEqual(onThatDoc, [], `expected zero findings for that story's record doc: ${JSON.stringify(onThatDoc)}`);
      }),
  },

  // Scenario: a depends or parent value that did NOT point at a shifted item
  // is left unchanged.
  {
    name: "work-reindex/depends-parent: a depends value that did not point at a shifted item is left unchanged",
    run: () =>
      withWork(async (work) => {
        await buildTopLevelStream(work, 5); // 00-04
        await writeMilestoneItem(work, "05", { depends: ["0"] }); // foxtrot depends on alpha (00)
        await reindexForInsert(work, { at: 3, space: "top-level" });

        const shifted = await findWork(work, "6"); // foxtrot (was 05) now at 06
        assert.equal(shifted.length, 1);
        const text = await readDocText(shifted[0].dir, "SPEC.md");
        assert.equal(extractLine(text, "depends"), "depends: [0]", `depends should stay unchanged: ${text}`);
      }),
  },

  // Scenario: a multi-entry depends list rewrites only the entries that
  // pointed at a shifted driver.
  {
    name: "work-reindex/depends-parent: a multi-entry depends list rewrites only the entries that pointed at a shifted driver",
    run: () =>
      withWork(async (work) => {
        await buildTopLevelStream(work, 5); // 00-04
        await writeMilestoneItem(work, "05", { depends: ["1", "4"] }); // foxtrot depends on bravo(01) and echo(04)
        await reindexForInsert(work, { at: 2, space: "top-level" });

        const shifted = await findWork(work, "6"); // foxtrot (was 05) now at 06
        assert.equal(shifted.length, 1);
        const text = await readDocText(shifted[0].dir, "SPEC.md");
        assert.equal(
          extractLine(text, "depends"),
          "depends: [1, 5]",
          `entry "1" (below P) unchanged; entry "4" (shifted) rewritten to 5: ${text}`,
        );

        const findings = await validateWork(work, CONFIG);
        const onThatDoc = findings.filter((f) => f.path.includes(shifted[0].dir));
        assert.deepEqual(onThatDoc, [], `expected zero findings for that item's record doc: ${JSON.stringify(onThatDoc)}`);
      }),
  },

  // Scenario: aof work validate is green across the whole fixture stream
  // after an insert, with no manual repair.
  {
    name: "work-reindex/depends-parent: aof work validate is green across the whole fixture stream after an insert",
    run: () =>
      withWork(async (work) => {
        await buildTopLevelStream(work, 4); // 00-03
        const echoDir = await writeMilestoneItem(work, "04");
        await writeStoryItem(echoDir, "00", "04");
        await writeMilestoneItem(work, "05", { depends: ["2"] });

        await reindexForInsert(work, { at: 2, space: "top-level" });

        const findings = await validateWork(work, CONFIG);
        assert.deepEqual(findings, [], `expected the whole fixture stream to validate clean: ${JSON.stringify(findings)}`);
      }),
  },

  // Scenario: the depends graph stays acyclic after a top-level insert.
  {
    name: "work-reindex/depends-parent: the depends graph stays acyclic after a top-level insert",
    run: () =>
      withWork(async (work) => {
        await writeMilestoneItem(work, "00");
        await writeMilestoneItem(work, "01", { depends: ["0"] });
        await writeMilestoneItem(work, "02");
        await writeMilestoneItem(work, "03", { depends: ["1"] });
        await writeMilestoneItem(work, "04");
        await writeMilestoneItem(work, "05");

        await reindexForInsert(work, { at: 2, space: "top-level" });

        const findings = await validateWork(work, CONFIG);
        assert.ok(!findings.some((f) => /depends cycle/.test(f.problem)), `no depends-cycle finding expected: ${JSON.stringify(findings)}`);
      }),
  },

  // Scenario: opening a slot in the nested space rewrites no depends and no
  // parent.
  {
    name: "work-reindex/depends-parent: opening a slot in the nested space rewrites no depends and no parent",
    run: () =>
      withWork(async (work) => {
        const dirs = await buildTopLevelStream(work, 5); // 00-04
        await writeStoryItem(dirs.echo, "00", "04");
        await writeStoryItem(dirs.echo, "01", "04");
        await writeMilestoneItem(work, "05", { depends: ["2"] }); // a top-level item carrying depends

        await reindexForInsert(work, { at: 1, space: "nested", parent: "04" });

        const story00 = await findWork(work, "04/00");
        assert.equal(story00.length, 1);
        const story00Text = await readDocText(story00[0].dir, "STORY.md");
        assert.equal(extractLine(story00Text, "parent"), "parent: 04", "the story that was 04/00 still declares parent 04");

        const foxtrot = await findWork(work, "5");
        assert.equal(foxtrot.length, 1);
        const foxtrotText = await readDocText(foxtrot[0].dir, "SPEC.md");
        assert.equal(extractLine(foxtrotText, "depends"), "depends: [2]", "no top-level item's depends value changes");
      }),
  },
];
