// Traceability wiring for milestone 41 / story 03 (insert-story), task
//   wiki/work/41_milestone_work-item-insertion/stories/03_story_insert-story/
//     tasks/00_insert-story-places-and-scaffolds.feature
// Every @executable scenario (and each Scenario Outline row) below is wired
// against the REAL registered command `work:insert-story`
// (src/commands/insert-story.mjs, a thin wrapper over story 01's engine via
// src/commands/insert-shared.mjs's `runInsertStory`), invoked in-process
// through the command core (src/command-core.mjs), and read back black-box via
// findWork/validateWork (src/work.mjs) — mirroring the feature's own LITMUS
// note: every Then is confirmable from the command's result envelope plus a
// FRESH find/validate read, no source read.
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { invoke } from "../src/command-core.mjs";
import { findWork, validateWork } from "../src/work.mjs";
import { withInsertFixture, buildMilestone, writeStoryItem, SLUGS } from "./support/work-insert-fixture.mjs";

// The Background every scenario shares: milestone "05" with nested stories
// "05/00" (alpha), "05/01" (bravo), "05/02" (charlie).
async function buildBackground(workDir) {
  const milestoneDir = await buildMilestone(workDir, "05", "quintet");
  await writeStoryItem(milestoneDir, "00", "05", { slug: SLUGS[0] });
  await writeStoryItem(milestoneDir, "01", "05", { slug: SLUGS[1] });
  await writeStoryItem(milestoneDir, "02", "05", { slug: SLUGS[2] });
  return milestoneDir;
}

export const workInsertStoryPlacesTests = [
  // Headline (PO): the new story lands at SS and every pre-existing sibling
  // >= SS shifts up by one.
  {
    name: "work-insert-story/places: insert-story places the new story at SS and every pre-existing sibling story >= SS shifts up by exactly one",
    run: () =>
      withInsertFixture(async ({ workDir, workspace }) => {
        await buildBackground(workDir);

        const result = await invoke("work:insert-story", { slug: "auth-guard", at: 1, under: 5 }, { workspace });

        assert.equal(result.created.ref, "05/01", `reports the new item's ref as 05/01 (got ${result.created.ref})`);

        const auth = (await findWork(workDir, "05/01"))[0];
        assert.ok(auth, "a fresh find 05/01 resolves");
        assert.equal(auth.slug, "auth-guard");

        const bravo = (await findWork(workDir, "05/02"))[0];
        assert.ok(bravo, "a fresh find 05/02 resolves");
        assert.equal(bravo.slug, SLUGS[1], `formerly-05/01 story (slug ${SLUGS[1]}) now resolves at 05/02`);

        const charlie = (await findWork(workDir, "05/03"))[0];
        assert.ok(charlie, "a fresh find 05/03 resolves");
        assert.equal(charlie.slug, SLUGS[2], `formerly-05/02 story (slug ${SLUGS[2]}) now resolves at 05/03`);
      }),
  },

  // The new story is scaffolded from the SAME template add-story uses, with
  // correct identity frontmatter — confirmed through find (type/slug/parent) +
  // validate (number<->folder consistent, created/updated present).
  {
    name: "work-insert-story/places: the new story is scaffolded from the same template add-story uses, with correct identity frontmatter and parent",
    run: () =>
      withInsertFixture(async ({ workDir, workspace }) => {
        await buildBackground(workDir);

        const result = await invoke("work:insert-story", { slug: "auth-guard", at: 1, under: 5 }, { workspace });
        assert.equal(result.created.ref, "05/01");

        const auth = (await findWork(workDir, "05/01"))[0];
        assert.equal(auth.type, "story", "reports type story");
        assert.equal(auth.slug, "auth-guard", "reports slug auth-guard");
        assert.equal(String(auth.parent), "05", `reports parent "05" (got ${auth.parent})`);

        const tasksEntries = await readdir(path.join(auth.dir, "tasks"));
        assert.deepEqual(tasksEntries, [], "the new story has an empty tasks/ directory");

        const findings = await validateWork(workDir, workspace.config);
        const own = findings.filter((f) => f.path.startsWith(auth.dir));
        assert.deepEqual(own, [], `zero findings for the new story's record doc: ${JSON.stringify(own)}`);
      }),
  },

  // QA Examples — the one-slot shift arithmetic across the boundary: head
  // (SS=0, all three shift), interior (SS=2, exactly one shifts), and append
  // (SS=3, none shift).
  ...[
    { at: 0, ss: "00", shifted: 3, case: "head — every sibling shifts" },
    { at: 2, ss: "02", shifted: 1, case: "interior — one sibling shifts" },
    { at: 3, ss: "03", shifted: 0, case: "append — nothing shifts" },
  ].map(({ at, ss, shifted, case: label }) => ({
    name: `work-insert-story/places: inserting at SS=${at} places the new story at SS and shifts exactly the siblings that were >= SS up by one (${label})`,
    run: () =>
      withInsertFixture(async ({ workDir, workspace }) => {
        await buildBackground(workDir);

        const result = await invoke("work:insert-story", { slug: "auth-guard", at, under: 5 }, { workspace });

        const auth = (await findWork(workDir, `05/${ss}`))[0];
        assert.ok(auth, `a fresh find 05/${ss} resolves`);
        assert.equal(auth.slug, "auth-guard");

        assert.equal(result.shifted, shifted, `the envelope reports it shifted ${shifted} sibling stories (got ${result.shifted})`);

        const findings = await validateWork(workDir, workspace.config);
        assert.deepEqual(findings, [], `a fresh validate over the whole fixture stream reports zero findings: ${JSON.stringify(findings)}`);
      }),
  })),
];
