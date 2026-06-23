// Fitness function for the AOF.md digest source (05/ADR-007 "add a source = a
// localised additive change, gated by the SAME derived-index invariant"):
// "Every `summary` record a digest contributes carries the frozen MemoryRecord
//  shape and a `source` (path:line) that resolves to its own `## ` heading; a
//  fresh reindex reproduces the identical digest record set (rebuildable, no
//  accretion); the digest is the record source, never a duplicate-as-authority."
//
// Behavioural proof (not a source grep): build the local index from a fixture
// stream whose milestone carries an AOF.md, then for each summary record resolve
// source → the `## ` heading whose slug IS the record id, assert the title/summary
// trace to text at/after that line, and assert a second reindex is byte-identical.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { reindex } from "../../src/memory/local-indexing.mjs";
import { MEMORY_RECORD_FIELDS } from "../../src/memory/local-retrieval.mjs";

// A digest with three `## ` sections + an h3 subsection (which must NOT be a record
// root) — the same shape an aof digest takes for a milestone with no ADR/retro docs.
const DIGEST = `---
doc: digest
milestone: 06
slug: knowledge-rag
imported: true
importedBy: aof
---
# 06 · Knowledge Base & RAG — Digest

<!-- aof digest: each ## section indexes as one summary record. -->

## Intent

Answer from docs, not just tools: a dedicated knowledge index, top-K retrieval, citations.

## Delivered

A retriever seam, an idempotent ingestion pipeline, a scoped knowledge index, and citations.

### A subsection that folds into Delivered

This prose is not its own record.

## Key decision

Self-rolled retrieval over managed grounding so the orchestrator owns the turn loop.
`;

function slugifyHeading(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "section";
}

function contentTokens(value) {
  return (String(value).toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 3);
}

async function buildTempStream() {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "aof-arch-aof-digest-"));
  const workDir = path.join(projectRoot, "wiki", "work");
  const dir = path.join(workDir, "06_milestone_knowledge-rag");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "AOF.md"), DIGEST, "utf8");
  await mkdir(path.join(projectRoot, ".aof"), { recursive: true });
  return { projectRoot, workDir, ctx: { workDir, projectRoot, configMemory: {} } };
}

export const archTests = [
  {
    name: "arch/aof-digest: every summary record resolves to its own ## heading and traces to live text",
    run: async () => {
      const { projectRoot, workDir, ctx } = await buildTempStream();
      try {
        const result = await reindex(null, ctx);
        const summaries = result.records.filter((r) => r.recordType === "summary");
        assert.equal(summaries.length, 3, "the digest's three ## sections yield three summary records (h1/h3 excluded)");

        for (const record of summaries) {
          // Frozen MemoryRecord shape: exactly the 13 fields, every value a string.
          assert.deepEqual(
            Object.keys(record).filter((k) => k !== "score").sort(),
            [...MEMORY_RECORD_FIELDS].sort(),
            `summary ${record.id} carries exactly the frozen MemoryRecord fields`,
          );
          for (const field of MEMORY_RECORD_FIELDS) {
            assert.equal(typeof record[field], "string", `summary ${record.id} field "${field}" is a string`);
          }

          // source → path:line resolves on disk.
          const lastColon = record.source.lastIndexOf(":");
          assert.ok(lastColon > 0, `summary ${record.id} source has a :line suffix (${record.source})`);
          const relPath = record.source.slice(0, lastColon);
          const lineNo = Number.parseInt(record.source.slice(lastColon + 1), 10);
          const absPath = path.join(workDir, relPath);
          assert.ok(existsSync(absPath), `summary ${record.id} source file exists: ${relPath}`);
          const lines = (await readFile(absPath, "utf8")).split(/\r?\n/);
          assert.ok(lineNo >= 1 && lineNo <= lines.length, `summary ${record.id} line ${lineNo} within file`);

          // the recorded line is a `## ` heading whose slug IS the record id.
          const headingLine = lines[lineNo - 1];
          assert.match(headingLine, /^##\s+\S/, `summary ${record.id}'s source line is a ## heading: "${headingLine}"`);
          const headingSlug = slugifyHeading(headingLine.replace(/^##\s+/, "").replace(/`/g, "").trim());
          assert.equal(headingSlug, record.id, `summary's id is the heading slug ("${headingLine}")`);

          // the title + summary trace to text at/after that line (a projection, not an invented fact).
          const region = lines.slice(lineNo - 1).join("\n").toLowerCase();
          for (const tok of contentTokens(record.title)) {
            assert.ok(region.includes(tok), `summary ${record.id}'s title token "${tok}" traces to source at/after line ${lineNo}`);
          }
          for (const tok of contentTokens(record.summary).slice(0, 6)) {
            assert.ok(region.includes(tok), `summary ${record.id}'s summary token "${tok}" traces to source at/after line ${lineNo}`);
          }
        }
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/aof-digest: a second reindex yields the identical summary set (rebuildable, no accretion)",
    run: async () => {
      const { projectRoot, ctx } = await buildTempStream();
      try {
        const first = await reindex(null, ctx);
        const second = await reindex(null, ctx);
        const summaries = (records) => records.filter((r) => r.recordType === "summary").map((r) => JSON.stringify(r)).sort();
        assert.deepEqual(summaries(second.records), summaries(first.records), "the digest's summary set is byte-identical across reindexes");
      } finally {
        await rm(projectRoot, { recursive: true, force: true });
      }
    },
  },
];
