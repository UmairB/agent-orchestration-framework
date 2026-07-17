// Traceability wiring for milestone 41 / story 03 (insert-story), task
//   wiki/work/41_milestone_work-item-insertion/stories/03_story_insert-story/
//     tasks/03_count-gated-confirmation-and-yes-override.feature
// Every @executable scenario (and each Scenario Outline row) below is wired
// against the REAL registered command `work:insert-story`, invoked in-process
// through the command core. "Run non-interactively, without --yes" is
// inherent to an in-process invoke() call (no TTY prompt exists on this path
// at all) — a gated call either proceeds or throws the coded error, never
// hangs. The documented threshold (5, SAME constant as story 02) is set
// explicitly in the fixture config so the test is resilient to any future
// named-default change.
import assert from "node:assert/strict";
import { invoke } from "../src/command-core.mjs";
import { findWork, listItems } from "../src/work.mjs";
import { withInsertFixture, buildMilestone, writeStoryItem, SLUGS } from "./support/work-insert-fixture.mjs";

const THRESHOLD_CONFIG = { work: { insert: { confirmThreshold: 5 } } };

// Background: milestone "05" has nested stories "05/00" through "05/09".
async function buildTenStories(workDir) {
  const milestoneDir = await buildMilestone(workDir, "05", "quintet");
  for (let n = 0; n < 10; n += 1) {
    const number = String(n).padStart(2, "0");
    await writeStoryItem(milestoneDir, number, "05", { slug: SLUGS[n] });
  }
  return milestoneDir;
}

async function nestedSnapshot(workDir, parentNumber) {
  const items = await listItems(workDir);
  return items
    .filter((item) => item.type === "story" && item.parent != null && Number.parseInt(item.parent, 10) === parentNumber)
    .map((item) => ({ number: item.number, slug: item.slug }))
    .sort((a, b) => a.number.localeCompare(b.number));
}

export const workInsertStoryCountGateTests = [
  // QA Examples — BELOW the threshold proceeds automatically.
  ...[
    { at: 9, ss: "09", shifted: 1 },
    { at: 8, ss: "08", shifted: 2 },
    { at: 6, ss: "06", shifted: 4 },
  ].map(({ at, ss, shifted }) => ({
    name: `work-insert-story/count-gate: a nested insert whose sibling-shift count is below the threshold proceeds automatically without --yes (at=${at}, shifted=${shifted})`,
    run: () =>
      withInsertFixture(async ({ workDir, workspace }) => {
        await buildTenStories(workDir);

        const result = await invoke("work:insert-story", { slug: "auth-guard", at, under: 5 }, { workspace });
        assert.ok(result, "the command succeeds without requiring --yes");

        const auth = (await findWork(workDir, `05/${ss}`))[0];
        assert.ok(auth, `a fresh find 05/${ss} resolves the new story`);
        assert.equal(auth.slug, "auth-guard");

        assert.equal(result.shifted, shifted, `the envelope reports it shifted ${shifted} sibling stories (got ${result.shifted})`);
      }, THRESHOLD_CONFIG),
  })),

  // QA Examples — AT/ABOVE the threshold, run non-interactively without
  // --yes, fails LOUD and coded, naming the shift count, and mutates NOTHING.
  ...[
    { at: 5, shifted: 5 },
    { at: 2, shifted: 8 },
    { at: 0, shifted: 10 },
  ].map(({ at, shifted }) => ({
    name: `work-insert-story/count-gate: a nested insert whose sibling-shift count is at/above the threshold, run non-interactively without --yes, fails loud with a coded error naming the count (at=${at}, shifted=${shifted})`,
    run: () =>
      withInsertFixture(async ({ workDir, workspace }) => {
        await buildTenStories(workDir);
        const before = await nestedSnapshot(workDir, 5);

        await assert.rejects(
          () => invoke("work:insert-story", { slug: "auth-guard", at, under: 5 }, { workspace }),
          (error) => {
            assert.equal(error.code, "insert-confirm-required", `coded error (got code "${error.code}")`);
            assert.match(error.message, new RegExp(String(shifted)), `error names the shifted count (${shifted}): "${error.message}"`);
            return true;
          },
        );

        const after = await nestedSnapshot(workDir, 5);
        assert.deepEqual(after, before, `milestone "05"'s stories are unchanged at refs "05/00" through "05/09" (before: ${JSON.stringify(before)}, after: ${JSON.stringify(after)})`);
      }, THRESHOLD_CONFIG),
  })),

  // Headline: --yes proceeds regardless of count, and the shift is applied +
  // reported.
  {
    name: "work-insert-story/count-gate: --yes proceeds with an at/above-threshold nested insert regardless of count",
    run: () =>
      withInsertFixture(async ({ workDir, workspace }) => {
        await buildTenStories(workDir);

        const result = await invoke("work:insert-story", { slug: "auth-guard", at: 2, yes: true, under: 5 }, { workspace });
        assert.ok(result, "the command succeeds");

        const auth = (await findWork(workDir, "05/02"))[0];
        assert.ok(auth, "a fresh find 05/02 resolves the new story");
        assert.equal(auth.slug, "auth-guard");

        assert.equal(result.shifted, 8, `the envelope reports it shifted 8 sibling stories (got ${result.shifted})`);

        const after = await nestedSnapshot(workDir, 5);
        assert.equal(after.length, 11, `milestone "05" now holds eleven stories at refs "05/00" through "05/10" (got ${after.length})`);
        assert.deepEqual(
          after.map((row) => row.number),
          ["00", "01", "02", "03", "04", "05", "06", "07", "08", "09", "10"],
        );
      }, THRESHOLD_CONFIG),
  },

  // Scoping: the count is the TARGET milestone's OWN siblings — a large
  // sibling count under a DIFFERENT milestone never gates an insert into a
  // small one.
  {
    name: "work-insert-story/count-gate: the shift count is scoped to the target milestone's own siblings, not the whole stream",
    run: () =>
      withInsertFixture(async ({ workDir, workspace }) => {
        await buildTenStories(workDir); // milestone "05" — ten stories, would gate
        const milestone06Dir = await buildMilestone(workDir, "06", "sextet");
        await writeStoryItem(milestone06Dir, "00", "06", { slug: SLUGS[0] });
        await writeStoryItem(milestone06Dir, "01", "06", { slug: SLUGS[1] });
        await writeStoryItem(milestone06Dir, "02", "06", { slug: SLUGS[2] });

        const result = await invoke("work:insert-story", { slug: "small-fix", at: 1, under: 6 }, { workspace });
        assert.ok(result, "the command succeeds without requiring --yes");

        const smallFix = (await findWork(workDir, "06/01"))[0];
        assert.ok(smallFix, "a fresh find 06/01 resolves the new story");
        assert.equal(smallFix.slug, "small-fix");

        assert.equal(result.shifted, 2, `the envelope reports it shifted 2 sibling stories, scoped to milestone "06" (got ${result.shifted})`);
        assert.equal(String(result.parent), "06", `the envelope's parent is scoped to milestone "06" (got ${result.parent})`);
      }, THRESHOLD_CONFIG),
  },
];
