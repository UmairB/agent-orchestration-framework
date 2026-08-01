// Fitness functions for m42 wave (d) leg d4, PORT 2 (PRD-command-spine-effects-
// ledger, "the two reclaim implementations unify on one transition edge + shared
// cascade").
//
// THE DEFECT THIS CLOSES. A reclaim IS a run completion — the legal running →
// failed edge with failureReason `runtime_offline` and a reclaimedAt stamp — but
// neither reclaim path went through the completion seam, so neither raised
// `run.completed` and each carried whatever consequence its own author
// remembered:
//
//   the RESTART scan   (run-store's reclaimStaleRuns, called by work:run-start)
//                      returned its reclaimed entries and the COMMAND looped
//                      `rollbackItemStatus` over them — a hand copy of the
//                      ledger's own rollback-status reactor;
//   the CONTROL tick   (mesh-assignment-reclaim's dual-staleness reclaim) wrote
//                      its own inline copy of the reclaim edge — under a comment
//                      claiming it was "reusing the EXACT applyTransition edge" —
//                      and then rolled NOTHING back. A control-side reclaim left
//                      the item reading `in-progress` forever.
//
// Two implementations of one act, one of them silently missing its consequence.
// `reclaimRun` is the one edge, `transitionRunReclaimed` the one door to it, and
// the rollback is the DECLARED cascade of the `run.completed` it raises — so both
// halves now inherit it and neither can drift again.
//
//   (1) THE RESTART HALF pays the rollback through the ledger, not a loop.
//   (2) THE CONTROL HALF pays the SAME rollback — the behaviour it never had.
//   (3) The reclaim edge is stated ONCE (no second literal runtime_offline +
//       reclaimedAt write anywhere in src/).
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openGlobalWorkProjectionStore } from "../../src/global-work-store.mjs";
import { assembleAssignmentRecord, insertAssignment, readAssignment } from "../../src/assignment-record.mjs";
import { publishPresenceRecord } from "../../src/mesh-presence.mjs";
import { startRun, heartbeat, readRuns } from "../../src/run-store.mjs";
import { findWork } from "../../src/work.mjs";
import { reclaimStaleAssignments, DEFAULT_ASSIGNMENT_HEARTBEAT_STALE_MS } from "../../src/mesh-assignment-reclaim.mjs";
import { transitionStaleRunsReclaimed } from "../../src/effects/run-transitions.mjs";
import { openEffectsJournal, readEvents } from "../../src/effects/journal.mjs";
import { withMeshWorkerExecFixture } from "../support/mesh-worker-exec-fixture.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC_DIR = path.join(repoRoot, "src");

const NOW = "2026-07-09T12:00:00.000Z";
const TARGET_NODE = "node-b";
const secondsBefore = (iso, seconds) => new Date(Date.parse(iso) - seconds * 1000).toISOString();
const msBefore = (iso, ms) => new Date(Date.parse(iso) - ms).toISOString();

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

async function listSourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listSourceFiles(full)));
    else if (entry.isFile() && entry.name.endsWith(".mjs")) files.push(full);
  }
  return files;
}

// Flip an item's record doc to in-progress so a rollback is APPLICABLE (the writer
// is bounded to in-progress → not-started; a not-started item is the sanctioned
// no-op and would make the proof vacuous).
async function markInProgress(docPath) {
  const text = await readFile(docPath, "utf8");
  await writeFile(docPath, text.replace(/status:\s*\S+/, "status: in-progress"), "utf8");
}

export const archTests = [
  {
    name: "arch/m42-d4-port2: the RESTART reclaim rolls the item back through the declared cascade (no inline loop) and journals the completion",
    run: async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "aof-reclaim-edge-"));
      const globalHome = await mkdtemp(path.join(os.tmpdir(), "aof-reclaim-edge-gh-"));
      const journalOptions = { env: { ...process.env, AOF_GLOBAL_HOME: globalHome } };
      try {
        const dir = path.join(root, "wiki", "work", "20_milestone_reclaim");
        await mkdir(dir, { recursive: true });
        const specPath = path.join(dir, "SPEC.md");
        await writeFile(
          specPath,
          '---\ntype: milestone\nnumber: "20"\nslug: reclaim\nstatus: in-progress\ntitle: "Reclaim"\ncreated: 2026-07-09\nupdated: 2026-07-09\n---\n# Reclaim\n',
          "utf8",
        );
        const item = { ref: "20", dir, type: "milestone" };
        const run = await startRun(item, { now: msBefore(NOW, 30 * 60 * 1000) });

        const settled = await transitionStaleRunsReclaimed(
          [item],
          { now: NOW, stalenessThreshold: 60_000 },
          { journalOptions },
        );

        assert.equal(settled.length, 1, "the stale running run is reclaimed");
        assert.equal(settled[0].record.runId, run.runId, "…the one that was stale");
        assert.equal(settled[0].record.state, "failed", "the run is force-failed");
        assert.equal(settled[0].record.failureReason, "runtime_offline", "…runtime_offline (retryable)");
        assert.ok(settled[0].record.reclaimedAt, "…and stamped reclaimedAt");

        // THE CASCADE, not a loop: the rollback reactor ran off the raised event.
        const rollback = settled[0].effects.find((outcome) => outcome.key === "rollback-status");
        assert.ok(rollback, "the reclaim's completion declared the rollback-status reactor");
        assert.equal(rollback.status, "done", "…and it was paid");
        assert.match(await readFile(specPath, "utf8"), /status: not-started/, "the item rolled back on disk");

        const journal = await openEffectsJournal(journalOptions);
        try {
          const events = readEvents(journal, { name: "run.completed" });
          assert.equal(events.length, 1, "the reclaim journaled exactly one completion");
          assert.equal(events[0].payload.reclaimed, true, "…marked as a reclaim");
          assert.equal(events[0].payload.outcome, "failed", "…with the failed outcome the rollback keys on");
        } finally {
          journal.close();
        }
      } finally {
        await rm(root, { recursive: true, force: true });
        await rm(globalHome, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/m42-d4-port2: the CONTROL tick's reclaim now pays the SAME rollback — the consequence that half never had",
    run: async () => {
      await withMeshWorkerExecFixture(async (fx) => {
        const store = await openGlobalWorkProjectionStore(fx.env ? { env: fx.env } : {});
        try {
          const matches = await findWork(fx.workDir, fx.itemRef);
          const item = matches.find((row) => row.ref === fx.itemRef) ?? matches[0];
          assert.ok(item, "the fixture item resolves");
          const docPath = path.join(item.dir, "STORY.md");
          await markInProgress(docPath);

          const runRecord = await startRun(item, { now: secondsBefore(NOW, 600), node: TARGET_NODE });
          await heartbeat(item, runRecord.runId, { now: msBefore(NOW, DEFAULT_ASSIGNMENT_HEARTBEAT_STALE_MS + 60_000) });
          const record = assembleAssignmentRecord({
            itemRef: fx.itemRef,
            workspaceId: fx.workspaceId,
            targetNodeId: TARGET_NODE,
            issuer: "control-a",
            state: "running",
            runId: runRecord.runId,
            now: secondsBefore(NOW, 600),
          });
          insertAssignment(store, record);
          await publishPresenceRecord(fx.workspace, TARGET_NODE, {
            nodeId: TARGET_NODE,
            heartbeatAt: secondsBefore(NOW, 120),
            activeRuns: [],
            aofVersion: "1.0.0",
          });

          const reclaimed = await reclaimStaleAssignments(store, fx.workspace, fx.workspaceId, {
            now: NOW,
            globalWorkStoreOptions: fx.env ? { env: fx.env } : {},
          });

          assert.equal(reclaimed.length, 1, "the dual-stale assignment is reclaimed (unchanged)");
          assert.equal(readAssignment(store, record.assignmentId).state, "reclaimed", "the assignment row settles");

          const runs = await readRuns(item);
          const failed = runs.find((row) => row.runId === runRecord.runId);
          assert.equal(failed.state, "failed", "the linked run is force-failed (unchanged)");
          assert.equal(failed.failureReason, "runtime_offline", "…runtime_offline, retryable (unchanged)");

          // THE NEW HALF: the item's status rolls back, exactly as the restart-time
          // reclaim has always done. Before port 2 this path rolled nothing back and
          // the item read `in-progress` with no run behind it.
          assert.match(
            await readFile(docPath, "utf8"),
            /status: not-started/,
            "the control-side reclaim rolls the item back through the declared cascade",
          );
        } finally {
          store.close();
        }
      });
    },
  },
  {
    name: "arch/m42-d4-port2: the reclaim edge is written ONCE — no second inline runtime_offline + reclaimedAt write in src/",
    run: async () => {
      const files = await listSourceFiles(SRC_DIR);
      const offenders = [];
      for (const file of files) {
        const rel = path.relative(repoRoot, file).replaceAll("\\", "/");
        if (rel === "src/run-store.mjs") continue; // the edge's one home
        const code = stripComments(await readFile(file, "utf8"));
        // The signature of a hand-rolled reclaim: the retryable failure reason and
        // the reclaim stamp written together at one call site.
        if (/failureReason:\s*["']runtime_offline["']/.test(code) && /reclaimedAt:/.test(code)) {
          offenders.push(rel);
        }
      }
      assert.deepEqual(offenders, [], `the reclaim edge has one home (offenders: ${offenders.join(", ")})`);
      // Non-vacuous: the detector fires on the shape that was deleted from
      // mesh-assignment-reclaim.mjs.
      const planted = 'await applyTransition(item, id, "failed", { now, failureReason: "runtime_offline", reclaimedAt: now });';
      assert.ok(
        /failureReason:\s*["']runtime_offline["']/.test(planted) && /reclaimedAt:/.test(planted),
        "the detector catches a re-planted inline reclaim edge",
      );
    },
  },
];
