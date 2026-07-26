// Traceability wiring for milestone 40 / story 01 (version stamp & reader), task
//   wiki/work/40_milestone_work-item-versioning-upgrade/stories/
//     01_story_version-stamp-and-reader/tasks/01_new-items-born-stamped.feature
// Every @executable scenario (and each Scenario Outline row) below is wired
// against the REAL registered scaffold commands `work:insert-milestone` /
// `work:insert-story` (src/commands/insert-milestone.mjs / insert-story.mjs,
// thin wrappers over src/commands/insert-shared.mjs's runInsertTopLevel /
// runInsertStory — the SAME engine `add-milestone`/`add-story` scaffold from),
// invoked in-process through the command core (src/command-core.mjs), against a
// REAL fixture project carrying the real committed `.aof/templates/work/`
// templates (test/support/work-insert-fixture.mjs, the SAME fixture milestone
// 41's own insert-command tests use). Read back black-box: the new item's
// on-disk record doc frontmatter, and the story-01 reader
// (readItemSchema/readItemVersion, src/work.mjs) — no source read.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { invoke } from "../src/command-core.mjs";
import { parseFrontmatter, readItemSchema, readItemVersion, WORK_ITEM_SCHEMA_VERSION } from "../src/work.mjs";
import { packageVersionString } from "../src/asset-base.mjs";
import { withInsertFixture, buildMilestone } from "./support/work-insert-fixture.mjs";

export const workScaffoldBornStampedTests = [
  // Scenario Outline: a newly scaffolded milestone/story is born carrying both
  // version keys.
  {
    name: 'work-scaffold/born-stamped: a newly scaffolded milestone is born carrying both version keys in SPEC.md',
    run: () =>
      withInsertFixture(async ({ workspace }) => {
        const result = await invoke("work:insert-milestone", { slug: "widget-support", at: 0 }, { workspace });
        const text = await readFile(path.join(result.created.dir, "SPEC.md"), "utf8");
        const meta = parseFrontmatter(text);
        assert.ok(Object.prototype.hasOwnProperty.call(meta, "schema"), 'the new milestone\'s SPEC.md frontmatter declares a "schema" key');
        assert.ok(Object.prototype.hasOwnProperty.call(meta, "aofVersion"), 'the new milestone\'s SPEC.md frontmatter declares an "aofVersion" key');
      }),
  },
  {
    name: 'work-scaffold/born-stamped: a newly scaffolded story is born carrying both version keys in STORY.md',
    run: () =>
      withInsertFixture(async ({ workDir, workspace }) => {
        const milestoneDir = await buildMilestone(workDir, "05", "quintet");
        const result = await invoke("work:insert-story", { slug: "auth-guard", at: 0, under: 5 }, { workspace });
        const text = await readFile(path.join(milestoneDir, "stories", "00_story_auth-guard", "STORY.md"), "utf8");
        const meta = parseFrontmatter(text);
        assert.equal(result.created.ref, "05/00", `reports the new story's ref (got ${result.created.ref})`);
        assert.ok(Object.prototype.hasOwnProperty.call(meta, "schema"), 'the new story\'s STORY.md frontmatter declares a "schema" key');
        assert.ok(Object.prototype.hasOwnProperty.call(meta, "aofVersion"), 'the new story\'s STORY.md frontmatter declares an "aofVersion" key');
      }),
  },

  // The born schema is the CONSTANT, not a copied literal.
  {
    name: "work-scaffold/born-stamped: the born schema equals the current schema constant WORK_ITEM_SCHEMA_VERSION (1 at this milestone)",
    run: () =>
      withInsertFixture(async ({ workspace }) => {
        const result = await invoke("work:insert-milestone", { slug: "widget-support", at: 0 }, { workspace });
        const text = await readFile(path.join(result.created.dir, "SPEC.md"), "utf8");
        const meta = parseFrontmatter(text);
        assert.equal(
          Number.parseInt(meta.schema, 10),
          WORK_ITEM_SCHEMA_VERSION,
          `the written "schema" resolves to WORK_ITEM_SCHEMA_VERSION (got ${meta.schema}, constant is ${WORK_ITEM_SCHEMA_VERSION})`,
        );
        assert.equal(WORK_ITEM_SCHEMA_VERSION, 1, "WORK_ITEM_SCHEMA_VERSION is 1 at this milestone, so the written schema is 1");
      }),
  },

  // The born provenance is the RUNNING package version.
  {
    name: "work-scaffold/born-stamped: the born provenance equals the running aof package version (packageVersionString()), a string never a number",
    run: () =>
      withInsertFixture(async ({ workDir, workspace }) => {
        await buildMilestone(workDir, "05", "quintet");
        await invoke("work:insert-story", { slug: "auth-guard", at: 0, under: 5 }, { workspace });
        const storyDir = path.join(workDir, "05_milestone_quintet", "stories", "00_story_auth-guard");
        const text = await readFile(path.join(storyDir, "STORY.md"), "utf8");
        const meta = parseFrontmatter(text);
        assert.equal(meta.aofVersion, packageVersionString(), `aofVersion (${meta.aofVersion}) equals packageVersionString() (${packageVersionString()})`);
        assert.notEqual(typeof meta.aofVersion, "number", "aofVersion is a string, never a number");
      }),
  },

  // The whole point of the born-stamp: a fresh item reads at the current
  // schema through the story-01 reader — never stale-by-construction.
  {
    name: "work-scaffold/born-stamped: a freshly-created item is never stale-by-construction — the reader resolves it at WORK_ITEM_SCHEMA_VERSION",
    run: () =>
      withInsertFixture(async ({ workDir, workspace }) => {
        await buildMilestone(workDir, "05", "quintet");
        const result = await invoke("work:insert-story", { slug: "auth-guard", at: 0, under: 5 }, { workspace });
        const dir = path.join(workDir, "05_milestone_quintet", "stories", "00_story_auth-guard");
        const item = { type: "story", ref: result.created.ref, dir };
        const schema = await readItemSchema(item);
        assert.equal(schema, WORK_ITEM_SCHEMA_VERSION, `the reader resolves the new story's schema as WORK_ITEM_SCHEMA_VERSION (got ${schema})`);
      }),
  },
];
