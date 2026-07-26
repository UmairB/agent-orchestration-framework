// Traceability wiring for milestone 40 / story 02 (migration registry &
// `aof upgrade`), task
//   wiki/work/40_milestone_work-item-versioning-upgrade/stories/
//     02_story_migration-registry-and-upgrade/tasks/02_upgrade-idempotent.feature
// Every @executable scenario below is wired against the REAL `aof upgrade` CLI
// verb over a fixture project, BYTE-DIFFING each record doc across runs — the
// LITMUS this task specifies. No source read.
import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { withUpgradeProject, writeItem, runCli, parseJsonOut } from "./support/work-upgrade-fixture.mjs";

// A fixture stream already fully stamped at the current schema.
async function buildCurrentFixture({ workDir }) {
  const milestoneDir = path.join(workDir, "00_milestone_widget");
  await writeItem(milestoneDir, { type: "milestone", number: "00", slug: "widget", stamped: true });
  const storyDir = path.join(milestoneDir, "stories", "00_story_facet");
  await writeItem(storyDir, { type: "story", number: "00", slug: "facet", parent: "00", stamped: true });
}

// A fixture stream of unstamped items (schema 0).
async function buildUnstampedFixture({ workDir }) {
  const milestoneDir = path.join(workDir, "00_milestone_widget");
  await writeItem(milestoneDir, { type: "milestone", number: "00", slug: "widget" });
  const storyDir = path.join(milestoneDir, "stories", "00_story_facet");
  await writeItem(storyDir, { type: "story", number: "00", slug: "facet", parent: "00" });
}

async function readAll(workDir) {
  return {
    milestone: await readFile(path.join(workDir, "00_milestone_widget", "SPEC.md"), "utf8"),
    story: await readFile(path.join(workDir, "00_milestone_widget", "stories", "00_story_facet", "STORY.md"), "utf8"),
  };
}

export const workUpgradeIdempotentTests = [
  // "an item already at the current schema is left byte-untouched by an apply"
  {
    name: "work-upgrade/idempotent: applying aof upgrade over an already-current fixture leaves every record doc byte-identical, and validate reports zero findings",
    run: () =>
      withUpgradeProject(buildCurrentFixture, async ({ repo, workDir }) => {
        const before = await readAll(workDir);
        const apply = runCli(repo, ["upgrade", "--json"]);
        assert.equal(apply.status, 0, `aof upgrade exits 0 over an already-current stream (stderr: ${apply.stderr})`);
        const after = await readAll(workDir);
        assert.deepEqual(after, before, "every record doc is byte-identical to before the run");

        const validate = runCli(repo, ["work", "validate", "--json"]);
        assert.equal(validate.status, 0, `aof work validate --json exits 0 (stderr: ${validate.stderr})`);
        assert.deepEqual(parseJsonOut(validate), [], "a fresh aof work validate --json over the fixture reports zero findings");
      }),
  },

  // "`aof upgrade --dry-run` over an already-current stream reports nothing pending"
  {
    name: "work-upgrade/idempotent: aof upgrade --dry-run over an already-current stream reports nothing pending and leaves every frontmatter unchanged",
    run: () =>
      withUpgradeProject(buildCurrentFixture, async ({ repo, workDir }) => {
        const before = await readAll(workDir);
        const dryRun = runCli(repo, ["upgrade", "--dry-run", "--json"]);
        assert.equal(dryRun.status, 0, `aof upgrade --dry-run exits 0 (stderr: ${dryRun.stderr})`);
        assert.deepEqual(parseJsonOut(dryRun).pending, [], "the report names no item as pending any transform");
        const after = await readAll(workDir);
        assert.deepEqual(after, before, "every record doc's on-disk frontmatter is unchanged");
      }),
  },

  // "a second `aof upgrade` apply is a no-op"
  {
    name: "work-upgrade/idempotent: a second aof upgrade apply over an already-upgraded stream is byte-identical to the first",
    run: () =>
      withUpgradeProject(buildCurrentFixture, async ({ repo, workDir }) => {
        const first = runCli(repo, ["upgrade", "--json"]);
        assert.equal(first.status, 0, `first aof upgrade exits 0 (stderr: ${first.stderr})`);
        const afterFirst = await readAll(workDir);

        const second = runCli(repo, ["upgrade", "--json"]);
        assert.equal(second.status, 0, `second aof upgrade exits 0 (stderr: ${second.stderr})`);
        const afterSecond = await readAll(workDir);

        assert.deepEqual(afterSecond, afterFirst, "every record doc is byte-identical between the first apply and the second");
      }),
  },

  // "re-running upgrade immediately after a real apply changes nothing"
  {
    name: "work-upgrade/idempotent: re-running aof upgrade immediately after a real (unstamped -> stamped) apply changes nothing on the second pass",
    run: () =>
      withUpgradeProject(buildUnstampedFixture, async ({ repo, workDir }) => {
        const first = runCli(repo, ["upgrade", "--json"]);
        assert.equal(first.status, 0, `first aof upgrade (real apply) exits 0 (stderr: ${first.stderr})`);
        const parsedFirst = parseJsonOut(first);
        assert.ok(parsedFirst.applied.length > 0, "the first apply actually stamped at least one item (a REAL transform ran)");
        const onceUpgraded = await readAll(workDir);

        const second = runCli(repo, ["upgrade", "--json"]);
        assert.equal(second.status, 0, `second aof upgrade exits 0 (stderr: ${second.stderr})`);
        const parsedSecond = parseJsonOut(second);
        assert.deepEqual(parsedSecond.applied, [], "no record doc changes on the second apply — nothing was pending");

        const twiceUpgraded = await readAll(workDir);
        assert.deepEqual(twiceUpgraded, onceUpgraded, "the twice-upgraded frontmatter is byte-identical to the once-upgraded frontmatter");
      }),
  },
];
