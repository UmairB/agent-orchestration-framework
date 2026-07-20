// Traceability wiring for milestone 38 / story 08 (worker-verified-memory-syncback,
// ADR-016) — tasks/01_control-reingests-own-checkout.feature.
//
// Covers every @executable scenario / Outline row: before the branch merges, a
// worker-authored lesson is NOT recallable on the control node; after a REAL
// `git merge` (the local analog of "as after a `git pull`") + a REAL `aof work memory
// ingest`, the SAME worker-authored lesson/ADR becomes recallable, each recalled
// record's source resolving to LIVE TEXT within the control's OWN checkout; every
// worker-authored knowledge KIND ADR-016 names (a RETROSPECTIVE `R<n>` lesson, an
// `ADR-NNN` block) becomes recallable with the correct recordType/area; and an
// off-topic query recalls nothing new.
//
// Hermetic + producer-fed (the milestone's own recurring F1/F4 lesson): a REAL local
// git checkout (test/support/mesh-memory-syncback-fixture.mjs, a real `git merge`) +
// the REAL `runMemory`/`resolveConfiguredBackend` seam over the REAL `local` backend
// (src/memory/local-indexing.mjs's `buildRecords`/`parseRetrospective`/
// `parseArchitecture` — the SAME parsers the graphify backend also reuses, ADR-016's
// own "RECORDS rebuild is OBSERVABLE with NO graphify binary" framing). The `local`
// backend never attempts a graph build at all, so this suite is IMMUNE to the KNOWN
// graphify-extraction LLM non-determinism (memory-integration.test.mjs's flake) by
// construction — no claude-cli, no graphify binary, ever invoked here. Each assertion
// targets the SPECIFIC worker-authored record by id (absent-before / recallable-after),
// never a fragile lesson+adr===recordCount sum.
import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { runMemory, resolveConfiguredBackend } from "../src/work-memory.mjs";
import { resolveRecordSourcePath } from "../src/memory/local-indexing.mjs";
import { withMeshMemorySyncbackFixture } from "./support/mesh-memory-syncback-fixture.mjs";

const CONFIG = { memory: { backend: "local" } };

function memoryCtxFor(fx) {
  return { workDir: fx.workDir, projectRoot: fx.root, configMemory: CONFIG.memory };
}

async function runReal(ctx, argv) {
  const out = [];
  const outcome = await runMemory(argv, {
    config: CONFIG,
    resolveBackend: (cfg) => resolveConfiguredBackend(cfg),
    ctx,
    log: (line) => out.push(line),
  });
  return { outcome, output: out.join("\n") };
}

export const meshMemorySyncbackControlReingestTests = [
  // ====================================================================
  // Scenario: before the merge, the worker's lesson is not recallable on the control
  // node
  // ====================================================================
  {
    name: "mesh-memory-syncback/01 before the merge, the worker's lesson is not recallable on the control node",
    run: async () => {
      await withMeshMemorySyncbackFixture(async (fx) => {
        // "Given the control node has ingested its checkout as it stands, WITHOUT
        // the worker's markdown" — no mergeWorkerBranch() call: the checkout stays
        // on the base branch (the worker's branch is real but unmerged).
        const ctx = memoryCtxFor(fx);
        await runReal(ctx, ["ingest", "--all"]);
        const { outcome } = await runReal(ctx, ["recall", "zephyrlesson"]);
        assert.equal(outcome.ok, true, "the command exits 0");
        assert.equal(outcome.exitCode, 0, "the command exits 0");
        const strandedHit = outcome.result.records.find((r) => r.id === "R9" || /zephyrlesson/.test(r.text));
        assert.equal(strandedHit, undefined, "no recalled record is sourced from the worker-authored lesson/ADR — it is stranded on the worker");
      });
    },
  },

  // ====================================================================
  // Scenario: after the branch merges, `git pull` + `aof work memory ingest` makes the
  // worker's lesson recallable
  // ====================================================================
  {
    name: "mesh-memory-syncback/01 after the branch merges, git pull + aof work memory ingest makes the worker's lesson recallable",
    run: async () => {
      await withMeshMemorySyncbackFixture(async (fx) => {
        fx.mergeWorkerBranch(); // the REAL git merge — "as after a git pull"
        const ctx = memoryCtxFor(fx);
        await runReal(ctx, ["ingest", "--all"]);
        const { outcome } = await runReal(ctx, ["recall", "zephyrlesson"]);
        assert.equal(outcome.ok, true, "the command exits 0");
        assert.equal(outcome.exitCode, 0, "the command exits 0");

        const hit = outcome.result.records.find((r) => r.id === "R9");
        assert.ok(hit, "the recalled records include the worker-authored RETROSPECTIVE R9 lesson");
        assert.equal(hit.recordType, "lesson", "the worker-authored record carries recordType lesson");

        // "each recalled record's 'source' resolves to live text at its 'path:line'
        // within the control's OWN checkout, never a peer's cache" — asserted over
        // EVERY recalled record, not only the worker's.
        assert.ok(outcome.result.records.length > 0, "the recall returned at least one record to check");
        for (const record of outcome.result.records) {
          const { absPath, line } = resolveRecordSourcePath(record, { workDir: ctx.workDir, projectRoot: ctx.projectRoot });
          assert.ok(
            path.resolve(absPath).startsWith(path.resolve(ctx.workDir)),
            `record ${record.id}'s source resolves WITHIN the control's OWN checkout (${absPath}), never a peer's cache`,
          );
          const lines = (await readFile(absPath, "utf8")).split(/\r?\n/);
          assert.ok(line >= 1 && line <= lines.length, `record ${record.id}'s source line ${line} is in range`);
          assert.ok(lines[line - 1].includes(record.id), `record ${record.id}'s source traces to LIVE TEXT naming it (got: "${lines[line - 1]}")`);
        }
      });
    },
  },

  // ====================================================================
  // Scenario Outline: each worker-authored knowledge artifact becomes recallable after
  // the control re-ingests its checkout
  // ====================================================================
  ...[
    { label: "RETROSPECTIVE `R<n>` lesson", query: "zephyrlesson", id: "R9", recordType: "lesson", area: "memory" },
    { label: "`ADR-NNN` block", query: "zephyradr", id: "ADR-902", recordType: "adr", area: "architecture" },
  ].map((row) => ({
    name: `mesh-memory-syncback/01 each worker-authored knowledge artifact becomes recallable after the control re-ingests its checkout — ${row.label}`,
    run: async () => {
      await withMeshMemorySyncbackFixture(async (fx) => {
        fx.mergeWorkerBranch();
        const ctx = memoryCtxFor(fx);
        await runReal(ctx, ["ingest", "--all"]);
        const { outcome } = await runReal(ctx, ["recall", row.query]);
        assert.equal(outcome.ok, true, "the command exits 0");
        const hit = outcome.result.records.find((r) => r.id === row.id);
        assert.ok(hit, `the recalled records include the worker-authored record of recordType ${row.recordType} (id ${row.id})`);
        assert.equal(hit.recordType, row.recordType, `that record carries recordType ${row.recordType}`);
        assert.equal(hit.area, row.area, `that record carries area ${row.area}`);
      });
    },
  })),

  // ====================================================================
  // Scenario: a query matching no worker-authored artifact recalls nothing new after
  // the re-ingest
  // ====================================================================
  {
    name: "mesh-memory-syncback/01 a query matching no worker-authored artifact recalls nothing new after the re-ingest",
    run: async () => {
      await withMeshMemorySyncbackFixture(async (fx) => {
        fx.mergeWorkerBranch();
        const ctx = memoryCtxFor(fx);
        await runReal(ctx, ["ingest", "--all"]);
        const { outcome } = await runReal(ctx, ["recall", "wobblefrobnicate999"]);
        assert.equal(outcome.ok, true, "the command exits 0");
        const hit = outcome.result.records.find((r) => r.id === "R9" || r.id === "ADR-902");
        assert.equal(hit, undefined, "no recalled record is sourced from the worker-authored lesson/ADR for an off-topic query");
      });
    },
  },
];
