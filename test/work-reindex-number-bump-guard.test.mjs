// Regression test for review fix 3 (milestone 41 as-built review, 2026-07-16):
// "The mandatory `number:` bump silently no-ops, committing a folder<->frontmatter
// mismatch." `reindexForInsert` (src/work-reindex.mjs) used to rename a shifted
// item's folder UNCONDITIONALLY, then guard the frontmatter `number:` write on
// `if (bumped !== text)` — so a shifted item whose record doc was malformed (no
// `---` frontmatter block at byte 0, or no `number:` line inside it) had its
// folder renamed to the NEW number while its frontmatter stayed stale at the OLD
// number: a silent validate-broken mismatch with no error. The fix asserts the
// mandatory bump actually happened BEFORE the rename commits, throwing a coded
// `reindex-number-bump-failed` error instead.
//
// Wired directly against the LOCKED engine `reindexForInsert(workDir, { at,
// space })` (mirrors work-reindex-slot-open.test.mjs's own house style — story
// 01 has no command surface), confirmed via a fresh `folderNames`/`findWork`
// read that the offending item's folder was NEVER renamed (no partial mismatch
// committed).
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { findWork } from "../src/work.mjs";
import { reindexForInsert } from "../src/work-reindex.mjs";
import { withWork, buildTopLevelStream, folderNames } from "./support/work-reindex-fixture.mjs";

export const workReindexNumberBumpGuardTests = [
  // A shifted item whose record doc has NO frontmatter block at all.
  {
    name: "work-reindex/number-bump-guard: a shifted item whose record doc has no frontmatter block throws reindex-number-bump-failed and its folder is never renamed",
    run: () =>
      withWork(async (work) => {
        const dirs = await buildTopLevelStream(work, 3); // 00_alpha, 01_bravo, 02_charlie
        // "02_milestone_charlie" is the ONLY item >= at:2, so it's the only
        // one the engine would touch — malform it so the bump has nothing to
        // resolve.
        await writeFile(path.join(dirs.charlie, "SPEC.md"), "no frontmatter block here — just prose.\n", "utf8");

        await assert.rejects(
          () => reindexForInsert(work, { at: 2, space: "top-level" }),
          (error) => {
            assert.equal(error.code, "reindex-number-bump-failed", `coded error (got code "${error.code}")`);
            return true;
          },
        );

        const names = await folderNames(work);
        assert.ok(names.includes("02_milestone_charlie"), `charlie's folder was NEVER renamed — no silent folder<->frontmatter mismatch (folders: ${JSON.stringify(names)})`);
        assert.ok(!names.includes("03_milestone_charlie"), `no "03_milestone_charlie" folder exists (folders: ${JSON.stringify(names)})`);

        const three = await findWork(work, "3");
        assert.equal(three.length, 0, "slot 3 resolves nothing — the rename never committed");
      }),
  },

  // A shifted item whose record doc HAS a frontmatter block, but no
  // resolvable `number:` line inside it.
  {
    name: "work-reindex/number-bump-guard: a shifted item whose frontmatter block has no number: line throws reindex-number-bump-failed and its folder is never renamed",
    run: () =>
      withWork(async (work) => {
        const dirs = await buildTopLevelStream(work, 3); // 00_alpha, 01_bravo, 02_charlie
        await writeFile(
          path.join(dirs.charlie, "SPEC.md"),
          "---\ntype: milestone\nslug: charlie\nstatus: not-started\ncreated: 2026-07-16\nupdated: 2026-07-16\n---\n",
          "utf8",
        );

        await assert.rejects(
          () => reindexForInsert(work, { at: 2, space: "top-level" }),
          (error) => {
            assert.equal(error.code, "reindex-number-bump-failed", `coded error (got code "${error.code}")`);
            return true;
          },
        );

        const names = await folderNames(work);
        assert.ok(names.includes("02_milestone_charlie"), `charlie's folder was NEVER renamed — no silent folder<->frontmatter mismatch (folders: ${JSON.stringify(names)})`);
        assert.ok(!names.includes("03_milestone_charlie"), `no "03_milestone_charlie" folder exists (folders: ${JSON.stringify(names)})`);
      }),
  },

  // The happy path is unaffected: every VALID record doc carries a `number:`
  // line, so a normal insert still succeeds with no false-positive throw.
  {
    name: "work-reindex/number-bump-guard: a normal (valid) shift still succeeds — no false-positive over the happy path",
    run: () =>
      withWork(async (work) => {
        await buildTopLevelStream(work, 4); // 00-03
        const result = await reindexForInsert(work, { at: 2, space: "top-level" });
        assert.equal(result.shifted, 2, `2 items shift (02,03) (got ${result.shifted})`);

        const three = await findWork(work, "3");
        assert.equal(three.length, 1, "3 resolves the item that was 02");
      }),
  },
];
