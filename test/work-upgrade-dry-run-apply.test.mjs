// Traceability wiring for milestone 40 / story 02 (migration registry &
// `aof upgrade`), task
//   wiki/work/40_milestone_work-item-versioning-upgrade/stories/
//     02_story_migration-registry-and-upgrade/tasks/01_upgrade-dry-run-then-apply.feature
// Every @executable scenario below is wired against the REAL `aof upgrade` CLI
// verb (spawnCliSync over bin/aof.mjs, in-process registry underneath — the
// SAME face `aof migrate`/`aof project migrate` use), over a fixture project
// mixing unstamped (schema-0) and stamped (schema-1) record docs. Read back
// black-box: `aof work list --json` before/after, every record doc's on-disk
// frontmatter, `aof work validate --json`, and the command's own exit code +
// --json envelope. No source read.
import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { WORK_ITEM_SCHEMA_VERSION } from "../src/work.mjs";
import { withUpgradeProject, writeItem, readDoc, runCli, parseJsonOut } from "./support/work-upgrade-fixture.mjs";

// A fixture stream mixing an unstamped milestone (00) and a stamped story (00/00).
async function buildMixedFixture({ workDir }) {
  const milestoneDir = path.join(workDir, "00_milestone_widget");
  await writeItem(milestoneDir, { type: "milestone", number: "00", slug: "widget" }); // unstamped
  const storyDir = path.join(milestoneDir, "stories", "00_story_facet");
  await writeItem(storyDir, { type: "story", number: "00", slug: "facet", parent: "00", stamped: true }); // schema 1
}

export const workUpgradeDryRunApplyTests = [
  // "`aof upgrade --dry-run` reports the items that would change and mutates nothing"
  {
    name: "work-upgrade/dry-run-apply: aof upgrade --dry-run reports every unstamped item as pending, names no already-stamped item, and mutates nothing",
    run: () =>
      withUpgradeProject(buildMixedFixture, async ({ repo }) => {
        const before = runCli(repo, ["work", "list", "--json"]);
        assert.equal(before.status, 0, `aof work list --json exits 0 (stderr: ${before.stderr})`);

        const dryRun = runCli(repo, ["upgrade", "--dry-run", "--json"]);
        assert.equal(dryRun.status, 0, `aof upgrade --dry-run exits 0 (stderr: ${dryRun.stderr})`);
        const parsed = parseJsonOut(dryRun);
        assert.equal(parsed.dryRun, true, "the result reports dryRun:true");
        const pendingRefs = parsed.pending.map((entry) => entry.ref).sort();
        assert.deepEqual(pendingRefs, ["00"], "only the unstamped milestone (00) is named pending — the already-stamped story (00/00) is not");

        const after = runCli(repo, ["work", "list", "--json"]);
        assert.equal(after.status, 0, `aof work list --json exits 0 after dry-run (stderr: ${after.stderr})`);
        assert.equal(after.stdout, before.stdout, "aof work list --json after the dry-run is byte-identical to before");
      }),
  },
  {
    name: "work-upgrade/dry-run-apply: aof upgrade --dry-run leaves every record doc's on-disk frontmatter unchanged",
    run: () =>
      withUpgradeProject(buildMixedFixture, async ({ repo, workDir }) => {
        const milestoneDoc = path.join(workDir, "00_milestone_widget", "SPEC.md");
        const storyDoc = path.join(workDir, "00_milestone_widget", "stories", "00_story_facet", "STORY.md");
        const beforeMilestone = await readFile(milestoneDoc, "utf8");
        const beforeStory = await readFile(storyDoc, "utf8");

        const dryRun = runCli(repo, ["upgrade", "--dry-run", "--json"]);
        assert.equal(dryRun.status, 0, `aof upgrade --dry-run exits 0 (stderr: ${dryRun.stderr})`);

        assert.equal(await readFile(milestoneDoc, "utf8"), beforeMilestone, "the unstamped milestone's frontmatter is unchanged after --dry-run");
        assert.equal(await readFile(storyDoc, "utf8"), beforeStory, "the already-stamped story's frontmatter is unchanged after --dry-run");
      }),
  },

  // "applying `aof upgrade` stamps every unstamped item and leaves the already-stamped ones untouched"
  {
    name: "work-upgrade/dry-run-apply: applying aof upgrade stamps every unstamped item to schema 1 + aofVersion, leaves the already-stamped item byte-identical, and validate reports zero findings",
    run: () =>
      withUpgradeProject(buildMixedFixture, async ({ repo, workDir }) => {
        const milestoneDoc = path.join(workDir, "00_milestone_widget", "SPEC.md");
        const storyDoc = path.join(workDir, "00_milestone_widget", "stories", "00_story_facet", "STORY.md");
        const beforeStory = await readFile(storyDoc, "utf8");

        const apply = runCli(repo, ["upgrade", "--json"]);
        assert.equal(apply.status, 0, `aof upgrade (apply) exits 0 (stderr: ${apply.stderr})`);
        const parsed = parseJsonOut(apply);
        assert.equal(parsed.dryRun, false, "the apply result reports dryRun:false");

        const afterMilestone = await readFile(milestoneDoc, "utf8");
        assert.match(afterMilestone, /^schema:\s*1\s*$/m, "the previously-unstamped milestone now reads schema: 1");
        assert.match(afterMilestone, /^aofVersion:\s*\S+\s*$/m, "the previously-unstamped milestone now carries an aofVersion provenance string");

        const afterStory = await readFile(storyDoc, "utf8");
        assert.equal(afterStory, beforeStory, "the already-stamped story's record doc is byte-identical to before the apply");

        const validate = runCli(repo, ["work", "validate", "--json"]);
        assert.equal(validate.status, 0, `aof work validate --json exits 0 (stderr: ${validate.stderr})`);
        assert.deepEqual(parseJsonOut(validate), [], "a fresh aof work validate --json over the fixture reports zero findings");
      }),
  },

  // "the items dry-run names as pending are exactly the items the apply changes"
  {
    name: "work-upgrade/dry-run-apply: the set of items dry-run names pending equals the set of record docs the apply actually changes",
    run: () =>
      withUpgradeProject(buildMixedFixture, async ({ repo, workDir }) => {
        const dryRun = runCli(repo, ["upgrade", "--dry-run", "--json"]);
        assert.equal(dryRun.status, 0, `aof upgrade --dry-run exits 0 (stderr: ${dryRun.stderr})`);
        const pendingRefs = parseJsonOut(dryRun).pending.map((entry) => entry.ref).sort();

        const milestoneDoc = path.join(workDir, "00_milestone_widget", "SPEC.md");
        const storyDoc = path.join(workDir, "00_milestone_widget", "stories", "00_story_facet", "STORY.md");
        const before = { "00": await readFile(milestoneDoc, "utf8"), "00/00": await readFile(storyDoc, "utf8") };

        const apply = runCli(repo, ["upgrade", "--json"]);
        assert.equal(apply.status, 0, `aof upgrade (apply) exits 0 (stderr: ${apply.stderr})`);

        const after = { "00": await readFile(milestoneDoc, "utf8"), "00/00": await readFile(storyDoc, "utf8") };
        const changedRefs = Object.keys(before).filter((ref) => before[ref] !== after[ref]).sort();
        assert.deepEqual(changedRefs, pendingRefs, "the refs whose on-disk frontmatter changed equal the refs dry-run named pending");
      }),
  },

  // "a stream schema newer than this build is refused, never downgraded"
  {
    name: "work-upgrade/dry-run-apply: a schema newer than WORK_ITEM_SCHEMA_VERSION refuses the whole run, exits non-zero, and leaves the newer item byte-untouched",
    run: () =>
      withUpgradeProject(
        async ({ workDir }) => {
          await buildMixedFixture({ workDir });
          const futureDir = path.join(workDir, "01_milestone_future");
          await writeItem(futureDir, { type: "milestone", number: "01", slug: "future", schema: WORK_ITEM_SCHEMA_VERSION + 1 });
        },
        async ({ repo, workDir }) => {
          const futureDoc = path.join(workDir, "01_milestone_future", "SPEC.md");
          const milestoneDoc = path.join(workDir, "00_milestone_widget", "SPEC.md");
          const beforeFuture = await readFile(futureDoc, "utf8");
          const beforeMilestone = await readFile(milestoneDoc, "utf8");

          const apply = runCli(repo, ["upgrade", "--json"]);
          assert.notEqual(apply.status, 0, `aof upgrade refuses with a non-zero exit (got ${apply.status})`);
          const parsed = parseJsonOut(apply);
          assert.equal(parsed.ok, false, "the --json envelope reports ok:false");
          assert.equal(parsed.code, "schema-newer-than-build", `the error code names the refusal (got "${parsed.code}")`);

          assert.equal(await readFile(futureDoc, "utf8"), beforeFuture, "the newer-than-build item's record doc is left byte-untouched");
          assert.equal(await readFile(milestoneDoc, "utf8"), beforeMilestone, "no other item in the fixture was written either — the whole run refused, nothing written");
        },
      ),
  },
];
