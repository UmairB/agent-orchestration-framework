// Traceability wiring for story 00/00 `resolve-items`.
//
// These tests prove every @executable scenario/row in the story's two task
// features resolve against the LOCKED engine (`findWork` / `listItems` /
// `parseFrontmatter` in ../src/work.mjs). They author no engine code: each test
// builds a temp-dir fixture whose folder layout matches the feature Background
// EXACTLY, then asserts the resolution contract.
//
//   00_resolve-by-ref.feature  — bare NN and NN/SS structured refs
//   01_resolve-by-query.feature — free-text slug / folder-name queries
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listItems, findWork, parseFrontmatter } from "../src/work.mjs";

// --- fixture helpers (mirror test/work.test.mjs) ----------------------------

function frontmatter(fields) {
  const body = Object.entries(fields)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? `[${value.join(", ")}]` : value}`)
    .join("\n");
  return `---\n${body}\n---\n`;
}

// Background of 00_resolve-by-ref:
//   milestone "00" (slug "foundation") with nested stories
//     "00/00" (slug "alpha") and "00/01" (slug "beta"),
//   milestone "01" (slug "next"),
//   top-level uat session "02" (slug "acceptance").
// Record docs carry status/title so the "reports its record fields" scenario
// has something real to read.
async function buildRefFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-resolve-ref-"));
  const work = path.join(root, "work");

  const milestone0 = path.join(work, "00_milestone_foundation");
  const storyAlpha = path.join(milestone0, "stories", "00_story_alpha");
  const storyBeta = path.join(milestone0, "stories", "01_story_beta");
  await mkdir(storyAlpha, { recursive: true });
  await mkdir(storyBeta, { recursive: true });

  await writeFile(
    path.join(milestone0, "SPEC.md"),
    frontmatter({
      type: "milestone",
      number: "00",
      slug: "foundation",
      status: "in-progress",
      title: "Foundation",
      created: "2026-01-01",
      updated: "2026-01-02",
    }),
  );
  await writeFile(
    path.join(storyAlpha, "STORY.md"),
    frontmatter({
      type: "story",
      number: "00",
      slug: "alpha",
      status: "done",
      title: "Alpha",
      created: "2026-01-01",
      updated: "2026-01-02",
      parent: "00",
    }),
  );
  await writeFile(
    path.join(storyBeta, "STORY.md"),
    frontmatter({
      type: "story",
      number: "01",
      slug: "beta",
      status: "not-started",
      title: "Beta",
      created: "2026-01-01",
      updated: "2026-01-02",
      parent: "00",
    }),
  );

  const milestone1 = path.join(work, "01_milestone_next");
  await mkdir(milestone1, { recursive: true });
  await writeFile(
    path.join(milestone1, "SPEC.md"),
    frontmatter({
      type: "milestone",
      number: "01",
      slug: "next",
      status: "not-started",
      title: "Next",
      created: "2026-01-01",
      updated: "2026-01-02",
      depends: ["00"],
    }),
  );

  const session = path.join(work, "02_uat_acceptance");
  await mkdir(session, { recursive: true });
  await writeFile(
    path.join(session, "SESSION.md"),
    frontmatter({
      type: "uat",
      number: "02",
      slug: "acceptance",
      status: "not-started",
      title: "Acceptance",
      owner: "qa",
      created: "2026-01-01",
      updated: "2026-01-02",
      depends: ["00", "01"],
    }),
  );

  return { root, work };
}

// Background of 01_resolve-by-query:
//   milestone "00" (slug "foundation") with nested stories
//     "00/00" (slug "alpha") and "00/01" (slug "alpha-two"),
//   milestone "01" (slug "next").
async function buildQueryFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-resolve-query-"));
  const work = path.join(root, "work");

  const milestone0 = path.join(work, "00_milestone_foundation");
  const storyAlpha = path.join(milestone0, "stories", "00_story_alpha");
  const storyAlphaTwo = path.join(milestone0, "stories", "01_story_alpha-two");
  await mkdir(storyAlpha, { recursive: true });
  await mkdir(storyAlphaTwo, { recursive: true });

  await writeFile(
    path.join(milestone0, "SPEC.md"),
    frontmatter({
      type: "milestone",
      number: "00",
      slug: "foundation",
      status: "in-progress",
      title: "Foundation",
      created: "2026-01-01",
      updated: "2026-01-02",
    }),
  );
  await writeFile(
    path.join(storyAlpha, "STORY.md"),
    frontmatter({
      type: "story",
      number: "00",
      slug: "alpha",
      status: "done",
      title: "Alpha",
      created: "2026-01-01",
      updated: "2026-01-02",
      parent: "00",
    }),
  );
  await writeFile(
    path.join(storyAlphaTwo, "STORY.md"),
    frontmatter({
      type: "story",
      number: "01",
      slug: "alpha-two",
      status: "not-started",
      title: "Alpha Two",
      created: "2026-01-01",
      updated: "2026-01-02",
      parent: "00",
    }),
  );

  const milestone1 = path.join(work, "01_milestone_next");
  await mkdir(milestone1, { recursive: true });
  await writeFile(
    path.join(milestone1, "SPEC.md"),
    frontmatter({
      type: "milestone",
      number: "01",
      slug: "next",
      status: "not-started",
      title: "Next",
      created: "2026-01-01",
      updated: "2026-01-02",
      depends: ["00"],
    }),
  );

  return { root, work };
}

async function withFixture(build, body) {
  const { root, work } = await build();
  try {
    return await body(work);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

// Resolve a query and return its matched refs, sorted for order-independent
// comparison. The CLI surfaces exactly these rows, so refs == the contract.
async function refsFor(work, query) {
  const rows = await findWork(work, query);
  return rows.map((row) => row.ref).sort();
}

// Parse a feature's "refs" cell: "(none)" → [], "00/00, 00/01" → ["00/00","00/01"].
function expectedRefs(cell) {
  if (cell === "(none)") return [];
  return cell
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .sort();
}

export const resolveItemsTests = [
  // ====================================================================
  // 00_resolve-by-ref.feature
  // ====================================================================

  {
    name: "work/resolve: bare number 00 resolves the top-level foundation milestone",
    run: () =>
      withFixture(buildRefFixture, async (work) => {
        const rows = await findWork(work, "00");
        assert.equal(rows.length, 1, "exactly one item is returned");
        assert.equal(rows[0].ref, "00");
        assert.equal(rows[0].type, "milestone");
        assert.equal(rows[0].slug, "foundation");
      }),
  },
  {
    name: "work/resolve: bare number 02 resolves the top-level uat session",
    run: () =>
      withFixture(buildRefFixture, async (work) => {
        const rows = await findWork(work, "02");
        assert.equal(rows.length, 1, "exactly one item is returned");
        assert.equal(rows[0].type, "uat");
        assert.equal(rows[0].slug, "acceptance");
      }),
  },
  {
    name: "work/resolve: pair 00/01 resolves the nested beta story whose parent is 00",
    run: () =>
      withFixture(buildRefFixture, async (work) => {
        const rows = await findWork(work, "00/01");
        assert.equal(rows.length, 1, "exactly one item is returned");
        assert.equal(rows[0].type, "story");
        assert.equal(rows[0].ref, "00/01");
        assert.equal(rows[0].parent, "00");
      }),
  },
  {
    name: "work/resolve: a resolved row carries exactly the keys ref/type/slug/status/title/parent/dir",
    run: () =>
      withFixture(buildRefFixture, async (work) => {
        const rows = await findWork(work, "00");
        assert.equal(rows.length, 1);
        // The row object IS what the CLI serializes for --json (the flag is a CLI
        // concern; findWork always returns this shape).
        assert.deepEqual(
          Object.keys(rows[0]).sort(),
          ["dir", "parent", "ref", "slug", "status", "title", "type"],
        );
      }),
  },
  {
    name: "work/resolve: a resolved item reports record fields (status/title) read from frontmatter",
    run: () =>
      withFixture(buildRefFixture, async (work) => {
        const rows = await findWork(work, "00");
        assert.equal(rows.length, 1);
        // status/title come from the milestone's SPEC.md frontmatter, not the folder.
        assert.equal(rows[0].status, "in-progress");
        assert.equal(rows[0].title, "Foundation");
      }),
  },
  {
    name: "work/resolve: parent of an NN/SS story is its milestone (00)",
    run: () =>
      withFixture(buildRefFixture, async (work) => {
        const rows = await findWork(work, "00/00");
        assert.equal(rows.length, 1);
        assert.equal(rows[0].parent, "00");
      }),
  },

  // Scenario Outline: bare-number hits — milestone, milestone, uat session.
  {
    name: "work/resolve: bare-number outline — hits at slots 00, 01, 02",
    run: () =>
      withFixture(buildRefFixture, async (work) => {
        for (const [ref, refs] of [
          ["00", "00"],
          ["01", "01"],
          ["02", "02"],
        ]) {
          assert.deepEqual(await refsFor(work, ref), expectedRefs(refs), `bare ${ref}`);
        }
      }),
  },
  // Scenario Outline: bare-number misses — empty slots.
  {
    name: "work/resolve: bare-number outline — misses at empty slots 03, 99 return none",
    run: () =>
      withFixture(buildRefFixture, async (work) => {
        for (const [ref, refs] of [
          ["03", "(none)"],
          ["99", "(none)"],
        ]) {
          assert.deepEqual(await refsFor(work, ref), expectedRefs(refs), `bare ${ref}`);
        }
      }),
  },
  // Scenario Outline: zero-padding equivalence on a bare number — slot 0 and slot 2.
  {
    name: "work/resolve: bare-number outline — zero-padding 0/00/000 all name slot 00, 2/02/002 name slot 02",
    run: () =>
      withFixture(buildRefFixture, async (work) => {
        for (const ref of ["0", "00", "000"]) {
          assert.deepEqual(await refsFor(work, ref), ["00"], `padding ${ref} → 00`);
        }
        for (const ref of ["2", "02", "002"]) {
          assert.deepEqual(await refsFor(work, ref), ["02"], `padding ${ref} → 02`);
        }
      }),
  },

  // Scenario Outline: NN/SS pair hits — sibling stories under milestone 00.
  {
    name: "work/resolve: pair outline — hits 00/00 and 00/01 resolve the sibling stories",
    run: () =>
      withFixture(buildRefFixture, async (work) => {
        for (const [ref, refs] of [
          ["00/00", "00/00"],
          ["00/01", "00/01"],
        ]) {
          assert.deepEqual(await refsFor(work, ref), expectedRefs(refs), `pair ${ref}`);
        }
      }),
  },
  // Scenario Outline: NN/SS pair misses — unknown sub-slot, unknown milestone, milestone-slot-as-pair.
  {
    name: "work/resolve: pair outline — misses 00/99, 99/00, 01/00 return none",
    run: () =>
      withFixture(buildRefFixture, async (work) => {
        for (const [ref, refs] of [
          ["00/99", "(none)"], // milestone 00 exists, sub-slot 99 does not
          ["99/00", "(none)"], // milestone 99 does not exist
          ["01/00", "(none)"], // milestone 01 exists but has no story 00
        ]) {
          assert.deepEqual(await refsFor(work, ref), expectedRefs(refs), `pair ${ref}`);
        }
      }),
  },
  // Scenario Outline: zero-padding equivalence on both halves of a pair.
  {
    name: "work/resolve: pair outline — paddings 0/0, 00/0, 0/00, 000/000 all name story 00/00",
    run: () =>
      withFixture(buildRefFixture, async (work) => {
        for (const ref of ["0/0", "00/0", "0/00", "000/000"]) {
          assert.deepEqual(await refsFor(work, ref), ["00/00"], `padding ${ref} → 00/00`);
        }
      }),
  },

  // ====================================================================
  // 01_resolve-by-query.feature
  // ====================================================================

  {
    name: "work/resolve: query 'found' (slug substring) matches milestone 00 foundation",
    run: () =>
      withFixture(buildQueryFixture, async (work) => {
        const rows = await findWork(work, "found");
        const match = rows.find((row) => row.ref === "00");
        assert.ok(match, 'milestone "00" is among the results');
        assert.equal(match.slug, "foundation");
      }),
  },
  {
    name: "work/resolve: query 'alpha' (shared substring) matches both sibling stories 00/00 and 00/01",
    run: () =>
      withFixture(buildQueryFixture, async (work) => {
        assert.deepEqual(await refsFor(work, "alpha"), ["00/00", "00/01"]);
      }),
  },
  {
    name: "work/resolve: query 'zzz' matches nothing and returns no items",
    run: () =>
      withFixture(buildQueryFixture, async (work) => {
        assert.deepEqual(await findWork(work, "zzz"), []);
      }),
  },

  // Scenario Outline: slug substring matching — exact, prefix, longer slug, miss.
  {
    name: "work/resolve: query outline — exact 'foundation', prefix 'found', 'next', 'alpha-two', miss 'zzz'",
    run: () =>
      withFixture(buildQueryFixture, async (work) => {
        for (const [query, refs] of [
          ["foundation", "00"],
          ["found", "00"],
          ["next", "01"],
          ["alpha-two", "00/01"],
          ["zzz", "(none)"],
        ]) {
          assert.deepEqual(await refsFor(work, query), expectedRefs(refs), `query ${query}`);
        }
      }),
  },
  // Scenario Outline (second Examples block of the same outline): shared substring + sibling fragment.
  {
    name: "work/resolve: query outline — shared 'alpha' hits 00/00 & 00/01, fragment 'two' hits 00/01",
    run: () =>
      withFixture(buildQueryFixture, async (work) => {
        for (const [query, refs] of [
          ["alpha", "00/00, 00/01"],
          ["two", "00/01"],
        ]) {
          assert.deepEqual(await refsFor(work, query), expectedRefs(refs), `query ${query}`);
        }
      }),
  },

  // Scenario Outline: case-insensitivity on both query and candidate.
  {
    name: "work/resolve: query outline — case-insensitive FOUNDATION/Found → 00, ALPHA/Alpha → 00/00 & 00/01",
    run: () =>
      withFixture(buildQueryFixture, async (work) => {
        for (const [query, refs] of [
          ["foundation", "00"],
          ["FOUNDATION", "00"],
          ["Found", "00"],
          ["ALPHA", "00/00, 00/01"],
          ["Alpha", "00/00, 00/01"],
        ]) {
          assert.deepEqual(await refsFor(work, query), expectedRefs(refs), `query ${query}`);
        }
      }),
  },

  // Scenario Outline: folder-name TYPE-word matching — no slug carries these words,
  // so a hit proves the full folder name (NN_type_slug) is part of the candidate.
  {
    name: "work/resolve: query outline — folder type word 'milestone' → 00 & 01, 'story' → 00/00 & 00/01",
    run: () =>
      withFixture(buildQueryFixture, async (work) => {
        for (const [query, refs] of [
          ["milestone", "00, 01"],
          ["story", "00/00, 00/01"],
        ]) {
          assert.deepEqual(await refsFor(work, query), expectedRefs(refs), `query ${query}`);
        }
      }),
  },

  // Scenario Outline: empty / whitespace query matches the whole stream.
  {
    name: "work/resolve: query outline — empty '' and whitespace '   ' match the whole stream",
    run: () =>
      withFixture(buildQueryFixture, async (work) => {
        const whole = ["00", "00/00", "00/01", "01"];
        for (const query of ["", "   "]) {
          assert.deepEqual(await refsFor(work, query), whole, `query ${JSON.stringify(query)}`);
        }
      }),
  },

  // Sanity: the listItems layout under the ref fixture is what the Background describes.
  {
    name: "work/resolve: ref fixture layout matches the Background (00, 00/00, 00/01, 01, 02)",
    run: () =>
      withFixture(buildRefFixture, async (work) => {
        const items = await listItems(work);
        assert.deepEqual(items.map((item) => item.ref).sort(), ["00", "00/00", "00/01", "01", "02"]);
        assert.equal(items.find((item) => item.ref === "02").type, "uat");
        // parseFrontmatter is the reader behind status/title enrichment.
        const parsed = parseFrontmatter(frontmatter({ type: "milestone", status: "done", title: "X" }));
        assert.equal(parsed.status, "done");
        assert.equal(parsed.title, "X");
      }),
  },
];
