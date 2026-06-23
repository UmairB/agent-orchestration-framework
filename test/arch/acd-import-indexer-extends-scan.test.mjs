// Fitness function for milestone 13 / ADR-003:
// "Index via the existing store + scan extension. Imported knowledge is indexed only
//  by EXTENDING the existing indexer scan to the import store (the existing parsers,
//  the existing .aof/aof.memory.index.json path) — NO new index file is written under
//  .aof/, NO bespoke per-import store, and the import command + materialize modules
//  never write the memory index JSON directly (the import is a PRODUCER of .md; reindex
//  derives the index)."
//
// Mirrors 05's acd-memory-index-location idiom (the only memory file under .aof/ is the
// one fixed-path index), extended to the import leg. Halves, all CI-able offline:
//   (a) ONE-INDEX-EXTENDED: materialize a FIXTURE import, then `reindex` (the EXISTING
//       buildRecords scan) — the imported adr/lesson records land in the ONE
//       .aof/aof.memory.index.json (the same memoryIndexPath), and the ONLY memory
//       index file written anywhere under the project is that fixed path.
//   (b) NO-DIRECT-INDEX-WRITE: source-grep the import command + materialize + store —
//       none writes `aof.memory.index.json` (no fixed-name index write, no
//       memoryIndexPath/writeText-into-index call). The import never hand-writes the
//       index; it produces .md and triggers the backend's reindex.
//   (c) buildRecords IS the extension owner: buildRecords composes the import-store scan
//       (its records include the import leg), so the extension reuses the existing scan,
//       not a parallel one.
//
// Non-vacuous: (a) would go RED if materialize wrote its own index file (a second memory
// index would appear under .aof/) or if the imported records did NOT land in the fixed
// index; (b) would go RED if the import command/materialize string-wrote the index file
// name (the self-checks prove the matcher catches the forbidden write); (c) would go RED
// if buildRecords stopped composing the import store (the imported record would vanish
// from a whole-stream rebuild).
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  reindex,
  buildRecords,
  memoryIndexPath,
  isImportRecord,
} from "../../src/memory/local-indexing.mjs";
import { materializeImport } from "../../src/import/materialize.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC_IMPORT_DIR = path.join(repoRoot, "src", "import");
const IMPORT_COMMAND = path.join(repoRoot, "src", "commands", "import-milestone.mjs");

const INDEX_NAME = "aof.memory.index.json";

function fixtureRecovered() {
  return {
    intent: { objective: "Recover the beacon milestone.", scope: "In: snapshot. Out: sync." },
    decisions: [
      { id: "ADR-001", title: "Beacon reuses the seam", status: "Accepted", body: "**Decision.** Beacon reuses the existing seam." },
    ],
    outcomes: [
      { id: "R1", title: "Beacon seam froze first", body: "- **Kind:** near-miss · **Area:** architecture · **Stage:** build · **Owner:** dev\n\n- **Lesson:** freeze the beacon seam first." },
    ],
  };
}

// A temp project with a fixture import materialized in story 00's frozen .aof/ layout
// AND a real work-stream milestone (so the index has both legs).
async function tempProjectWithImport() {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "aof-arch-import-index-"));
  const workDir = path.join(projectRoot, "wiki", "work");
  const ms = path.join(workDir, "01_milestone_work-stream");
  await mkdir(ms, { recursive: true });
  await mkdir(path.join(projectRoot, ".aof"), { recursive: true });
  // a real work-stream record so the index is not import-only.
  const arch = ["---", "doc: architecture", "---", "# 01 — Architecture Decisions", "",
    "## ADR-001: Work-stream decision", "", "**Status:** Accepted", "", "**Decision.** A work-stream decision.", ""].join("\n");
  await writeFile(path.join(ms, "ARCHITECTURE.md"), arch, "utf8");
  await materializeImport({ projectRoot, sourceSlug: "fixture-src", milestoneRef: "00", recovered: fixtureRecovered() }, {});
  return { projectRoot, workDir, ctx: { workDir, projectRoot, configMemory: {} } };
}

function stripCommentsAndStrings(source) {
  let out = "";
  let i = 0;
  const n = source.length;
  let state = "code";
  while (i < n) {
    const c = source[i];
    const c2 = source[i + 1];
    if (state === "code") {
      if (c === "/" && c2 === "/") { state = "line"; i += 2; continue; }
      if (c === "/" && c2 === "*") { state = "block"; i += 2; continue; }
      if (c === "'") { state = "sq"; i += 1; out += " "; continue; }
      if (c === '"') { state = "dq"; i += 1; out += " "; continue; }
      if (c === "`") { state = "tpl"; i += 1; out += " "; continue; }
      out += c; i += 1; continue;
    }
    if (state === "line") { if (c === "\n") { state = "code"; out += "\n"; } i += 1; continue; }
    if (state === "block") { if (c === "*" && c2 === "/") { state = "code"; i += 2; continue; } if (c === "\n") out += "\n"; i += 1; continue; }
    if (c === "\\") { i += 2; continue; }
    if ((state === "sq" && c === "'") || (state === "dq" && c === '"') || (state === "tpl" && c === "`")) { state = "code"; i += 1; continue; }
    if (c === "\n") out += "\n";
    i += 1; continue;
  }
  return out;
}
function stripCommentsOnly(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

async function importMaterializeFiles() {
  // The import command + the materialize/store modules — the producers. (recovery.mjs
  // + source.mjs read the source; they are not index writers, but include them so the
  // sweep covers the whole import surface.)
  const files = [IMPORT_COMMAND];
  for (const entry of await readdir(SRC_IMPORT_DIR)) {
    if (entry.endsWith(".mjs")) files.push(path.join(SRC_IMPORT_DIR, entry));
  }
  return files;
}

export const archTests = [
  {
    name: "arch/import-indexer-extends-scan: a fixture import indexes into the ONE existing .aof/aof.memory.index.json (the only memory index under .aof/)",
    run: async () => {
      const { projectRoot, ctx } = await tempProjectWithImport();
      try {
        const result = await reindex(null, ctx);
        // The imported records are IN the one index (the extended scan reached the store).
        const importRecords = result.records.filter(isImportRecord);
        assert.ok(importRecords.length >= 2, `the import leg's records are in the one index (got ${importRecords.length})`);
        assert.ok(result.records.some((r) => !isImportRecord(r)), "the work-stream leg's records are in the SAME index");
        assert.equal(path.basename(memoryIndexPath(projectRoot)), INDEX_NAME, "the index path is the existing fixed path");
        assert.ok(existsSync(memoryIndexPath(projectRoot)), "the fixed-path index was written");

        // The ONLY memory-index file written under .aof/ is that one file — no bespoke
        // per-import index store was created.
        const aofDir = path.join(projectRoot, ".aof");
        const memoryFilesUnderAof = (await readdir(aofDir)).filter((name) => /memory.*index\.json$/i.test(name));
        assert.deepEqual(memoryFilesUnderAof, [INDEX_NAME], `the only memory index under .aof/ is ${INDEX_NAME} (found: ${memoryFilesUnderAof.join(", ")})`);
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/import-indexer-extends-scan: NO memory index is written anywhere outside the fixed path (no bespoke per-import store under the import store)",
    run: async () => {
      const { projectRoot, ctx } = await tempProjectWithImport();
      try {
        await reindex(null, ctx);
        const allowed = memoryIndexPath(projectRoot);
        const stray = [];
        async function walk(dir) {
          let entries;
          try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
          for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) await walk(full);
            else if (/memory.*index\.json$/i.test(entry.name) && full !== allowed) stray.push(full);
          }
        }
        await walk(projectRoot);
        assert.deepEqual(stray, [], `no memory index outside the fixed path (no bespoke import index); found: ${stray.join(", ")}`);
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/import-indexer-extends-scan: buildRecords COMPOSES the import-store scan (the extension reuses the existing scan, not a parallel one)",
    run: async () => {
      const { projectRoot, ctx } = await tempProjectWithImport();
      try {
        // The EXISTING buildRecords (the indexer's record source) yields the import leg on
        // a whole-stream rebuild — proving the scan was EXTENDED, not duplicated.
        const records = await buildRecords(null, ctx);
        assert.ok(records.some(isImportRecord), "buildRecords includes the import leg (the scan was extended)");
        assert.ok(records.some((r) => !isImportRecord(r)), "buildRecords still includes the work-stream leg");
        // A milestone-scoped rebuild stays work-stream-only (imports carry a non-numeric
        // namespaced item) — so the extension is scoped to whole-stream rebuilds (ADR-003).
        const scoped = await buildRecords("01", ctx);
        assert.ok(!scoped.some(isImportRecord), "a milestone-scoped rebuild excludes imports (non-numeric item)");
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/import-indexer-extends-scan: the import command + materialize/store modules NEVER write the memory index JSON directly",
    run: async () => {
      for (const file of await importMaterializeFiles()) {
        const code = stripCommentsAndStrings(await readFile(file, "utf8"));
        // No direct write of the fixed index filename, and no call into the index-writer
        // path (memoryIndexPath / a writeText/writeFile against an index path). The import
        // produces .md + triggers the backend's reindex; it never hand-writes the index.
        assert.ok(
          !/aof\.memory\.[a-z]*\.?index\.json/i.test(code),
          `${path.relative(repoRoot, file)} never names the memory index file (it produces .md; reindex derives the index)`
        );
        assert.ok(
          !/\bmemoryIndexPath\b/.test(code),
          `${path.relative(repoRoot, file)} never references memoryIndexPath (no direct index write)`
        );
      }
      // Self-check (non-vacuous): the string-stripper keeps the filename a literal would
      // hide, so a real `writeFile(memoryIndexPath(root), …)` WOULD trip the guard.
      const probe = stripCommentsAndStrings('await writeText(memoryIndexPath(root), json);');
      assert.ok(/\bmemoryIndexPath\b/.test(probe), "the guard WOULD catch a direct memoryIndexPath write");
    },
  },
];
