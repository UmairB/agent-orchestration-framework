// Traceability wiring for milestone 41 / story 03 (insert-story), task
//   wiki/work/41_milestone_work-item-insertion/stories/03_story_insert-story/
//     tasks/01_nested-shift-preserves-parent-and-validate-green.feature
// Every @executable scenario below is wired against the REAL registered
// command `work:insert-story`, invoked in-process through the command core,
// and read back black-box via findWork/listItems/validateWork — no source
// read (mirrors the feature's own LITMUS note).
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { invoke } from "../src/command-core.mjs";
import { findWork, listItems, validateWork } from "../src/work.mjs";
import { withInsertFixture, buildTopLevelMilestones, writeStoryItem, frontmatter, SLUGS } from "./support/work-insert-fixture.mjs";

// The Background: milestone "05" with nested stories "05/00" (alpha), "05/01"
// (bravo), "05/02" (charlie).
async function buildBackground(workDir) {
  const dirs = await buildTopLevelMilestones(workDir, 6); // 00-05 (alpha..foxtrot); "05" is the target milestone
  await writeStoryItem(dirs.foxtrot, "00", "05", { slug: SLUGS[0] });
  await writeStoryItem(dirs.foxtrot, "01", "05", { slug: SLUGS[1] });
  await writeStoryItem(dirs.foxtrot, "02", "05", { slug: SLUGS[2] });
  return dirs;
}

export const workInsertStoryNestedValidateTests = [
  // Headline: every shifted sibling's parent is unchanged — the milestone
  // itself did not move.
  {
    name: "work-insert-story/nested-validate: every shifted sibling story's parent still resolves to the same, unchanged milestone",
    run: () =>
      withInsertFixture(async ({ workDir, workspace }) => {
        await buildBackground(workDir);

        await invoke("work:insert-story", { slug: "auth-guard", at: 1, under: 5 }, { workspace });

        const bravo = (await findWork(workDir, "05/02"))[0];
        assert.equal(bravo.slug, SLUGS[1], "formerly-05/01 story (bravo) now resolves at 05/02");
        assert.equal(String(bravo.parent), "05", `formerly-05/01 story's parent is still "05" (got ${bravo.parent})`);

        const charlie = (await findWork(workDir, "05/03"))[0];
        assert.equal(charlie.slug, SLUGS[2], "formerly-05/02 story (charlie) now resolves at 05/03");
        assert.equal(String(charlie.parent), "05", `formerly-05/02 story's parent is still "05" (got ${charlie.parent})`);
      }),
  },

  // Headline: each shifted sibling's frontmatter number matches its new
  // folder — the exact folder<->number consistency validate enforces.
  {
    name: "work-insert-story/nested-validate: each shifted sibling story's frontmatter number matches its new folder name",
    run: () =>
      withInsertFixture(async ({ workDir, workspace }) => {
        await buildBackground(workDir);

        await invoke("work:insert-story", { slug: "auth-guard", at: 1, under: 5 }, { workspace });

        const bravo = (await findWork(workDir, "05/02"))[0];
        assert.equal(bravo.slug, SLUGS[1]);
        assert.equal(bravo.ref, "05/02", `bravo resolves at its new folder slot "02" (got ref ${bravo.ref})`);

        const charlie = (await findWork(workDir, "05/03"))[0];
        assert.equal(charlie.slug, SLUGS[2]);
        assert.equal(charlie.ref, "05/03", `charlie resolves at its new folder slot "03" (got ref ${charlie.ref})`);

        const findings = await validateWork(workDir, workspace.config);
        const foldering = findings.filter((f) => /≠ folder/.test(f.problem));
        assert.deepEqual(foldering, [], `no folder-vs-number finding for either shifted sibling: ${JSON.stringify(foldering)}`);
      }),
  },

  // The acceptance bar: aof work validate is green over the whole stream,
  // no manual repair.
  {
    name: "work-insert-story/nested-validate: aof work validate is green over the whole stream after a nested insert, with no manual repair",
    run: () =>
      withInsertFixture(async ({ workDir, workspace }) => {
        await buildBackground(workDir);

        await invoke("work:insert-story", { slug: "auth-guard", at: 1, under: 5 }, { workspace });

        const findings = await validateWork(workDir, workspace.config);
        assert.deepEqual(findings, [], `a fresh validate over the whole fixture stream reports zero findings: ${JSON.stringify(findings)}`);
      }),
  },

  // The near-zero-cost claim made concrete: a nested insert touches no
  // top-level item's number and rewrites no depends edge anywhere in the
  // stream. Observable proxy: no top-level ref moves in list, and validate
  // stays green (no depends target moved, none dangles).
  {
    name: "work-insert-story/nested-validate: a nested insert changes no top-level item's number and rewrites no depends edge",
    run: () =>
      withInsertFixture(async ({ workDir, workspace }) => {
        const dirs = await buildBackground(workDir);
        // Item "03" (slug delta) declares depends: [01] (targeting bravo, milestone 01).
        await writeFile(
          `${dirs.delta}/SPEC.md`,
          frontmatter({ type: "milestone", number: "03", slug: "delta", status: "not-started", created: "2026-07-16", updated: "2026-07-16", depends: [1] }),
        );

        const before = (await listItems(workDir))
          .filter((item) => item.parent == null)
          .map((item) => ({ number: item.number, slug: item.slug }))
          .sort((a, b) => a.number.localeCompare(b.number));

        await invoke("work:insert-story", { slug: "auth-guard", at: 1, under: 5 }, { workspace });

        const after = (await listItems(workDir))
          .filter((item) => item.parent == null)
          .map((item) => ({ number: item.number, slug: item.slug }))
          .sort((a, b) => a.number.localeCompare(b.number));
        assert.deepEqual(after, before, `every top-level item's ref is unchanged at "00" through "05" (before: ${JSON.stringify(before)}, after: ${JSON.stringify(after)})`);

        const findings = await validateWork(workDir, workspace.config);
        assert.deepEqual(findings, [], `a fresh validate over the whole stream reports zero findings and no dangling depends: ${JSON.stringify(findings)}`);
      }),
  },
];
