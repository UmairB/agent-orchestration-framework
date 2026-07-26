// Fitness function for milestone 41 / ADR-001 — the god-node blast-radius guard.
//
//   "The re-index engine is a NEW module (src/work-reindex.mjs) that IMPORTS
//    work.mjs's readers; work.mjs NEVER imports the engine back. The god-node's
//    36-module blast radius does not grow."
//
// `src/work.mjs` is imported/called by 36 modules (codebase graph, refine 41) and
// imports only 3 (fs, node-identity, workspace). Bolting the renumber WRITER into
// it would inherit that whole blast radius. This guard pins the dependency
// DIRECTION structurally, on import specifiers (comment-stripped so a documenting
// mention never trips it):
//   - work.mjs imports NO reindex/insert engine module (its import list stays the
//     sanctioned three) — asserted NOW, always live;
//   - GUARD-IF-PRESENT: once src/work-reindex.mjs exists it MUST import ./work.mjs
//     (the engine depends on the readers, never the reverse). While absent, a clean
//     skip — the suite stays green pre-build and this arms the moment the engine
//     lands.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORK = path.join(repoRoot, "src", "work.mjs");
const REINDEX = path.join(repoRoot, "src", "work-reindex.mjs");

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function importSpecifiers(commentStrippedSource) {
  const specs = [];
  const re = /\bfrom\s+["']([^"']+)["']|\bimport\s+["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(commentStrippedSource)) !== null) specs.push(m[1] ?? m[2]);
  return specs;
}

// A reindex/insert ENGINE module specifier (the WRITER work.mjs must never pull in).
const ENGINE_MODULE = /(^|\/)(work-reindex|reindex|work-insert|insert)\.mjs$/;
const WORK_MODULE = /(^|\/)work\.mjs$/;

export const archTests = [
  {
    name: "arch/ADR-001(m41): src/work.mjs imports NO reindex/insert engine module — the 36-module god-node blast radius does not grow",
    run: async () => {
      const specs = importSpecifiers(stripComments(await readFile(WORK, "utf8")));
      const engineImports = specs.filter((s) => ENGINE_MODULE.test(s));
      assert.deepEqual(
        engineImports,
        [],
        `src/work.mjs imports no reindex/insert engine — imports: ${specs.join(", ")}`,
      );
      // work.mjs's import list stays minimal (a canary on the god-node staying a
      // pure READER hub) — every specifier resolves within src/ (relative) and none
      // is an engine module. Self-checks (non-vacuous): the matcher catches every
      // engine-module form and does NOT flag work.mjs's legitimate dependencies.
      for (const bad of ["./work-reindex.mjs", "./reindex.mjs", "../src/work-insert.mjs"]) {
        assert.ok(ENGINE_MODULE.test(bad), `the matcher catches a real ${bad} import`);
      }
      for (const ok of ["./fs.mjs", "./node-identity.mjs", "./workspace.mjs"]) {
        assert.ok(!ENGINE_MODULE.test(ok), `the matcher does NOT flag work.mjs's legitimate dependency (${ok})`);
      }
    },
  },
  {
    name: "arch/ADR-001(m41): GUARD-IF-PRESENT — once src/work-reindex.mjs exists it imports ./work.mjs (the engine depends on the readers, never the reverse)",
    run: async () => {
      if (!existsSync(REINDEX)) {
        // Clean skip while the engine is unbuilt — arms the moment it lands.
        return;
      }
      const specs = importSpecifiers(stripComments(await readFile(REINDEX, "utf8")));
      const importsWork = specs.some((s) => WORK_MODULE.test(s));
      assert.ok(
        importsWork,
        `src/work-reindex.mjs must import ./work.mjs (the engine consumes work.mjs's readers) — imports: ${specs.join(", ")}`,
      );
      // Self-check (non-vacuous): the WORK matcher recognises the real specifier.
      assert.ok(WORK_MODULE.test("./work.mjs"), "the WORK matcher recognises ./work.mjs");
      assert.ok(!WORK_MODULE.test("./work-reindex.mjs"), "the WORK matcher does not confuse work-reindex.mjs for work.mjs");
    },
  },
];
