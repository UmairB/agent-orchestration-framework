// Fitness function for milestone 13 / ADR-001:
// "Reuse the 05 doc shapes; NO new parser, NO new record shape. Every record an
//  import contributes is produced by the EXISTING parseArchitecture/parseRetrospective
//  over a materialized ARCHITECTURE.md/RETROSPECTIVE.md-shaped .md and matches the
//  frozen MemoryRecord (absent-type fields present-as-""); the recovered SPEC.md is
//  legible intent, NEVER an index record source; the import introduces no new parser."
//
// Mirrors 05's acd-memory-index-location MemoryRecord-shape idiom + the 10
// records-from-parsers idiom, applied to the import leg. Four halves, all CI-able
// offline (no command, no live source):
//   (a) ARTIFACT-SHAPE: materialize a FIXTURE import (materializeImport with a FIXED
//       `recovered`), then parse the materialized ARCHITECTURE.md / RETROSPECTIVE.md
//       with the EXISTING parsers and assert each record is EXACTLY the frozen
//       MemoryRecord field set, with the absent-type fields present-as-"".
//   (b) SPEC-NOT-INDEXED: the materialized SPEC.md, run through BOTH parsers, yields
//       ZERO records (it has no ## ADR-NNN / ## R<n> headings — it is legible intent).
//   (c) NO-NEW-PARSER: the import modules (src/import/*.mjs + src/commands/import-
//       milestone.mjs) IMPORT the parsers from nowhere AND define no `parseArchitecture`
//       / `parseRetrospective` of their own (no second parser); they are PRODUCERS of
//       `.md`, never parser owners (ADR-001).
//   (d) ONE-PARSER-OWNER: parseArchitecture/parseRetrospective are exported by exactly
//       ONE module on disk (src/memory/local-indexing.mjs) — there is no rival parser
//       module that emits a record shape.
//
// Non-vacuous: (a) would go RED if materialize emitted a heading shape the existing
// parsers do not read (zero records) or if a parser added/removed a MemoryRecord field;
// (b) would go RED if SPEC.md grew ## ADR-NNN/## R<n> headings (became a record source);
// (c) would go RED if any import module declared `function parseArchitecture(` /
// `parseRetrospective(` or imported them (a bespoke second parser); (d) would go RED if
// a second module on disk exported a parser of the same name.
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, mkdir, readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  parseArchitecture,
  parseRetrospective,
} from "../../src/memory/local-indexing.mjs";
import { MEMORY_RECORD_FIELDS } from "../../src/memory/local-retrieval.mjs";
import { materializeImport, ARCHITECTURE_FILE, RETROSPECTIVE_FILE, SPEC_FILE } from "../../src/import/materialize.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC_IMPORT_DIR = path.join(repoRoot, "src", "import");
const IMPORT_COMMAND = path.join(repoRoot, "src", "commands", "import-milestone.mjs");
const SRC_DIR = path.join(repoRoot, "src");

// The FIXED recovery input — a recovered intent (→ SPEC.md, never indexed), two
// decisions (→ two adr records), one outcome (→ one lesson record). Distinct topic
// ("beacon") so the records are self-identifying.
function fixtureRecovered() {
  return {
    intent: {
      objective: "Recover the beacon milestone faithfully from the source.",
      scope: "In: the import snapshot. Out: live sync.",
    },
    decisions: [
      { id: "ADR-001", title: "Beacon routing reuses the existing seam", status: "Accepted", body: "**Decision.** The beacon reuses the existing routing seam." },
      { id: "ADR-002", title: "Beacon is read-only on the source", status: "Accepted", body: "**Decision.** The beacon reads the source read-only." },
    ],
    outcomes: [
      { id: "R1", title: "Freezing the beacon seam first unblocked the siblings", body: "- **Kind:** near-miss · **Area:** architecture · **Stage:** build · **Owner:** dev\n\n- **Lesson:** freeze the beacon seam before fanning out." },
    ],
  };
}

async function materializeFixture() {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "aof-arch-import-shape-"));
  await mkdir(path.join(projectRoot, ".aof"), { recursive: true });
  const out = await materializeImport(
    { projectRoot, sourceSlug: "fixture-src", milestoneRef: "00", recovered: fixtureRecovered() },
    {}
  );
  return { projectRoot, dir: out.dir };
}

// Strip line + block comments so a documented mention of `parseArchitecture` in prose
// does not trip the no-new-parser guard — only a live declaration/specifier counts.
function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

async function importModuleFiles() {
  const files = [IMPORT_COMMAND];
  for (const entry of await readdir(SRC_IMPORT_DIR)) {
    if (entry.endsWith(".mjs")) files.push(path.join(SRC_IMPORT_DIR, entry));
  }
  return files;
}

// Recursively collect every src/**/*.mjs file (for the single-parser-owner sweep).
async function allSrcFiles(dir = SRC_DIR) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await allSrcFiles(full)));
    else if (entry.name.endsWith(".mjs")) out.push(full);
  }
  return out;
}

export const archTests = [
  {
    name: "arch/import-artifact-shape: the materialized ARCHITECTURE.md/RETROSPECTIVE.md parse with the EXISTING parsers into frozen MemoryRecords (absent-type fields present-as-\"\")",
    run: async () => {
      const { projectRoot, dir } = await materializeFixture();
      try {
        const meta = { item: "import:fixture-src/00", itemSlug: "import-00" };

        const archText = await readFile(path.join(dir, ARCHITECTURE_FILE), "utf8");
        const adrs = parseArchitecture(archText, { ...meta, workRelPath: `fixture-src/import-00/${ARCHITECTURE_FILE}` });
        assert.equal(adrs.length, 2, "the two recovered decisions parse into two adr records via the EXISTING parser");

        const retroText = await readFile(path.join(dir, RETROSPECTIVE_FILE), "utf8");
        const lessons = parseRetrospective(retroText, { ...meta, workRelPath: `fixture-src/import-00/${RETROSPECTIVE_FILE}` });
        assert.equal(lessons.length, 1, "the one recovered outcome parses into one lesson record via the EXISTING parser");

        for (const record of [...adrs, ...lessons]) {
          // EXACTLY the frozen MemoryRecord field set — no field added, none missing.
          assert.deepEqual(
            Object.keys(record).sort(),
            [...MEMORY_RECORD_FIELDS].sort(),
            `record ${record.id} carries EXACTLY the frozen MemoryRecord fields (no new record shape)`
          );
          for (const field of MEMORY_RECORD_FIELDS) {
            assert.equal(typeof record[field], "string", `record ${record.id} field "${field}" is a string`);
          }
        }

        // Absent-type fields present-as-"" (ADR-005, inherited): a lesson has status "";
        // an adr has stage/kind/owner "" and area hard-fixed "architecture".
        for (const lesson of lessons) {
          assert.equal(lesson.recordType, "lesson", `${lesson.id} is a lesson`);
          assert.equal(lesson.status, "", `lesson ${lesson.id} has the adr-only field status present-as-""`);
        }
        for (const adr of adrs) {
          assert.equal(adr.recordType, "adr", `${adr.id} is an adr`);
          assert.equal(adr.area, "architecture", `adr ${adr.id} area is "architecture"`);
          assert.equal(adr.stage, "", `adr ${adr.id} has the lesson-only field stage present-as-""`);
          assert.equal(adr.kind, "", `adr ${adr.id} has the lesson-only field kind present-as-""`);
          assert.equal(adr.owner, "", `adr ${adr.id} has the lesson-only field owner present-as-""`);
        }
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/import-artifact-shape: the materialized SPEC.md is NOT a record source — both parsers yield ZERO records over it (legible intent, never indexed)",
    run: async () => {
      const { projectRoot, dir } = await materializeFixture();
      try {
        const specText = await readFile(path.join(dir, SPEC_FILE), "utf8");
        const meta = { item: "import:fixture-src/00", itemSlug: "import-00", workRelPath: `fixture-src/import-00/${SPEC_FILE}` };
        // SPEC.md carries an Objective + Scope, NOT ## ADR-NNN / ## R<n> headings — so
        // running BOTH parsers over it yields no records. If SPEC.md ever grew a parser
        // heading (became a record source — the ADR-001 second-copy failure mode) this
        // would go RED.
        assert.equal(parseArchitecture(specText, meta).length, 0, "SPEC.md yields ZERO adr records (no ## ADR-NNN headings)");
        assert.equal(parseRetrospective(specText, meta).length, 0, "SPEC.md yields ZERO lesson records (no ## R<n> headings)");
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/import-artifact-shape: NO import module defines or imports a parser (parseArchitecture/parseRetrospective) — the import is a PRODUCER of .md, not a parser owner",
    run: async () => {
      const files = await importModuleFiles();
      assert.ok(files.length >= 4, `the import surface has its modules on disk (got ${files.length})`);
      for (const file of files) {
        const code = stripComments(await readFile(file, "utf8"));
        // No SELF-DECLARED parser: a `function parseArchitecture(`/`parseRetrospective(`
        // or `const parseArchitecture =` in an import module would be a bespoke SECOND
        // parser emitting a record shape (ADR-001 forbids it).
        assert.ok(
          !/\b(?:function|const|let|var)\s+parse(?:Architecture|Retrospective)\b/.test(code),
          `${path.relative(repoRoot, file)} declares no parseArchitecture/parseRetrospective (no bespoke second parser)`
        );
        // And it does NOT IMPORT the parsers either (it never needs to — it produces the
        // .md the indexer's existing parsers read; the indexer extension, NOT an import
        // module, owns the parser reuse).
        assert.ok(
          !/\bfrom\s+["'][^"']*\bparse(?:Architecture|Retrospective)\b/.test(code) &&
            !/\bimport\b[^;]*\bparse(?:Architecture|Retrospective)\b/.test(code),
          `${path.relative(repoRoot, file)} imports no parser (the import produces .md; the indexer parses it)`
        );
      }
    },
  },
  {
    name: "arch/import-artifact-shape: parseArchitecture/parseRetrospective are EXPORTED by exactly ONE module on disk (no rival record-shape parser)",
    run: async () => {
      const files = await allSrcFiles();
      const owners = { parseArchitecture: [], parseRetrospective: [] };
      const rel = (file) => path.relative(repoRoot, file).split(path.sep).join("/");
      for (const file of files) {
        const code = stripComments(await readFile(file, "utf8"));
        if (/\bexport\s+function\s+parseArchitecture\b/.test(code)) owners.parseArchitecture.push(rel(file));
        if (/\bexport\s+function\s+parseRetrospective\b/.test(code)) owners.parseRetrospective.push(rel(file));
      }
      // Exactly one owner each, and it is src/memory/local-indexing.mjs — so no second
      // module emits a record shape (ADR-001: the import reuses the ONE parser set).
      assert.deepEqual(owners.parseArchitecture, ["src/memory/local-indexing.mjs"], `parseArchitecture exported by exactly local-indexing.mjs (got: ${owners.parseArchitecture.join(", ")})`);
      assert.deepEqual(owners.parseRetrospective, ["src/memory/local-indexing.mjs"], `parseRetrospective exported by exactly local-indexing.mjs (got: ${owners.parseRetrospective.join(", ")})`);
    },
  },
];
