// Regression test for review fix 1 (milestone 41 as-built review, 2026-07-16):
// "Non-atomic insert leaves the stream corrupt on a mid-flight failure."
// `runInsertTopLevel`/`runInsertStory` (src/commands/insert-shared.mjs) used to
// call `reindexForInsert` (rename every affected folder + rewrite frontmatter)
// BEFORE scaffolding the new item — so a missing/misconfigured template threw
// `insert-template-missing` AFTER the shift, leaving the whole stream renumbered,
// no new item created, and slot P an empty gap (no rollback). The fix
// pre-flights every required template read (and the computed folder name)
// BEFORE the first mutation, mirroring the count-gate's own "gate before any
// mutation" discipline.
//
// Every scenario below is wired against the REAL registered commands
// (`work:insert-milestone` / `work:insert-story`), invoked in-process through
// the command core, and confirmed via a FRESH `listItems`/`findWork` read
// after the rejected call — no source read.
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";
import { invoke } from "../src/command-core.mjs";
import { findWork, listItems } from "../src/work.mjs";
import { withInsertFixture, buildTopLevelMilestones, buildMilestone, writeStoryItem, SLUGS } from "./support/work-insert-fixture.mjs";

async function topLevelSnapshot(workDir) {
  const items = await listItems(workDir);
  return items
    .filter((item) => item.parent == null)
    .map((item) => ({ number: item.number, type: item.type, slug: item.slug }))
    .sort((a, b) => a.number.localeCompare(b.number));
}

async function storySnapshot(workDir) {
  const items = await listItems(workDir);
  return items
    .filter((item) => item.type === "story" && item.parent != null)
    .map((item) => ({ number: item.number, parent: item.parent, slug: item.slug }))
    .sort((a, b) => a.number.localeCompare(b.number));
}

export const workInsertAtomicPreflightTests = [
  // Headline (top-level axis): a missing template throws the coded error AND
  // leaves every pre-existing top-level item at its original ref — no
  // mid-flight shift, no gap at slot P.
  {
    name: "work-insert/atomic-preflight: insert-milestone with a missing SPEC.md template throws insert-template-missing and leaves the stream untouched",
    run: () =>
      withInsertFixture(async ({ workDir, workspace }) => {
        await buildTopLevelMilestones(workDir, 5); // 00-04 (alpha..echo)
        const before = await topLevelSnapshot(workDir);

        // Simulate a missing/misconfigured scaffold template — delete the
        // template AFTER the fixture copied it in, BEFORE the insert runs.
        await rm(path.join(workspace.aofDir, "templates", "work", "milestone", "SPEC.md"), { force: true });

        await assert.rejects(
          () => invoke("work:insert-milestone", { slug: "widget-support", at: 2 }, { workspace }),
          (error) => {
            assert.equal(error.code, "insert-template-missing", `coded error (got code "${error.code}")`);
            return true;
          },
        );

        const after = await topLevelSnapshot(workDir);
        assert.deepEqual(after, before, `a fresh listItems shows nothing shifted — the stream is untouched (before: ${JSON.stringify(before)}, after: ${JSON.stringify(after)})`);

        const found = await findWork(workDir, "2");
        const widget = found.find((row) => row.slug === "widget-support");
        assert.ok(!widget, "no new item was scaffolded at slot 2 — no gap, no orphan");

        // The item formerly at "02" (slug charlie) still resolves at its
        // ORIGINAL ref 2 (never shifted to 3).
        const charlie = (await findWork(workDir, "charlie"))[0];
        assert.equal(Number(charlie.ref), 2, `charlie still resolves at its original ref 2 (got ${charlie.ref})`);
      }),
  },

  // Headline (nested axis): the same discipline for insert-story — a missing
  // STORY.md template throws the coded error AND leaves every pre-existing
  // sibling story at its original ref.
  {
    name: "work-insert/atomic-preflight: insert-story with a missing STORY.md template throws insert-template-missing and leaves every sibling story untouched",
    run: () =>
      withInsertFixture(async ({ workDir, workspace }) => {
        const milestoneDir = await buildMilestone(workDir, "05", "quintet");
        await writeStoryItem(milestoneDir, "00", "05", { slug: SLUGS[0] });
        await writeStoryItem(milestoneDir, "01", "05", { slug: SLUGS[1] });
        await writeStoryItem(milestoneDir, "02", "05", { slug: SLUGS[2] });
        const before = await storySnapshot(workDir);

        await rm(path.join(workspace.aofDir, "templates", "work", "story", "STORY.md"), { force: true });

        await assert.rejects(
          () => invoke("work:insert-story", { slug: "auth-guard", at: 1, under: 5 }, { workspace }),
          (error) => {
            assert.equal(error.code, "insert-template-missing", `coded error (got code "${error.code}")`);
            return true;
          },
        );

        const after = await storySnapshot(workDir);
        assert.deepEqual(after, before, `a fresh listItems shows no sibling story shifted (before: ${JSON.stringify(before)}, after: ${JSON.stringify(after)})`);

        const found = await findWork(workDir, "05/01");
        const bravo = found.find((row) => row.slug === SLUGS[1]);
        assert.ok(bravo, "05/01 still resolves the ORIGINAL sibling (bravo), never shifted to make room");

        const authGuard = (await findWork(workDir, "auth-guard"));
        assert.deepEqual(authGuard, [], "no new story was scaffolded anywhere in the stream");
      }),
  },
];
