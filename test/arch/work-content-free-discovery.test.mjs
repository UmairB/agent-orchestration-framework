// Fitness function for milestone 00 / ADR-001:
// "The folder name is the index; content reads never identify an item."
//
// Behavioural proof (not a source grep): build a stream whose record docs are
// corrupt or absent, then assert discovery is unaffected — `listItems` still
// enumerates every folder, and `findWork` still resolves a bare number, an
// `NN/SS` pair, and a slug. If resolution ever started reading content to find
// or identify items, this fixture would make items vanish or refs miss; instead
// identity survives unreadable content, with `readMeta` yielding null
// status/title for the matched-but-corrupt item.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listItems, findWork } from "../../src/work.mjs";

// A stream where IDENTITY lives only in the folder names; every record doc is
// either garbage (no parseable frontmatter) or missing entirely.
async function buildContentlessFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-arch-"));
  const work = path.join(root, "work");

  const milestone = path.join(work, "00_milestone_foundation");
  const story = path.join(milestone, "stories", "00_story_alpha");
  await mkdir(story, { recursive: true });
  // Corrupt record docs: not even a frontmatter block — parseFrontmatter() → {},
  // and the type/number/slug are nowhere in the content.
  await writeFile(path.join(milestone, "SPEC.md"), "this file is not yaml at all\n");
  await writeFile(path.join(story, "STORY.md"), ">>> truncated mid-write");

  // A second top-level item whose record doc is ABSENT entirely (readMeta throws,
  // is swallowed → {}). Discovery must still see the folder.
  const other = path.join(work, "01_milestone_next");
  await mkdir(other, { recursive: true });
  // (no SPEC.md written)

  return { root, work };
}

async function withContentlessFixture(body) {
  const { root, work } = await buildContentlessFixture();
  try {
    return await body(work);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export const archTests = [
  {
    name: "arch/ADR-001: listItems enumerates every item with corrupt/absent record docs",
    run: () =>
      withContentlessFixture(async (work) => {
        const items = await listItems(work);
        // All three folders are listed despite no readable content anywhere.
        assert.deepEqual(items.map((item) => item.ref).sort(), ["00", "00/00", "01"]);
        // Identity (type/slug/parent) came from folder names, not files.
        const story = items.find((item) => item.ref === "00/00");
        assert.equal(story.type, "story");
        assert.equal(story.slug, "alpha");
        assert.equal(story.parent, "00");
      }),
  },
  {
    name: "arch/ADR-001: findWork resolves NN, NN/SS, and a slug when record docs are unreadable",
    run: () =>
      withContentlessFixture(async (work) => {
        // Bare number — resolves the top-level item; doc is corrupt → null enrichment.
        const byNumber = await findWork(work, "00");
        assert.equal(byNumber.length, 1);
        assert.equal(byNumber[0].ref, "00");
        assert.equal(byNumber[0].type, "milestone");
        assert.equal(byNumber[0].slug, "foundation");
        assert.equal(byNumber[0].status, null);
        assert.equal(byNumber[0].title, null);

        // NN/SS pair — resolves the nested story by folder name alone.
        const byPair = await findWork(work, "00/00");
        assert.equal(byPair.length, 1);
        assert.equal(byPair[0].type, "story");
        assert.equal(byPair[0].slug, "alpha");
        assert.equal(byPair[0].status, null);

        // Slug query — matches on the folder name, not content.
        const bySlug = await findWork(work, "next");
        assert.equal(bySlug.length, 1);
        assert.equal(bySlug[0].ref, "01");
        // Its record doc is ABSENT, yet it still resolves with null enrichment.
        assert.equal(bySlug[0].status, null);
        assert.equal(bySlug[0].title, null);
      }),
  },
];
