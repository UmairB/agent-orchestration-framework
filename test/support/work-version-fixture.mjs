// test/support/work-version-fixture.mjs — shared fixture builder for milestone 40
// / story 01 (version stamp & reader) task-traceability modules (00, 02).
//
// Re-exports test/support/work-reindex-fixture.mjs's withWork/folderNames/SLUGS
// (the SAME temp-dir-per-scenario convention every other work.mjs fixture uses —
// do not fork it) and adds the ONE thing this story's tests need beyond the bare
// item writer: a HAND-AUTHORED record doc — the caller supplies the exact
// frontmatter lines (line-by-line, per the task features' own Background), never
// a generated/sorted key set — so a scenario can exercise a present/missing/
// non-integer `schema`, a non-default key order, a comment line inside the
// block, and a body carrying real prose + an HTML comment block, exactly as the
// features specify.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export { withWork, folderNames, SLUGS } from "./work-reindex-fixture.mjs";

// A hand-authored milestone record doc (00_milestone_sample/SPEC.md). `lines`
// are the frontmatter body lines the caller wants BETWEEN the fences (in
// addition to the minimal identity fields every record doc needs) — e.g.
// `["schema: 2"]` or `[]` for "no schema key at all". Returns the `item` shape
// work.mjs's readers/writer expect: `{ type, ref, dir }`.
export async function writeMilestoneRecordDoc(work, { number = "00", slug = "sample", extraLines = [] } = {}) {
  const dir = path.join(work, `${number}_milestone_${slug}`);
  await mkdir(dir, { recursive: true });
  const text =
    "---\n" +
    "type: milestone\n" +
    `number: ${number}\n` +
    `slug: ${slug}\n` +
    'title: "Sample"\n' +
    "status: not-started\n" +
    "owner: product-owner\n" +
    "created: 2026-07-17\n" +
    "updated: 2026-07-17\n" +
    extraLines.map((line) => `${line}\n`).join("") +
    "---\n" +
    `# ${number} · Sample\n`;
  await writeFile(path.join(dir, "SPEC.md"), text, "utf8");
  return { item: { type: "milestone", ref: number, dir }, dir };
}

// A hand-authored story record doc for the ADR-004 writer tests (task 02): a
// NON-DEFAULT frontmatter key order, a comment line INSIDE the block, and a
// body of authored prose plus an HTML comment block — the exact shape the
// task feature's Background asks for. `status` and `extraLines` (inserted
// right after the in-block comment, before `owner:`) let each scenario set up
// its own starting state (a present `schema: 0`, a legacy key to rename, a
// specific rollback `status`, etc).
export async function writeWriterFixtureDoc(work, { status = "in-progress", extraLines = [] } = {}) {
  const dir = path.join(work, "00_milestone_host", "stories", "00_story_subject");
  await mkdir(dir, { recursive: true });
  const lines = [
    "---",
    'title: "Subject"',
    `status: ${status}`,
    "type: story",
    "number: 00",
    "slug: subject",
    "parent: 00",
    "# internal note: reviewed at refine — this comment must survive verbatim",
    ...extraLines,
    "owner: developer",
    "created: 2026-07-17",
    "updated: 2026-07-17",
    "---",
    "# 00 · Subject",
    "",
    "As a maintainer I want the upgrade to run so that items carry their version.",
    "",
    "<!--",
    "  A body HTML comment block — must survive unchanged, byte-for-byte.",
    "-->",
    "",
    "## Acceptance",
    "- [ ] a thing",
    "",
  ];
  const text = lines.join("\n");
  await writeFile(path.join(dir, "STORY.md"), text, "utf8");
  return { item: { type: "story", ref: "00/00", parent: "00", dir }, dir, text };
}
