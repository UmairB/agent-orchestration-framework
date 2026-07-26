// Traceability wiring for milestone 40 / story 02 (migration registry &
// `aof upgrade`), task
//   wiki/work/40_milestone_work-item-versioning-upgrade/stories/
//     02_story_migration-registry-and-upgrade/tasks/03_stamp-transform-backstamps-unstamped.feature
// Every @executable scenario (and each Scenario Outline row) below is wired
// against the REAL `aof upgrade` CLI verb applying the 0->1 stamp transform
// over a fixture stream whose items are unstamped (no `schema` key). Read
// back black-box: each item's on-disk record-doc frontmatter after the apply,
// body byte-identity, and a fresh `aof work validate --json`. No source read.
//
// The ONE @manual scenario in this feature (backstamping the LIVE aof 00-39
// stream) is NOT run here — it is executed at aof:verify, and its evidence is
// recorded in the milestone's VERIFICATION.md, per the feature's own tagging.
import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { withUpgradeProject, writeItem, runCli, parseJsonOut } from "./support/work-upgrade-fixture.mjs";

const bodyOf = (text) => text.slice(text.indexOf("\n---", 3) + "\n---".length);

// Scenario Outline: the 0->1 stamp backstamps an unstamped <type> to schema 1
// with a provenance stamp — one row per record-doc type recordDoc (work.mjs)
// resolves (ADR-002).
const OUTLINE_ROWS = [
  { type: "milestone", doc: "SPEC.md" },
  { type: "story", doc: "STORY.md" },
  { type: "uat", doc: "SESSION.md" },
  { type: "spike", doc: "SPIKE.md" },
  { type: "chore", doc: "CHORE.md" },
];

async function buildOutlineFixture({ workDir }) {
  // A milestone parent (for the story row's `parent` to resolve) plus one
  // unstamped item of EVERY type recordDoc resolves, all top-level except the
  // story (nested under the milestone, mirroring listItems' own shape).
  const milestoneDir = path.join(workDir, "00_milestone_host");
  await writeItem(milestoneDir, { type: "milestone", number: "00", slug: "host" });
  const storyDir = path.join(milestoneDir, "stories", "00_story_subject");
  await writeItem(storyDir, { type: "story", number: "00", slug: "subject", parent: "00" });
  await writeItem(path.join(workDir, "01_uat_gate"), { type: "uat", number: "01", slug: "gate" });
  await writeItem(path.join(workDir, "02_spike_probe"), { type: "spike", number: "02", slug: "probe" });
  await writeItem(path.join(workDir, "03_chore_tidy"), { type: "chore", number: "03", slug: "tidy" });
}

const DOC_PATH_OF = {
  milestone: (workDir) => path.join(workDir, "00_milestone_host", "SPEC.md"),
  story: (workDir) => path.join(workDir, "00_milestone_host", "stories", "00_story_subject", "STORY.md"),
  uat: (workDir) => path.join(workDir, "01_uat_gate", "SESSION.md"),
  spike: (workDir) => path.join(workDir, "02_spike_probe", "SPIKE.md"),
  chore: (workDir) => path.join(workDir, "03_chore_tidy", "CHORE.md"),
};

export const workUpgradeStampTransformTests = [
  ...OUTLINE_ROWS.map(({ type, doc }) => ({
    name: `work-upgrade/stamp-transform: the 0->1 stamp backstamps an unstamped ${type} (${doc}) to schema 1 with a provenance stamp, body byte-identical`,
    run: () =>
      withUpgradeProject(buildOutlineFixture, async ({ repo, workDir }) => {
        const docPath = DOC_PATH_OF[type](workDir);
        const before = await readFile(docPath, "utf8");

        const apply = runCli(repo, ["upgrade", "--json"]);
        assert.equal(apply.status, 0, `aof upgrade exits 0 (stderr: ${apply.stderr})`);

        const after = await readFile(docPath, "utf8");
        assert.match(after, /^schema:\s*1\s*$/m, `the ${type}'s ${doc} frontmatter now reads schema: 1`);
        assert.match(after, /^aofVersion:\s*\S+\s*$/m, `the ${type}'s ${doc} now carries an aofVersion provenance string`);
        assert.equal(bodyOf(after), bodyOf(before), `the ${type}'s ${doc} body is byte-identical to before the stamp`);
      }),
  })),

  // "backstamping the unstamped fixture stream leaves it validate-green"
  {
    name: "work-upgrade/stamp-transform: backstamping the whole unstamped fixture stream (every recordDoc type) leaves every item schema:1 + aofVersion, and aof work validate --json reports zero findings",
    run: () =>
      withUpgradeProject(buildOutlineFixture, async ({ repo, workDir }) => {
        const apply = runCli(repo, ["upgrade", "--json"]);
        assert.equal(apply.status, 0, `aof upgrade exits 0 (stderr: ${apply.stderr})`);
        const parsed = parseJsonOut(apply);
        assert.equal(parsed.applied.length, OUTLINE_ROWS.length, `all ${OUTLINE_ROWS.length} fixture items were stamped`);

        for (const { type } of OUTLINE_ROWS) {
          const text = await readFile(DOC_PATH_OF[type](workDir), "utf8");
          assert.match(text, /^schema:\s*1\s*$/m, `${type} carries schema: 1`);
          assert.match(text, /^aofVersion:\s*\S+\s*$/m, `${type} carries an aofVersion string`);
        }

        const validate = runCli(repo, ["work", "validate", "--json"]);
        assert.equal(validate.status, 0, `aof work validate --json exits 0 (stderr: ${validate.stderr})`);
        assert.deepEqual(parseJsonOut(validate), [], "a fresh aof work validate --json over the fixture reports zero findings");
      }),
  },
];
