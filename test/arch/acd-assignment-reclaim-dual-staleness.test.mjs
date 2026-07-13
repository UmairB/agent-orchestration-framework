// Fitness function: acd-assignment-reclaim-dual-staleness (milestone 35 / ADR-005,
// fitness #10) — "an assignment is reclaimed ONLY under DUAL staleness (presence
// stale AND run-heartbeat stale), strict >; fresh presence and no-presence-record are
// hands-off."
//
// Proofs:
//  1. Structural — the reclaim decision ANDs isNodeStale (presence, IMPORTED from
//     mesh-presence) with isStale (run heartbeat, IMPORTED from run-store) — both
//     predicates are imported (not re-derived), and the reclaim guard is a
//     conjunction (never an OR, never a single predicate alone).
//  2. Behavioural — the key decision-table rows: stale+stale reclaims; fresh presence
//     + stale heartbeat hands-off; no presence record hands-off; exactly-AT presence
//     threshold still live.
//  Self-check (m03 non-vacuous): a planted single-predicate (heartbeat only) reclaim,
//  or a missing-presence-as-stale flip, fails the SAME detector the real (dual, KR2-
//  safe) source passes.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openGlobalWorkProjectionStore } from "../../src/global-work-store.mjs";
import { assembleAssignmentRecord, insertAssignment, readAssignment } from "../../src/assignment-record.mjs";
import { publishPresenceRecord } from "../../src/mesh-presence.mjs";
import { startRun, heartbeat } from "../../src/run-store.mjs";
import { findWork } from "../../src/work.mjs";
import { reclaimStaleAssignments, DEFAULT_ASSIGNMENT_HEARTBEAT_STALE_MS } from "../../src/mesh-assignment-reclaim.mjs";
import { withMeshWorkerExecFixture } from "../support/mesh-worker-exec-fixture.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const reclaimSourcePath = path.join(repoRoot, "src", "mesh-assignment-reclaim.mjs");

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function assertStructural(code) {
  const problems = [];
  if (!/import\s*\{[^}]*\bisNodeStale\b[^}]*\}\s*from\s*["']\.\/mesh-presence\.mjs["']/.test(code)) {
    problems.push("isNodeStale is not imported from ./mesh-presence.mjs");
  }
  if (!/import\s*\{[^}]*\bisStale\b[^}]*\}\s*from\s*["']\.\/run-store\.mjs["']/.test(code)) {
    problems.push("isStale is not imported from ./run-store.mjs");
  }
  // The decision must be a CONJUNCTION: presenceStale is checked and, only when true,
  // runStale decides — never an early "return true" off heartbeat alone, never an OR.
  if (!/presenceStale\s*=\s*isNodeStale\s*\(/.test(code)) {
    problems.push("no presenceStale = isNodeStale(...) assignment found");
  }
  if (!/if\s*\(\s*!presenceStale\s*\)\s*return\s*false/.test(code)) {
    problems.push("fresh presence does not short-circuit to hands-off (no !presenceStale early return)");
  }
  if (!/runStale\s*=\s*isStale\s*\(/.test(code)) {
    problems.push("no runStale = isStale(...) assignment found");
  }
  if (/\|\|\s*isStale\s*\(|\|\|\s*isNodeStale\s*\(/.test(code)) {
    problems.push("a disjunction (||) with a staleness predicate was found — reclaim must be a conjunction, never an OR");
  }
  if (!/presence\s*==\s*null[\s\S]{0,120}return\s*false/.test(code)) {
    problems.push("no-presence-record does not explicitly hands-off (missing presence==null guard returning false)");
  }
  return problems;
}

const NOW = "2026-07-09T12:00:00.000Z";
const secondsBefore = (iso, seconds) => new Date(Date.parse(iso) - seconds * 1000).toISOString();
const msBefore = (iso, ms) => new Date(Date.parse(iso) - ms).toISOString();
const HEARTBEAT_STALE = msBefore(NOW, DEFAULT_ASSIGNMENT_HEARTBEAT_STALE_MS + 60_000);

async function seedScenario(fx, store, { presence }) {
  const matches = await findWork(fx.workDir, fx.itemRef);
  const item = matches[0];
  const runRecord = await startRun(item, { now: secondsBefore(NOW, 600), node: "node-b" });
  await heartbeat(item, runRecord.runId, { now: HEARTBEAT_STALE });
  const record = assembleAssignmentRecord({
    itemRef: fx.itemRef,
    workspaceId: fx.workspaceId,
    targetNodeId: "node-b",
    issuer: "control-a",
    state: "running",
    runId: runRecord.runId,
    now: secondsBefore(NOW, 600),
  });
  insertAssignment(store, record);
  if (presence != null) {
    await publishPresenceRecord(fx.workspace, "node-b", { nodeId: "node-b", heartbeatAt: presence, activeRuns: [], aofVersion: "1.0.0" });
  }
  return record;
}

export const archTests = [
  {
    name: "arch/35 ADR-005 (acd-assignment-reclaim-dual-staleness): the reclaim decision ANDs isNodeStale (imported from mesh-presence) with isStale (imported from run-store) — both predicates imported, never re-derived (structural)",
    run: async () => {
      const code = stripComments(await readFile(reclaimSourcePath, "utf8"));
      const problems = assertStructural(code);
      assert.deepEqual(problems, [], `structural problems: ${JSON.stringify(problems)}`);
    },
  },
  {
    name: "arch/35 ADR-005 (acd-assignment-reclaim-dual-staleness): key decision-table rows (behavioural) — stale+stale reclaims; fresh presence + stale heartbeat hands-off; no presence record hands-off; exactly-AT threshold still live",
    run: async () => {
      const rows = [
        { presence: secondsBefore(NOW, 120), reclaimed: true, label: "stale presence" },
        { presence: secondsBefore(NOW, 30), reclaimed: false, label: "fresh presence" },
        { presence: null, reclaimed: false, label: "no presence record" },
        { presence: secondsBefore(NOW, 90), reclaimed: false, label: "exactly-AT the presence threshold" },
      ];
      for (const row of rows) {
        await withMeshWorkerExecFixture(async (fx) => {
          const store = await openGlobalWorkProjectionStore(fx.env ? { env: fx.env } : {});
          try {
            const record = await seedScenario(fx, store, { presence: row.presence });
            const result = await reclaimStaleAssignments(store, fx.workspace, fx.workspaceId, { now: NOW });
            if (row.reclaimed) {
              assert.equal(result.length, 1, `[${row.label}] reclaimed`);
            } else {
              assert.equal(result.length, 0, `[${row.label}] hands-off`);
              assert.equal(readAssignment(store, record.assignmentId).state, "running", `[${row.label}] stays running`);
            }
          } finally {
            store.close();
          }
        });
      }
    },
  },
  {
    name: "arch/35 ADR-005 (acd-assignment-reclaim-dual-staleness): self-check — a planted single-predicate (heartbeat-only) reclaim, and a missing-presence-as-stale flip, both trip the detector",
    run: async () => {
      const code = stripComments(await readFile(reclaimSourcePath, "utf8"));
      assert.deepEqual(assertStructural(code), [], "the real source is clean");

      const plantedSinglePredicate = code.replace(
        /if\s*\(\s*!presenceStale\s*\)\s*return\s*false;/,
        "// removed presence gate",
      );
      assert.ok(assertStructural(plantedSinglePredicate).length > 0, "a planted single-predicate (heartbeat only) reclaim trips the detector");

      const plantedOr = `${code}\nfunction plantedDecision(a, b) { return isNodeStale(a) || isStale(b); }\n`;
      assert.ok(assertStructural(plantedOr).length > 0, "a planted disjunction (||) trips the detector");

      const plantedMissingPresenceAsStale = code.replace(
        /if\s*\(\s*presence\s*==\s*null[\s\S]{0,120}return\s*false;/,
        "if (false) return false;",
      );
      assert.ok(assertStructural(plantedMissingPresenceAsStale).length > 0, "a missing-presence-as-stale flip trips the detector");
    },
  },
];
