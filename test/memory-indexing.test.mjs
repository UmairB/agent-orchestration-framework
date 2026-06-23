// Traceability wiring for milestone 05 / story 01 (local-backend-indexing).
//
// Every @executable scenario AND every Scenario-Outline Examples row across the
// story's five executable task features (00-04) is covered here, exercised
// against the REAL indexing module (`src/memory/local-indexing.mjs`) directly —
// the CLI-phrased "I run aof work memory reindex" scenarios bind to direct
// `reindex(only, ctx)` calls (the CLI/seam is story 00, not under test here).
//
//   00_parse-retrospective-lessons.feature — R<n> entry -> lesson MemoryRecord
//   01_parse-architecture-adrs.feature      — ADR-NNN block -> adr MemoryRecord
//   02_reindex-builds-derived-index.feature — frozen index document, full vs --item, ingest alias
//   03_index-location-and-gitignore.feature — fixed path + idempotent .gitignore
//   04_status-reports-the-store.feature      — status counts + lesson/adr split + absent store
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseRetrospective,
  parseArchitecture,
  parseAof,
  reindex,
  status,
  memoryIndexPath,
  INDEX_VERSION,
} from "../src/memory/local-indexing.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const REAL_WORK_DIR = path.join(REPO_ROOT, "wiki", "work");

// ---- real-corpus fixtures (the milestone-01 RETROSPECTIVE.md + ARCHITECTURE.md
// the features are grounded in — copied verbatim into a temp stream so the tests
// are hermetic, not dependent on the live stream's growth) -----------------------
const M01_DIR = path.join(REAL_WORK_DIR, "01_milestone_acd-asset-bundle");

async function readReal(name) {
  return readFile(path.join(M01_DIR, name), "utf8");
}

const META = { item: "01", itemSlug: "acd-asset-bundle", workRelPath: "01_milestone_acd-asset-bundle/RETROSPECTIVE.md" };
const META_ARCH = { item: "01", itemSlug: "acd-asset-bundle", workRelPath: "01_milestone_acd-asset-bundle/ARCHITECTURE.md" };

// ---- temp work-stream fixture (a minimal NN_milestone_slug tree the indexer
// scans via listItems) -----------------------------------------------------------
async function tempStream(milestones) {
  // milestones: [{ number, slug, retro?, arch? }]
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "aof-mem-"));
  const workDir = path.join(projectRoot, "wiki", "work");
  for (const m of milestones) {
    const dir = path.join(workDir, `${m.number}_milestone_${m.slug}`);
    await mkdir(dir, { recursive: true });
    if (m.retro != null) await writeFile(path.join(dir, "RETROSPECTIVE.md"), m.retro, "utf8");
    if (m.arch != null) await writeFile(path.join(dir, "ARCHITECTURE.md"), m.arch, "utf8");
    if (m.aof != null) await writeFile(path.join(dir, "AOF.md"), m.aof, "utf8");
  }
  await mkdir(path.join(projectRoot, ".aof"), { recursive: true });
  return { projectRoot, workDir, ctx: { workDir, projectRoot, configMemory: {} } };
}

// A tiny self-authored retro/arch pair (used where the scenario only needs
// shape, not the real milestone-01 field values).
const TINY_RETRO = `---
doc: retrospective
ref: "07"
---
# 07 · Tiny — Retrospective

## R1 — A first tiny lesson

- **Kind:** near-miss · **Area:** tooling · **Stage:** build · **Owner:** developer · **Raised by:** developer
- **What happened:** something happened.
- **Why:** because of a reason.
- **Lesson:** the distilled tiny lesson gist.
`;

const TINY_ARCH = `---
doc: architecture
---
# 07 · Tiny — Architecture Decisions

## ADR-001: A first tiny decision

**Status:** Accepted
**Date:** 2026-06-19

**Context.** some context.

**Decision.** the tiny decision gist.

**Invariant.** the tiny invariant.
`;

// An ARCHITECTURE.md whose ADR-009 block is Superseded (the feature-01 Outline's
// illustrative superseded row — synthesized, the status carries forward verbatim).
const ARCH_SUPERSEDED = `---
doc: architecture
---
# X · Architecture Decisions

## ADR-009: A superseded decision

**Status:** Superseded by ADR-014
**Date:** 2026-06-19

**Decision.** the old decision.
`;

// An AOF.md digest fixture: an h1 title, an HTML comment, three `## ` sections, and
// an h3 subsection (which must fold into its parent, not become its own record).
const SAMPLE_AOF = `---
doc: digest
milestone: 06
slug: knowledge-rag
imported: true
importedBy: aof
---
# 06 · Knowledge Base & RAG — Digest

<!-- aof digest: each ## section indexes as one summary record. -->

## Intent

Answer from docs, not just tools: a dedicated KB index, top-K retrieval, citations.

## Delivered

A retriever seam, ingestion pipeline, KB index, retrieval grounding, citations. Done.

### A subsection that is NOT its own record

This prose stays inside Delivered.

## Key decision

Self-rolled retrieval over Azure "On Your Data".
`;

function recordById(records, id) {
  return records.find((r) => r.id === id);
}

const MEMORY_RECORD_KEYS = [
  "recordType", "id", "item", "itemSlug", "title",
  "area", "stage", "kind", "owner", "status", "summary", "text", "source",
];

function assertFrozenShape(record) {
  for (const key of MEMORY_RECORD_KEYS) {
    assert.ok(key in record, `record ${record.id} has key "${key}"`);
    assert.equal(typeof record[key], "string", `record ${record.id} field "${key}" is a string`);
  }
  assert.ok(["lesson", "adr"].includes(record.recordType), `record ${record.id} recordType is lesson|adr`);
}

// The frozen MemoryRecord shape for a digest `summary` record (same 13 fields,
// every value a string; recordType is "summary").
function assertAofShape(record) {
  for (const key of MEMORY_RECORD_KEYS) {
    assert.ok(key in record, `record ${record.id} has key "${key}"`);
    assert.equal(typeof record[key], "string", `record ${record.id} field "${key}" is a string`);
  }
  assert.equal(record.recordType, "summary", `record ${record.id} recordType is summary`);
}

// Resolve a record's source (path:line) against a work directory, asserting live
// text exists at/after the recorded line.
async function assertSourceResolves(record, workDir) {
  const lastColon = record.source.lastIndexOf(":");
  const relPath = record.source.slice(0, lastColon);
  const line = Number.parseInt(record.source.slice(lastColon + 1), 10);
  const absPath = path.join(workDir, relPath);
  assert.ok(existsSync(absPath), `source file ${relPath} exists for ${record.id}`);
  const lines = (await readFile(absPath, "utf8")).split(/\r?\n/);
  assert.ok(line >= 1 && line <= lines.length, `source line ${line} in range for ${record.id}`);
  return lines[line - 1];
}

export const memoryIndexingTests = [
  // ====================================================================
  // 00_parse-retrospective-lessons.feature
  // ====================================================================
  {
    name: "00/retro: a near-miss R-entry (R2) becomes a lesson record with its meta fields populated",
    run: async () => {
      const records = parseRetrospective(await readReal("RETROSPECTIVE.md"), META);
      const r2 = recordById(records, "R2");
      assert.ok(r2, "R2 record exists");
      assert.equal(r2.recordType, "lesson");
      assert.equal(r2.item, "01");
      assert.equal(r2.itemSlug, "acd-asset-bundle");
      assert.equal(r2.title, "Content-addressed artifacts must pin line endings or cross-platform CI hashes diverge");
      assert.equal(r2.area, "architecture");
      assert.equal(r2.stage, "build");
      assert.equal(r2.kind, "near-miss");
      assert.equal(r2.owner, "developer");
      // summary is the entry's one-line lesson gist (non-empty, drawn from the Lesson field).
      assert.ok(r2.summary.length > 0, "summary is the lesson gist");
      assert.ok(r2.summary.includes("pin its bytes"), "summary traces to the Lesson text");
      // text is the searchable blob covering title, what, why, lesson.
      assert.ok(r2.text.includes(r2.title), "text covers the title");
      assert.ok(r2.text.includes("bundle manifest hashes"), "text covers the What");
      assert.ok(r2.text.includes("content addressing is byte-exact"), "text covers the Why");
      // source resolves to the "## R2" heading line.
      const headingLine = await assertSourceResolves(r2, REAL_WORK_DIR);
      assert.match(headingLine, /^##\s+R2\b/, "source points at the ## R2 heading");
    },
  },
  {
    name: "00/retro: a lesson record (R1) carries the adr-only status field present as an empty string",
    run: async () => {
      const records = parseRetrospective(await readReal("RETROSPECTIVE.md"), META);
      const r1 = recordById(records, "R1");
      assert.ok("status" in r1, "status field is present (not omitted)");
      assert.equal(r1.status, "", 'status is the empty string ""');
    },
  },
  {
    name: "00/retro: every R-entry produces exactly one lesson record (R1..R4)",
    run: async () => {
      const records = parseRetrospective(await readReal("RETROSPECTIVE.md"), META);
      assert.equal(records.length, 4, "4 lesson records, one per R<n> heading");
      assert.ok(records.every((r) => r.recordType === "lesson"), "all are lessons");
      assert.deepEqual(records.map((r) => r.id), ["R1", "R2", "R3", "R4"], "ids are exactly R1..R4");
    },
  },
  // Scenario Outline: the four real lessons of milestone 01.
  ...[
    { id: "R1", area: "architecture", stage: "build→verify", kind: "near-miss", owner: "architect" },
    { id: "R2", area: "architecture", stage: "build", kind: "near-miss", owner: "developer" },
    { id: "R3", area: "contract", stage: "refine→build", kind: "misunderstanding", owner: "contract authors (Three Amigos)" },
    { id: "R4", area: "contract", stage: "build", kind: "near-miss", owner: "developer" },
  ].map((row) => ({
    name: `00/retro outline: ${row.id} maps to lesson fields (area=${row.area}, stage=${row.stage}, kind=${row.kind}, owner=${row.owner}, status="")`,
    run: async () => {
      const records = parseRetrospective(await readReal("RETROSPECTIVE.md"), META);
      const rec = recordById(records, row.id);
      assert.ok(rec, `${row.id} record exists`);
      assert.equal(rec.recordType, "lesson");
      assert.equal(rec.area, row.area, "area");
      assert.equal(rec.stage, row.stage, "stage");
      assert.equal(rec.kind, row.kind, "kind");
      assert.equal(rec.owner, row.owner, "owner");
      assert.equal(rec.status, "", 'status ""');
    },
  })),

  // ====================================================================
  // 01_parse-architecture-adrs.feature
  // ====================================================================
  {
    name: "01/adr: an Accepted ADR (ADR-002) becomes an adr record with its decision fields populated",
    run: async () => {
      const records = parseArchitecture(await readReal("ARCHITECTURE.md"), META_ARCH);
      const adr = recordById(records, "ADR-002");
      assert.ok(adr, "ADR-002 record exists");
      assert.equal(adr.recordType, "adr");
      assert.equal(adr.item, "01");
      assert.equal(adr.itemSlug, "acd-asset-bundle");
      assert.equal(adr.title, "Bundle membership and content are pinned by a content-addressed manifest reusing hashContent");
      assert.equal(adr.area, "architecture");
      assert.equal(adr.stage, "");
      assert.equal(adr.kind, "");
      assert.equal(adr.owner, "");
      assert.equal(adr.status, "Accepted");
      assert.ok(adr.summary.length > 0, "summary is the decision/invariant gist");
      assert.ok(adr.summary.includes("content-addressed bundle manifest"), "summary traces to the Decision text");
      assert.ok(adr.text.includes(adr.title), "text covers the title");
      assert.ok(adr.text.includes("work update"), "text covers the Context");
      const headingLine = await assertSourceResolves(adr, REAL_WORK_DIR);
      assert.match(headingLine, /^##\s+ADR-002\b/, "source points at the ## ADR-002 heading");
    },
  },
  {
    name: "01/adr: an adr (ADR-001) fixes area to architecture and carries lesson-only fields as empty strings",
    run: async () => {
      const records = parseArchitecture(await readReal("ARCHITECTURE.md"), META_ARCH);
      const adr = recordById(records, "ADR-001");
      assert.equal(adr.area, "architecture");
      for (const key of ["stage", "kind", "owner"]) {
        assert.ok(key in adr, `${key} present (not omitted)`);
        assert.equal(adr[key], "", `${key} is ""`);
      }
    },
  },
  {
    name: "01/adr: every ADR block produces exactly one adr record (ADR-001..ADR-007)",
    run: async () => {
      const records = parseArchitecture(await readReal("ARCHITECTURE.md"), META_ARCH);
      assert.equal(records.length, 7, "7 adr records, one per ## ADR-NNN heading");
      assert.ok(records.every((r) => r.recordType === "adr"), "all are adrs");
      assert.deepEqual(
        records.map((r) => r.id),
        ["ADR-001", "ADR-002", "ADR-003", "ADR-004", "ADR-005", "ADR-006", "ADR-007"],
        "ids are exactly ADR-001..ADR-007",
      );
    },
  },
  // Scenario Outline: status comes from the Status line — real Accepted blocks.
  ...[
    { id: "ADR-001", status: "Accepted" },
    { id: "ADR-004", status: "Accepted" },
    { id: "ADR-007", status: "Accepted" },
  ].map((row) => ({
    name: `01/adr outline: ${row.id} status comes from its Status line (${row.status})`,
    run: async () => {
      const records = parseArchitecture(await readReal("ARCHITECTURE.md"), META_ARCH);
      const adr = recordById(records, row.id);
      assert.ok(adr, `${row.id} exists`);
      assert.equal(adr.recordType, "adr");
      assert.equal(adr.area, "architecture");
      assert.equal(adr.stage, "");
      assert.equal(adr.kind, "");
      assert.equal(adr.owner, "");
      assert.equal(adr.status, row.status);
    },
  })),
  // Scenario Outline: the illustrative superseded row (status carries forward verbatim).
  {
    name: "01/adr outline: a superseded ADR (ADR-009) carries the Superseded status string verbatim",
    run: async () => {
      const records = parseArchitecture(ARCH_SUPERSEDED, { item: "X", itemSlug: "x", workRelPath: "X/ARCHITECTURE.md" });
      const adr = recordById(records, "ADR-009");
      assert.ok(adr, "ADR-009 exists");
      assert.equal(adr.recordType, "adr");
      assert.equal(adr.area, "architecture");
      assert.equal(adr.stage, "");
      assert.equal(adr.kind, "");
      assert.equal(adr.owner, "");
      assert.equal(adr.status, "Superseded by ADR-014");
    },
  },

  // ====================================================================
  // 02_reindex-builds-derived-index.feature
  // ====================================================================
  {
    name: "02/reindex: reindex writes an index document in the frozen format",
    run: async () => {
      const { projectRoot, workDir, ctx } = await tempStream([
        { number: "01", slug: "acd-asset-bundle", retro: await readReal("RETROSPECTIVE.md"), arch: await readReal("ARCHITECTURE.md") },
      ]);
      try {
        await reindex(null, ctx);
        const storePath = memoryIndexPath(projectRoot);
        assert.ok(existsSync(storePath), ".aof/aof.memory.index.json exists");
        const index = JSON.parse(await readFile(storePath, "utf8"));
        // top-level keys are exactly backend, version, generatedAt, workDir, recordCount, records.
        assert.deepEqual(
          Object.keys(index).sort(),
          ["backend", "generatedAt", "recordCount", "records", "version", "workDir"],
          "top-level keys are exactly the frozen set",
        );
        assert.equal(index.backend, "local");
        assert.equal(index.version, INDEX_VERSION);
        assert.match(index.generatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, "generatedAt is ISO-8601");
        assert.equal(index.workDir, path.resolve(workDir), "workDir is the absolute work dir");
        assert.equal(index.recordCount, index.records.length, "recordCount == records.length");
        for (const rec of index.records) assertFrozenShape(rec);
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: "02/reindex: a full reindex scans every milestone folder in the stream (00, 01, 04)",
    run: async () => {
      const { projectRoot, ctx } = await tempStream([
        { number: "00", slug: "work-cli", arch: TINY_ARCH },
        { number: "01", slug: "acd-asset-bundle", retro: TINY_RETRO },
        { number: "04", slug: "round-trip-proof", arch: TINY_ARCH },
      ]);
      try {
        const result = await reindex(null, ctx);
        const items = new Set(result.records.map((r) => r.item));
        assert.ok(items.has("00"), "records sourced from milestone 00");
        assert.ok(items.has("01"), "records sourced from milestone 01");
        assert.ok(items.has("04"), "records sourced from milestone 04");
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: "02/reindex: --item scopes the rebuild to one milestone",
    run: async () => {
      const { projectRoot, ctx } = await tempStream([
        { number: "00", slug: "work-cli", arch: TINY_ARCH },
        { number: "01", slug: "acd-asset-bundle", retro: TINY_RETRO, arch: TINY_ARCH },
      ]);
      try {
        const result = await reindex("01", ctx);
        assert.ok(result.records.length > 0, "scoped reindex produced records");
        assert.ok(result.records.every((r) => r.item === "01"), "every record has item 01");
        assert.ok(!result.records.some((r) => r.item === "00"), "no record sourced from milestone 00");
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: "02/reindex: ingest --all produces the same index records as reindex (ingest aliases reindex)",
    run: async () => {
      const { projectRoot, ctx } = await tempStream([
        { number: "01", slug: "acd-asset-bundle", retro: await readReal("RETROSPECTIVE.md"), arch: await readReal("ARCHITECTURE.md") },
      ]);
      try {
        // reindex == the canonical build; capture its record set.
        const reindexResult = await reindex(null, ctx);
        const reindexIds = reindexResult.records.map((r) => `${r.item}:${r.id}`).sort();
        // ingest --all maps to reindex(null) for the local backend (ADR-003, FINDINGS §4).
        const ingestResult = await reindex(null, ctx);
        const ingestIds = ingestResult.records.map((r) => `${r.item}:${r.id}`).sort();
        assert.deepEqual(ingestIds, reindexIds, "ingest --all yields the same record set as reindex");
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: "02/reindex: reindexing twice from the same sources does not grow the store",
    run: async () => {
      const { projectRoot, ctx } = await tempStream([
        { number: "01", slug: "acd-asset-bundle", retro: await readReal("RETROSPECTIVE.md"), arch: await readReal("ARCHITECTURE.md") },
      ]);
      try {
        const first = await reindex(null, ctx);
        const second = await reindex(null, ctx);
        assert.equal(second.recordCount, first.recordCount, "recordCount unchanged across runs");
        // and the store on disk matches the second run's count (no accretion).
        const index = JSON.parse(await readFile(memoryIndexPath(projectRoot), "utf8"));
        assert.equal(index.recordCount, first.recordCount, "store recordCount is stable");
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    },
  },

  // ====================================================================
  // 03_index-location-and-gitignore.feature
  // ====================================================================
  {
    name: "03/location: reindex writes the index only to the fixed path under .aof/ (no other memory index)",
    run: async () => {
      const { projectRoot, ctx } = await tempStream([
        { number: "01", slug: "acd-asset-bundle", retro: TINY_RETRO },
      ]);
      try {
        await reindex(null, ctx);
        const storePath = memoryIndexPath(projectRoot);
        assert.ok(existsSync(storePath), "the fixed-path index exists");
        // No other *.memory.index.json anywhere else in the project.
        const stray = await findStrayMemoryIndexes(projectRoot, storePath);
        assert.deepEqual(stray, [], `no other memory index file written (found: ${stray.join(", ")})`);
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: "03/gitignore: reindex ignores the index via the nested .aof/.gitignore when it is absent",
    run: async () => {
      const { projectRoot, ctx } = await tempStream([
        { number: "01", slug: "acd-asset-bundle", retro: TINY_RETRO },
      ]);
      try {
        // F-02: the baseline is a SELF-CONTAINED nested .aof/.gitignore, never the repo root.
        const gitignorePath = path.join(projectRoot, ".aof", ".gitignore");
        assert.ok(!existsSync(gitignorePath), "no .aof/.gitignore yet");
        assert.ok(!existsSync(path.join(projectRoot, ".gitignore")), "the repo-root .gitignore is left untouched");
        await reindex(null, ctx);
        assert.ok(existsSync(gitignorePath), ".aof/.gitignore created");
        assert.ok(!existsSync(path.join(projectRoot, ".gitignore")), "the repo-root .gitignore is still untouched");
        // The entry is relative to .aof/ (git applies a nested ignore from its own dir).
        const lines = (await readFile(gitignorePath, "utf8")).split(/\r?\n/).map((l) => l.trim());
        assert.ok(lines.includes("aof.memory.index.json"), ".aof/.gitignore ignores the index");
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: "03/gitignore: reindex does not duplicate an existing nested .aof/.gitignore entry",
    run: async () => {
      const { projectRoot, ctx } = await tempStream([
        { number: "01", slug: "acd-asset-bundle", retro: TINY_RETRO },
      ]);
      try {
        const gitignorePath = path.join(projectRoot, ".aof", ".gitignore");
        await mkdir(path.join(projectRoot, ".aof"), { recursive: true });
        await writeFile(gitignorePath, "# pre-existing\naof.memory.index.json\n", "utf8");
        await reindex(null, ctx);
        const content = await readFile(gitignorePath, "utf8");
        const count = content.split(/\r?\n/).filter((l) => l.trim() === "aof.memory.index.json").length;
        assert.equal(count, 1, "exactly one entry (no duplicate)");
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: "03/gitignore: the written index path is git-ignored via the nested .aof/.gitignore after reindex",
    run: async () => {
      // We assert the observable file-outcome that drives git's ignore decision:
      // the index's fixed name matches an entry in its own dir's .gitignore (git
      // applies a nested ignore relative to that dir). Running real `git check-ignore`
      // would require a git repo + git on PATH; the entry presence is the
      // deterministic outcome the scenario hinges on.
      const { projectRoot, ctx } = await tempStream([
        { number: "01", slug: "acd-asset-bundle", retro: TINY_RETRO },
      ]);
      try {
        await reindex(null, ctx);
        const lines = (await readFile(path.join(projectRoot, ".aof", ".gitignore"), "utf8")).split(/\r?\n/).map((l) => l.trim());
        assert.ok(lines.includes("aof.memory.index.json"), "the written index is git-ignored by .aof/.gitignore");
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    },
  },

  // ====================================================================
  // 04_status-reports-the-store.feature
  // ====================================================================
  {
    name: "04/status: status before any reindex reports an absent store with zero counts, without throwing",
    run: async () => {
      const { projectRoot, ctx } = await tempStream([
        { number: "01", slug: "acd-asset-bundle", retro: TINY_RETRO },
      ]);
      try {
        const result = await status(ctx); // must not throw
        assert.equal(result.backend, "local");
        assert.equal(result.recordCount, 0, "recordCount 0 on an absent store");
        assert.equal(result.present, false, "store reported as absent");
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: "04/status: status after reindex reports the record count and store location",
    run: async () => {
      const { projectRoot, ctx } = await tempStream([
        { number: "01", slug: "acd-asset-bundle", retro: await readReal("RETROSPECTIVE.md"), arch: await readReal("ARCHITECTURE.md") },
      ]);
      try {
        const built = await reindex(null, ctx);
        const result = await status(ctx);
        assert.equal(result.backend, "local");
        assert.equal(result.recordCount, built.recordCount, "recordCount equals the index record count");
        assert.equal(result.store, memoryIndexPath(projectRoot), "store location is the fixed path");
        assert.ok(result.store.endsWith(path.join(".aof", "aof.memory.index.json")), "store ends with .aof/aof.memory.index.json");
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: "04/status: status reports the lesson/adr split and the split sums to recordCount",
    run: async () => {
      const { projectRoot, ctx } = await tempStream([
        { number: "01", slug: "acd-asset-bundle", retro: await readReal("RETROSPECTIVE.md"), arch: await readReal("ARCHITECTURE.md") },
      ]);
      try {
        const built = await reindex(null, ctx);
        const result = await status(ctx);
        assert.equal(typeof result.lessons, "number", "lessons count reported");
        assert.equal(typeof result.adrs, "number", "adrs count reported");
        assert.equal(result.lessons, 4, "4 lessons (R1..R4)");
        assert.equal(result.adrs, 7, "7 adrs (ADR-001..ADR-007)");
        assert.equal(result.lessons + result.adrs, result.recordCount, "lesson + adr == recordCount");
        assert.equal(result.recordCount, built.recordCount, "recordCount matches the build");
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    },
  },
  // ====================================================================
  // Real-world format robustness — separators and heading levels that real
  // streams use but aof's own docs do not. Surfaced by the let-shield testbed:
  // ADR headings separated by `·` (parser had required `:`), and R-entries at
  // h3 with the meta block split across two lines. Regression guard so a
  // stream's titles/lessons are not swallowed into the id or dropped entirely.
  // ====================================================================
  ...[
    { sep: "·", label: "middot" },
    { sep: "—", label: "em-dash" },
    { sep: "–", label: "en-dash" },
    { sep: "-", label: "hyphen" },
    { sep: ":", label: "colon" },
  ].map(({ sep, label }) => ({
    name: `01/adr robustness: an ADR heading separated by ${label} keeps id and title distinct`,
    run: async () => {
      const arch = `---\ndoc: architecture\n---\n# M — Architecture\n\n## ADR-001 ${sep} Per-obligation status map + conservative headline rule\n\n- **Status:** Accepted\n`;
      const [rec] = parseArchitecture(arch, { item: "04", itemSlug: "compliance", workRelPath: "04_milestone_compliance/ARCHITECTURE.md" });
      assert.equal(rec.id, "ADR-001", `id is the bare ADR id, not the whole heading (sep=${label})`);
      assert.equal(rec.title, "Per-obligation status map + conservative headline rule", `title is extracted, not empty (sep=${label})`);
      assert.equal(rec.area, "architecture");
      assert.equal(rec.status, "Accepted");
    },
  })),
  {
    name: "00/retro robustness: an R-entry authored at h3 (### R1) is still parsed as a lesson",
    run: async () => {
      const retro = `---\ndoc: retrospective\n---\n# M — Retrospective\n\n## Lessons\n\n### R1 — A lazy-seam transport shipped without a unit test\n- **Kind:** mistake · **Area:** code\n- **What happened:** the seam was asserted only at the enum level.\n`;
      const recs = parseRetrospective(retro, { item: "02", itemSlug: "voicevox", workRelPath: "02_milestone_voicevox/RETROSPECTIVE.md" });
      assert.equal(recs.length, 1, "the ### R1 heading produces exactly one lesson");
      assert.equal(recs[0].id, "R1");
      assert.equal(recs[0].title, "A lazy-seam transport shipped without a unit test");
      assert.equal(recs[0].recordType, "lesson");
    },
  },
  {
    name: "00/retro robustness: a meta block split across two lines populates all of kind/area/stage/owner",
    run: async () => {
      const retro = `---\ndoc: retrospective\n---\n# M — Retrospective\n\n### R1 — A lazy-seam transport shipped without a unit test\n- **Kind:** mistake · **Area:** code\n- **Stage:** build · **Owner:** developer · **Raised by:** qa (behavioural review)\n- **What happened:** prose.\n`;
      const [rec] = parseRetrospective(retro, { item: "02", itemSlug: "voicevox", workRelPath: "02_milestone_voicevox/RETROSPECTIVE.md" });
      assert.equal(rec.kind, "mistake");
      assert.equal(rec.area, "code");
      assert.equal(rec.stage, "build", "Stage from the SECOND meta line is captured");
      assert.equal(rec.owner, "developer", "Owner from the SECOND meta line is captured");
    },
  },

  // ====================================================================
  // AOF.md digest → `summary` records (05/ADR-007 localised additive source).
  // A digest gives a milestone whose SPEC/STATE carry no ADR/retro records a
  // recallable presence; each `## ` section is one summary record that resolves
  // to its heading line. h1 (the digest title) and h3+ subsections are NOT roots.
  // ====================================================================
  {
    name: "aof/digest: each ## section becomes a summary record (h1 + h3 excluded) with the frozen shape",
    run: async () => {
      const recs = parseAof(SAMPLE_AOF, { item: "06", itemSlug: "knowledge-rag", workRelPath: "06_milestone_knowledge-rag/AOF.md" });
      assert.deepEqual(recs.map((r) => r.id), ["intent", "delivered", "key-decision"], "one summary per ## section; h1/h3 are not roots");
      for (const r of recs) assertAofShape(r);
      const intent = recs.find((r) => r.id === "intent");
      assert.equal(intent.title, "Intent", "title is the heading text");
      assert.ok(/Answer from docs/.test(intent.text), "text carries the section body");
      assert.ok(intent.summary.length > 0 && /Answer from docs/.test(intent.summary), "summary is the section's gist line");
      // The h3 subsection's prose stays inside its parent (Delivered), not its own record.
      const delivered = recs.find((r) => r.id === "delivered");
      assert.ok(/stays inside Delivered/.test(delivered.text), "an h3 subsection's prose folds into its parent section");
      // Each source line is the section's own ## heading.
      const lines = SAMPLE_AOF.split(/\r?\n/);
      for (const r of recs) {
        const ln = Number.parseInt(r.source.split(":").pop(), 10);
        assert.match(lines[ln - 1], /^##\s+\S/, `${r.id} source points at its ## heading`);
      }
    },
  },
  {
    name: "aof/digest: an empty/whitespace heading yields no record (no fabrication)",
    run: async () => {
      const recs = parseAof(`# T — Digest\n\n## \n\nbody with no heading text\n`, { item: "06", itemSlug: "x", workRelPath: "06_milestone_x/AOF.md" });
      assert.equal(recs.length, 0, "a `## ` with no title text produces no record");
    },
  },
  {
    name: "aof/digest: reindex scans a milestone's AOF.md and contributes its summary records (resolving on disk)",
    run: async () => {
      const { projectRoot, workDir, ctx } = await tempStream([
        { number: "06", slug: "knowledge-rag", aof: SAMPLE_AOF },
      ]);
      try {
        const result = await reindex(null, ctx);
        const summaries = result.records.filter((r) => r.recordType === "summary");
        assert.equal(summaries.length, 3, "3 summary records from the digest");
        assert.ok(summaries.every((r) => r.item === "06"), "items are the milestone number");
        const headingLine = await assertSourceResolves(summaries[0], workDir);
        assert.match(headingLine, /^##\s+\S/, "the summary's source resolves to a ## heading in AOF.md");
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: "aof/digest: a milestone-scoped reindex includes that milestone's AOF.md digest",
    run: async () => {
      const { projectRoot, ctx } = await tempStream([
        { number: "06", slug: "knowledge-rag", aof: SAMPLE_AOF },
        { number: "07", slug: "other", arch: TINY_ARCH },
      ]);
      try {
        const result = await reindex("06", ctx);
        assert.ok(result.records.length > 0, "scoped reindex produced records");
        assert.ok(result.records.every((r) => r.item === "06"), "every record is milestone 06");
        assert.ok(result.records.some((r) => r.recordType === "summary"), "the digest's summary records are included");
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: "aof/digest: status reports a summaries count, and lessons+adrs+summaries == recordCount",
    run: async () => {
      const { projectRoot, ctx } = await tempStream([
        { number: "06", slug: "knowledge-rag", aof: SAMPLE_AOF, retro: TINY_RETRO, arch: TINY_ARCH },
      ]);
      try {
        await reindex(null, ctx);
        const result = await status(ctx);
        assert.equal(result.summaries, 3, "3 summary records counted");
        assert.equal(result.lessons + result.adrs + result.summaries, result.recordCount, "the full type split sums to recordCount");
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    },
  },
];

// Recursively find any *.memory.index.json other than the fixed-path store.
async function findStrayMemoryIndexes(root, allowed) {
  const { readdir } = await import("node:fs/promises");
  const stray = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (/memory.*index\.json$/i.test(entry.name) && full !== allowed) {
        stray.push(full);
      }
    }
  }
  await walk(root);
  return stray;
}
