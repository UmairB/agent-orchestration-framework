// work:doctor — milestone 16: the DOC-BLOAT / CONTEXT-BUDGET check-group. A single
// PURE `(snapshot, ctx) => Finding[]` function APPENDED to the engine's CHECK_GROUPS
// registry (milestone 16 / ADR-001) — it edits no existing group and no spine control
// flow. The module NAME (`work-doctor-budget.mjs`) is load-bearing: it puts the group
// under the `work-doctor*.mjs` determinism glob so the no-wall-clock invariant
// auto-covers it (ADR-001, ADR-003).
//
// PURITY (ADR-002): the group reads ONLY the per-artifact line counts the snapshot
// already recorded (`item.docSizes`, measured from text the snapshot already read) and
// the RESOLVED budgets handed in on `ctx.budgets` (ADR-005). It performs NO filesystem
// read of its own and reads NO wall-clock. The budget NUMBERS live ONLY in the
// `budgetsFromConfig` resolver (work-doctor.mjs) — this body holds no budget literal.
//
// Code + severity (ADR-004, fixed in the task .feature Examples):
//   doc-over-budget (warn) — fired ONCE per over-budget artifact, anchored at the
//   over-budget FILE's raw absolute path, naming the artifact + measured lines + budget.
import path from "node:path";

// Each budgeted artifact filename → the `ctx.budgets` key for its kind. SESSION.md
// (uat) is deliberately absent — it is not a budgeted long-form context doc.
const BUDGET_KEY = {
  "SPEC.md": "spec",
  "ARCHITECTURE.md": "architecture",
  "STORY.md": "story",
};

// doc-over-budget (warn): for each item, each recorded per-artifact line count that is
// STRICTLY GREATER THAN the resolved budget for that artifact kind fires one finding,
// anchored at that artifact's own file (so a milestone with both SPEC.md and
// ARCHITECTURE.md over budget yields two distinct findings). A doc AT its budget is
// healthy (the strictly-greater convention). Within budget ⇒ silent (no "ok" rows).
export function budgetGroup(snapshot, ctx) {
  const budgets = ctx?.budgets ?? {};
  const findings = [];

  for (const item of snapshot.items) {
    const docSizes = item.docSizes ?? {};
    for (const [docName, size] of Object.entries(docSizes)) {
      const key = BUDGET_KEY[docName];
      const budget = budgets[key];
      const lines = size?.lines;
      if (key == null || budget == null || lines == null) continue;
      if (lines > budget) {
        findings.push({
          code: "doc-over-budget",
          severity: "warn",
          path: path.join(item.dir, docName),
          message: `${docName} is ${lines} lines, over the ${budget}-line budget for ${item.type} ${item.ref}`,
        });
      }
    }
  }

  return findings;
}
