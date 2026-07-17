// Regression test for QA coverage gap F-3 (behavioural review of the milestone
// 41 review fast-follow, 2026-07-16): "CLI loud-failure envelope untested
// end-to-end." The count-gate error is asserted at the `invoke()` throw site
// (test/work-insert-count-gate.test.mjs), but the operator-facing shaping in
// `workInsertCli` (src/cli.mjs, ~L1589 -> catches the coded
// "insert-confirm-required" error and emits ONE
// `{ ok:false, error, code, shifted }` envelope + `process.exitCode = 1` under
// --json) was run by no test.
//
// This drives the REAL `aof` CLI as a CHILD PROCESS — the same `spawnCliSync`
// harness `test/arch/acd-work-command-cli-bijection.test.mjs` uses — over a
// real fixture on disk (the same `withInsertFixture`/`buildTopLevelMilestones`
// builders the other work-insert command-surface tests use), confirming BOTH
// the process exit code and the exact --json error envelope shape.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnCliSync } from "./support/cli-spawn.mjs";
import { withInsertFixture, buildTopLevelMilestones } from "./support/work-insert-fixture.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "bin", "aof.mjs");

export const workInsertCliConfirmEnvelopeTests = [
  {
    name: "work-insert/cli-confirm-envelope: an above-threshold insert-milestone run via the real CLI without --yes exits 1 with the { ok:false, error, code, shifted } --json envelope",
    run: () =>
      withInsertFixture(async ({ repo, workDir }) => {
        // 00-09; --at 2 shifts 02..09 = 8 items, at/above the default
        // confirmThreshold (5) — the fixture writes NO config override, so the
        // named default (insert-shared.mjs's DEFAULT_CONFIRM_THRESHOLD) applies.
        await buildTopLevelMilestones(workDir, 10);

        const result = spawnCliSync(
          process.execPath,
          [cliPath, "work", "insert-milestone", "widget-support", "--at", "2", "--json"],
          {
            cwd: repo,
            encoding: "utf8",
            env: { ...process.env, NODE_NO_WARNINGS: "1" },
          },
        );

        assert.equal(result.status, 1, `the CLI process exits 1 (stdout: ${result.stdout}; stderr: ${result.stderr})`);

        let parsed;
        assert.doesNotThrow(() => {
          parsed = JSON.parse(result.stdout);
        }, `stdout is a single parseable JSON document: ${JSON.stringify(result.stdout)}`);

        assert.equal(parsed.ok, false, `the envelope reports ok:false: ${JSON.stringify(parsed)}`);
        assert.equal(parsed.code, "insert-confirm-required", `the envelope carries the coded error: ${JSON.stringify(parsed)}`);
        assert.equal(typeof parsed.error, "string", `the envelope carries a string error message: ${JSON.stringify(parsed)}`);
        assert.ok(parsed.error.length > 0, "the error message is non-empty");
        assert.equal(typeof parsed.shifted, "number", `the envelope carries a numeric "shifted" count, not null: ${JSON.stringify(parsed)}`);
        assert.equal(parsed.shifted, 8, `the envelope names the exact shift count (8 items, 02..09): ${JSON.stringify(parsed)}`);
      }),
  },
];
