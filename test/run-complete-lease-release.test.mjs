// Traceability wiring for milestone 26 / story 02 — the lease lifecycle behind the
// EXISTING verbs (tasks/01_lease-release-on-complete.feature, ADR-003.2 + ADR-004
// consequences + ADR-001's node key).
//
// Covers EVERY @executable scenario / Scenario-Outline row, exercising the REAL
// in-process registry (loadWorkspace + invoke over src/commands/run-complete.mjs /
// run-retry.mjs) against a temp fixture repo — plain fs fixtures (no git needed: the
// release and the retry are LOCAL writes; the sync tick carries them later).
//
//   01_lease-release-on-complete.feature —
//     - EVERY terminal outcome (done|failed|cancelled) flips the holder's OWN claim
//       file to state "released" — a STATE write, never a delete; no other
//       contender's file is touched;
//     - after completion the item reads claimable again (no live claim; a fresh
//       claim is not blocked by the released file);
//     - work:run-retry carries the node through the retry lineage (same node id,
//       same partition, retryOf linked, the prior byte-unchanged);
//     - THE UNCONFIGURED FLOOR: no mesh ⇒ complete + retry byte-identical to today —
//       flat records, node null, and the lease seam never appears on disk.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadWorkspace } from "../src/work.mjs";
import { invoke } from "../src/command-core.mjs";
import { meshDir, leaseClaimPath } from "../src/mesh-store.mjs";
import { runsDir, runRecordPath, runNodeRecordPath } from "../src/run-store.mjs";
import { acquireLease, readItemClaims, claimLiveness } from "../src/mesh-lease.mjs";

const NOW = "2026-07-02T12:00:00.000Z";
const ITEM_REF = "00";
const NODE_ID = "node-a";
const RUN_ID = "20260702T100000000Z-0000";

function frontmatter(fields) {
  const body = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("\n");
  return `---\n${body}\n---\n`;
}

async function makeRepo({ mesh } = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-lease-release-"));
  const workDir = path.join(repo, "wiki", "work");
  const itemDir = path.join(workDir, "00_milestone_m0");
  await mkdir(itemDir, { recursive: true });
  await writeFile(
    path.join(itemDir, "SPEC.md"),
    frontmatter({ type: "milestone", number: "00", slug: "m0", status: "in-progress", created: "2026-07-01", updated: "2026-07-01" }),
    "utf8"
  );
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  const config = { name: "fixture", work: { dir: "./wiki/work" } };
  if (mesh !== undefined) config.mesh = mesh;
  await writeFile(path.join(repo, ".aof", "aof.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  const workspace = await loadWorkspace(repo);
  return { repo, workDir, itemDir, workspace, item: { ref: ITEM_REF, dir: itemDir } };
}

// Write a FOURTEEN-key run record directly (the fixture writer — placement mirrors the
// store's record-driven persist: node set ⇒ the node partition, null ⇒ flat).
async function seedRun(item, { runId = RUN_ID, state = "running", node = null, failureReason = null, attempt = 1, sessionId = null } = {}) {
  const record = {
    runId,
    itemRef: item.ref,
    state,
    attempt,
    outcome: state === "running" || state === "queued" ? null : state,
    sessionId,
    brief: {},
    createdAt: "2026-07-02T10:00:00.000Z",
    updatedAt: "2026-07-02T10:00:00.000Z",
    failureReason,
    heartbeatAt: "2026-07-02T11:59:00.000Z",
    retryOf: null,
    reclaimedAt: null,
    node,
  };
  const target = node ? runNodeRecordPath(item, node, runId) : runRecordPath(item, runId);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(record, null, 2), "utf8");
  return record;
}

async function seedClaim(workspace, itemRef, nodeId, state = "claimed", runId = null) {
  const target = leaseClaimPath(workspace, itemRef, nodeId);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(
    target,
    JSON.stringify({ itemRef, nodeId, state, claimedAt: "2026-07-02T11:00:00.000Z", runId, aofVersion: "0.1.0" }, null, 2),
    "utf8"
  );
}

const cleanup = (dir) => rm(dir, { recursive: true, force: true });

export const runCompleteLeaseReleaseTests = [
  // ══ Scenario Outline: completing a run with any terminal outcome flips the holder's
  //    own claim file to released (done / failed / cancelled) ══
  {
    name: "run-complete-lease/01 completing a run with EVERY terminal outcome (done|failed|cancelled) flips the holder's own claim file to released — a state write, never a delete, never a foreign write",
    async run() {
      for (const outcome of ["done", "failed", "cancelled"]) {
        const fx = await makeRepo({ mesh: { nodeId: NODE_ID } });
        try {
          // This node holds the lease: its claim reads "claimed" + carries the runId.
          await seedRun(fx.item, { node: NODE_ID });
          await seedClaim(fx.workspace, ITEM_REF, NODE_ID, "claimed", RUN_ID);
          // A second contender's (released) claim file — the foreign file that must
          // never be touched by this node's release.
          await seedClaim(fx.workspace, ITEM_REF, "node-b", "released", null);
          const foreignBefore = await readFile(leaseClaimPath(fx.workspace, ITEM_REF, "node-b"), "utf8");

          const result = await invoke("work:run-complete", { ref: ITEM_REF, outcome, now: NOW }, { workspace: fx.workspace });

          assert.equal(result.state, outcome, `[${outcome}] the run reaches state ${outcome}`);
          // The holder's OWN claim file flips to released — and still exists.
          const ownPath = leaseClaimPath(fx.workspace, ITEM_REF, NODE_ID);
          assert.ok(existsSync(ownPath), `[${outcome}] the claim file still exists on disk (a state write, never a delete)`);
          const own = JSON.parse(await readFile(ownPath, "utf8"));
          assert.equal(own.state, "released", `[${outcome}] the holder's own claim file flips to state released`);
          // No other contender's claim file was touched (an own-path write only).
          const foreignAfter = await readFile(leaseClaimPath(fx.workspace, ITEM_REF, "node-b"), "utf8");
          assert.equal(foreignAfter, foreignBefore, `[${outcome}] the other contender's claim file is byte-untouched`);
        } finally {
          await cleanup(fx.repo);
        }
      }
    },
  },

  // ══ Scenario: after completion the item's lease reads released and is claimable again ══
  {
    name: "run-complete-lease/01 after completion no live claim remains — the item reads claimable again and a fresh claim is not blocked by the released file",
    async run() {
      const fx = await makeRepo({ mesh: { nodeId: NODE_ID, presence: { stalenessSeconds: 60 } } });
      try {
        // This node completed its run: its claim file reads "released".
        await seedRun(fx.item, { node: NODE_ID });
        await seedClaim(fx.workspace, ITEM_REF, NODE_ID, "claimed", RUN_ID);
        await invoke("work:run-complete", { ref: ITEM_REF, outcome: "done", now: NOW }, { workspace: fx.workspace });

        // Any node reading the item's lease state finds NO live claim.
        const claims = await readItemClaims(fx.workspace, ITEM_REF);
        assert.ok(claims.length > 0, "the released claim file is still readable (history, not a hold)");
        for (const claim of claims) {
          assert.equal(
            claimLiveness(claim, null, Date.parse(NOW), 60_000),
            "not-held",
            "no live claim remains on the item (the item reads claimable again)"
          );
        }

        // A subsequent claim for the item is NOT blocked by the released file: a fresh
        // contender acquires over an injected clean sync and HOLDS.
        const result = await acquireLease(fx.workspace, ITEM_REF, "node-b", {
          runSync: async () => ({ committed: true, pushed: [], pulled: [], noop: false }),
          now: NOW,
          config: fx.workspace.config,
          aofVersion: "0.1.0",
        });
        assert.equal(result.held, true, "a subsequent claim is not blocked by the released file");
      } finally {
        await cleanup(fx.repo);
      }
    },
  },

  // ══ Scenario: work:run-retry carries the node through the retry lineage ══
  {
    name: "run-complete-lease/01 work:run-retry carries the node through the retry lineage — same node id, same partition, retryOf linked, the prior byte-unchanged",
    async run() {
      const fx = await makeRepo({ mesh: { nodeId: NODE_ID } });
      try {
        // This node owns a FAILED run with a retryable reason under its node partition.
        await seedRun(fx.item, { state: "failed", node: NODE_ID, failureReason: "timeout", attempt: 1, sessionId: "sess-1" });
        const priorBytes = await readFile(runNodeRecordPath(fx.item, NODE_ID, RUN_ID), "utf8");

        const result = await invoke("work:run-retry", { ref: ITEM_REF, now: NOW }, { workspace: fx.workspace });

        assert.equal(result.state, "running", "a new run is minted in state running");
        assert.equal(result.attempt, 2, "the attempt is incremented by one");
        assert.equal(result.retryOf, RUN_ID, "the new run's retryOf links the failed run's runId");
        assert.equal(result.node, NODE_ID, "the new run carries the same node id");
        assert.ok(
          existsSync(runNodeRecordPath(fx.item, NODE_ID, result.runId)),
          "the new run lands under the same node partition"
        );
        assert.equal(
          await readFile(runNodeRecordPath(fx.item, NODE_ID, RUN_ID), "utf8"),
          priorBytes,
          "the prior failed run record is left byte-unchanged"
        );
      } finally {
        await cleanup(fx.repo);
      }
    },
  },

  // ══ Scenario: an unconfigured-mesh install completes and retries byte-identically ══
  {
    name: "run-complete-lease/01 an unconfigured-mesh install completes and retries byte-identically to today — flat records, node null, and the lease seam never appears on disk",
    async run() {
      const fx = await makeRepo(); // no mesh config at all
      try {
        // A running run as today's unconfigured install writes it: a FLAT record, node null.
        await seedRun(fx.item, { node: null, failureReason: null });

        const completed = await invoke(
          "work:run-complete",
          { ref: ITEM_REF, outcome: "failed", reason: "timeout", now: NOW },
          { workspace: fx.workspace }
        );
        const retried = await invoke("work:run-retry", { ref: ITEM_REF, now: NOW }, { workspace: fx.workspace });

        // Byte-identical to today's unconfigured behaviour: flat placement, node null,
        // the same lineage semantics.
        assert.equal(completed.state, "failed", "the completion reaches failed");
        assert.equal(completed.node, null, "the completed record carries node null (the flat legacy shape)");
        assert.ok(existsSync(runRecordPath(fx.item, RUN_ID)), "the completed record stays at the flat path");
        assert.equal(retried.state, "running", "the retry mints a running run");
        assert.equal(retried.node, null, "the retried record carries node null");
        assert.equal(retried.retryOf, RUN_ID, "the retry lineage links as today");
        assert.ok(existsSync(runRecordPath(fx.item, retried.runId)), "the retried record stays at the flat path");
        // No node partition appeared under runs/ — every entry is a flat file.
        const entries = await readdir(runsDir(fx.item), { withFileTypes: true });
        assert.ok(entries.every((e) => e.isFile()), "no node partition appears under runs/");
        // The lease seam was never written: no lease file exists anywhere under the
        // partition root — in fact the partition root itself was never created.
        assert.ok(!existsSync(path.join(meshDir(fx.workspace), "leases")), "no lease file exists anywhere under the partition root");
        assert.ok(!existsSync(meshDir(fx.workspace)), "the partition root itself was never created (no lease read, no lease write)");
      } finally {
        await cleanup(fx.repo);
      }
    },
  },
];
