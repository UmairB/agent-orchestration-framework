// Traceability wiring for milestone 39 / story 03 (gap-to-chore), task
//   wiki/work/39_milestone_delivery-memory-outcome/stories/03_story_gap-to-chore/
//     tasks/01_promote-gap-to-chore.feature
//
// Every @executable scenario (and every Scenario Outline Examples row) below is
// wired against the REAL registered command `work:promote-gap`
// (src/commands/promote-gap-to-chore.mjs — composes over insert-shared.mjs's
// runInsertTopLevel via the SAME "chore" type work:insert-chore uses),
// invoked in-process through the command core (mirrors
// test/work-insert-top-level-places.test.mjs), scaffolding into a temp work
// dir via test/support/work-insert-fixture.mjs (withInsertFixture, extended
// this story to also copy the chore template) and read back black-box via a
// fresh findWork/validateWork plus a direct read of the created CHORE.md.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { invoke } from "../src/command-core.mjs";
import { findWork, validateWork } from "../src/work.mjs";
import { withInsertFixture } from "./support/work-insert-fixture.mjs";

// Extract a heading section's body: everything between the heading line and
// the next `##`-level heading (or end of doc) — mirrors
// test/work-chore-template.test.mjs's own helper.
function extractSectionBody(text, heading) {
  const lines = text.split(/\r?\n/);
  const headingIdx = lines.findIndex((line) => line.trim() === heading);
  if (headingIdx === -1) return null;
  const body = [];
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) break;
    body.push(lines[i]);
  }
  return body.join("\n");
}

function extractFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const out = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

// Promote a gap through the REAL registered command and read the created
// chore's CHORE.md back from disk.
async function promote(workspace, workDir, { title, discharge, status, at }) {
  const result = await invoke("work:promote-gap", { title, discharge, status, at }, { workspace });
  if (!result.promoted) return { result, text: null, dir: null };
  const text = await readFile(path.join(result.chore.dir, "CHORE.md"), "utf8");
  return { result, text, dir: result.chore.dir };
}

export const promoteGapToChoreTests = [
  // ==========================================================================
  // Scenario: promoting an open gap creates a top-level chore seeded from its
  //   discharge condition
  // ==========================================================================
  {
    name: "promote-gap-to-chore: promoting an open gap creates a top-level chore whose DoD contains the discharge condition and records the originating gap",
    run: () =>
      withInsertFixture(async ({ workDir, workspace }) => {
        const { result, text } = await promote(workspace, workDir, {
          title: "warnings_delivered field",
          discharge: "a production path writes warnings_delivered",
          status: "open",
          at: 0
        });

        assert.equal(result.promoted, true, "the promotion succeeds");

        // "a top-level chore work item is created"
        const found = await findWork(workDir, "0");
        const row = found.find((r) => r.slug === "warnings-delivered-field");
        assert.ok(row, "a fresh find resolves the promoted item");
        assert.equal(row.type, "chore", "the promoted item is a chore");
        assert.equal(row.parent, null, "the chore is top-level (no parent)");

        // "the chore's Definition of Done contains the discharge condition"
        const dod = extractSectionBody(text, "## Definition of Done");
        assert.ok(dod !== null, "the chore carries a Definition of Done section");
        assert.ok(
          dod.includes("a production path writes warnings_delivered"),
          `the Definition of Done contains the discharge condition; got:\n${dod}`
        );

        // "the chore records the originating gap it was promoted from"
        assert.ok(
          text.includes("warnings_delivered field"),
          "the chore's content names the originating gap's title (a back-reference)"
        );
      })
  },

  // ==========================================================================
  // Scenario: the promoted chore is born not-started, never hand-ticked done
  //   at creation
  // ==========================================================================
  {
    name: "promote-gap-to-chore: the promoted chore is born not-started with no ticked Definition of Done box",
    run: () =>
      withInsertFixture(async ({ workDir, workspace }) => {
        const { text } = await promote(workspace, workDir, {
          title: "warnings_delivered field",
          discharge: "a production path writes warnings_delivered",
          status: "open",
          at: 0
        });

        const meta = extractFrontmatter(text);
        assert.equal(meta.status, "not-started", `the created chore's status is "not-started"; got "${meta.status}"`);

        const dod = extractSectionBody(text, "## Definition of Done");
        const nonEmptyLines = dod
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l.length > 0);
        assert.ok(nonEmptyLines.length > 0, "the Definition of Done carries at least one checklist item");
        for (const line of nonEmptyLines) {
          assert.ok(!/^-\s\[[xX]\]/.test(line), `no Definition of Done box is ticked; found ticked line "${line}"`);
        }
      })
  },

  // ==========================================================================
  // Scenario Outline: each gap's discharge condition becomes its chore's
  //   close criterion
  //   | gap                      | discharge condition                              |
  //   | warnings_delivered field | a production path writes warnings_delivered      |
  //   | audit_trail field        | an emitter populates audit_trail on every write  |
  //   | retry_count field        | the scheduler increments retry_count on retry    |
  // ==========================================================================
  ...[
    { gap: "warnings_delivered field", discharge: "a production path writes warnings_delivered" },
    { gap: "audit_trail field", discharge: "an emitter populates audit_trail on every write" },
    { gap: "retry_count field", discharge: "the scheduler increments retry_count on retry" }
  ].map((row) => ({
    name: `promote-gap-to-chore: outline — promoting the open gap "${row.gap}" seeds its chore's DoD with "${row.discharge}" and back-references "${row.gap}", born not-started`,
    run: () =>
      withInsertFixture(async ({ workDir, workspace }) => {
        const { result, text } = await promote(workspace, workDir, {
          title: row.gap,
          discharge: row.discharge,
          status: "open",
          at: 0
        });

        assert.equal(result.promoted, true, `promoting "${row.gap}" succeeds`);

        const found = await findWork(workDir, "0");
        const promotedRow = found.find((r) => r.type === "chore");
        assert.ok(promotedRow, `a top-level chore work item is created for "${row.gap}"`);

        const dod = extractSectionBody(text, "## Definition of Done");
        assert.ok(dod.includes(row.discharge), `DoD contains "${row.discharge}"; got:\n${dod}`);
        assert.ok(text.includes(row.gap), `the chore records the originating gap "${row.gap}"`);

        const meta = extractFrontmatter(text);
        assert.equal(meta.status, "not-started", `"${row.gap}": the created chore's status is "not-started"`);
      })
  })),

  // ==========================================================================
  // Boundary: promoting an already-discharged gap creates no chore
  // ==========================================================================
  {
    name: "promote-gap-to-chore: promoting an already-discharged gap creates no chore and reports the gap is already discharged",
    run: () =>
      withInsertFixture(async ({ workDir, workspace }) => {
        const before = await findWork(workDir, "0");
        assert.deepEqual(before, [], "the fixture starts with no items");

        const { result } = await promote(workspace, workDir, {
          title: "legacy_flag field",
          discharge: "the legacy_flag reader was removed",
          status: "discharged",
          at: 0
        });

        assert.equal(result.promoted, false, "the promotion is refused");
        assert.match(
          result.reason ?? "",
          /already discharged/i,
          `the promotion reports the gap is already discharged; got "${result.reason}"`
        );

        // "no chore work item is created"
        const after = await findWork(workDir, "0");
        assert.deepEqual(after, [], "no item was created for the discharged gap");
      })
  },

  // ==========================================================================
  // Review fix (FIX 1): a missing/blank --discharge is refused, not silently
  // scaffolded with an empty Definition of Done checklist item.
  // ==========================================================================
  {
    name: "promote-gap-to-chore: regression — a missing --discharge is refused with a coded error and creates no chore",
    run: () =>
      withInsertFixture(async ({ workDir, workspace }) => {
        await assert.rejects(
          () => invoke("work:promote-gap", { title: "warnings_delivered field", status: "open", at: 0 }, { workspace }),
          (err) => {
            assert.equal(err.code, "promote-gap-invalid-discharge", `error code is "promote-gap-invalid-discharge"; got "${err.code}"`);
            assert.equal(err.status, 400, `error status is 400; got ${err.status}`);
            return true;
          },
          "promoting with no --discharge throws a coded error"
        );
        const after = await findWork(workDir, "0");
        assert.deepEqual(after, [], "no chore is created when --discharge is missing");
      })
  },

  {
    name: "promote-gap-to-chore: regression — a blank/whitespace-only --discharge is refused with a coded error and creates no chore",
    run: () =>
      withInsertFixture(async ({ workDir, workspace }) => {
        await assert.rejects(
          () => invoke("work:promote-gap", { title: "warnings_delivered field", discharge: "   ", status: "open", at: 0 }, { workspace }),
          (err) => {
            assert.equal(err.code, "promote-gap-invalid-discharge", `error code is "promote-gap-invalid-discharge"; got "${err.code}"`);
            assert.equal(err.status, 400, `error status is 400; got ${err.status}`);
            return true;
          },
          "promoting with a blank --discharge throws a coded error"
        );
        const after = await findWork(workDir, "0");
        assert.deepEqual(after, [], "no chore is created when --discharge is blank");
      })
  },

  // ==========================================================================
  // Regression: a promoted chore validates clean (the reused scaffold seam
  // produces a genuinely well-formed record doc, not a hand-patched stub).
  // ==========================================================================
  {
    name: "promote-gap-to-chore: regression — the promoted chore's folder validates clean",
    run: () =>
      withInsertFixture(async ({ workDir, workspace }) => {
        const { result } = await promote(workspace, workDir, {
          title: "warnings_delivered field",
          discharge: "a production path writes warnings_delivered",
          status: "open",
          at: 0
        });
        const findings = await validateWork(workDir, workspace.config);
        const own = findings.filter((f) => f.path.startsWith(result.chore.dir));
        assert.deepEqual(own, [], `zero findings for the promoted chore's record doc: ${JSON.stringify(own)}`);
      })
  }
];
