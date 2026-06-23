// Fitness function for milestone 07 / ADR-002 (the structured verdict contract):
// "The conformance review returns exactly one of CONFORMS / GAPS / INCONCLUSIVE; it returns
//  INCONCLUSIVE (naming the missing baseline) when there is no committed mock AND no binding
//  checklist, or no render is available; it never guesses from component code in place of a
//  render; Playwright is invoked on-demand via `npx` and is NOT a dependency in package.json."
//
// Reads the BUNDLED designer agent (the verdict it returns) + verify/continue commands (the
// verdict the orchestration routes) under src/bundle/ (ADR-005), and the root package.json (the
// no-Playwright-dependency assertion). The designer-side verdict text is authored by story 00;
// the command-side text + the npx/no-dep rule by story 02 — read here by the one contract test.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../../", import.meta.url);
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, root)), "utf8");
const has = (rel, needle) => read(rel).toLowerCase().includes(needle.toLowerCase());

const DESIGNER = "src/bundle/agents/aof-designer.md";
const VERIFY = "src/bundle/commands/verify.md";
const CONTINUE = "src/bundle/commands/continue.md";

export const archTests = [
  {
    name: "arch/ADR-002: the bundled designer + verify/continue commands name the three terminal verdict values CONFORMS / GAPS / INCONCLUSIVE",
    run: async () => {
      for (const asset of [DESIGNER, VERIFY, CONTINUE]) {
        const body = read(asset); // case-sensitive: the verdict tokens are uppercase
        for (const token of ["CONFORMS", "GAPS", "INCONCLUSIVE"]) {
          assert.ok(body.includes(token), `${asset} names the verdict token ${token}`);
        }
      }
      // The designer fixes the verdict as one of exactly three (the closed-set constraint).
      assert.ok(
        has(DESIGNER, "one of exactly three") || has(DESIGNER, "exactly those three") || has(DESIGNER, "exactly three"),
        "the designer contract states the verdict is one of exactly those three"
      );
    }
  },
  {
    name: "arch/ADR-002: INCONCLUSIVE is mandatory when there is no baseline (no committed mock AND no binding checklist) or no render — and the review names the missing baseline rather than guessing from component code",
    run: async () => {
      // Designer side (story 00).
      assert.ok(has(DESIGNER, "no committed mock and no binding checklist"), "designer: INCONCLUSIVE when no committed mock AND no binding checklist");
      assert.ok(has(DESIGNER, "no render") || has(DESIGNER, "no screenshot") || has(DESIGNER, "no rendered screenshot"), "designer: INCONCLUSIVE when no render/screenshot is available");
      assert.ok(has(DESIGNER, "names the missing baseline") || has(DESIGNER, "missing baseline as the gap"), "designer: names the missing baseline as the gap");
      assert.ok(
        has(DESIGNER, "never guess from code") || has(DESIGNER, "never guesses from code") || (has(DESIGNER, "infer") && has(DESIGNER, "component code")),
        "designer: never infers CONFORMS/GAPS from component code in place of a render"
      );

      // Orchestration side (story 02).
      for (const cmd of [VERIFY, CONTINUE]) {
        assert.ok(has(cmd, "inconclusive"), `${cmd}: carries the INCONCLUSIVE path`);
        assert.ok(
          has(cmd, "no committed mock and no binding checklist") || has(cmd, "no baseline exists") || has(cmd, "no baseline"),
          `${cmd}: INCONCLUSIVE when no base URL / screenshot is available or no baseline exists`
        );
        // Full phrase (not a bare-word proxy) so a real weakening of the no-guess rule trips the test (F5).
        assert.ok(
          has(cmd, "inferring from component code"),
          `${cmd}: names the missing baseline rather than inferring from component code`
        );
        // A surface with no renderable Route collapses to INCONCLUSIVE naming the missing Route (02/01, F4).
        assert.ok(
          has(cmd, "no renderable") && has(cmd, "route"),
          `${cmd}: a DESIGN surface with no renderable Route collapses to INCONCLUSIVE naming the missing Route`
        );
      }
    }
  },
  {
    name: "arch/ADR-002: the review renders on-demand via `npx playwright` in the bundled commands",
    run: async () => {
      for (const cmd of [VERIFY, CONTINUE]) {
        assert.ok(has(cmd, "npx playwright"), `${cmd} invokes the render on-demand via npx playwright`);
      }
    }
  },
  {
    name: "arch/ADR-002: Playwright is on-demand via npx, NOT a dependency in root package.json (dependencies/devDependencies)",
    run: async () => {
      const pkg = JSON.parse(read("package.json"));
      for (const field of ["dependencies", "devDependencies"]) {
        const deps = pkg[field] ?? {};
        assert.ok(!("playwright" in deps), `package.json ${field} does not list playwright`);
        assert.ok(!("@playwright/test" in deps), `package.json ${field} does not list @playwright/test`);
      }
    }
  }
];
