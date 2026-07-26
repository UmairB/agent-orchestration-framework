// Traceability wiring for milestone 41 / story 02 (insert-top-level), task
//   wiki/work/41_milestone_work-item-insertion/stories/02_story_insert-top-level/
//     tasks/01_insert-uat-depends-framing.feature
// Every @executable scenario below is wired against the REAL registered command
// `work:insert-uat` (src/commands/insert-uat.mjs), invoked in-process through the
// command core. Per the feature's own LITMUS note, `depends` is NOT surfaced by
// find/list/validate, so the ONLY black-box channel for the authored value is the
// insert-uat --json envelope's `created.depends` — asserted here directly off the
// command's result. validate-green is the second, independent channel (an
// authored depends that failed to resolve would flag).
import assert from "node:assert/strict";
import { invoke } from "../src/command-core.mjs";
import { findWork, validateWork } from "../src/work.mjs";
import { withInsertFixture, buildTopLevelMilestones } from "./support/work-insert-fixture.mjs";

export const workInsertUatDependsTests = [
  // Headline: depends framing is authored on the newly-scaffolded item exactly as
  // add-uat would author it, whatever position it lands at. Inserting the uat at
  // slot 1 shifts every milestone >= 1 up by one: milestone "01" -> 2, milestone
  // "02" -> 3, milestone "00" unchanged. The operator names milestones 0 and 2
  // (their current numbers); framed against post-shift numbers that is [0, 3].
  {
    name: "work-insert/uat-depends: insert-uat authors the given depends list, rewritten to post-shift numbers, into the new item",
    run: () =>
      withInsertFixture(async ({ workDir, workspace }) => {
        await buildTopLevelMilestones(workDir, 3); // 00, 01, 02

        const result = await invoke("work:insert-uat", { slug: "release-gate", at: 1, depends: "0,2" }, { workspace });

        assert.deepEqual(result.created.depends, [0, 3], `depends rewritten to post-shift numbers [0, 3] (got ${JSON.stringify(result.created.depends)})`);

        const gate = (await findWork(workDir, "release-gate"))[0];
        const findings = await validateWork(workDir, workspace.config);
        const own = findings.filter((f) => f.path.startsWith(gate.dir));
        assert.deepEqual(own, [], `zero findings for the new item's depends: ${JSON.stringify(own)}`);
      }),
  },

  // A depends target that itself shifts as a consequence of the insert is framed
  // against its NEW number, not its pre-insert number. Milestone "01" shifts to 2
  // when the uat opens slot 1, so the authored depends becomes [2].
  {
    name: "work-insert/uat-depends: a named depends target that shifts as a consequence of the same insert is framed against its new number",
    run: () =>
      withInsertFixture(async ({ workDir, workspace }) => {
        await buildTopLevelMilestones(workDir, 3); // 00, 01, 02

        const result = await invoke("work:insert-uat", { slug: "release-gate", at: 1, depends: "1" }, { workspace });

        // The milestone that was "01" (slug bravo) now resolves at ref 2.
        const bravo = (await findWork(workDir, "bravo"))[0];
        assert.deepEqual(result.created.depends, [Number(bravo.ref)], `depends equals the new number of the milestone that was 01 (bravo is now ${bravo.ref}, got ${JSON.stringify(result.created.depends)})`);

        const gate = (await findWork(workDir, "release-gate"))[0];
        const findings = await validateWork(workDir, workspace.config);
        const own = findings.filter((f) => f.path.startsWith(gate.dir));
        assert.deepEqual(own, [], `zero findings for the new item's depends: ${JSON.stringify(own)}`);
      }),
  },

  // insert-milestone carries no depends-framing concept — framing parity with
  // add-milestone, which authors no depends either.
  {
    name: "work-insert/uat-depends: insert-milestone accepts no depends framing",
    run: () =>
      withInsertFixture(async ({ workDir, workspace }) => {
        await buildTopLevelMilestones(workDir, 3); // 00, 01, 02

        const result = await invoke("work:insert-milestone", { slug: "widget-support", at: 1 }, { workspace });

        assert.ok(!("depends" in result.created), `insert-milestone's created carries no depends key (got ${JSON.stringify(result.created)})`);

        const found = await findWork(workDir, "1");
        const widget = found.find((row) => row.slug === "widget-support");
        assert.ok(widget, "a fresh find 1 resolves a milestone with slug widget-support");
      }),
  },
];
