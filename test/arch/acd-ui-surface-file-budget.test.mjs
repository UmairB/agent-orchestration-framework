// Fitness function: acd-ui-surface-file-budget (m43 / ADR-015/F2) —
//
//   "A React surface file gains CHILD COMPONENTS, not blocks. The `ui/` half of the
//    codebase gets the same ratchet the `src/` half already has."
//
// WHY, MEASURED RATHER THAN FELT. ADR-012/B4 put a line ceiling on
// `src/global-work-store.mjs` because it went 885 -> 1,233 lines in ONE story, and named
// the failure mode: `mesh-worker-execution.mjs` reached 3,174 lines the same way, "one
// justified block at a time, with no single diff ever looking wrong" (TECH_DEBT item 10).
// `ui/` had no equivalent, and it has been running the identical trajectory unwatched.
// Measured 2026-08-03 across the repo's own history:
//
//   file                            m03      m26      07-30    43/03    43/04
//   ui/src/board/DetailPanel.tsx     434      707        814      839    1,123   +284 (+34%)
//   ui/src/fleet/Fleet.tsx             —      508      1,463    1,463    1,521    +58
//   ui/src/board/Board.tsx           315      367        437      485      581    +96
//
// DetailPanel grew MORE in story 43/04 alone (+284) than in the whole month before it
// (+132), and crossed 1,000 lines in that one diff. That is B4's own curve, one layer over.
//
// THE ESCAPE HATCH IS THE OUTCOME WE WANT, and in `ui/` it is cheaper than anywhere else: a
// React surface's natural unit of extraction is a CHILD COMPONENT with a prop boundary, and
// this milestone already built the pattern twice in the same story — the freshness ramp's
// pure logic to `freshness.mjs`, the Resync state machine to `resync.mjs`, the badge and
// the legend to `StaleBadge.tsx`. What did NOT follow was `ProvenanceLine`: a ~180-line
// self-contained component with four hooks and a clean prop boundary, landed as a block
// inside `DetailPanel.tsx`. Same story, same author, both moves available — which is what
// makes this a ratchet worth having rather than a judgement call worth repeating.
//
// TWO THINGS THIS DELIBERATELY IS NOT:
//   - NOT a repo-wide file-size rule. A limit one milestone imposes on everyone else's
//     files is what the codebase-health rule rejects. This is a NAMED table of the surface
//     modules this milestone measurably enlarged, each with its own reason.
//   - NOT satisfiable by deleting explanation. ADR-014/E3 stated the general rule and it
//     binds here verbatim: "a line ceiling is a proxy for structural cost, and deleting
//     rationale to fit under it RAISES the real cost while lowering the measured one. If a
//     change cannot fit under the ceiling without removing existing explanation, the change
//     belongs in another module — that is the ratchet working." Raising a number here is a
//     decision that needs an ADR, not a diff.
//
// `ui/src/board/Board.tsx` is deliberately NOT capped, and the reason is on the record so a
// later reviewer meets the decision rather than the omission: it is the composition ROOT.
// Its +96 is almost entirely prop threading (`freshnessOf`, `pollMs`, `onResyncWatch`) and
// two effects, which is what a root is FOR — capping it would push state back down into the
// leaves, which is the opposite of the shape this file exists to protect.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// The named table. `floor` makes each entry non-vacuous: a rename, a move or a truncated
// read cannot turn a ceiling into a silent pass on a file that is no longer there.
const BUDGETS = [
  {
    file: "ui/src/board/DetailPanel.tsx",
    ceiling: 1000,
    floor: 400,
    // Set BELOW the delivered 1,123 on purpose (ADR-015/F2): the extraction of
    // `ProvenanceLine` into its own module is a required outcome of 43/04's second-pass
    // review, and a ratchet that ratifies the size it was raised against would be
    // decoration. Post-extraction the file lands near 950, so this leaves real headroom
    // without dictating the shape of the move.
    why: "the board's detail panel — it hosts the header, the provenance box, four doc tabs, the tasks view and the runs view; each milestone adds one more region. `ProvenanceLine` belongs in its own module (its pure half already is: ./resync.mjs), called from here.",
  },
  {
    file: "ui/src/fleet/Fleet.tsx",
    ceiling: 1560,
    floor: 600,
    // Set just ABOVE the delivered 1,521, and that asymmetry with DetailPanel is
    // deliberate: 43/04 added 58 lines here, so its size is a debt this story did not
    // create and must not be made to pay. The ceiling holds the line for the NEXT author.
    why: "the largest file in ui/ (508 -> 1,521). Its regions — nodes, boards, milestones, the assign affordance, diagnostics, the legend — are already separate components in one file; the next one belongs in its own.",
  },
];

export const archTests = [
  ...BUDGETS.map((budget) => ({
    name: `arch/43 ADR-015/F2 (acd-ui-surface-file-budget): ${budget.file} stays under its ${budget.ceiling}-line ratchet — a surface gains child components, not blocks`,
    run: async () => {
      const source = await readFile(path.join(repoRoot, budget.file), "utf8");
      const lines = source.split(/\r?\n/).length;
      assert.ok(
        lines > budget.floor,
        `the measured module was actually read (non-vacuous): ${budget.file} is ${lines} lines`,
      );
      assert.ok(
        lines <= budget.ceiling,
        `${budget.file} is ${lines} lines, over the ${budget.ceiling}-line ratchet (ADR-015/F2) — ${budget.why} Extract the next region into a sibling component with a prop boundary; do NOT trim comments to fit (ADR-014/E3). Raising this number needs an ADR, not a diff.`,
      );
    },
  })),
  {
    name: "arch/43 ADR-015/F2 (acd-ui-surface-file-budget): self-check — every budgeted file exists, and the table is the only place a number lives",
    run: async () => {
      const missing = [];
      for (const budget of BUDGETS) {
        try {
          await readFile(path.join(repoRoot, budget.file), "utf8");
        } catch {
          missing.push(budget.file);
        }
      }
      assert.deepEqual(
        missing,
        [],
        `a budget entry naming a file that is no longer on disk makes the ratchet guard a number that is not true (ADR-013/C5) — remove or re-aim it: ${missing.join(", ")}`,
      );
      assert.ok(BUDGETS.length > 0, "the budget table is populated (non-vacuous)");
      for (const budget of BUDGETS) {
        assert.ok(budget.ceiling > budget.floor, `${budget.file}: the ceiling must exceed the non-vacuity floor`);
      }
    },
  },
];
