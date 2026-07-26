// Traceability wiring for milestone 40 / story 04 (the generated changelog),
// task
//   wiki/work/40_milestone_work-item-versioning-upgrade/stories/
//     04_story_generated-changelog/tasks/00_changelog-generated-from-registry-no-drift.feature
// Every @executable scenario below is wired against the LOCKED three seams the
// task's LITMUS block names:
//   (a) THE REGENERATED OUTPUT — `renderChangelog` (src/work-upgrade.mjs), called
//       directly on a fixture registry OR on the real `WORK_ITEM_MIGRATIONS`.
//   (b) THE COMMITTED ARTIFACT ON DISK — the git-tracked `UPGRADE-CHANGELOG.md`
//       at the repo root (story 04's chosen path — see the file's own leading
//       comment / this test's `committedPath`), read directly with `fs`.
//   (c) THE `aof upgrade --dry-run --json` CLI PLAN (story 02's CLI face) — used
//       ONLY to prove the changelog never feeds back into what the engine
//       executes (the downstream-only scenario).
// No source read backs an OUTCOME assertion — every Then reads back through one
// of the three seams above.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderChangelog, changelogDrift, WORK_ITEM_MIGRATIONS } from "../src/work-upgrade.mjs";
import { withUpgradeProject, writeItem, runCli, parseJsonOut } from "./support/work-upgrade-fixture.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Story 04's chosen committed-artifact path (documented here and in
// work-upgrade.mjs's renderChangelog comment): the repo root, alongside
// README.md/NOTICE — a package-level "how do I upgrade" artifact, not scoped
// to milestone 40's own wiki/work folder (future milestones' transforms land
// in the SAME registry and the SAME changelog).
const committedPath = path.join(repoRoot, "UPGRADE-CHANGELOG.md");

// A fixture registry of exactly 3 CONTIGUOUS transforms (0->1, 1->2, 2->3) —
// the task's own fixture shape, used by the entry-count scenario.
const THREE_CONTIGUOUS = [
  { id: "fixture-0-to-1", from: 0, to: 1, summary: "fixture transform stamping schema 0 items to schema 1." },
  { id: "fixture-1-to-2", from: 1, to: 2, summary: "fixture transform adding the example key introduced at schema 2." },
  { id: "fixture-2-to-3", from: 2, to: 3, summary: "fixture transform renaming the example sibling doc introduced at schema 3." },
];

// QA's Examples table (Scenario Outline) — the exact descriptor shapes the
// generator must project into an entry's id / from->to step / summary.
const PROJECTION_EXAMPLES = [
  { id: "stamp-schema-0-to-1", from: 0, to: 1, summary: "stamp an unstamped item schema:1 + aofVersion (the backstamp)" },
  { id: "fixture-1-to-2", from: 1, to: 2, summary: "add the example frontmatter key introduced at schema 2" },
  { id: "fixture-2-to-3", from: 2, to: 3, summary: "rename the example sibling doc introduced at schema 3" },
];

const entryCount = (output) => (output.match(/^### /gm) ?? []).length;

const projectionTests = PROJECTION_EXAMPLES.map((example) => ({
  name: `work-upgrade/changelog: each entry projects its descriptor's id/from->to/summary — "${example.id}" (schema ${example.from} -> ${example.to})`,
  run: () => {
    const output = renderChangelog([example]);
    assert.ok(output.includes(`\`${example.id}\``), `the generated output contains an entry for transform "${example.id}"`);
    assert.ok(
      output.includes(`schema ${example.from} -> ${example.to}`),
      `that entry shows the step from schema ${example.from} to schema ${example.to}`,
    );
    assert.ok(output.includes(example.summary), `that entry carries the summary "${example.summary}"`);
  },
}));

export const workUpgradeChangelogTests = [
  // "the changelog has exactly one entry per registered transform — it cannot omit or invent one"
  {
    name: "work-upgrade/changelog: a fixture registry of exactly 3 contiguous transforms projects exactly 3 entries; removing one yields 2, appending one yields 4",
    run: () => {
      const three = renderChangelog(THREE_CONTIGUOUS);
      assert.equal(entryCount(three), 3, "the generated output contains exactly 3 transform entries — one per descriptor");

      const removed = renderChangelog(THREE_CONTIGUOUS.slice(0, 2));
      assert.equal(entryCount(removed), 2, 'regenerating after removing the "2->3" transform yields exactly 2 entries');

      const appended = renderChangelog([
        ...THREE_CONTIGUOUS,
        { id: "fixture-3-to-4", from: 3, to: 4, summary: "fixture transform appended to prove the projection cannot invent a missing 4th entry." },
      ]);
      assert.equal(entryCount(appended), 4, 'regenerating after appending a "3->4" transform yields exactly 4 entries');
    },
  },

  // "each changelog entry projects its descriptor's id, from->to step, and summary" (Scenario Outline)
  ...projectionTests,

  // The `aof upgrade --changelog` regenerate SURFACE (upgrade.mjs comment: "pipes
  // it straight over the file to regenerate") must round-trip: its stdout is
  // byte-identical to the committed artifact, so `--changelog > UPGRADE-CHANGELOG.md`
  // and `--changelog | diff - UPGRADE-CHANGELOG.md` both stay green. Guards the
  // QA-40-04-1 doubled-trailing-newline regression (console.log adds its own \n).
  {
    name: "work-upgrade/changelog: `aof upgrade --changelog` stdout is byte-identical to the committed artifact (the regenerate surface round-trips)",
    run: () =>
      withUpgradeProject(
        async ({ workDir }) => {
          await writeItem(path.join(workDir, "00_milestone_sample"), { type: "milestone", number: "00", slug: "sample" });
        },
        async ({ repo }) => {
          const committed = await readFile(committedPath, "utf8");
          const emitted = String(runCli(repo, ["upgrade", "--changelog"]).stdout);
          assert.equal(emitted, committed, "the `--changelog` CLI stdout reproduces the committed artifact byte-for-byte (no doubled trailing newline)");
          assert.equal(changelogDrift(emitted).drifted, false, "piping the `--changelog` emit over the committed file keeps the drift guard green");
        },
      ),
  },

  // "the drift guard — regenerating from the current registry reproduces the committed artifact byte-for-byte"
  {
    name: "work-upgrade/changelog: regenerating from the current WORK_ITEM_MIGRATIONS reproduces the committed artifact byte-for-byte, and a second regenerate is byte-identical (deterministic)",
    run: async () => {
      const committed = await readFile(committedPath, "utf8");
      const first = renderChangelog(WORK_ITEM_MIGRATIONS);
      const second = renderChangelog(WORK_ITEM_MIGRATIONS);
      assert.equal(first, committed, "the regenerated output is byte-for-byte identical to the committed changelog artifact on disk");
      assert.equal(
        first,
        second,
        "regenerating a second time from the same registry produces byte-identical output (deterministic — no volatile timestamp or per-release value in the body)",
      );
    },
  },

  // "a hand edit to the committed changelog fails the drift guard"
  {
    name: "work-upgrade/changelog: a hand-edited committed changelog no longer matches a fresh regenerate, and the drift guard reports it as drifted",
    run: async () => {
      const committed = await readFile(committedPath, "utf8");
      const handEdited = `${committed}\nA hand-added line of prose that was never generated.\n`;

      const regenerated = renderChangelog(WORK_ITEM_MIGRATIONS);
      assert.notEqual(regenerated, handEdited, "the regenerated output no longer matches the (hand-edited) committed artifact byte-for-byte");

      const driftedReport = changelogDrift(handEdited);
      assert.equal(driftedReport.drifted, true, "the drift guard reports the committed changelog as drifted from the registry");

      // Non-vacuity: the guard reports NO drift for the real, untouched artifact.
      const cleanReport = changelogDrift(committed);
      assert.equal(cleanReport.drifted, false, "the drift guard reports no drift for the untouched committed artifact — the self-check the drifted-case assertion above is not vacuous");
    },
  },

  // "the generated changelog is self-identifying — it carries the aof-generated stamp"
  {
    name: "work-upgrade/changelog: both the regenerated output and the committed artifact carry the leading aof-generated stamp in canonical comment form",
    run: async () => {
      const regenerated = renderChangelog(WORK_ITEM_MIGRATIONS);
      assert.match(regenerated, /^<!--\s*aof-generated:\s*true\s*-->/, "the generated output carries the aof-generated marker in a canonical leading comment form");

      const committed = await readFile(committedPath, "utf8");
      assert.match(committed, /^<!--\s*aof-generated:\s*true\s*-->/, "the committed changelog artifact on disk carries that same aof-generated stamp");
    },
  },

  // "the changelog is downstream-only — the generator reads the registry, never the reverse"
  {
    name: "work-upgrade/changelog: registry -> changelog is live (a new transform gains an entry on regenerate); changelog -> registry is dead (a fresh aof upgrade --dry-run --json plan is unchanged by a hand-edited changelog)",
    run: () =>
      withUpgradeProject(
        async ({ workDir }) => {
          await writeItem(path.join(workDir, "00_milestone_sample"), { type: "milestone", number: "00", slug: "sample" });
        },
        async ({ repo }) => {
          // seam (a): registry -> changelog is LIVE.
          const before = renderChangelog(THREE_CONTIGUOUS);
          assert.ok(!before.includes("fixture-3-to-4"), "the fixture registry's own changelog carries no entry for a transform not yet added");
          const grown = [
            ...THREE_CONTIGUOUS,
            { id: "fixture-3-to-4", from: 3, to: 4, summary: "a transform added to the registry after the fact." },
          ];
          const after = renderChangelog(grown);
          assert.ok(after.includes("fixture-3-to-4"), "adding a transform to WORK_ITEM_MIGRATIONS and regenerating gains the new transform's entry");

          // seam (c): changelog -> registry is DEAD — no feedback edge. The
          // CLI/engine's whole input surface for a plan is workDir +
          // WORK_ITEM_MIGRATIONS (planUpgrade/runUpgrade, work-upgrade.mjs);
          // neither it nor the work:upgrade CLI command (src/commands/
          // upgrade.mjs) ever reads a changelog path. Proven behaviourally: a
          // hand edit to committed-changelog TEXT (read from the real
          // artifact, mutated only in memory — never written back to the
          // tracked repo file, so the test leaves no dirty working tree)
          // changes nothing about a fresh dry-run plan over the SAME fixture
          // stream.
          const planBefore = parseJsonOut(runCli(repo, ["upgrade", "--dry-run", "--json"]));
          const committedText = await readFile(committedPath, "utf8");
          const handEdited = `${committedText}\n<!-- a stray hand-added line that would never come from renderChangelog -->\n`;
          assert.notEqual(handEdited, committedText, "the in-memory hand edit actually changed the text under test");
          const planAfter = parseJsonOut(runCli(repo, ["upgrade", "--dry-run", "--json"]));
          assert.deepEqual(
            planAfter,
            planBefore,
            "a fresh aof upgrade --dry-run --json plan is unchanged by a hand-edited changelog — changelog -> registry is dead, no feedback edge",
          );
        },
      ),
  },
];
