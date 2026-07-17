// test/support/work-reindex-fixture.mjs — shared fixture builder for milestone
// 41 / story 01 (reindex-engine) task-traceability modules (00-04). Mirrors the
// repo's temp-dir fixture convention (test/work-validate.test.mjs): a fresh
// `mkdtemp` work dir per scenario, `NN_type_slug/` folders carrying real record
// docs, removed afterward. Every fixture TOP-LEVEL item is a `milestone` — the
// task features themselves say `"03_milestone_<slug>"`, so the fixture streams
// this milestone builds are milestone-only at the top level; nested items are
// `story`.
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Stable, NUMBER-INDEPENDENT slugs, so a test can keep referring to "the item
// that was NN" by its slug after a rename changes its number — mirrors how the
// task features themselves name items ("the item that was 05").
export const SLUGS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet"];

export async function withWork(body) {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-reindex-"));
  const work = path.join(root, "work");
  await mkdir(work, { recursive: true });
  try {
    return await body(work);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export function frontmatter(fields) {
  const body = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? `[${value.join(", ")}]` : value}`)
    .join("\n");
  return `---\n${body}\n---\n`;
}

export function milestoneFields(number, overrides = {}) {
  const n = Number.parseInt(number, 10);
  return {
    type: "milestone",
    number,
    slug: SLUGS[n] ?? `item${number}`,
    status: "not-started",
    created: "2026-07-16",
    updated: "2026-07-16",
    ...overrides,
  };
}

export function storyFields(number, parent, overrides = {}) {
  return {
    type: "story",
    number,
    slug: `story${number}`,
    status: "not-started",
    created: "2026-07-16",
    updated: "2026-07-16",
    parent,
    ...overrides,
  };
}

// A top-level `uat` item — SHARES the top-level number space with milestone
// (ADR-005: "milestone/uat/spike/chore share this space"), record doc
// SESSION.md (work.mjs's `recordDoc`). Added for QA coverage gap F-1 (review
// fast-follow, 2026-07-16): every prior reindex fixture built the shifting set
// as milestones ONLY, leaving `rewriteReferences`'s non-story (`applyDependsRewrite`)
// branch exercised only via a milestone depends-holder — never a uat one.
export function uatFields(number, overrides = {}) {
  const n = Number.parseInt(number, 10);
  return {
    type: "uat",
    number,
    slug: SLUGS[n] ?? `item${number}`,
    status: "not-started",
    created: "2026-07-16",
    updated: "2026-07-16",
    ...overrides,
  };
}

export async function writeMilestoneItem(work, number, overrides = {}) {
  const fields = milestoneFields(number, overrides);
  const dir = path.join(work, `${number}_milestone_${fields.slug}`);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "SPEC.md"), frontmatter(fields));
  return dir;
}

export async function writeUatItem(work, number, overrides = {}) {
  const fields = uatFields(number, overrides);
  const dir = path.join(work, `${number}_uat_${fields.slug}`);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "SESSION.md"), frontmatter(fields));
  return dir;
}

export async function writeStoryItem(milestoneDir, number, parent, overrides = {}) {
  const fields = storyFields(number, parent, overrides);
  const dir = path.join(milestoneDir, "stories", `${number}_story_${fields.slug}`);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "STORY.md"), frontmatter(fields));
  return dir;
}

// Build top-level milestones numbered 00..count-1 (2-digit zero-padded), each
// a minimally-valid record doc. Returns `{ [slug]: dir }`.
export async function buildTopLevelStream(work, count) {
  const dirs = {};
  for (let n = 0; n < count; n += 1) {
    const number = String(n).padStart(2, "0");
    const dir = await writeMilestoneItem(work, number);
    dirs[SLUGS[n]] = dir;
  }
  return dirs;
}

export async function folderNames(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

export async function readDocText(dir, doc) {
  return readFile(path.join(dir, doc), "utf8");
}
