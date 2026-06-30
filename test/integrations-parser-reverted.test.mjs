// Traceability wiring for milestone 18 / story 02, task 00 —
// tasks/00_parser-reverted-to-minimal.feature (@executable, every scenario + both
// Scenario-Outline Examples groups). One test object per @executable scenario/row;
// ADR-007 (the parseFrontmatter inline-flow-map revert).
//
// parseFrontmatter is reverted to its pre-m18 minimal shape (scalars + quoted scalars
// + inline lists ONLY — no `{}` flow-map branch). The unit scenarios drive
// parseFrontmatter in-process; the traversal scenario invokes the REAL `aof work list
// --json` command over a temp fixture whose `.aof/aof.config.json` work.dir points at
// the fixture work folder, so the revert is exercised through the live list traversal.
//
// The STRUCTURAL "the `{}` flow-map branch is absent from parseScalarOrCollection"
// invariant is FF-B (an arch-test authored in this story), NOT asserted here — these
// Thens assert the observable PARSE RESULT, not the source.
import assert from "node:assert/strict";
import { spawnCliSync } from "./support/cli-spawn.mjs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "../src/work.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "bin", "aof.mjs");

// Parse a single frontmatter LINE (the Given is "a frontmatter block with <line>") —
// wrap it in the `---`-delimited block parseFrontmatter consumes and return the parsed
// value for the line's key.
function parseLine(line) {
  const key = line.slice(0, line.indexOf(":")).trim();
  const out = parseFrontmatter(`---\n${line}\n---\n`);
  return { key, value: out[key], out };
}

// Build a temp repo whose `.aof/aof.config.json` points work.dir at `wiki/work`, with a
// single milestone folder whose SPEC.md frontmatter carries the given `depends` inline
// list (the load-bearing real value the revert must leave intact). Returns { root }.
async function buildFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-parser-reverted-"));
  const aofDir = path.join(root, ".aof");
  const workDir = path.join(root, "wiki", "work");
  const milestoneDir = path.join(workDir, "18_milestone_demo");
  await mkdir(aofDir, { recursive: true });
  await mkdir(milestoneDir, { recursive: true });
  await writeFile(
    path.join(aofDir, "aof.config.json"),
    `${JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" } }, null, 2)}\n`,
    "utf8"
  );
  // The milestone SPEC.md carries `depends: [17]` (e.g. milestone 18's own SPEC.md) —
  // the inline list that must still parse to ["17"] after the revert.
  await writeFile(
    path.join(milestoneDir, "SPEC.md"),
    "---\ntype: milestone\nnumber: 18\nslug: demo\nstatus: in-progress\ntitle: \"Demo\"\ndepends: [17]\n---\n# Demo\n",
    "utf8"
  );
  return { root };
}

export const integrationsParserRevertedTests = [
  {
    // Scenario: a scalar and a quoted scalar still parse as before
    name: "integrations-parser-reverted/00 a scalar and a quoted scalar still parse as before",
    async run() {
      const out = parseFrontmatter('---\nstatus: in-progress\ntitle: "A — B"\n---\n');
      assert.equal(out.status, "in-progress", '"status" is "in-progress"');
      assert.equal(out.title, "A — B", '"title" is "A — B" (quotes stripped)');
    },
  },
  {
    // Scenario: an inline list still parses as a list
    name: "integrations-parser-reverted/00 an inline list still parses as a list containing 17",
    async run() {
      const { value } = parseLine("depends: [17]");
      assert.ok(Array.isArray(value), '"depends" is a list');
      assert.deepEqual(value, ["17"], '"depends" is the list containing "17"');
    },
  },
  {
    // Scenario: an inline flow map is no longer parsed into an object. The deterministic
    // fallback is the VERBATIM string "{ parent: p1 }" — braces retained, NOT
    // brace-stripped, NOT empty, NOT the inner "p1" — so it routes nothing.
    name: "integrations-parser-reverted/00 an inline flow map is no longer parsed into an object (verbatim brace string; notion.parent yields nothing)",
    async run() {
      const { value, out } = parseLine("notion: { parent: p1 }");
      assert.equal(value, "{ parent: p1 }", '"notion" is the verbatim string "{ parent: p1 }" (braces retained)');
      assert.equal(typeof value, "string", '"notion" is a string, not an object');
      assert.ok(!Array.isArray(value), '"notion" is not an array');
      // reading "notion.parent" yields nothing — it is a string, so .parent is undefined.
      assert.equal(out.notion?.parent, undefined, 'reading "notion.parent" yields nothing');
    },
  },
  {
    // Scenario: the work-stream traversals are unaffected by the revert. The REAL
    // `aof work list --json` runs over a fixture whose milestone carries `depends: [17]`;
    // every item reports its identity + status, and the milestone's depends parses to
    // ["17"] (the live traversal exercises parseFrontmatter via readMeta/listStream).
    name: "integrations-parser-reverted/00 the work-stream list traversal is unaffected by the revert (identity, status, depends:[17])",
    async run() {
      const { root } = await buildFixture();
      try {
        const result = spawnCliSync(process.execPath, [cliPath, "work", "list", "--json"], {
          cwd: root,
          encoding: "utf8",
        });
        assert.equal(result.status, 0, "the command exits 0");
        const rows = JSON.parse(result.stdout);
        const milestone = rows.find((r) => r.ref === "18");
        assert.ok(milestone, "the milestone is listed");
        assert.equal(milestone.type, "milestone", "the milestone reports its type");
        assert.equal(milestone.slug, "demo", "the milestone reports its identity (slug)");
        assert.equal(milestone.status, "in-progress", "the milestone reports its status exactly as before the revert");
        assert.equal(milestone.title, "Demo", "the milestone reports its quoted title exactly as before the revert");
        // The milestone's `depends` still parses to the list containing "17" (read
        // directly via parseFrontmatter over the same on-disk SPEC.md the traversal read).
        const spec = path.join(root, "wiki", "work", "18_milestone_demo", "SPEC.md");
        const { value } = ((src) => {
          const out = parseFrontmatter(src);
          return { value: out.depends };
        })(await (await import("node:fs/promises")).readFile(spec, "utf8"));
        assert.deepEqual(value, ["17"], 'the milestone\'s "depends" still parses to the list containing "17"');
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario Outline (Examples: scalars and lists are unchanged) — each row → one
    // assertion. A scalar stays a scalar string; an inline list stays a list.
    name: "integrations-parser-reverted/00 each scalar/list value kind parses to its expected result after the revert (every outline row)",
    async run() {
      // number: 18 ⇒ the scalar "18"
      {
        const { value } = parseLine("number: 18");
        assert.equal(value, "18", 'the value of "number" is the scalar "18"');
        assert.equal(typeof value, "string", '"number" is a scalar string');
      }
      // depends: [13, 17] ⇒ the list "13", "17"
      {
        const { value } = parseLine("depends: [13, 17]");
        assert.deepEqual(value, ["13", "17"], 'the value of "depends" is the list "13", "17"');
      }
    },
  },
  {
    // Scenario Outline (Examples: an inline flow map is now the verbatim brace string —
    // no comma-split, no brace-strip) — each row → one assertion.
    name: "integrations-parser-reverted/00 each inline flow map parses to its verbatim brace string after the revert (every outline row)",
    async run() {
      const rows = [
        { line: "notion: { parent: p1 }", expected: "{ parent: p1 }" },
        { line: "notion: { parent: p1, board: b1}", expected: "{ parent: p1, board: b1}" },
        { line: "notion: {}", expected: "{}" },
      ];
      for (const { line, expected } of rows) {
        const { value } = parseLine(line);
        assert.equal(value, expected, `${JSON.stringify(line)} ⇒ the verbatim string ${JSON.stringify(expected)}`);
        assert.equal(typeof value, "string", `${JSON.stringify(line)} parses to a string, not an object (no comma-split, no brace-strip)`);
      }
    },
  },
];
