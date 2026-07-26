// Traceability wiring for milestone 41 / story 02 (insert-top-level), task
//   wiki/work/41_milestone_work-item-insertion/stories/02_story_insert-top-level/
//     tasks/03_shift-count-reported-in-json-envelope.feature
// Every @executable scenario below is wired against the REAL registered command
// `work:insert-milestone`, invoked in-process through the command core. The
// command's `run()` result IS the --json envelope's payload (cli.json is an
// identity passthrough — src/commands/insert-milestone.mjs), so asserting
// directly on the invoke() result is equivalent to asserting on `aof work
// insert-milestone --json`'s stdout, cross-checked against a fresh `listItems`
// read to count what actually moved.
import assert from "node:assert/strict";
import { invoke } from "../src/command-core.mjs";
import { listItems } from "../src/work.mjs";
import { withInsertFixture, buildTopLevelMilestones } from "./support/work-insert-fixture.mjs";

const THRESHOLD_CONFIG = { work: { insert: { confirmThreshold: 5 } } };

export const workInsertJsonEnvelopeTests = [
  // Headline: a below-threshold insert still reports the exact shifted count.
  // (insert at 8 shifts items 08,09 = 2 items — below the threshold of 5.)
  {
    name: "work-insert/json-envelope: a below-threshold insert reports the exact shifted count, at, and top-level space in the json envelope",
    run: () =>
      withInsertFixture(async ({ workDir, workspace }) => {
        await buildTopLevelMilestones(workDir, 10); // 00-09

        const result = await invoke("work:insert-milestone", { slug: "widget-support", at: 8 }, { workspace });

        assert.equal(result.shifted, 2, `envelope includes shifted: 2 (got ${result.shifted})`);
        assert.equal(Number(result.at), 8, `envelope includes at: 8 (got ${result.at})`);
        assert.equal(result.space, "top-level", `envelope includes the top-level space identifier (got "${result.space}")`);
      }, THRESHOLD_CONFIG),
  },

  // Headline: an above-threshold insert run with --yes still reports the exact
  // shifted count. (insert at 2 shifts items 02..09 = 8 items.)
  {
    name: "work-insert/json-envelope: an above-threshold insert run with --yes reports the exact shifted count in the json envelope",
    run: () =>
      withInsertFixture(async ({ workDir, workspace }) => {
        await buildTopLevelMilestones(workDir, 10); // 00-09

        const result = await invoke("work:insert-milestone", { slug: "widget-support", at: 2, yes: true }, { workspace });

        assert.equal(result.shifted, 8, `envelope includes shifted: 8 (got ${result.shifted})`);
      }, THRESHOLD_CONFIG),
  },

  // The reported count matches the number of items actually renamed — the
  // operator is never told a different number than the one that moved.
  // (insert at 4 shifts items 04..09 = 6 items.)
  {
    name: "work-insert/json-envelope: the reported shifted count equals the number of pre-existing items whose ref actually changed",
    run: () =>
      withInsertFixture(async ({ workDir, workspace }) => {
        await buildTopLevelMilestones(workDir, 10); // 00-09
        const before = new Map((await listItems(workDir)).filter((i) => i.parent == null).map((i) => [i.slug, Number.parseInt(i.number, 10)]));

        const result = await invoke("work:insert-milestone", { slug: "widget-support", at: 4, yes: true }, { workspace });

        const after = new Map((await listItems(workDir)).filter((i) => i.parent == null).map((i) => [i.slug, Number.parseInt(i.number, 10)]));
        let actuallyMoved = 0;
        for (const [slug, oldNumber] of before) {
          if (after.get(slug) !== oldNumber) actuallyMoved += 1;
        }
        assert.equal(result.shifted, actuallyMoved, `shifted (${result.shifted}) equals the number of pre-existing items whose ref changed (${actuallyMoved})`);
        assert.equal(result.shifted, 6, `sanity: items 04..09 (6 items) shift at at=4 (got ${result.shifted})`);
      }, THRESHOLD_CONFIG),
  },
];
