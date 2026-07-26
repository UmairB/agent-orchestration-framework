// Traceability wiring for milestone 41 / story 02 (insert-top-level), task
//   wiki/work/41_milestone_work-item-insertion/stories/02_story_insert-top-level/
//     tasks/02_count-gated-confirmation-and-yes-override.feature
// Every @executable scenario (and each Scenario Outline row) below is wired
// against the REAL registered command `work:insert-milestone`, invoked in-process
// through the command core. "Run non-interactively, without --yes" is inherent to
// an in-process `invoke()` call (no TTY prompt exists on this path at all) — a
// gated call either proceeds or throws the coded error, never hangs. The
// documented threshold (5, pinned at this refine) is set explicitly in the fixture
// config so the test is resilient to any future named-default change.
import assert from "node:assert/strict";
import { invoke } from "../src/command-core.mjs";
import { listItems } from "../src/work.mjs";
import { withInsertFixture, buildTopLevelMilestones } from "./support/work-insert-fixture.mjs";

const THRESHOLD_CONFIG = { work: { insert: { confirmThreshold: 5 } } };

async function snapshot(workDir) {
  const items = await listItems(workDir);
  return items.map((item) => ({ number: item.number, type: item.type, slug: item.slug, parent: item.parent })).sort((a, b) => a.number.localeCompare(b.number));
}

export const workInsertCountGateTests = [
  // Headline: a small shift proceeds automatically, no confirmation needed.
  // (insert at 7 shifts items 07,08,09 = 3 items, below the threshold of 5.)
  {
    name: "work-insert/count-gate: an insert whose shift count is below the threshold proceeds automatically",
    run: () =>
      withInsertFixture(async ({ workDir, workspace }) => {
        await buildTopLevelMilestones(workDir, 10); // 00-09

        const result = await invoke("work:insert-milestone", { slug: "widget-support", at: 7 }, { workspace });
        assert.equal(Number(result.created.ref), 7, "the new item occupies ref 7");
        assert.equal(result.shifted, 3, "3 items shifted (07,08,09)");
      }, THRESHOLD_CONFIG),
  },

  // Headline: a large shift on a non-interactive caller without --yes fails loud
  // and coded. (insert at 2 shifts items 02..09 = 8 items, at/above the threshold.)
  {
    name: "work-insert/count-gate: an insert whose shift count is at/above the threshold, run non-interactively without --yes, fails loud with a coded error",
    run: () =>
      withInsertFixture(async ({ workDir, workspace }) => {
        await buildTopLevelMilestones(workDir, 10); // 00-09
        const before = await snapshot(workDir);

        await assert.rejects(
          () => invoke("work:insert-milestone", { slug: "widget-support", at: 2 }, { workspace }),
          (error) => {
            assert.equal(error.code, "insert-confirm-required", `coded error (got code "${error.code}")`);
            assert.match(error.message, /8/, `error names the shifted count (8): "${error.message}"`);
            return true;
          },
        );

        const after = await snapshot(workDir);
        assert.deepEqual(after, before, "every pre-existing item is still at its original ref (the aborted insert changed nothing)");
      }, THRESHOLD_CONFIG),
  },

  // Headline: --yes asserts intent and proceeds regardless of count.
  {
    name: "work-insert/count-gate: --yes proceeds with an at/above-threshold insert regardless of count",
    run: () =>
      withInsertFixture(async ({ workDir, workspace }) => {
        await buildTopLevelMilestones(workDir, 10); // 00-09

        const result = await invoke("work:insert-milestone", { slug: "widget-support", at: 2, yes: true }, { workspace });
        assert.equal(Number(result.created.ref), 2, "the new item occupies ref 2");
        assert.equal(result.shifted, 8, "every pre-existing item that was >= 2 (8 items) has shifted up by exactly one");
      }, THRESHOLD_CONFIG),
  },

  // --force is a documented alias for --yes, applied at the CLI face
  // (cli.argv: yes: Boolean(options.yes || options.force)) — proven here at the
  // command level with the equivalent `yes: true` input the CLI alias resolves to.
  {
    name: "work-insert/count-gate: --force is accepted as an alias for --yes",
    run: () =>
      withInsertFixture(async ({ workDir, workspace }) => {
        await buildTopLevelMilestones(workDir, 10); // 00-09

        // The CLI's --force -> yes:true resolution is asserted directly (unit-level)
        // against the registered command's own argv adapter — the exact alias the
        // scenario names.
        const { insertMilestoneCommand } = await import("../src/commands/insert-milestone.mjs");
        const input = insertMilestoneCommand.cli.argv(["widget-support"], { at: "2", force: true });
        assert.equal(input.yes, true, "--force resolves to yes:true");

        const result = await invoke("work:insert-milestone", input, { workspace });
        assert.ok(result, "the command succeeds without an error about missing confirmation");
      }, THRESHOLD_CONFIG),
  },

  // The exact threshold boundary: at the threshold count itself, confirmation is
  // required (>=, not >); one below it is not. Fixture 00-09, threshold 5:
  //   at 6 -> items 06,07,08,09 shift = 4 (< 5) -> proceeds
  //   at 5 -> items 05,06,07,08,09 shift = 5 (>= 5) -> confirmation required
  ...[
    { at: 6, shifted: 4, requiresConfirm: false },
    { at: 5, shifted: 5, requiresConfirm: true },
  ].map(({ at, shifted, requiresConfirm }) => ({
    name: `work-insert/count-gate: threshold boundary row at=${at} (${shifted} item(s) shift) ${requiresConfirm ? "requires confirmation" : "proceeds without --yes"}`,
    run: () =>
      withInsertFixture(async ({ workDir, workspace }) => {
        await buildTopLevelMilestones(workDir, 10); // 00-09

        if (requiresConfirm) {
          await assert.rejects(
            () => invoke("work:insert-milestone", { slug: "widget-support", at }, { workspace }),
            (error) => {
              assert.equal(error.code, "insert-confirm-required");
              assert.match(error.message, new RegExp(String(shifted)));
              return true;
            },
          );
        } else {
          const result = await invoke("work:insert-milestone", { slug: "widget-support", at }, { workspace });
          assert.equal(result.shifted, shifted);
        }
      }, THRESHOLD_CONFIG),
  })),

  // --yes on a below-threshold insert is accepted as a harmless no-op flag.
  // (insert at 8 shifts 08,09 = 2 items.)
  {
    name: "work-insert/count-gate: --yes on a below-threshold insert is accepted without error",
    run: () =>
      withInsertFixture(async ({ workDir, workspace }) => {
        await buildTopLevelMilestones(workDir, 10); // 00-09

        const result = await invoke("work:insert-milestone", { slug: "widget-support", at: 8, yes: true }, { workspace });
        assert.equal(result.shifted, 2);
      }, THRESHOLD_CONFIG),
  },
];
