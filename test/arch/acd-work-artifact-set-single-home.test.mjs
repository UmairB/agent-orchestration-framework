// Fitness function: acd-work-artifact-set-single-home (milestone 43 / ADR-007) —
//
//   "The streamed/requestable artifact set becomes a bounded two-kind MANIFEST living in
//    ONE module; WORK_ITEM_DOC_FILES is DERIVED from it — never a second literal list —
//    so the streamed set and the requestable set can never drift."
//
// This invariant is not new; it is the one the existing constant's own comment already
// states (src/global-work-store.mjs:14-16, verbatim): "The record docs a board/CLI face
// may request by NAME (work:doc's input contract) and therefore exactly the doc bodies a
// worker streams for its active worktree — ONE home for the set … so the streamed set and
// the requestable set can never drift." ADR-007 WIDENS the set (tasks/*.feature,
// ARCHITECTURE.md, DESIGN.md, RESEARCH.md, STATE.md) and MOVES it to a pure-leaf module
// (src/work-artifacts.mjs, 0 imports) so its three consumers need not travel through
// global-work-store.mjs's 6-module import closure to read a constant table. The widening
// and the move are exactly the two moments a second literal list gets written by
// accident. This guard makes that a CI failure instead of a drift nobody notices until a
// face asks for a name the worker never streamed.
//
// Scope note (deliberate): the guard is keyed on the named CONSTANT, not on the record-doc
// FILENAMES. Several modules legitimately list record-doc names for unrelated purposes —
// work-doctor.mjs's CONVENTION_DOCS, import/recovery.mjs's RECORD_DOC_NAMES,
// import/materialize.mjs's RETROSPECTIVE_FILE. Those are different sets answering
// different questions; flagging them would be a false positive that teaches people to
// ignore this test.
//
// Proofs:
//  1. GREEN — the artifact-set constant is DECLARED in exactly one module in src/; every
//     other mention is an import or a re-export.
//  2. GREEN — the declaring module actually declares the four record docs (non-vacuous:
//     the guard is watching a real set, not an empty name).
//  Self-check (m03 non-vacuous): a planted second declaration trips the detector, and an
//  import / a re-export does not.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = path.join(repoRoot, "src");

// The set's names, before and after ADR-007's widening — either is the one home.
const SET_NAMES = ["WORK_ITEM_DOC_FILES", "WORK_ITEM_ARTIFACTS"];

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// A LITERAL DECLARATION (`export const X = {` / `const X = [`), never an import and
// never a re-export (`export { X } from "…"` / `export const Y = X`). NOTE what this
// deliberately does NOT match: a DERIVED declaration (`= Object.freeze(Object.fromEntries(`),
// because "is there a second literal list" is precisely the question it answers.
// Whether the derived view is genuinely derived is a different question, asked by
// `declarationInitializer` below — ADR-013/C9, after this guard was measured blind to
// a planted stale literal declared beside the manifest in the SAME module.
function declares(code, name) {
  const decl = new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?const\\s+${name}\\s*=\\s*(?:Object\\.freeze\\s*\\(\\s*)?[[{]`);
  return decl.test(code);
}

// The text of a `const X = …` initializer, up to the next top-level statement — enough
// to ask what the value is BUILT FROM, which is the whole of ADR-007's "one definition,
// one derived compatibility view — never two literal lists".
function declarationInitializer(code, name) {
  const match = new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?const\\s+${name}\\s*=\\s*`).exec(code);
  if (match == null) return null;
  const rest = code.slice(match.index + match[0].length);
  const end = rest.search(/\n(?:export|const|function|async|class)\b/);
  return end < 0 ? rest : rest.slice(0, end);
}

// DERIVED, not literal: the initializer must NAME the manifest and must not open with a
// literal `[`/`{`. This is the clause a stale hand-maintained copy trips.
function derivationProblems(initializer) {
  const problems = [];
  if (initializer == null) return ["WORK_ITEM_DOC_FILES is not declared in the manifest module at all"];
  if (!/\bWORK_ITEM_ARTIFACTS\b/.test(initializer)) {
    problems.push("WORK_ITEM_DOC_FILES' initializer does not reference WORK_ITEM_ARTIFACTS — it is not derived from the manifest");
  }
  if (/^\s*(?:Object\.freeze\s*\(\s*)?[[{]/.test(initializer)) {
    problems.push("WORK_ITEM_DOC_FILES is an object/array LITERAL — ADR-007 forbids a second literal list, however faithful it looks today");
  }
  return problems;
}

async function mjsFilesUnder(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await mjsFilesUnder(full)));
    else if (entry.name.endsWith(".mjs")) out.push(full);
  }
  return out;
}

export const archTests = [
  {
    name: "arch/43 ADR-007 (acd-work-artifact-set-single-home): the artifact-set constant is DECLARED in exactly ONE module in src/ — the streamed set and the requestable set cannot drift",
    run: async () => {
      const declarers = new Map();
      for (const file of await mjsFilesUnder(SRC)) {
        const code = stripComments(await readFile(file, "utf8"));
        for (const name of SET_NAMES) {
          if (declares(code, name)) {
            const list = declarers.get(name) ?? [];
            list.push(path.relative(repoRoot, file));
            declarers.set(name, list);
          }
        }
      }
      const declared = [...declarers.entries()];
      assert.ok(declared.length > 0, "the artifact set is declared somewhere (non-vacuous)");
      const problems = declared
        .filter(([, files]) => files.length !== 1)
        .map(([name, files]) => `${name} declared in ${files.length} modules: ${files.join(", ")}`);
      assert.deepEqual(problems, [], `artifact-set drift: ${JSON.stringify(problems)}`);

      // …and if BOTH names exist, they must be in the same module (the derived
      // compatibility view lives beside its source, never as a second literal list).
      if (declarers.size === 2) {
        const [first, second] = [...declarers.values()];
        assert.deepEqual(
          first,
          second,
          "WORK_ITEM_DOC_FILES must be DERIVED from WORK_ITEM_ARTIFACTS in the same module (ADR-007), never a second literal list",
        );
      }
    },
  },
  {
    name: "arch/43 ADR-007 (acd-work-artifact-set-single-home): the declaring module really carries the record-doc set (the guard watches a real set, not an empty name)",
    run: async () => {
      let carrier = null;
      for (const file of await mjsFilesUnder(SRC)) {
        const code = stripComments(await readFile(file, "utf8"));
        if (SET_NAMES.some((name) => declares(code, name))) {
          carrier = code;
          break;
        }
      }
      assert.ok(carrier != null, "found the declaring module");
      for (const doc of ["SPEC.md", "STORY.md", "VERIFICATION.md", "RETROSPECTIVE.md"]) {
        assert.ok(carrier.includes(doc), `the artifact set still names ${doc}`);
      }
    },
  },
  {
    // ADR-013/C9 — THE CLAUSE THIS GUARD WAS MISSING. Measured by QA at 43/03's review:
    // a stale literal `WORK_ITEM_DOC_FILES = { SPEC, STORY, VERIFICATION, RETROSPECTIVE }`
    // planted in the SAME module as the manifest passed the behavioural suite AND every
    // proof above — because "declared in exactly one module" is satisfied by two
    // constants sitting side by side, and because the real derived form
    // (`Object.freeze(Object.fromEntries(`) is not even matched by `declares()`, so the
    // same-module branch never ran. ADR-007's invariant is not "one file"; it is
    // "ONE DEFINITION, one DERIVED view — never two literal lists". That is a property
    // of the initializer, and this is the clause that reads it.
    name: "arch/43 ADR-007 + ADR-013 (acd-work-artifact-set-single-home): WORK_ITEM_DOC_FILES is genuinely DERIVED — its initializer names WORK_ITEM_ARTIFACTS and is not a literal",
    run: async () => {
      let carrier = null;
      let carrierPath = null;
      for (const file of await mjsFilesUnder(SRC)) {
        const code = stripComments(await readFile(file, "utf8"));
        if (declares(code, "WORK_ITEM_ARTIFACTS")) {
          carrier = code;
          carrierPath = path.relative(repoRoot, file);
          break;
        }
      }
      assert.ok(carrier != null, "found the module declaring the manifest");
      const problems = derivationProblems(declarationInitializer(carrier, "WORK_ITEM_DOC_FILES"));
      assert.deepEqual(problems, [], `${carrierPath}: ${JSON.stringify(problems)}`);

      // Non-vacuous, and the two halves are asserted separately so a future refactor
      // cannot satisfy this by deleting the compatibility view instead of deriving it.
      const initializer = declarationInitializer(carrier, "WORK_ITEM_DOC_FILES");
      assert.match(initializer, /WORK_ITEM_ARTIFACTS/, "the real derived view really does read the manifest");
      const { WORK_ITEM_ARTIFACTS, WORK_ITEM_DOC_FILES } = await import("../../src/work-artifacts.mjs");
      assert.deepEqual(
        Object.entries(WORK_ITEM_DOC_FILES),
        WORK_ITEM_ARTIFACTS.filter((entry) => entry.file != null).map((entry) => [entry.name, entry.file]),
        "…and the derived value equals the manifest's file-kind entries, in manifest order (a stale copy would diverge here)",
      );
    },
  },
  {
    name: "arch/43 ADR-007 + ADR-013 (acd-work-artifact-set-single-home): self-check — the derivation detector fires on QA's planted stale literal and spares the real derived form",
    run: async () => {
      const real = "export const WORK_ITEM_DOC_FILES = Object.freeze(Object.fromEntries(\n  WORK_ITEM_ARTIFACTS.filter((e) => e.file != null).map((e) => [e.name, e.file]),\n));\n";
      assert.deepEqual(derivationProblems(declarationInitializer(real, "WORK_ITEM_DOC_FILES")), [], "the real derived form passes");

      // QA's plant, verbatim in shape: a stale hand-maintained copy of the four names,
      // declared beside the manifest in the same module.
      const planted = 'export const WORK_ITEM_DOC_FILES = Object.freeze({\n  SPEC: "SPEC.md",\n  STORY: "STORY.md",\n  VERIFICATION: "VERIFICATION.md",\n  RETROSPECTIVE: "RETROSPECTIVE.md",\n});\n';
      assert.ok(derivationProblems(declarationInitializer(planted, "WORK_ITEM_DOC_FILES")).length >= 2, "a planted stale literal trips BOTH clauses (not derived, and a literal)");

      const bareLiteral = 'const WORK_ITEM_DOC_FILES = { SPEC: "SPEC.md" };\n';
      assert.ok(derivationProblems(declarationInitializer(bareLiteral, "WORK_ITEM_DOC_FILES")).length >= 2, "an unfrozen literal trips it too");

      assert.deepEqual(
        derivationProblems(declarationInitializer('import { x } from "./y.mjs";\n', "WORK_ITEM_DOC_FILES")),
        ["WORK_ITEM_DOC_FILES is not declared in the manifest module at all"],
        "a module with no declaration is reported as such, never silently passed",
      );
    },
  },
  {
    name: "arch/43 ADR-007 (acd-work-artifact-set-single-home): self-check — a planted second declaration trips the detector; an import and a re-export do not",
    run: async () => {
      assert.ok(declares("export const WORK_ITEM_DOC_FILES = {\n  SPEC: \"SPEC.md\",\n};", "WORK_ITEM_DOC_FILES"), "the detector catches a real object declaration");
      assert.ok(declares("const WORK_ITEM_ARTIFACTS = [\n  { name: \"SPEC\", file: \"SPEC.md\" },\n];", "WORK_ITEM_ARTIFACTS"), "the detector catches an array declaration");
      assert.ok(declares("export const WORK_ITEM_ARTIFACTS = Object.freeze([{ name: \"SPEC\" }]);", "WORK_ITEM_ARTIFACTS"), "the detector catches a frozen declaration");
      assert.ok(
        !declares('import { WORK_ITEM_DOC_FILES } from "../global-work-store.mjs";', "WORK_ITEM_DOC_FILES"),
        "the detector does NOT flag an import (commands/doc.mjs's legitimate consumption)",
      );
      assert.ok(
        !declares('export { WORK_ITEM_DOC_FILES } from "./work-artifacts.mjs";', "WORK_ITEM_DOC_FILES"),
        "the detector does NOT flag a re-export (the ADR-007 compatibility view)",
      );
      assert.ok(
        !declares("const DOC_FILES = WORK_ITEM_DOC_FILES;", "WORK_ITEM_DOC_FILES"),
        "the detector does NOT flag an alias binding (commands/doc.mjs:27)",
      );
    },
  },
];
