// Traceability wiring for milestone 41 / story 01 (reindex-engine), task
//   wiki/work/41_milestone_work-item-insertion/stories/01_story_reindex-engine/
//     tasks/02_surgical-frontmatter-rewrite-is-byte-identical.feature
// Every @executable scenario below is confirmed by re-reading the record doc's
// RAW BYTES from the fixture stream after the engine call (`readFile` — never
// a source read of the engine's own code), against the LOCKED engine
// `reindexForInsert(workDir, { at, space, parent })` (src/work-reindex.mjs).
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { findWork } from "../src/work.mjs";
import { reindexForInsert } from "../src/work-reindex.mjs";
import { withWork } from "./support/work-reindex-fixture.mjs";

// A hand-authored record doc: non-default frontmatter key order, a leading
// comment line inside the frontmatter block, a `depends` inline list, and — in
// the body, after the closing fence — prose plus an HTML comment block. Full
// manual control over every byte, so the byte-diff assertions below are exact.
function rawMilestoneDoc({ number, slug, depends }) {
  return (
    `---\n` +
    `status: not-started\n` +
    `created: 2026-07-16\n` +
    `type: milestone\n` +
    `# a hand-written note about this slug\n` +
    `slug: ${slug}\n` +
    `number: ${number}\n` +
    `updated: 2026-07-16\n` +
    `depends: [${depends.join(", ")}]\n` +
    `---\n` +
    `# ${number} · ${slug}\n\n` +
    `Some prose about this milestone.\n\n` +
    `<!--\n` +
    `An HTML comment block.\n` +
    `Spanning multiple lines.\n` +
    `-->\n\n` +
    `More prose after the comment.\n`
  );
}

async function writeRawMilestone(work, { number, slug, depends = [] }) {
  const dir = path.join(work, `${number}_milestone_${slug}`);
  await mkdir(dir, { recursive: true });
  const text = rawMilestoneDoc({ number, slug, depends });
  await writeFile(path.join(dir, "SPEC.md"), text);
  return { dir, text };
}

// Assert that `before` and `after` differ on EXACTLY the given set of line
// prefixes (e.g. ["number:"]) — every other line, in the same order, is
// byte-identical.
function assertOnlyLinesChanged(before, after, expectedPrefixes) {
  const b = before.split(/\r?\n/);
  const a = after.split(/\r?\n/);
  assert.equal(a.length, b.length, `line count changed:\nBEFORE:\n${before}\nAFTER:\n${after}`);
  const diffs = [];
  for (let i = 0; i < b.length; i += 1) {
    if (a[i] !== b[i]) diffs.push({ index: i, before: b[i], after: a[i] });
  }
  assert.equal(diffs.length, expectedPrefixes.length, `unexpected diff set: ${JSON.stringify(diffs)}`);
  for (const [i, prefix] of expectedPrefixes.entries()) {
    assert.ok(diffs[i].before.startsWith(prefix), `expected diff ${i} to be a "${prefix}" line: ${JSON.stringify(diffs[i])}`);
    assert.ok(diffs[i].after.startsWith(prefix), `expected diff ${i} to be a "${prefix}" line: ${JSON.stringify(diffs[i])}`);
  }
}

function frontmatterKeyOrder(text) {
  const block = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const keys = [];
  for (const line of block[1].split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+):/);
    if (m) keys.push(m[1]);
  }
  return keys;
}

export const workReindexSurgicalFrontmatterTests = [
  // Scenario: a shifted item's record doc changes only its number line,
  // leaving every other frontmatter key and the body untouched.
  {
    name: "work-reindex/surgical-frontmatter: a shifted item's record doc changes only its number line",
    run: () =>
      withWork(async (work) => {
        await writeRawMilestone(work, { number: "01", slug: "bravo", depends: [] });
        const { text: before } = await writeRawMilestone(work, { number: "03", slug: "nonstandard", depends: [1] }); // depends on 01, which will NOT shift

        await reindexForInsert(work, { at: 3, space: "top-level" }); // shifts only item 03 -> 04

        const shifted = await findWork(work, "4");
        assert.equal(shifted.length, 1);
        const after = await readFile(path.join(shifted[0].dir, "SPEC.md"), "utf8");

        assertOnlyLinesChanged(before, after, ["number:"]);
        // The body is byte-identical to before.
        const bodyBefore = before.split(/\r?\n---\r?\n/)[1];
        const bodyAfter = after.split(/\r?\n---\r?\n/)[1];
        assert.equal(bodyAfter, bodyBefore, "the record doc's body is byte-identical to before");
      }),
  },

  // Scenario: a rewritten depends value changes only the depends line,
  // leaving surrounding frontmatter untouched.
  {
    name: "work-reindex/surgical-frontmatter: a rewritten depends value changes only the depends line",
    run: () =>
      withWork(async (work) => {
        // The referencing item (01) declares depends: [3], pointing at an
        // item that will shift; it does not itself shift (at=3).
        const { text: before } = await writeRawMilestone(work, { number: "01", slug: "referencing", depends: [3] });
        await writeRawMilestone(work, { number: "03", slug: "target", depends: [] });

        await reindexForInsert(work, { at: 3, space: "top-level" }); // shifts item 03 -> 04; 01 stays put

        const referencing = await findWork(work, "1");
        assert.equal(referencing.length, 1);
        assert.equal(referencing[0].slug, "referencing");
        const after = await readFile(path.join(referencing[0].dir, "SPEC.md"), "utf8");

        assertOnlyLinesChanged(before, after, ["depends:"]);
      }),
  },

  // Scenario: a renumber never bumps the record doc's updated field.
  {
    name: "work-reindex/surgical-frontmatter: a renumber never bumps the record doc's updated field",
    run: () =>
      withWork(async (work) => {
        const { text: before } = await writeRawMilestone(work, { number: "02", slug: "shifting", depends: [] });

        await reindexForInsert(work, { at: 2, space: "top-level" });

        const shifted = await findWork(work, "3");
        assert.equal(shifted.length, 1);
        const after = await readFile(path.join(shifted[0].dir, "SPEC.md"), "utf8");

        const updatedBefore = before.match(/^updated:.*$/m)[0];
        const updatedAfter = after.match(/^updated:.*$/m)[0];
        assert.equal(updatedAfter, updatedBefore, "the updated value is unchanged from before the shift");
      }),
  },

  // Scenario: frontmatter key order and the body's HTML comment survive the
  // rewrite.
  {
    name: "work-reindex/surgical-frontmatter: frontmatter key order and the body's HTML comment survive the rewrite",
    run: () =>
      withWork(async (work) => {
        const { text: before } = await writeRawMilestone(work, { number: "02", slug: "shifting", depends: [] });

        await reindexForInsert(work, { at: 2, space: "top-level" });

        const shifted = await findWork(work, "3");
        assert.equal(shifted.length, 1);
        const after = await readFile(path.join(shifted[0].dir, "SPEC.md"), "utf8");

        assert.deepEqual(frontmatterKeyOrder(after), frontmatterKeyOrder(before), "frontmatter keys are still in their original order");

        const commentBlock = "<!--\nAn HTML comment block.\nSpanning multiple lines.\n-->";
        assert.ok(before.includes(commentBlock), "sanity: fixture carries the HTML comment block");
        assert.ok(after.includes(commentBlock), "the HTML comment block in the record doc's body is still present, unchanged");
      }),
  },
];
