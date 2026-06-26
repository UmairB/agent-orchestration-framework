// import-digest — the AOF.md digest-on-import follow-up (milestone 13 / story 04;
// ADR-006). The @executable proof for `04_import-emits-recallable-digest.feature`.
//
// The gap it closes: an imported milestone whose source carried NO decisions and NO
// outcomes (only intent) materialized just a SPEC.md — legible but NOT an index record
// source (ADR-001) — so it contributed ZERO records and was invisible to recall. The
// fix (the deferred 13×14 follow-up): for exactly that zero-record case the import also
// emits an `AOF.md` digest (the milestone-14 doc type), and the import-store scan runs
// the EXISTING `parseAof` over it, so each `## ` section becomes one `summary` record —
// the imported intent gains a recallable presence with NO new parser.
//
// Runs OFFLINE against a fixture import store materialized via materializeImport with a
// FIXED `recovered` (no recovery engine, no binary) — the @executable lane.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runMemory, resolveConfiguredBackend } from "../src/work-memory.mjs";
import {
  reindex,
  memoryIndexPath,
  resolveRecordSourcePath,
  isImportRecord,
} from "../src/memory/local-indexing.mjs";
import { MEMORY_RECORD_FIELDS } from "../src/memory/local-retrieval.mjs";
import { materializeImport, AOF_FILE } from "../src/import/materialize.mjs";

// memory.backend = "local" so reindex/recall actually run the local backend.
const CONFIG = { name: "fixture", work: { dir: "./wiki/work" }, memory: { backend: "local" } };

// A deterministic injected provenance date so the digest is byte-stable in tests
// (ADR-007: importedAt is injectable; the CLI defaults it to today).
const IMPORTED_AT = "2026-06-25";

// An INTENT-ONLY recovered shape (no decisions, no outcomes) — the zero-record case
// the digest exists for. A distinctive topic ("starlight ferry") so a recall targets
// the imported milestone without colliding with any generic corpus. `meta` carries
// the recovered milestone identity for the digest frontmatter (ADR-007).
function intentOnlyRecovered() {
  return {
    intent: {
      objective: "Ferry passengers across the starlight channel on a fixed cadence.",
      scope: "In: the starlight ferry schedule. Out: live vessel telemetry.",
    },
    decisions: [],
    outcomes: [],
    meta: { slug: "starlight-ferry", title: "Starlight Ferry", status: "not-started" },
  };
}

// A project root with a local-backend config + an empty work stream, into which a
// fixture import is materialized. Returns { repo, ctx }.
async function makeProject() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-import-digest-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  await mkdir(workDir, { recursive: true });
  await writeFile(path.join(repo, ".aof", "aof.config.json"), `${JSON.stringify(CONFIG, null, 2)}\n`, "utf8");
  return { repo, ctx: { workDir, projectRoot: repo, configMemory: CONFIG.memory } };
}

async function reindexAndRead(ctx) {
  await reindex(null, ctx);
  return JSON.parse(await readFile(memoryIndexPath(ctx.projectRoot), "utf8"));
}

async function recallReal(ctx, argv) {
  const outcome = await runMemory(["recall", ...argv], {
    config: CONFIG,
    resolveBackend: (cfg) => resolveConfiguredBackend(cfg),
    ctx,
    log: () => {},
  });
  return outcome.result;
}

export const importDigestTests = [
  {
    name: "import-digest/00 an intent-only import materializes an AOF.md digest, one ## section per recovered half",
    async run() {
      const { repo } = await makeProject();
      try {
        const out = await materializeImport({
          projectRoot: repo,
          sourceSlug: "src",
          milestoneRef: "00",
          recovered: intentOnlyRecovered(),
          importedAt: IMPORTED_AT,
        });
        const aofPath = path.join(out.dir, AOF_FILE);
        assert.ok(existsSync(aofPath), "an intent-only import materializes an AOF.md digest");
        const body = await readFile(aofPath, "utf8");
        // ADR-007: the digest frontmatter carries the milestone identity + provenance.
        assert.ok(/^doc:\s*digest$/m.test(body), "frontmatter: doc: digest");
        assert.ok(/^milestone:\s*00$/m.test(body), "frontmatter: milestone (the ref)");
        assert.ok(/^slug:\s*starlight-ferry$/m.test(body), "frontmatter: the recovered slug");
        assert.ok(/^title:\s*"Starlight Ferry"$/m.test(body), "frontmatter: the recovered title (quoted)");
        assert.ok(/^status:\s*not-started$/m.test(body), "frontmatter: the recovered status");
        assert.ok(/^imported:\s*true$/m.test(body), "frontmatter: imported: true");
        assert.ok(/^importedBy:\s*aof$/m.test(body), "frontmatter: importedBy: aof");
        assert.ok(/^importedAt:\s*2026-06-25$/m.test(body), "frontmatter: the injected importedAt date");
        assert.ok(/^## Intent$/m.test(body), "the digest carries a `## Intent` section (the recovered objective)");
        assert.ok(/^## Scope$/m.test(body), "the digest carries a `## Scope` section (the recovered scope)");
        assert.ok(/starlight channel/.test(body), "the Intent section is the recovered objective verbatim");
        // recordCount counts the two digest sections (one summary record each); SPEC.md yields none.
        assert.equal(out.recordCount, 2, "recordCount counts the two digest summary records (SPEC.md yields none)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "import-digest/01 reindex indexes the digest into frozen summary records that resolve in the import store",
    async run() {
      const { repo, ctx } = await makeProject();
      try {
        await materializeImport({ projectRoot: repo, sourceSlug: "src", milestoneRef: "00", recovered: intentOnlyRecovered() });
        const index = await reindexAndRead(ctx);
        const summaries = index.records.filter((r) => r.recordType === "summary");
        assert.equal(summaries.length, 2, "reindex derives one summary record per digest `## ` section");
        for (const record of summaries) {
          // Frozen MemoryRecord shape (absent-type fields present-as-"").
          for (const field of MEMORY_RECORD_FIELDS) {
            assert.ok(field in record, `the summary record carries the frozen field "${field}"`);
          }
          // It is an IMPORT-leg record, and its source:line resolves in the import store.
          assert.ok(isImportRecord(record), "the digest record carries the namespaced import item");
          const { absPath, line } = resolveRecordSourcePath(record, ctx);
          assert.ok(existsSync(absPath), `the digest record's source resolves to a file (${absPath})`);
          const lines = (await readFile(absPath, "utf8")).split(/\r?\n/);
          assert.ok(line >= 1 && line <= lines.length && lines[line - 1].trim().length > 0, "the source line resolves to live text (a `## ` heading)");
          assert.ok(/^##\s/.test(lines[line - 1]), "the digest record traces to its `## ` heading line");
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "import-digest/02 the digest makes the imported intent recall-able through the unchanged verb",
    async run() {
      const { repo, ctx } = await makeProject();
      try {
        await materializeImport({ projectRoot: repo, sourceSlug: "src", milestoneRef: "00", recovered: intentOnlyRecovered() });
        await reindex(null, ctx);
        const result = await recallReal(ctx, ["starlight ferry", "--limit", "5"]);
        const hits = result.records ?? [];
        assert.ok(hits.length > 0, "recall returns the imported digest record (it was zero records before)");
        assert.ok(hits.some((r) => r.recordType === "summary" && isImportRecord(r)), "an imported `summary` digest record surfaces in recall");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "import-digest/03 an import WITH decisions/outcomes emits NO digest (it already grounds recall)",
    async run() {
      const { repo, ctx } = await makeProject();
      try {
        const out = await materializeImport({
          projectRoot: repo,
          sourceSlug: "src",
          milestoneRef: "00",
          recovered: {
            intent: { objective: "Has decisions.", scope: "Has outcomes." },
            decisions: [{ id: "ADR-001", title: "A decision", status: "Accepted", body: "**Decision.** A." }],
            outcomes: [{ id: "R1", title: "An outcome", body: "- **Lesson:** L." }],
          },
        });
        assert.ok(!existsSync(path.join(out.dir, AOF_FILE)), "no AOF.md digest when the import already has adr/lesson records");
        const index = await reindexAndRead(ctx);
        assert.ok(!index.records.some((r) => r.recordType === "summary"), "the index carries no summary records for an ADR/retro import");
        assert.ok(index.records.some((r) => r.recordType === "adr") && index.records.some((r) => r.recordType === "lesson"), "the adr + lesson records are present as before");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "import-digest/04 absent intent fabricates no digest (absence is information)",
    async run() {
      const { repo } = await makeProject();
      try {
        const out = await materializeImport({
          projectRoot: repo,
          sourceSlug: "src",
          milestoneRef: "00",
          recovered: { intent: null, decisions: [], outcomes: [] },
        });
        assert.ok(!existsSync(path.join(out.dir, AOF_FILE)), "no digest is fabricated when intent is not recoverable");
        assert.equal(out.recordCount, 0, "an unrecoverable import contributes zero records");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "import-digest/05 a re-import yields a byte-identical digest (rebuildable, no accretion)",
    async run() {
      const { repo } = await makeProject();
      try {
        const out1 = await materializeImport({ projectRoot: repo, sourceSlug: "src", milestoneRef: "00", recovered: intentOnlyRecovered(), importedAt: IMPORTED_AT });
        const body1 = await readFile(path.join(out1.dir, AOF_FILE), "utf8");
        const out2 = await materializeImport({ projectRoot: repo, sourceSlug: "src", milestoneRef: "00", recovered: intentOnlyRecovered(), importedAt: IMPORTED_AT });
        const body2 = await readFile(path.join(out2.dir, AOF_FILE), "utf8");
        assert.equal(body2, body1, "a second import over the same source (same importedAt) yields a byte-identical AOF.md digest");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];
