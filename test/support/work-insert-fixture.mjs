// test/support/work-insert-fixture.mjs — shared fixture builder for milestone 41
// / story 02 (insert-top-level) COMMAND-SURFACE tests (test/work-insert-*.test.mjs).
//
// Builds on top of test/support/work-reindex-fixture.mjs's item writers (the SAME
// stable, number-independent SLUGS and frontmatter shape story 01's engine tests
// use — so a test can keep referring to "the item that was NN" by its slug after a
// rename changes its number) and adds the two things a COMMAND-surface test needs
// beyond the bare engine:
//   1. a real `.aof/aof.config.json` + a loadWorkspace()-produced `workspace`, so
//      tests exercise the REAL registered command via invoke("work:insert-…", …)
//      (mirrors command-core-contract.test.mjs's house style: real fs, in-process,
//      through the registry) — never the engine directly.
//   2. the REAL committed `.aof/templates/work/<type>/` templates copied in — the
//      SAME templates insert-milestone/insert-uat scaffold from (ADR-002) — so a
//      scaffolded item is genuinely validate-green, not a test-only stub.
import { mkdtemp, mkdir, writeFile, rm, cp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkspace } from "../../src/work.mjs";
import { frontmatter, SLUGS } from "./work-reindex-fixture.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export { SLUGS, frontmatter };

// A fresh temp PROJECT (not just a bare work dir): `.aof/aof.config.json` + the
// real templates + `wiki/work/`. `body(ctx)` receives `{ repo, workDir, workspace }`;
// the whole tree is removed afterward. `configOverrides` merges into the written
// `aof.config.json` (e.g. `{ work: { insert: { confirmThreshold: 5 } } }`).
export async function withInsertFixture(body, configOverrides = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-insert-"));
  const workDir = path.join(repo, "wiki", "work");
  const aofDir = path.join(repo, ".aof");
  await mkdir(workDir, { recursive: true });
  await mkdir(aofDir, { recursive: true });
  const config = { name: "fixture", work: { dir: "./wiki/work" }, ...configOverrides };
  await writeFile(path.join(aofDir, "aof.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await cp(
    path.join(repoRoot, ".aof", "templates", "work", "milestone"),
    path.join(aofDir, "templates", "work", "milestone"),
    { recursive: true },
  );
  await cp(path.join(repoRoot, ".aof", "templates", "work", "uat"), path.join(aofDir, "templates", "work", "uat"), {
    recursive: true,
  });
  // milestone 41 / story 03 — insert-story scaffolds from
  // `.aof/templates/work/story/`, the SAME template add-story uses.
  await cp(path.join(repoRoot, ".aof", "templates", "work", "story"), path.join(aofDir, "templates", "work", "story"), {
    recursive: true,
  });
  try {
    const workspace = await loadWorkspace(repo);
    return await body({ repo, workDir, workspace });
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
}

// Build `count` top-level milestones numbered 00..count-1, stable SLUGS-keyed.
// Returns `{ [slug]: dir }`.
export async function buildTopLevelMilestones(workDir, count) {
  const dirs = {};
  for (let n = 0; n < count; n += 1) {
    const number = String(n).padStart(2, "0");
    const slug = SLUGS[n] ?? `item${n}`;
    const dir = path.join(workDir, `${number}_milestone_${slug}`);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "SPEC.md"),
      frontmatter({ type: "milestone", number, slug, status: "not-started", created: "2026-07-16", updated: "2026-07-16" }),
    );
    dirs[slug] = dir;
  }
  return dirs;
}

// Build ONE milestone at an ARBITRARY number/slug (unlike buildTopLevelMilestones,
// which always builds a sequential 00..count-1 run) — story 03's nested-axis
// tests need a milestone at a specific number (e.g. "05") independent of any
// other milestones in the fixture. `body` (optional) is appended verbatim after
// the frontmatter fence (e.g. a `## Stories` section) — omitted, the record doc
// is frontmatter-only (still validate-green; the body is prose, not enforced).
export async function buildMilestone(workDir, number, slug, body = "") {
  const dir = path.join(workDir, `${number}_milestone_${slug}`);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "SPEC.md"),
    frontmatter({ type: "milestone", number, slug, status: "not-started", created: "2026-07-16", updated: "2026-07-16" }) + body,
  );
  return dir;
}

export async function writeStoryItem(milestoneDir, number, parent, overrides = {}) {
  const slug = overrides.slug ?? `story${number}`;
  const dir = path.join(milestoneDir, "stories", `${number}_story_${slug}`);
  await mkdir(path.join(dir, "tasks"), { recursive: true });
  await writeFile(
    path.join(dir, "STORY.md"),
    frontmatter({
      type: "story",
      number,
      slug,
      status: "not-started",
      created: "2026-07-16",
      updated: "2026-07-16",
      parent,
      ...overrides,
    }),
  );
  return dir;
}

// Overwrite a milestone's SPEC.md with a `depends:` list — used by the
// validate-green whole-stream scenario.
export async function setMilestoneDepends(workDir, number, slug, depends) {
  const dir = path.join(workDir, `${number}_milestone_${slug}`);
  await writeFile(
    path.join(dir, "SPEC.md"),
    frontmatter({
      type: "milestone",
      number,
      slug,
      status: "not-started",
      created: "2026-07-16",
      updated: "2026-07-16",
      depends,
    }),
  );
}
