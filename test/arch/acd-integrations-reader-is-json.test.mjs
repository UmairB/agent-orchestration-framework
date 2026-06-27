// Fitness function FF-B for milestone 18 / ADR-003 + ADR-007 (reader-is-JSON-no-
// parseFrontmatter + the parser revert):
//   (a) The descriptor reader (src/integrations/routing.mjs) reads the per-folder
//       `.integrations.json` with `JSON.parse` and has NO `parseFrontmatter` import or
//       usage — routing is a discrete JSON file, never frontmatter (R4 (m18): extending
//       the shared frontmatter parser is a blast-radius hazard).
//   (b) src/work.mjs `parseScalarOrCollection` is back to its pre-m18 minimal shape — NO
//       inline-flow-map `{}` branch (the `{`-startsWith / `}`-endsWith flow-map branch is
//       ABSENT). The shared 14-importer god-node parser is de-risked.
//
// Source-grep, CI-able offline. Comments are stripped so a `parseFrontmatter` or a `{`
// brace mentioned in a comment is discounted; a real import/call/branch survives.
//   Self-checked non-vacuous: the `{}`-branch matcher fires on a planted flow-map branch,
//   and the parseFrontmatter matcher fires on a planted import.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROUTING = path.join(repoRoot, "src", "integrations", "routing.mjs");
const WORK = path.join(repoRoot, "src", "work.mjs");

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// The inline-flow-map branch ADR-007 REVERTED: a guard testing `value.startsWith("{")`
// (with or without the `&& value.endsWith("}")` half). Its presence means the `{}` branch
// is back. Quote-agnostic on the brace literal.
const FLOW_MAP_BRANCH = /\.\s*startsWith\s*\(\s*["'`]\{["'`]\s*\)/;
// A `parseFrontmatter` import or call (the forbidden frontmatter dependency in the reader).
const PARSE_FRONTMATTER_USE = /\bparseFrontmatter\b/;

export const archTests = [
  {
    name: "arch/18 FF-B (a): the descriptor reader uses JSON.parse and has NO parseFrontmatter dependency",
    async run() {
      const code = stripComments(await readFile(ROUTING, "utf8"));
      assert.ok(/\bJSON\.parse\s*\(/.test(code), "routing.mjs reads the descriptor with JSON.parse");
      assert.ok(!PARSE_FRONTMATTER_USE.test(code), "routing.mjs has no parseFrontmatter import or usage (routing is a discrete JSON file, not frontmatter)");
    },
  },
  {
    name: "arch/18 FF-B (b): src/work.mjs parseScalarOrCollection has NO inline-flow-map `{}` branch (ADR-007 revert)",
    async run() {
      const code = stripComments(await readFile(WORK, "utf8"));
      assert.ok(
        !FLOW_MAP_BRANCH.test(code),
        "src/work.mjs has no `value.startsWith(\"{\")` flow-map branch — parseScalarOrCollection is back to its pre-m18 minimal shape"
      );
      // The minimal reader IS still present (the inline-list branch survives) — this is a
      // revert to minimal, not a deletion of the function.
      assert.ok(/\.\s*startsWith\s*\(\s*["'`]\[["'`]\s*\)/.test(code), "the inline-list `[a, b]` branch is still present (the minimal reader survives)");
    },
  },
  {
    name: "arch/18 FF-B (self-check): the `{}`-branch matcher fires on a planted flow-map branch; the parseFrontmatter matcher fires on a planted import",
    async run() {
      assert.ok(
        FLOW_MAP_BRANCH.test('if (value.startsWith("{") && value.endsWith("}")) { return map; }'),
        "the flow-map-branch matcher fires on a planted `{}` branch"
      );
      assert.ok(!FLOW_MAP_BRANCH.test('if (value.startsWith("[") && value.endsWith("]")) {}'), "the matcher does NOT fire on the accepted inline-list branch");
      assert.ok(PARSE_FRONTMATTER_USE.test('import { parseFrontmatter } from "../work.mjs";'), "the parseFrontmatter matcher fires on a planted import");
    },
  },
];
