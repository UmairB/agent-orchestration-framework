// test/integration/support/common-steps.mjs — the shared step grammar every
// new-style feature builds on (m42 wave (d) restructure). One grammar, one
// meaning: fixtures scaffold through work-stream-fixture.mjs, execution goes
// through the REAL CLI (spawn or in-process — cli-context decides), assertions
// read the last result. Feature-specific step modules register their own
// patterns on top of these.
import assert from "node:assert/strict";
import { runCli } from "./cli-context.mjs";
import { ensureWorkStream, writeMilestone, writeStory } from "./work-stream-fixture.mjs";

export function registerCommonSteps(registry) {
  // ----------------------------------------------------------- fixtures ----
  registry.define(/^a work stream with milestone "([^"]+)" titled "([^"]+)"$/, async (context, number, title) => {
    await writeMilestone(context, { number, slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"), title });
  });

  registry.define(
    /^story "([^"]+)\/([^"]+)" titled "([^"]+)"(?: with status "([^"]+)")?$/,
    async (context, parent, number, title, status) => {
      await writeStory(context, {
        parent,
        number,
        slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        title,
        ...(status ? { status } : {}),
      });
    },
  );

  registry.define(/^a running run on "([^"]+)"$/, async (context, ref) => {
    const result = await runCli(context, `work run-start ${ref} --json`);
    assert.equal(result.status, 0, `run-start ${ref} exits 0 (stderr: ${result.stderr})`);
    context.lastRun = JSON.parse(result.stdout);
  });

  // ---------------------------------------------------------- execution ----
  registry.define(/^I run `(.+)`$/, async (context, command) => {
    await ensureWorkStream(context);
    context.lastResult = await runCli(context, command);
  });

  // --------------------------------------------------------- assertions ----
  registry.define("the command should succeed", (context) => {
    const { status, stderr } = context.lastResult;
    assert.equal(status, 0, `expected exit 0, got ${status} (stderr: ${stderr})`);
  });

  registry.define("the command should fail", (context) => {
    assert.notEqual(context.lastResult.status, 0, "expected a non-zero exit");
  });

  registry.define(/^stdout should contain `(.+)`$/, (context, text) => {
    assert.ok(
      context.lastResult.stdout.includes(text),
      `stdout should contain "${text}" (stdout: ${context.lastResult.stdout.slice(0, 300)})`,
    );
  });

  registry.define(/^stderr should contain `(.+)`$/, (context, text) => {
    assert.ok(
      context.lastResult.stderr.includes(text),
      `stderr should contain "${text}" (stderr: ${context.lastResult.stderr.slice(0, 300)})`,
    );
  });

  registry.define(/^the JSON result field "([^"]+)" should be (true|false|"[^"]*")$/, (context, field, expected) => {
    const parsed = JSON.parse(context.lastResult.stdout);
    const value = expected === "true" ? true : expected === "false" ? false : expected.slice(1, -1);
    assert.equal(parsed[field], value, `JSON field "${field}" is ${expected}`);
  });

  // The ONE error envelope: a --json failure is exactly one structured
  // { ok:false, error, code } document on STDOUT (never sniffed off stderr).
  registry.define(/^the JSON error envelope should carry code "([^"]+)"$/, (context, code) => {
    const parsed = JSON.parse(context.lastResult.stdout);
    assert.equal(parsed.ok, false, "the envelope is { ok: false, … }");
    assert.equal(parsed.code, code, `the envelope carries code "${code}" (got "${parsed.code}")`);
    assert.equal(typeof parsed.error, "string", "the envelope names the error");
  });

  // Per-reactor outcomes ride the result envelope (PRD: declared, drained,
  // reported — never silent).
  registry.define(/^the reactor "([^"]+)" should report "([^"]+)"$/, (context, key, status) => {
    const parsed = JSON.parse(context.lastResult.stdout);
    assert.ok(Array.isArray(parsed.effects), "the result carries per-reactor effects outcomes");
    const outcome = parsed.effects.find((entry) => entry.key === key);
    assert.ok(outcome, `an outcome for reactor "${key}" is present`);
    assert.equal(outcome.status, status, `reactor "${key}" reports "${status}" (got "${outcome.status}")`);
  });

  // Black-box status check through the CLI's own list face.
  registry.define(/^item "([^"]+)" should list with status "([^"]+)"$/, async (context, ref, status) => {
    const result = await runCli(context, "work list --json");
    assert.equal(result.status, 0, `work list exits 0 (stderr: ${result.stderr})`);
    const rows = JSON.parse(result.stdout);
    const row = rows.find((entry) => entry.ref === ref);
    assert.ok(row, `item "${ref}" is listed`);
    assert.equal(row.status, status, `item "${ref}" lists as "${status}" (got "${row.status}")`);
  });
}
