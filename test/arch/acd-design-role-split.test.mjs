// Fitness function for milestone 07 / ADR-001 (the responsibility-split contract):
// "The design-conformance loop is split across exactly THREE parties by a STRUCTURAL tool
//  boundary: the bundled DESIGNER agent carries NO Bash (tools stay Read/Grep/Glob/Write/
//  WebSearch/WebFetch) and judges a PROVIDED screenshot — it never runs a browser; QA carries
//  Bash and owns running the Playwright harness + the toHaveScreenshot regression that locks
//  the designer-approved baseline; the ORCHESTRATION (verify/continue) renders and hands the
//  screenshot to the designer + spawns QA. No browser-run / toHaveScreenshot ownership appears
//  in the designer's contract."
//
// Reads the BUNDLED assets under src/bundle/ (ADR-005), NOT .claude/. Authored across the three
// stories' slices (story 00 designer, story 01 QA, story 02 orchestration) but kept in one file —
// it is one invariant (the split) read from the three assets that carry it.
//
// The designer FORBIDDING slice is a clean pattern-ABSENCE (the sound direction of a forbidding
// grep, per acd-capability-delegation's note): the two UNIQUE browser-execution ownership tokens
// — `npx playwright` and `toHaveScreenshot` — must not appear in the designer body at all. (Bare
// "Playwright" / "the browser" are NOT forbidden — the designer legitimately disclaims running
// them — so only the unique ownership tokens are asserted absent.)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../../", import.meta.url);
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, root)), "utf8");

const DESIGNER = "src/bundle/agents/aof-designer.md";
const QA = "src/bundle/agents/aof-qa.md";
const VERIFY = "src/bundle/commands/verify.md";
const CONTINUE = "src/bundle/commands/continue.md";

// Parse the frontmatter `tools:` CSV list of an agent file.
function toolsOf(rel) {
  const body = read(rel);
  const fm = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(fm, `${rel} has YAML frontmatter`);
  const line = fm[1].split(/\r?\n/).find((l) => /^tools:/.test(l));
  assert.ok(line, `${rel} frontmatter carries a tools: line`);
  return line.replace(/^tools:/, "").split(",").map((t) => t.trim()).filter(Boolean);
}

const has = (rel, needle) => read(rel).toLowerCase().includes(needle.toLowerCase());

export const archTests = [
  {
    name: "arch/ADR-001 (designer slice): the bundled designer carries the six read-only tools and NO Bash, and judges a screenshot it is handed (read-only)",
    run: async () => {
      const tools = toolsOf(DESIGNER);
      for (const t of ["Read", "Grep", "Glob", "Write", "WebSearch", "WebFetch"]) {
        assert.ok(tools.includes(t), `designer tools include ${t}`);
      }
      assert.ok(!tools.includes("Bash"), "designer tools do NOT include Bash (the structural read-only guarantee)");

      assert.ok(
        has(DESIGNER, "screenshot") && (has(DESIGNER, "handed") || has(DESIGNER, "provided")),
        "designer body states it judges a screenshot it is handed/provided"
      );
      assert.ok(has(DESIGNER, "read-only"), "designer body states it is read-only");
      assert.ok(
        has(DESIGNER, "do not run the browser") || has(DESIGNER, "does not run the browser") || has(DESIGNER, "not run a browser"),
        "designer body states it does not run the browser itself"
      );
    }
  },
  {
    name: "arch/ADR-001 (designer slice): the browser-execution ownership tokens (npx playwright, toHaveScreenshot) are ABSENT from the designer contract",
    run: async () => {
      const body = read(DESIGNER).toLowerCase();
      assert.ok(!body.includes("npx playwright"), "the designer body never names the `npx playwright` render command (that is the orchestration's)");
      assert.ok(!body.includes("tohavescreenshot"), "the designer body never claims the `toHaveScreenshot` visual-regression (that is QA's)");
    }
  },
  {
    name: "arch/ADR-001 (QA slice): the bundled QA agent carries Bash and owns running the Playwright harness + the toHaveScreenshot regression + the functional checks; the designer owns none of them",
    run: async () => {
      const tools = toolsOf(QA);
      assert.ok(tools.includes("Bash"), "QA tools include Bash (it runs the browser)");

      assert.ok(has(QA, "playwright") && has(QA, "harness"), "QA owns running the Playwright browser harness");
      assert.ok(has(QA, "tohavescreenshot"), "QA owns the toHaveScreenshot visual-regression");
      assert.ok(has(QA, "designer-approved baseline"), "the toHaveScreenshot regression locks the designer-approved baseline");
      assert.ok(has(QA, "functional") && has(QA, "behavioural"), "QA owns the functional / behavioural checks");

      // The designer owns neither the harness-run token nor the regression token.
      assert.ok(!read(DESIGNER).toLowerCase().includes("tohavescreenshot"), "toHaveScreenshot is NOT in the designer contract");
    }
  },
  {
    name: "arch/ADR-001 (orchestration slice): verify.md + continue.md render via npx playwright, hand the screenshot to the designer to JUDGE, and spawn QA — without telling the designer to run the browser",
    run: async () => {
      for (const cmd of [VERIFY, CONTINUE]) {
        assert.ok(has(cmd, "npx playwright"), `${cmd} performs the render via npx playwright`);
        assert.ok(has(cmd, "aof-designer") && has(cmd, "judge") && has(cmd, "screenshot"), `${cmd} hands the screenshot to the designer to judge (the hand-off)`);
        assert.ok(has(cmd, "aof-qa"), `${cmd} spawns QA for the browser harness / regression / a11y`);
        assert.ok(
          has(cmd, "not instruct the designer to run the browser"),
          `${cmd} explicitly does not instruct the designer to run the browser`
        );
      }
    }
  },
  {
    // ADR-004 QA-ownership half (the a11y lane is QA's by the same ADR-001 tool boundary). The schema
    // shape is acd-a11y-config-schema's; this asserts the CONTRACT text in the bundled QA agent that
    // 01/02_qa-runs-a11y.feature's @executable scenarios pin: the a11y run is QA's, gated on the opt-in.
    name: "arch/ADR-004 (QA a11y-lane contract): the bundled QA agent owns the opt-in a11y run (axe-core via Playwright, gated on work.tags.domains, level from work.ui.a11y, absent ≡ off); the designer never runs it",
    run: async () => {
      assert.ok(has(QA, "axe-core") && has(QA, "playwright"), "QA runs the a11y check via axe-core injected through Playwright");
      assert.ok(has(QA, "work.tags.domains") && has(QA, "a11y"), "the a11y lane is gated on work.tags.domains containing a11y");
      assert.ok(has(QA, "work.ui.a11y"), "QA references the conformance level from work.ui.a11y");
      assert.ok(has(QA, "wcag 2.1 aa"), "the documented default level is WCAG 2.1 AA");
      assert.ok(has(QA, "absent ≡ off") || has(QA, "no a11y check"), "absent opt-in ≡ off (no a11y check runs)");
      assert.ok(!has(DESIGNER, "axe-core"), "the designer contract does not own/run the a11y check");
    }
  }
];
