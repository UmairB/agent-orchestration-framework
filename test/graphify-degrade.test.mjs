// Traceability wiring for milestone 10 / story 02 (extraction-posture-and-fallback),
// task 01 — 01_binary-absent-degrades-gracefully.feature.
//
// Covers EVERY @executable scenario AND every Scenario-Outline Examples row of that
// feature against the REAL graphify backend module (../src/memory/graphify-backend.mjs)
// driven through the REAL seam (`runMemory` for the --json projections). The Background
// is the 09 acd-graph-binary-absent idiom, HERMETIC (no live binary):
//   - resolveGraphifyBinary reports { found:false, hint } — injected on ctx as the
//     stub `ctx.resolveGraphifyBinary` (status reads it) AND as the `ctx.invoke` that
//     throws the structured `graphify-missing` (424) miss graph:build raises when the
//     binary is absent (reindex catches it);
//   - a reindex first POPULATES the 05 record store (the records half needs no binary),
//     so recall/brief have records to degrade over.
//
// The degrade SHAPE per verb (ADR-004): recall/brief stay populated + un-graph-ranked
// with a VISIBLE diagnostic, reindex rebuilds records + skips the graph with the install
// hint, status reports the binary-absent graph state. No verb throws.
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import graphifyBackend, {
  GRAPH_SIGNAL_UNAVAILABLE,
  GRAPH_STATE_BINARY_ABSENT,
} from "../src/memory/graphify-backend.mjs";
import { runMemory, resolveConfiguredBackend, briefDigest } from "../src/work-memory.mjs";

const MEMORY_RECORD_KEYS = [
  "recordType", "id", "item", "itemSlug", "title",
  "area", "stage", "kind", "owner", "status", "summary", "text", "source",
];

// The 09 resolveGraphifyBinary structured miss the Background pins: found:false + the
// `aof project provision graphify` install hint (12/ADR-004 wording).
const INSTALL_HINT = "Run `aof project provision graphify` to install graphify into the managed tool store.";
const ABSENT_RESOLVER = () => ({ found: false, hint: INSTALL_HINT });

function retroFor(n) {
  return `---
doc: retrospective
ref: "${n}"
---
# ${n} · Stream ${n} — Retrospective

## R1 — Derived index invariant lesson for milestone ${n}

- **Kind:** near-miss · **Area:** tooling · **Stage:** build · **Owner:** developer · **Raised by:** developer
- **What happened:** the derived index invariant held for ${n}.
- **Why:** because the records trace to source.
- **Lesson:** the distilled derived index invariant gist for ${n}.
`;
}

function archFor(n) {
  return `---
doc: architecture
---
# ${n} · Stream ${n} — Architecture Decisions

## ADR-001: A derived index decision in milestone ${n}

**Status:** Accepted
**Date:** 2026-06-22

**Context.** some context for the derived index invariant in ${n}.

**Decision.** the derived index decision gist for ${n}.

**Invariant.** the derived index invariant for ${n}.
`;
}

async function tempStream(milestones) {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "aof-graphify-degrade-"));
  const workDir = path.join(projectRoot, "wiki", "work");
  for (const n of milestones) {
    const dir = path.join(workDir, `${n}_milestone_stream-${n}`);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "RETROSPECTIVE.md"), retroFor(n), "utf8");
    await writeFile(path.join(dir, "ARCHITECTURE.md"), archFor(n), "utf8");
  }
  await mkdir(path.join(projectRoot, ".aof"), { recursive: true });
  return { projectRoot, workDir };
}

// The INJECTED invoke that simulates the binary-absent reality: graph:build throws the
// structured graphify-missing (424) — exactly src/commands/graph-build.mjs's
// commandError(resolved.hint, "graphify-missing", 424). The hint IS the install hint.
function missingBinaryInvoke() {
  return async () => {
    const error = new Error(INSTALL_HINT);
    error.code = "graphify-missing";
    error.status = 424;
    throw error;
  };
}

// The INJECTED invoke that simulates a PRESENT-but-BLOCKING binary: graph:build's spawn
// outran the wall-clock guard and was force-killed, so it throws the structured
// `graphify-timeout` (the exact code src/graphify.mjs raises on ETIMEDOUT). This is the
// case the original hang lived in — an unbounded spawnSync blocked `ingest`/`reindex`
// forever. reindex must CATCH it and still rebuild the records (TERMINATE, not block).
function timeoutInvoke() {
  return async () => {
    const error = new Error(
      "graphify timed out after 120000ms — raise AOF_GRAPHIFY_TIMEOUT_MS for a large repo, or check the extraction backend is not blocking."
    );
    error.code = "graphify-timeout";
    throw error;
  };
}

function fakeLoadWorkspace(projectRoot) {
  return async () => ({
    config: { name: "demo", resources: [], memory: { backend: "graphify" } },
    configPath: path.join(projectRoot, ".aof", "aof.config.json"),
    projectRoot,
    workDir: path.join(projectRoot, "wiki", "work"),
  });
}

// A Background ctx like ctxFor, but graph:build TIMES OUT (present binary blocked +
// force-killed) instead of being absent — the reindex-terminates-on-timeout regression.
function timeoutCtxFor(projectRoot) {
  return {
    workDir: path.join(projectRoot, "wiki", "work"),
    projectRoot,
    configMemory: { backend: "graphify" },
    invoke: timeoutInvoke(),
    loadWorkspace: fakeLoadWorkspace(projectRoot),
  };
}

// The Background ctx: graphify selected, the binary absent (resolveGraphifyBinary →
// found:false with the install hint), reachable both ways the verbs need it —
// reindex's graph:build via ctx.invoke (throws graphify-missing) and status's
// ctx.resolveGraphifyBinary (the structured miss).
function ctxFor(projectRoot) {
  return {
    workDir: path.join(projectRoot, "wiki", "work"),
    projectRoot,
    configMemory: { backend: "graphify" },
    invoke: missingBinaryInvoke(),
    loadWorkspace: fakeLoadWorkspace(projectRoot),
    resolveGraphifyBinary: ABSENT_RESOLVER,
  };
}

// Background: a reindex has populated the 05 record store (the records half needs no
// binary). Returns a ctx the verbs run through, with the binary absent throughout.
async function backgroundReindexed(milestones = ["00", "01"]) {
  const { projectRoot, workDir } = await tempStream(milestones);
  const ctx = ctxFor(projectRoot);
  const reindexResult = await graphifyBackend.reindex(null, ctx);
  return { projectRoot, workDir, ctx, reindexResult };
}

async function assertSourceResolves(record, workDir) {
  const lastColon = record.source.lastIndexOf(":");
  const relPath = record.source.slice(0, lastColon);
  const line = Number.parseInt(record.source.slice(lastColon + 1), 10);
  const absPath = path.join(workDir, relPath);
  assert.ok(existsSync(absPath), `source file ${relPath} exists for ${record.id}`);
  const lines = (await readFile(absPath, "utf8")).split(/\r?\n/);
  assert.ok(line >= 1 && line <= lines.length, `source line ${line} in range for ${record.id}`);
  assert.ok(
    lines[line - 1].includes(record.id),
    `source ${record.source} traces to live text naming ${record.id} (got: "${lines[line - 1]}")`
  );
}

function assertFrozenRecord(record) {
  for (const key of MEMORY_RECORD_KEYS) {
    assert.ok(key in record, `record ${record.id} has frozen field "${key}"`);
    assert.equal(typeof record[key], "string", `record ${record.id} field "${key}" is a string`);
  }
}

// The 05 base ranking is length-normalised, highest-score-first (05/ADR-006). With the
// graph unavailable, recall returns the base ranking EXACTLY (no graph re-rank term):
// scores are non-increasing and there is NO graph boost (the graphSignal is unavailable).
function assertBaseRankedNonIncreasing(records) {
  for (let i = 1; i < records.length; i += 1) {
    assert.ok(
      records[i - 1].score >= records[i].score,
      `records are base-ranked (score non-increasing): #${i - 1}=${records[i - 1].score} >= #${i}=${records[i].score}`
    );
  }
}

// Run a memory verb through the REAL seam with graphify selected, capturing --json
// stdout (exit code + parsed JSON / raw text).
async function runVerb(argv, ctx) {
  const lines = [];
  const outcome = await runMemory(argv, {
    config: { memory: { backend: "graphify" } },
    resolveBackend: (cfg) => resolveConfiguredBackend(cfg),
    ctx,
    log: (l) => lines.push(l),
  });
  return { outcome, output: lines.join("\n") };
}

export const graphifyDegradeTests = [
  // ====================================================================
  // 01_binary-absent-degrades-gracefully.feature
  // ====================================================================
  {
    name: "graphify/degrade: recall degrades to un-graph-ranked recall over the 05 records with a visible diagnostic",
    run: async () => {
      const { ctx, workDir } = await backgroundReindexed();
      let result;
      // Never throws on the missing binary (the @executable boundary of the universal
      // throw-free guard, which is the story-03 arch-test's).
      await assert.doesNotReject(async () => {
        result = await graphifyBackend.recall("derived index invariant", {}, {}, ctx);
      }, "recall never throws when the graphify binary is absent");

      // The records array is non-empty (the records are still there — ADR-004).
      assert.ok(Array.isArray(result.records) && result.records.length > 0, "the recall records array is non-empty");

      // Every record is a frozen MemoryRecord and its source resolves to live text.
      for (const record of result.records) {
        assertFrozenRecord(record);
        await assertSourceResolves(record, workDir);
      }

      // The frozen RecallResult shape is INTACT (the diagnostic is additive metadata,
      // NOT a 5th enumerable key — story-00's recall-returns-frozen-records stays green).
      assert.deepEqual(
        Object.keys(result).sort(),
        ["query", "records", "scope", "text"],
        "the frozen RecallResult shape stays exactly { query, scope, records, text }"
      );

      // Ranked by the 05 base ranking, WITHOUT a graph re-rank term (un-graph-ranked):
      // scores are non-increasing, and the recall over the SAME store WITHOUT the
      // graph (the only state available here) is byte-for-byte the base ranking — the
      // graph could not have re-ranked because none is present.
      assertBaseRankedNonIncreasing(result.records);

      // The visible diagnostic: the graph signal was unavailable (ADR-004 — the degrade
      // is VISIBLE, not silent). Carried as the non-enumerable `graphSignal` AND mirrored
      // into the human text view.
      assert.equal(result.graphSignal, GRAPH_SIGNAL_UNAVAILABLE, "the result carries graphSignal=unavailable");
      assert.match(result.text, /graph signal unavailable/i, "the human text view notes the un-graph-ranked fallback");
    },
  },
  {
    name: "graphify/degrade: brief inherits the same degrade — populated, un-graph-ranked, no throw",
    run: async () => {
      const { ctx } = await backgroundReindexed();
      // brief is COMPOSED seam-side over recall (no separate interface method): reach
      // backend.recall the same way the seam does, then derive the digest.
      let recalled;
      await assert.doesNotReject(async () => {
        recalled = await graphifyBackend.recall("", {}, { limit: Infinity }, ctx);
      }, "brief's underlying recall never throws when the binary is absent");
      const digest = briefDigest(recalled.records ?? [], {});

      // The digest is POPULATED from the un-graph-ranked recall (lessons + adrs present).
      assert.ok(digest.lessonCount + digest.adrCount > 0, "the brief digest is populated from the recall records");
      assert.ok(typeof digest.text === "string" && digest.text.length > 0, "the brief digest renders a non-empty text view");
      // The recall it inherited from is un-graph-ranked (the diagnostic rides the recall).
      assert.equal(recalled.graphSignal, GRAPH_SIGNAL_UNAVAILABLE, "the inherited recall is un-graph-ranked (graphSignal=unavailable)");
    },
  },
  {
    name: "graphify/degrade: reindex rebuilds the records and skips the graph with a clear binary-absent hint",
    run: async () => {
      const { ctx } = await backgroundReindexed();
      let result;
      await assert.doesNotReject(async () => {
        result = await graphifyBackend.reindex(null, ctx);
      }, "reindex never throws when the graphify binary is absent");

      // The record store is rebuilt and non-empty (the records half needs no binary).
      assert.equal(result.backend, "graphify", "the result is the graphify backend's");
      assert.ok(result.recordCount > 0, "the record store is rebuilt and non-empty");
      assert.ok(Array.isArray(result.records) && result.records.length > 0, "the rebuilt records are returned");

      // The graph was SKIPPED specifically because the graphify binary is absent.
      assert.equal(result.graph.built, false, "the graph build was skipped, not crashed");
      assert.equal(result.graph.skipped, "graphify-missing", "the skip carries the structured graphify-missing code");
      assert.equal(result.graph.binaryAbsent, true, "the skip is flagged binary-absent");

      // The skipped-graph signal carries the install hint (the 09 structured miss).
      assert.ok(typeof result.graph.hint === "string" && result.graph.hint.length > 0, "the skip carries a non-empty install hint");
      assert.match(result.graph.hint, /aof project provision/, "the install hint names `aof project provision`");
      assert.match(result.graph.reason, /graph skipped \(graphify binary absent/, "the reason is the ADR-004 graph-skipped shape");
    },
  },
  {
    // Regression for the `aof work memory ingest`/`reindex` HANG: a PRESENT graphify
    // binary whose extraction blocks used to hang reindex forever (unbounded spawnSync).
    // With the spawn now bounded, graph:build raises graphify-timeout on overrun; reindex
    // must CATCH it and TERMINATE with the records rebuilt (they were written before the
    // graph attempt) — never hang, never crash.
    name: "graphify/degrade: reindex TERMINATES and fails soft when the graph build times out (records rebuilt, graph skipped)",
    run: async () => {
      const { projectRoot } = await tempStream(["00", "01"]);
      const ctx = timeoutCtxFor(projectRoot);
      let result;
      await assert.doesNotReject(async () => {
        result = await graphifyBackend.reindex(null, ctx);
      }, "reindex never hangs/throws when the graph build times out — it returns");

      // The records half is unaffected — the store was written BEFORE the graph attempt.
      assert.equal(result.backend, "graphify", "the result is the graphify backend's");
      assert.ok(result.recordCount > 0, "the record store is rebuilt and non-empty");
      assert.ok(Array.isArray(result.records) && result.records.length > 0, "the rebuilt records are returned");

      // The graph was SKIPPED with the structured timeout code + a visible reason.
      assert.equal(result.graph.built, false, "the graph build was skipped, not crashed");
      assert.equal(result.graph.skipped, "graphify-timeout", "the skip carries the structured graphify-timeout code");
      assert.equal(result.graph.timedOut, true, "the skip is flagged as a timeout");
      assert.equal(result.graph.binaryAbsent, false, "a timeout is NOT a binary-absent skip");
      assert.match(result.graph.reason, /graph skipped \(graphify timed out/, "the reason is the ADR-004 graph-skipped shape");
    },
  },
  {
    name: "graphify/degrade: status reports the backend, record count, and the binary-absent graph state",
    run: async () => {
      const { ctx } = await backgroundReindexed();
      let result;
      await assert.doesNotReject(async () => {
        result = await graphifyBackend.status(ctx);
      }, "status never throws when the graphify binary is absent");

      assert.equal(result.backend, "graphify", 'status reports the backend "graphify"');
      assert.equal(typeof result.recordCount, "number", "status reports a numeric record count");
      assert.ok(result.recordCount > 0, "status reports the (populated) record count");

      // The graph state is binary-absent (ADR-004), with the install hint.
      assert.equal(result.graphState, GRAPH_STATE_BINARY_ABSENT, "status reports the binary-absent graph state");
      assert.ok(typeof result.graphHint === "string" && result.graphHint.length > 0, "status carries the install hint");
      assert.match(result.graphHint, /aof project provision/, "the install hint names `aof project provision`");
    },
  },
  // Scenario Outline: every verb degrades to its shape with the binary absent, exiting 0.
  //   | verb    | args                          | shape                                                            |
  //   | recall  | "derived index invariant"     | non-empty 05 records, un-graph-ranked, + graph-unavailable diag  |
  //   | brief   |                               | a populated un-graph-ranked digest                               |
  //   | reindex |                               | records rebuilt, graph skipped (binary absent + install hint)    |
  //   | status  |                               | { backend: "graphify", recordCount, graphState: binary-absent }  |
  {
    name: "graphify/degrade: outline — recall exits 0 with non-empty un-graph-ranked records + the graph-unavailable diagnostic",
    run: async () => {
      const { ctx } = await backgroundReindexed();
      const { outcome, output } = await runVerb(["recall", "derived index invariant", "--json"], ctx);
      assert.equal(outcome.exitCode, 0, "recall exits 0 with the binary absent");
      const records = JSON.parse(output);
      assert.ok(Array.isArray(records) && records.length > 0, "recall --json emits a non-empty records array");
      assertBaseRankedNonIncreasing(records);
      // The diagnostic rides the RecallResult returned to the seam (the records --json
      // projection is the frozen contract; the diagnostic is on the result object).
      assert.equal(outcome.result.graphSignal, GRAPH_SIGNAL_UNAVAILABLE, "the RecallResult carries graphSignal=unavailable");
    },
  },
  {
    name: "graphify/degrade: outline — brief exits 0 with a populated un-graph-ranked digest",
    run: async () => {
      const { ctx } = await backgroundReindexed();
      const { outcome, output } = await runVerb(["brief"], ctx);
      assert.equal(outcome.exitCode, 0, "brief exits 0 with the binary absent");
      assert.ok(output.length > 0, "brief renders a populated digest");
      assert.match(output, /lesson\(s\), \d+ adr\(s\)/, "the digest reports lesson/adr counts");
    },
  },
  {
    name: "graphify/degrade: outline — reindex exits 0 with records rebuilt + graph skipped (binary absent + install hint)",
    run: async () => {
      const { ctx } = await backgroundReindexed();
      const { outcome, output } = await runVerb(["reindex", "--json"], ctx);
      assert.equal(outcome.exitCode, 0, "reindex exits 0 with the binary absent");
      const summary = JSON.parse(output);
      assert.ok(summary.recordCount > 0, "reindex rebuilt a non-empty record store");
      assert.equal(summary.graph.built, false, "the graph was skipped");
      assert.equal(summary.graph.binaryAbsent, true, "the skip is flagged binary-absent");
      assert.match(summary.graph.hint, /aof project provision/, "the skip carries the install hint");
    },
  },
  {
    name: "graphify/degrade: outline — status exits 0 with { backend: graphify, recordCount, graphState: binary-absent }",
    run: async () => {
      const { ctx } = await backgroundReindexed();
      const { outcome, output } = await runVerb(["status", "--json"], ctx);
      assert.equal(outcome.exitCode, 0, "status exits 0 with the binary absent");
      const parsed = JSON.parse(output);
      assert.equal(parsed.backend, "graphify", "status reports backend graphify");
      assert.equal(typeof parsed.recordCount, "number", "status reports a numeric record count");
      assert.equal(parsed.graphState, GRAPH_STATE_BINARY_ABSENT, "status reports graphState binary-absent");
      assert.match(parsed.graphHint, /aof project provision/, "status carries the install hint");
    },
  },
];
