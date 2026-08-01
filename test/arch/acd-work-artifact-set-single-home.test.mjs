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

// A DECLARATION (`export const X = {` / `const X = [`), never an import and never a
// re-export (`export { X } from "…"` / `export const Y = X`).
function declares(code, name) {
  const decl = new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?const\\s+${name}\\s*=\\s*(?:Object\\.freeze\\s*\\(\\s*)?[[{]`);
  return decl.test(code);
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
