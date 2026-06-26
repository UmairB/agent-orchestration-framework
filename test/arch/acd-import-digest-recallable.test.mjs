// Fitness function for the AOF.md digest-on-import (13/ADR-006 — the deferred 13×14
// follow-up):
//   "An import that recovers intent but NO decisions and NO outcomes materializes an
//    AOF.md digest whose every `## ` section indexes (via the EXISTING parseAof) as a
//    frozen `summary` MemoryRecord resolving within the import store; an import that
//    recovered ADR/retro records emits NO digest (its artifact set is unchanged); the
//    digest is indexed through the SAME parseAof the work-stream scan uses — the import
//    side adds no new parser and no new record shape."
//
// Behavioural proof (materialize a fixture import + buildRecords over it) + a focused
// source-grep that the indexing extension reuses the existing parser. Mirrors the
// 05/14 `acd-memory-aof-digest` and 13 `acd-import-derived-index` idioms.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { materializeImport, AOF_FILE } from "../../src/import/materialize.mjs";
import { buildRecords, resolveRecordSourcePath, isImportRecord } from "../../src/memory/local-indexing.mjs";
import { MEMORY_RECORD_FIELDS } from "../../src/memory/local-retrieval.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Intent only (the zero-record case the digest exists for) vs an import that recovered
// ADR + retro records (already grounds recall → no digest).
const INTENT_ONLY = {
  intent: { objective: "Ferry across the starlight channel on a fixed cadence.", scope: "In: the schedule. Out: live telemetry." },
  decisions: [],
  outcomes: [],
  meta: { slug: "starlight-ferry", title: "Starlight Ferry", status: "not-started" },
};
const IMPORTED_AT = "2026-06-25";
const RICH = {
  intent: { objective: "Already has records.", scope: "Already has records." },
  decisions: [{ id: "ADR-001", title: "A decision", status: "Accepted", body: "**Decision.** A." }],
  outcomes: [{ id: "R1", title: "An outcome", body: "- **Lesson:** L." }],
};

async function makeProject() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-arch-import-digest-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(workDir, { recursive: true });
  return { repo, ctx: { workDir, projectRoot: repo } };
}

export const archTests = [
  {
    name: "arch/import-digest: an intent-only import yields an AOF.md whose ## sections index as frozen summary records resolving in the import store",
    async run() {
      const { repo, ctx } = await makeProject();
      try {
        const out = await materializeImport({ projectRoot: repo, sourceSlug: "src", milestoneRef: "00", recovered: INTENT_ONLY, importedAt: IMPORTED_AT });
        assert.ok(existsSync(path.join(out.dir, AOF_FILE)), "an intent-only import materializes an AOF.md digest");
        const records = await buildRecords(null, ctx);
        const summaries = records.filter((r) => r.recordType === "summary");
        assert.ok(summaries.length >= 1, "the digest indexes as at least one summary record");
        for (const rec of summaries) {
          for (const f of MEMORY_RECORD_FIELDS) assert.ok(f in rec, `the summary record carries the frozen field "${f}"`);
          assert.ok(isImportRecord(rec), "the digest record is an import-leg record (namespaced item)");
          const { absPath, line } = resolveRecordSourcePath(rec, ctx);
          assert.ok(existsSync(absPath), "the digest record's source resolves to a file in the import store");
          const lines = (await readFile(absPath, "utf8")).split(/\r?\n/);
          assert.ok(/^##\s/.test(lines[line - 1] ?? ""), "the digest record traces to its `## ` heading line");
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/import-digest: an import that recovered ADR/retro records emits NO digest (its artifact set is unchanged)",
    async run() {
      const { repo } = await makeProject();
      try {
        const out = await materializeImport({ projectRoot: repo, sourceSlug: "src", milestoneRef: "00", recovered: RICH });
        assert.ok(!existsSync(path.join(out.dir, AOF_FILE)), "no AOF.md is emitted when the import already has adr/lesson records");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/import-digest: the digest is indexed through the EXISTING parseAof; the import side defines no new parser/record shape",
    async run() {
      // The import-store scan reads AOF_FILE and runs the SAME parseAof the work stream uses.
      const indexing = await readFile(path.join(repoRoot, "src", "memory", "local-indexing.mjs"), "utf8");
      assert.ok(/AOF_FILE/.test(indexing), "local-indexing references AOF_FILE (the digest is a recognised scan artifact)");
      assert.ok(/parseAof\(/.test(indexing), "the digest is indexed through the existing parseAof");
      // The materialize writer RENDERS the digest — it defines no parser and no record shape.
      const materialize = await readFile(path.join(repoRoot, "src", "import", "materialize.mjs"), "utf8");
      assert.ok(/renderDigest/.test(materialize), "the materialize writer renders the digest (reusing the milestone-14 doc shape)");
      assert.ok(!/function\s+parse[A-Z]/.test(materialize), "the materialize writer defines no parser of its own");
      assert.ok(!/recordType\s*:/.test(materialize), "the materialize writer defines no record shape of its own");
    },
  },
  {
    name: "arch/import-digest: the digest carries the canonical identity+provenance frontmatter, and importedAt stays OFF record-bearing artifacts (ADR-007)",
    async run() {
      const { repo } = await makeProject();
      try {
        const out = await materializeImport({ projectRoot: repo, sourceSlug: "src", milestoneRef: "00", recovered: INTENT_ONLY, importedAt: IMPORTED_AT });
        const digest = await readFile(path.join(out.dir, AOF_FILE), "utf8");
        for (const [field, re] of [
          ["doc", /^doc:\s*digest$/m],
          ["milestone", /^milestone:\s*00$/m],
          ["slug", /^slug:\s*starlight-ferry$/m],
          ["title", /^title:\s*"Starlight Ferry"$/m],
          ["status", /^status:\s*not-started$/m],
          ["imported", /^imported:\s*true$/m],
          ["importedBy", /^importedBy:\s*aof$/m],
          ["importedAt", /^importedAt:\s*2026-06-25$/m],
        ]) {
          assert.ok(re.test(digest), `the digest frontmatter carries "${field}"`);
        }
        // ADR-007/005: importedAt is permitted ONLY on the (non-record-source) digest.
        // SPEC.md is a legible/record-bearing artifact and stays timestamp-free.
        const spec = await readFile(path.join(out.dir, "SPEC.md"), "utf8");
        assert.ok(!/importedAt/.test(spec), "SPEC.md carries no importedAt (record-bearing artifacts stay timestamp-free)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];
