// Traceability wiring for milestone 13 / story 02 — "Import reaches memory": the
// EXTENDED buildRecords scan (the import store as a SECOND scan root) + the import
// command's reindex trigger (ADR-003/001/005). The LOAD-BEARING win: imported
// precedent recall-able through the UNCHANGED `aof work memory` verbs.
//
// One test object per @executable scenario across the three task features
// (Scenario-Outline rows folded; each name traces to feature + scenario). The
// @manual graphify-backend row of 02_import-triggers-reindex.feature is DEFERRED —
// it needs the LIVE graphify binary, which cannot run in CI.
//
//   00_indexer-scans-import-store.feature — reindex scans the .aof/ import store IN
//        ADDITION to the work stream, runs the EXISTING parseArchitecture/
//        parseRetrospective UNTOUCHED, and the imported adr/lesson records land in
//        the one index as frozen MemoryRecords whose source:line resolves WITHIN the
//        import store; imported records sit alongside work-stream records; the
//        artifact→records matrix (ARCHITECTURE→adr, RETROSPECTIVE→lesson, SPEC→none).
//   01_imported-precedent-is-recallable.feature — after import+reindex, recall
//        surfaces imported precedent; RecallResult {query,scope,records,text}; the
//        imported record carries the full MemoryRecord fields + a resolving
//        source:line within the import store; --area architecture INCLUDES imported
//        adr records; --item 01 (a work-stream number) EXCLUDES imports; an off-topic
//        query does not recall it.
//   02_import-triggers-reindex.feature (@executable rows) — a real `aof import
//        milestone` leaves imported precedent immediately recall-able (no manual
//        reindex); a --dry-run indexes nothing; a re-import over the same source
//        yields the SAME recall-able set with NO growth.
//
// All @executable scenarios run OFFLINE against a FIXTURE import store in story 00's
// frozen .aof/ layout (materialized via materializeImport with a FIXED `recovered`)
// + a fixture work stream (incl. a REAL milestone 01, so the --item exclusion is a
// POSITIVE exclusion). The local backend (memory.backend = "local") is driven so
// reindex/recall actually run. Feature 02 drives the CLI (spawnSync) like story 00.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkspace } from "../src/work.mjs";
import { runMemory, resolveConfiguredBackend } from "../src/work-memory.mjs";
import {
  reindex,
  buildRecords,
  memoryIndexPath,
  resolveRecordSourcePath,
  isImportRecord,
  importItem,
} from "../src/memory/local-indexing.mjs";
import { MEMORY_RECORD_FIELDS } from "../src/memory/local-retrieval.mjs";
import { materializeImport } from "../src/import/materialize.mjs";
import { importStoreRoot } from "../src/import/store.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "bin", "aof.mjs");

// memory.backend = "local" so reindex/recall actually run the local backend.
const CONFIG = { name: "fixture", work: { dir: "./wiki/work" }, memory: { backend: "local" } };

// The FIXED recovery input (the features' fixture import). Carries decisions (→ adr
// records) AND outcomes (→ lesson records) AND a recovered intent (→ SPEC.md, never
// a record source) so the artifact→records matrix is fully exercised. The decision
// titles carry a distinctive topic ("teleport beacon") so a recall query targets the
// imported milestone WITHOUT colliding with the generic work-stream corpus.
function fixtureRecovered() {
  return {
    intent: {
      objective: "Recover the teleport-beacon milestone faithfully.",
      scope: "In: the import snapshot. Out: live sync.",
    },
    decisions: [
      {
        id: "ADR-001",
        title: "Teleport beacon routing through the existing seam",
        status: "Accepted",
        body: "**Decision.** The teleport beacon reuses the existing routing seam so no new path is added.",
      },
      {
        id: "ADR-002",
        title: "Teleport beacon read-only on the source",
        status: "Accepted",
        body: "**Decision.** The teleport beacon reads the source read-only and never writes back.",
      },
    ],
    outcomes: [
      {
        id: "R1",
        title: "Freezing the teleport-beacon seam first unblocked the siblings",
        body: "- **Kind:** near-miss · **Area:** architecture · **Stage:** build · **Owner:** dev\n\n- **Lesson:** freeze the teleport-beacon seam before fanning out.",
      },
    ],
  };
}

// A minimal project root with a local backend config, a fixture work stream (incl. a
// REAL milestone "01" with its own ARCHITECTURE.md + RETROSPECTIVE.md so the --item
// exclusion is positive), and a fixture import store materialized in the frozen
// .aof/ layout. Returns { repo, workDir, ctx, sourceSlug, milestoneRef, importDir }.
async function makeFixture({ sourceSlug = "demo-src", milestoneRef = "00", withImport = true } = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-import-mem-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  await mkdir(workDir, { recursive: true });
  await writeFile(
    path.join(repo, ".aof", "aof.config.json"),
    `${JSON.stringify(CONFIG, null, 2)}\n`,
    "utf8"
  );

  // A REAL work-stream milestone "01" carrying its own knowledge artifacts. Its ADR
  // / lesson use a DISTINCT topic ("wormhole") from the import ("teleport beacon") so
  // recall queries target one leg or the other unambiguously.
  const ms01 = path.join(workDir, "01_milestone_wormhole-stream");
  await mkdir(ms01, { recursive: true });
  // Several work-stream records on the "wormhole" theme so an OFF-TOPIC (wormhole)
  // query fills the default recall limit with genuine work-stream matches — the
  // zero-content-score imports then rank below the cut (the matrix's "a query
  // matching nothing imported does not recall it" row).
  await writeFile(
    path.join(ms01, "ARCHITECTURE.md"),
    [
      "---", "doc: architecture", "---",
      "# 01 Wormhole stream — Architecture Decisions", "",
      "## ADR-001: Wormhole stream uses the work-stream lane", "",
      "**Status:** Accepted", "",
      "**Decision.** The wormhole stream stays on the work-stream lane, distinct from imports.", "",
      "## ADR-002: Wormhole stream gating sequences the wormhole milestones", "",
      "**Status:** Accepted", "",
      "**Decision.** Wormhole gating sequences wormhole milestones along the wormhole lane.", "",
      "## ADR-003: Wormhole stream isolation keeps wormhole state per wormhole run", "",
      "**Status:** Accepted", "",
      "**Decision.** Wormhole isolation keeps wormhole state per wormhole run on the wormhole lane.", "",
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.join(ms01, "RETROSPECTIVE.md"),
    [
      "---", "doc: retrospective", "---",
      "# 01 Wormhole stream — Retrospective", "",
      "## R1 — Wormhole stream lessons stay in the work stream", "",
      "- **Kind:** insight · **Area:** process · **Stage:** verify · **Owner:** dev", "",
      "- **Lesson:** the wormhole stream lesson lives in the wormhole work stream lane.", "",
      "## R2 — Wormhole gating ordered the wormhole milestones cleanly", "",
      "- **Kind:** insight · **Area:** process · **Stage:** verify · **Owner:** dev", "",
      "- **Lesson:** the wormhole gating ordered the wormhole stream milestones cleanly along the wormhole lane.", "",
      "## R3 — Wormhole isolation kept wormhole runs from leaking wormhole state", "",
      "- **Kind:** insight · **Area:** process · **Stage:** verify · **Owner:** dev", "",
      "- **Lesson:** wormhole isolation kept each wormhole run's wormhole state on the wormhole lane.", "",
    ].join("\n"),
    "utf8"
  );

  let importDir = null;
  if (withImport) {
    const out = await materializeImport({
      projectRoot: repo,
      sourceSlug,
      milestoneRef,
      recovered: fixtureRecovered(),
    });
    importDir = out.dir;
  }

  const ctx = { workDir, projectRoot: repo, configMemory: CONFIG.memory };
  return { repo, workDir, ctx, sourceSlug, milestoneRef, importDir };
}

// Rebuild the index over both legs and return the parsed index document.
async function reindexAndRead(ctx) {
  await reindex(null, ctx);
  return JSON.parse(await readFile(memoryIndexPath(ctx.projectRoot), "utf8"));
}

// Resolve a record's source:line (leg-aware) and assert the cited line is live text.
async function assertSourceResolves(record, ctx, label) {
  const { absPath, line, path: rel } = resolveRecordSourcePath(record, ctx);
  assert.ok(existsSync(absPath), `[${label}] the source path "${rel}" exists (resolved to ${absPath})`);
  assert.ok(Number.isInteger(line) && line >= 1, `[${label}] the source line is a 1-based integer (got ${line})`);
  const body = await readFile(absPath, "utf8");
  const lines = body.split(/\r?\n/);
  assert.ok(line <= lines.length, `[${label}] the source line ${line} is within the file (${lines.length} lines)`);
  assert.ok(lines[line - 1].trim().length > 0, `[${label}] the source line ${line} resolves to live (non-blank) text`);
}

// Drive `aof work memory recall …` in-process through the real registry (mirrors
// workMemoryCommand), reusing one ctx (so a prior reindex's store is read back).
async function recallReal(ctx, argv) {
  const outcome = await runMemory(["recall", ...argv], {
    config: CONFIG,
    resolveBackend: (cfg) => resolveConfiguredBackend(cfg),
    ctx,
    log: () => {},
  });
  return outcome.result;
}

// A recalled record is "from the import store" iff its item is the namespaced import
// ref (the leg predicate). Equivalent to its source resolving under the import root.
const fromImportStore = (record) => isImportRecord(record);

// --- CLI driver (feature 02) -----------------------------------------------------

function runCli(root, args, env = {}) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1", ...env },
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

// A local aof-structured SOURCE fixture repo with a recoverable milestone, read in
// place via the read-only seam (the offline @executable lane). The recovered intent
// + ADRs carry the "teleport beacon" topic so a recall targets the import.
async function makeSourceRepo(milestoneRef = "00") {
  const src = await mkdtemp(path.join(os.tmpdir(), "aof-import-mem-src-"));
  const dir = path.join(src, "wiki", "work", `${milestoneRef}_milestone_teleport-beacon`);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "SPEC.md"),
    `# ${milestoneRef} Teleport beacon\n\n## Objective\n\nDeliver the teleport beacon.\n\n## Scope\n\nIn: the beacon. Out: live sync.\n`,
    "utf8"
  );
  await writeFile(
    path.join(dir, "ARCHITECTURE.md"),
    [
      "---", "doc: architecture", "---",
      `# ${milestoneRef} Teleport beacon — Architecture Decisions`, "",
      "## ADR-001: Teleport beacon routing through the existing seam", "",
      "**Status:** Accepted", "",
      "**Decision.** The teleport beacon reuses the existing routing seam.", "",
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.join(dir, "RETROSPECTIVE.md"),
    [
      "---", "doc: retrospective", "---",
      `# ${milestoneRef} Teleport beacon — Retrospective`, "",
      "## R1 — Teleport beacon seam frozen first", "",
      "- **Kind:** near-miss · **Area:** architecture · **Stage:** build · **Owner:** dev", "",
      "- **Lesson:** freeze the teleport-beacon seam before fanning out.", "",
    ].join("\n"),
    "utf8"
  );
  return src;
}

// A minimal project root (config + empty work stream) for the CLI-driven feature 02.
async function makeCliRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-import-mem-cli-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  await mkdir(workDir, { recursive: true });
  await writeFile(
    path.join(repo, ".aof", "aof.config.json"),
    `${JSON.stringify(CONFIG, null, 2)}\n`,
    "utf8"
  );
  return { repo, workDir };
}

// Recall through the CLI and return the parsed records array (--json). Run from the
// project root so loadWorkspace resolves the same config + store.
function cliRecall(repo, query, extra = []) {
  const r = runCli(repo, ["work", "memory", "recall", query, "--json", ...extra]);
  assert.equal(r.status, 0, `recall exits 0 (stderr: ${r.stderr.slice(0, 200)})`);
  return JSON.parse(r.stdout || "[]");
}

const TELEPORT_QUERY = "teleport beacon routing seam";

export const importIntoMemoryTests = [
  // ═════════════ 00_indexer-scans-import-store.feature ════════════════════════
  {
    name: "import-mem/00 reindex scans the import store in addition to the work stream (imported adr + lesson records land)",
    async run() {
      const { ctx, repo } = await makeFixture();
      try {
        const index = await reindexAndRead(ctx);
        const imported = index.records.filter(fromImportStore);
        assert.ok(
          imported.some((r) => r.recordType === "adr"),
          "the rebuilt index contains the imported milestone's adr records"
        );
        assert.ok(
          imported.some((r) => r.recordType === "lesson"),
          "the rebuilt index contains the imported milestone's lesson records"
        );
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "import-mem/00 each imported record is a frozen MemoryRecord whose source resolves within the import store",
    async run() {
      const { ctx, repo } = await makeFixture();
      try {
        const index = await reindexAndRead(ctx);
        const imported = index.records.filter(fromImportStore);
        assert.ok(imported.length > 0, "at least one imported record is indexed");
        for (const record of imported) {
          // Frozen MemoryRecord: exactly the frozen field set, no extra/missing keys.
          assert.deepEqual(
            Object.keys(record).sort(),
            [...MEMORY_RECORD_FIELDS].sort(),
            "the imported record carries exactly the frozen MemoryRecord fields"
          );
          // The namespaced, non-numeric item (the Three-Amigos identifier).
          assert.equal(
            record.item,
            importItem("demo-src", "00"),
            "the imported record's item is import:<sourceSlug>/<milestoneRef>"
          );
          // Its source:line resolves to live text WITHIN the import store.
          await assertSourceResolves(record, ctx, `imported ${record.recordType} ${record.id}`);
          const { absPath } = resolveRecordSourcePath(record, ctx);
          const rel = path.relative(importStoreRoot(repo), absPath);
          assert.ok(
            !rel.startsWith(".."),
            `the imported record's source resolves UNDER the import store root (rel: ${rel})`
          );
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "import-mem/00 imported records sit alongside work-stream records in the one index",
    async run() {
      const { ctx, repo } = await makeFixture();
      try {
        const index = await reindexAndRead(ctx);
        const work = index.records.filter((r) => !fromImportStore(r));
        const imported = index.records.filter(fromImportStore);
        assert.ok(work.length >= 1, "the index contains at least one record sourced from the work stream");
        assert.ok(imported.length >= 1, "the index contains at least one record sourced from the import store");
        // Same one index (one store path) holds both legs.
        assert.equal(work.length + imported.length, index.records.length, "every record is one leg or the other");
        // Each work-stream record's source resolves under the work stream (leg-aware).
        for (const record of work) {
          await assertSourceResolves(record, ctx, `work ${record.recordType} ${record.id}`);
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "import-mem/00 the imported records are produced by the same parsers as the work stream (## ADR-NNN→adr, ## R<n>→lesson)",
    async run() {
      const { ctx, repo } = await makeFixture();
      try {
        const index = await reindexAndRead(ctx);
        const imported = index.records.filter(fromImportStore);
        // The fixture's ARCHITECTURE.md "## ADR-NNN" blocks → recordType "adr".
        const adrs = imported.filter((r) => r.recordType === "adr");
        assert.ok(adrs.length >= 1, "an imported '## ADR-NNN' block becomes a record of recordType 'adr'");
        assert.ok(adrs.every((r) => /^ADR-\d+$/.test(r.id)), "each imported adr id is recovered from the heading");
        assert.ok(adrs.every((r) => r.area === "architecture"), "each imported adr carries area 'architecture' (the parser's invariant)");
        // The fixture's RETROSPECTIVE.md "## R<n>" entries → recordType "lesson".
        const lessons = imported.filter((r) => r.recordType === "lesson");
        assert.ok(lessons.length >= 1, "an imported '## R<n>' entry becomes a record of recordType 'lesson'");
        assert.ok(lessons.every((r) => /^R\d+$/.test(r.id)), "each imported lesson id is recovered from the heading");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "import-mem/00 an import-store artifact yields the records its shape produces, or none (Scenario Outline, folded)",
    async run() {
      const { ctx, repo, importDir } = await makeFixture();
      try {
        const index = await reindexAndRead(ctx);
        const imported = index.records.filter(fromImportStore);

        // Row: ARCHITECTURE.md "## ADR-NNN" blocks → adr.
        const fromArch = imported.filter((r) => /\/ARCHITECTURE\.md:/.test(r.source) || /ARCHITECTURE\.md:/.test(r.source));
        assert.ok(fromArch.length >= 1, "ARCHITECTURE.md yields adr records");
        assert.ok(fromArch.every((r) => r.recordType === "adr"), "every record derived from ARCHITECTURE.md is an adr");

        // Row: RETROSPECTIVE.md "## R<n>" entries → lesson.
        const fromRetro = imported.filter((r) => /RETROSPECTIVE\.md:/.test(r.source));
        assert.ok(fromRetro.length >= 1, "RETROSPECTIVE.md yields lesson records");
        assert.ok(fromRetro.every((r) => r.recordType === "lesson"), "every record derived from RETROSPECTIVE.md is a lesson");

        // Row: SPEC.md present → NO records (legible intent, never a record source).
        assert.ok(existsSync(path.join(importDir, "SPEC.md")), "the import store holds a SPEC.md");
        const fromSpec = imported.filter((r) => /SPEC\.md:/.test(r.source));
        assert.equal(fromSpec.length, 0, "SPEC.md yields NO records (it is legible recovered intent, ADR-001)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ═════════════ 01_imported-precedent-is-recallable.feature ══════════════════
  {
    name: "import-mem/01 recall returns the imported milestone's precedent among the results",
    async run() {
      const { ctx, repo } = await makeFixture();
      try {
        await reindex(null, ctx);
        const result = await recallReal(ctx, [TELEPORT_QUERY]);
        assert.ok(Array.isArray(result.records), "recall returns a records array");
        assert.ok(
          result.records.some(fromImportStore),
          "the recalled records include a record sourced from the import store"
        );
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "import-mem/01 a recalled imported record carries its source:line and the same RecallResult shape",
    async run() {
      const { ctx, repo } = await makeFixture();
      try {
        await reindex(null, ctx);
        const result = await recallReal(ctx, [TELEPORT_QUERY]);
        // RecallResult top-level keys.
        assert.deepEqual(
          Object.keys(result).sort(),
          ["query", "records", "scope", "text"],
          "the RecallResult has the top-level keys query, scope, records, text"
        );
        const imported = result.records.find(fromImportStore);
        assert.ok(imported, "an imported record is among the recalled records");
        // The imported record carries the full MemoryRecord field set (recall adds `score`).
        for (const field of MEMORY_RECORD_FIELDS) {
          assert.ok(field in imported, `the recalled imported record carries the MemoryRecord field "${field}"`);
        }
        // Its source:line resolves to live text within the import store.
        await assertSourceResolves(imported, ctx, `recalled ${imported.recordType} ${imported.id}`);
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "import-mem/01 an --area architecture filter includes imported adr records",
    async run() {
      const { ctx, repo } = await makeFixture();
      try {
        await reindex(null, ctx);
        const result = await recallReal(ctx, [TELEPORT_QUERY, "--area", "architecture"]);
        assert.ok(
          result.records.some((r) => fromImportStore(r) && r.recordType === "adr"),
          "the recalled records include the imported 'adr' record"
        );
        assert.ok(
          result.records.every((r) => r.area === "architecture"),
          "every recalled record carries area 'architecture'"
        );
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "import-mem/01 an --item 01 filter naming a work-stream milestone excludes imported records (positive exclusion)",
    async run() {
      const { ctx, repo } = await makeFixture();
      try {
        await reindex(null, ctx);
        const result = await recallReal(ctx, [TELEPORT_QUERY, "--item", "01"]);
        // Positive exclusion: the work stream HAS a real milestone 01, so --item 01
        // is a non-vacuous filter — and no imported record is among the results.
        assert.ok(
          !result.records.some(fromImportStore),
          "no recalled record is sourced from the import store under --item 01"
        );
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "import-mem/01 an agent recall at a decision point surfaces imported precedent alongside work-stream lessons",
    async run() {
      const { ctx, repo } = await makeFixture();
      try {
        await reindex(null, ctx);
        // A decision-point query matching BOTH legs ("seam" appears in the import's
        // ADR and the work-stream's lessons reference the seam boundary).
        const result = await recallReal(ctx, ["seam routing stream import work", "--limit", "10"]);
        assert.ok(result.records.some(fromImportStore), "the recalled records include a record sourced from the import store");
        assert.ok(result.records.some((r) => !fromImportStore(r)), "the recalled records include a record sourced from the work stream");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "import-mem/01 a query and scope decide whether the imported record is recalled (Scenario Outline, folded)",
    async run() {
      const { ctx, repo } = await makeFixture();
      try {
        await reindex(null, ctx);

        // Row: <topic>, (none) → recalled yes.
        let result = await recallReal(ctx, [TELEPORT_QUERY, "--limit", "10"]);
        assert.ok(result.records.some(fromImportStore), "an unscoped matching query recalls the imported record");

        // Row: <topic>, --area architecture → recalled yes.
        result = await recallReal(ctx, [TELEPORT_QUERY, "--area", "architecture", "--limit", "10"]);
        assert.ok(result.records.some(fromImportStore), "a content-scoped (--area architecture) matching query recalls the imported adr record");

        // Row: <topic>, --item 01 → recalled no (work-stream item filter excludes imports).
        result = await recallReal(ctx, [TELEPORT_QUERY, "--item", "01", "--limit", "10"]);
        assert.ok(!result.records.some(fromImportStore), "an --item 01 filter excludes the imported record");

        // Row: <off-topic work-stream term>, (none) → recalled no. Recall is a ranked
        // top-N retriever, NOT thresholded — TYPE_BOOST_LESSON gives ANY lesson a
        // non-zero score, so an off-topic exclusion must be demonstrated on a record
        // that scores a TRUE 0, not on the top-N cut. The import ADR records carry
        // area "architecture" and score 0.0 on this query (no architecture term), so
        // they are the genuinely zero-scoring imports: assert THEY are not recalled.
        result = await recallReal(ctx, ["wormhole gating isolation lane milestones"]);
        const recalledImportAdr = result.records.filter(
          (r) => fromImportStore(r) && r.recordType === "adr"
        );
        assert.equal(
          recalledImportAdr.length,
          0,
          "an off-topic query does not recall the import adr records (which score a true 0.0 — area architecture, no query-term hit)"
        );
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ═════════════ 02_import-triggers-reindex.feature (@executable rows) ════════
  {
    name: "import-mem/02 import leaves the imported precedent immediately recall-able with no separate reindex step",
    async run() {
      const { repo } = await makeCliRepo();
      const src = await makeSourceRepo("00");
      try {
        const imp = runCli(repo, ["import", "milestone", src, "00"]);
        assert.equal(imp.status, 0, `import exits 0 (stderr: ${imp.stderr.slice(0, 200)})`);
        // No manual reindex: a recall right after the import surfaces the import.
        const records = cliRecall(repo, TELEPORT_QUERY);
        assert.ok(
          records.some(isImportRecord),
          "the recalled records include a record sourced from the import store (the import triggered the reindex)"
        );
      } finally {
        await rm(repo, { recursive: true, force: true });
        await rm(src, { recursive: true, force: true });
      }
    },
  },
  {
    name: "import-mem/02 a --dry-run does not reindex, so recall after it surfaces no imported records",
    async run() {
      const { repo } = await makeCliRepo();
      const src = await makeSourceRepo("00");
      try {
        const imp = runCli(repo, ["import", "milestone", src, "00", "--dry-run"]);
        assert.equal(imp.status, 0, `--dry-run exits 0 (stderr: ${imp.stderr.slice(0, 200)})`);
        // The dry-run materialized + indexed nothing — no store, no index.
        assert.ok(!existsSync(importStoreRoot(repo)), "--dry-run materialized nothing (no import store)");
        assert.ok(!existsSync(memoryIndexPath(repo)), "--dry-run indexed nothing (no memory index written)");
        const records = cliRecall(repo, TELEPORT_QUERY);
        assert.ok(
          !records.some(isImportRecord),
          "no recalled record is sourced from the import store after a --dry-run"
        );
      } finally {
        await rm(repo, { recursive: true, force: true });
        await rm(src, { recursive: true, force: true });
      }
    },
  },
  {
    name: "import-mem/02 a re-import over the same source yields the same recall-able record set with no growth",
    async run() {
      const { repo } = await makeCliRepo();
      const src = await makeSourceRepo("00");
      try {
        const first = runCli(repo, ["import", "milestone", src, "00"]);
        assert.equal(first.status, 0, `first import exits 0 (stderr: ${first.stderr.slice(0, 200)})`);
        const firstSet = cliRecall(repo, TELEPORT_QUERY, ["--limit", "50"])
          .filter(isImportRecord)
          .map((r) => `${r.item}|${r.id}|${r.source}`)
          .sort();
        assert.ok(firstSet.length >= 1, "the first import is recall-able");

        // Re-import over the UNCHANGED source — a clean one-time snapshot (ADR-005).
        const second = runCli(repo, ["import", "milestone", src, "00"]);
        assert.equal(second.status, 0, `re-import exits 0 (stderr: ${second.stderr.slice(0, 200)})`);
        const secondSet = cliRecall(repo, TELEPORT_QUERY, ["--limit", "50"])
          .filter(isImportRecord)
          .map((r) => `${r.item}|${r.id}|${r.source}`)
          .sort();

        assert.deepEqual(secondSet, firstSet, "the re-import recall-able set is the SAME set (no new records, no drift)");
        assert.equal(secondSet.length, firstSet.length, "the imported record count is unchanged (no growth)");
      } finally {
        await rm(repo, { recursive: true, force: true });
        await rm(src, { recursive: true, force: true });
      }
    },
  },
  {
    name: "import-mem/02 the import mode decides whether the imported records become recall-able (Scenario Outline, folded)",
    async run() {
      // Row 1: a real import (no flag) → recall-able, the imported set.
      {
        const { repo } = await makeCliRepo();
        const src = await makeSourceRepo("00");
        try {
          assert.equal(runCli(repo, ["import", "milestone", src, "00"]).status, 0, "real import exits 0");
          const set = cliRecall(repo, TELEPORT_QUERY, ["--limit", "50"]).filter(isImportRecord);
          assert.ok(set.length >= 1, "a real import is recall-able (the imported set)");
        } finally {
          await rm(repo, { recursive: true, force: true });
          await rm(src, { recursive: true, force: true });
        }
      }
      // Row 2: a --dry-run → absent, zero (nothing indexed).
      {
        const { repo } = await makeCliRepo();
        const src = await makeSourceRepo("00");
        try {
          assert.equal(runCli(repo, ["import", "milestone", src, "00", "--dry-run"]).status, 0, "--dry-run exits 0");
          const set = cliRecall(repo, TELEPORT_QUERY, ["--limit", "50"]).filter(isImportRecord);
          assert.equal(set.length, 0, "a --dry-run reaches nothing (zero imported records recall-able)");
        } finally {
          await rm(repo, { recursive: true, force: true });
          await rm(src, { recursive: true, force: true });
        }
      }
      // Row 3: a re-run (no flag) → recall-able, unchanged from the first import.
      {
        const { repo } = await makeCliRepo();
        const src = await makeSourceRepo("00");
        try {
          assert.equal(runCli(repo, ["import", "milestone", src, "00"]).status, 0, "first import exits 0");
          const firstCount = cliRecall(repo, TELEPORT_QUERY, ["--limit", "50"]).filter(isImportRecord).length;
          assert.equal(runCli(repo, ["import", "milestone", src, "00"]).status, 0, "re-import exits 0");
          const secondCount = cliRecall(repo, TELEPORT_QUERY, ["--limit", "50"]).filter(isImportRecord).length;
          assert.ok(firstCount >= 1, "the first import is recall-able");
          assert.equal(secondCount, firstCount, "a re-import is recall-able with the count unchanged from the first import");
        } finally {
          await rm(repo, { recursive: true, force: true });
          await rm(src, { recursive: true, force: true });
        }
      }
    },
  },

  // Cross-check: a milestone-scoped rebuild stays work-stream-only (the import scan
  // is composed ONLY on a whole-stream rebuild — 13/ADR-003 scan-seam decision).
  {
    name: "import-mem/00 a milestone-scoped rebuild (only=01) stays work-stream-only (no imports composed)",
    async run() {
      const { ctx, repo } = await makeFixture();
      try {
        const scoped = await buildRecords("01", ctx);
        assert.ok(scoped.length >= 1, "the scoped rebuild yields the work-stream milestone's records");
        assert.ok(!scoped.some(isImportRecord), "a milestone-scoped rebuild composes NO import-store records");
        const whole = await buildRecords(null, ctx);
        assert.ok(whole.some(isImportRecord), "a whole-stream rebuild DOES compose import-store records");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];
