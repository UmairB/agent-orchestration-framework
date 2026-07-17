// Traceability wiring for milestone 41 / story 02 (insert-top-level), task
//   wiki/work/41_milestone_work-item-insertion/stories/02_story_insert-top-level/
//     tasks/00_insert-top-level-places-and-scaffolds.feature
// Every @executable scenario (and each Scenario Outline row) below is wired
// against the REAL registered commands `work:insert-milestone` / `work:insert-uat`
// (src/commands/insert-milestone.mjs, insert-uat.mjs — thin wrappers over story
// 01's engine via src/commands/insert-shared.mjs), invoked in-process through the
// command core (src/command-core.mjs), and read back black-box via
// findWork/listItems/validateWork (src/work.mjs) — mirroring the feature's own
// LITMUS note: every Then is confirmable from the command's result envelope plus a
// FRESH find/validate read, no source read.
import assert from "node:assert/strict";
import { invoke } from "../src/command-core.mjs";
import { findWork, validateWork } from "../src/work.mjs";
import { withInsertFixture, buildTopLevelMilestones, writeStoryItem, setMilestoneDepends } from "./support/work-insert-fixture.mjs";

export const workInsertTopLevelPlacesTests = [
  // Headline: insert-milestone places the new milestone at P and every
  // pre-existing item >= P shifts up by exactly one.
  {
    name: "work-insert/places: insert-milestone places the new milestone at P and every pre-existing item >= P shifts up by exactly one",
    run: () =>
      withInsertFixture(async ({ workDir, workspace }) => {
        await buildTopLevelMilestones(workDir, 5); // 00-04 (alpha..echo)

        const result = await invoke("work:insert-milestone", { slug: "widget-support", at: 2 }, { workspace });

        assert.equal(Number(result.created.ref), 2, `reports the new item's ref as 2 (got ${result.created.ref})`);

        const found = await findWork(workDir, "2");
        const widget = found.find((row) => row.slug === "widget-support");
        assert.ok(widget, "a fresh find 2 resolves a milestone with slug widget-support");
        assert.equal(widget.type, "milestone");

        // The item that was previously "02" (slug charlie) now resolves at ref 3.
        const charlie = (await findWork(workDir, "charlie"))[0];
        assert.equal(Number(charlie.ref), 3, `previously-02 item now resolves at ref 3 (got ${charlie.ref})`);

        // The item that was previously "04" (slug echo) now resolves at ref 5.
        const echo = (await findWork(workDir, "echo"))[0];
        assert.equal(Number(echo.ref), 5, `previously-04 item now resolves at ref 5 (got ${echo.ref})`);
      }),
  },

  // Headline: insert-uat places a new uat session at P the same way.
  {
    name: "work-insert/places: insert-uat places the new uat session at P and every pre-existing item >= P shifts up by exactly one",
    run: () =>
      withInsertFixture(async ({ workDir, workspace }) => {
        await buildTopLevelMilestones(workDir, 5); // 00-04 (alpha..echo)

        const result = await invoke("work:insert-uat", { slug: "release-gate", at: 1 }, { workspace });

        assert.equal(Number(result.created.ref), 1, `reports the new item's ref as 1 (got ${result.created.ref})`);

        const found = await findWork(workDir, "1");
        const gate = found.find((row) => row.slug === "release-gate");
        assert.ok(gate, "a fresh find 1 resolves a uat session with slug release-gate");
        assert.equal(gate.type, "uat");

        // The item that was previously "01" (slug bravo) now resolves at ref 2.
        const bravo = (await findWork(workDir, "bravo"))[0];
        assert.equal(Number(bravo.ref), 2, `previously-01 item now resolves at ref 2 (got ${bravo.ref})`);
      }),
  },

  // Scenario Outline: the new item is scaffolded from the SAME template
  // add-<type> uses, with correct identity frontmatter — validate-green.
  ...[
    { type: "milestone", slug: "widget-support" },
    { type: "uat", slug: "release-gate" },
  ].map(({ type, slug }) => ({
    name: `work-insert/places: the new ${type} is scaffolded from the same template add-${type} uses, with correct identity frontmatter (validate-green)`,
    run: () =>
      withInsertFixture(async ({ workDir, workspace }) => {
        await buildTopLevelMilestones(workDir, 5); // 00-04

        const commandId = type === "milestone" ? "work:insert-milestone" : "work:insert-uat";
        const result = await invoke(commandId, { slug, at: 2 }, { workspace });
        assert.equal(Number(result.created.ref), 2);

        const found = await findWork(workDir, "2");
        const row = found.find((r) => r.slug === slug);
        assert.ok(row, `a fresh find 2 resolves a ${type} with slug ${slug}`);
        assert.equal(row.type, type);

        const findings = await validateWork(workDir, workspace.config);
        const own = findings.filter((f) => f.path.startsWith(row.dir));
        assert.deepEqual(own, [], `zero findings for the new item's record doc: ${JSON.stringify(own)}`);
      }),
  })),

  // The re-order is correct end-to-end and validate-green (ADR-003 Tier 1): after
  // the insert, the whole stream — including a depends edge and a nested-story
  // parent that pointed at a shifted item — resolves clean.
  {
    name: "work-insert/places: after an insert-milestone, the whole stream is validate-green with no manual repair (nested parent + depends rewritten)",
    run: () =>
      withInsertFixture(async ({ workDir, workspace }) => {
        const dirs = await buildTopLevelMilestones(workDir, 5); // 00-04 (alpha..echo)
        // The milestone at "03" (slug delta) has a nested story "beta-flow".
        await writeStoryItem(dirs.delta, "00", "03", { slug: "beta-flow" });
        // Item "04" (slug echo) declares depends: [3] (targeting delta/03).
        await setMilestoneDepends(workDir, "04", "echo", [3]);

        const result = await invoke("work:insert-milestone", { slug: "widget-support", at: 2 }, { workspace });
        assert.equal(Number(result.created.ref), 2);

        const findings = await validateWork(workDir, workspace.config);
        assert.deepEqual(findings, [], `a fresh validate over the whole stream reports zero findings: ${JSON.stringify(findings)}`);

        const betaFlow = (await findWork(workDir, "beta-flow"))[0];
        assert.ok(betaFlow, "beta-flow still resolves");
        assert.equal(Number(betaFlow.parent), 4, `beta-flow resolves under its milestone's new ref 4 (got ${betaFlow.parent})`);
      }),
  },
];
