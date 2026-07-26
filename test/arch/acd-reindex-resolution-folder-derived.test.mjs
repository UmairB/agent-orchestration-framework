// Fitness function for milestone 41 / ADR-003 (foundation) — honours 00/ADR-001
// ("the folder name is the index; content reads never identify an item").
//
//   "Resolution is stateless and folder-derived, so RE-INDEX BY RENAME is
//    sufficient for resolution — there is no persistent index/cache to rebuild."
//
// The re-index engine (ADR-001) renumbers items purely by renaming `NN_type_slug`
// folders (+ bumping frontmatter `number` + rewriting stored `depends`/`parent`).
// The whole approach only works if `findWork`/`listItems` resolve the NEW number
// the instant the folder is renamed, with NO cache-invalidation / index-rebuild
// step. This is a BEHAVIOURAL proof (not a source grep): build a fixture, resolve
// the old numbers, RENAME the folders to new numbers (simulating a shift), and —
// with no rebuild in between — assert a FRESH resolution sees the new numbers and
// the old numbers resolve to nothing. If resolution ever grew a persistent index,
// this fixture would resolve stale numbers and the test would fail.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listItems, findWork } from "../../src/work.mjs";

function frontmatter(fields) {
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

// A minimal stream: one top-level milestone with one nested story.
async function buildFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-arch-reindex-"));
  const work = path.join(root, "work");
  const milestone = path.join(work, "05_milestone_alpha");
  const story = path.join(milestone, "stories", "00_story_first");
  await mkdir(story, { recursive: true });
  await writeFile(
    path.join(milestone, "SPEC.md"),
    frontmatter({ type: "milestone", number: "05", slug: "alpha", status: "not-started", title: '"Alpha"', created: "2026-07-16", updated: "2026-07-16" }),
    "utf8",
  );
  await writeFile(
    path.join(story, "STORY.md"),
    frontmatter({ type: "story", number: "00", slug: "first", parent: "05", status: "not-started", title: '"First"', created: "2026-07-16", updated: "2026-07-16" }),
    "utf8",
  );
  return { root, work, milestone };
}

export const archTests = [
  {
    name: "arch/ADR-003(m41): a top-level folder RENAME (05 -> 07) re-resolves with no index rebuild — resolution is folder-derived",
    run: async () => {
      const { root, work, milestone } = await buildFixture();
      try {
        // Before: 05 resolves the milestone.
        const before = await findWork(work, "05");
        assert.equal(before.length, 1, "05 resolves before the rename");
        assert.equal(before[0].type, "milestone");
        assert.equal(before[0].slug, "alpha");

        // Simulate a re-index shift: rename the folder ONLY (no frontmatter bump,
        // no rebuild) — resolution must follow the folder name immediately.
        await rename(milestone, path.join(work, "07_milestone_alpha"));

        // After: a FRESH findWork resolves 07; 05 now resolves to nothing.
        const nowSeven = await findWork(work, "07");
        assert.equal(nowSeven.length, 1, "07 resolves immediately after the rename — no rebuild needed");
        assert.equal(nowSeven[0].slug, "alpha");
        const nowFive = await findWork(work, "05");
        assert.equal(nowFive.length, 0, "05 resolves to nothing after the rename — resolution reads the folder, not a cache");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/ADR-003(m41): a nested story folder RENAME (00 -> 01) re-resolves the NN/SS pair with no index rebuild",
    run: async () => {
      const { root, work, milestone } = await buildFixture();
      try {
        const storiesDir = path.join(milestone, "stories");
        // Before: 05/00 resolves the story.
        const before = await findWork(work, "05/00");
        assert.equal(before.length, 1, "05/00 resolves before the nested rename");
        assert.equal(before[0].type, "story");
        assert.equal(before[0].slug, "first");

        // Simulate a nested shift: rename the story folder up by one.
        await rename(path.join(storiesDir, "00_story_first"), path.join(storiesDir, "01_story_first"));

        const after = await findWork(work, "05/01");
        assert.equal(after.length, 1, "05/01 resolves immediately after the nested rename");
        assert.equal(after[0].slug, "first");
        assert.equal(after[0].parent, "05", "the nested item's parent is folder-derived, unchanged by its own renumber");
        const stale = await findWork(work, "05/00");
        assert.equal(stale.length, 0, "05/00 resolves to nothing after the nested rename");

        // listItems enumerates the renamed item too — no stale entry lingers.
        const refs = (await listItems(work)).map((item) => item.ref).sort();
        assert.deepEqual(refs, ["05", "05/01"], "listItems reflects the renamed folder with no stale 05/00");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },
];
