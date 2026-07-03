// Traceability wiring for milestone 26 / story 02 — the fleet orphan reclaim at the
// claim path (tasks/03_fleet-orphan-reclaim.feature, ADR-006).
//
// Covers EVERY @executable scenario / Scenario-Outline row, exercising the REGISTERED
// work:run-start (loadWorkspace + invoke) over temp fixture repos with FIXTURE presence
// records + peer-partitioned run records whose stamps the test controls — the resolved
// inject-the-clock discipline: run-start's white-box `now` drives BOTH predicates
// (isNodeStale over presence, isStale over the run heartbeat), thresholds resolved from
// fixture config (presence 90s documented default via mesh.presence.stalenessSeconds;
// run heartbeat the 15m work.autonomous.heartbeatStaleMs default), so the
// exactly-at-threshold boundary row is byte-stable (strict `>` — AT the threshold is
// still live). The fixtures are non-git repos (the acquire's sync degrades to the clean
// no-git no-op — the lease mechanics are task 00's; HERE the decision table is pinned).
//
//   03_fleet-orphan-reclaim.feature —
//     - THE DUAL-STALENESS DECISION TABLE with presence precedence (5 rows, including
//       exactly-AT-the-presence-threshold ⇒ still LIVE);
//     - the reclaim in full: force-failed runtime_offline + reclaimedAt, retryable,
//       status rolled back, the item offered again, every other peer record untouched;
//     - the reclaiming winner's new run carries retryOf → the reclaimed run under the
//       WINNER's partition, the reclaimed record byte-unchanged;
//     - the dead peer's lease lapses by RULE: its claim file byte-unchanged, not
//       blocking, the reclaimer holding its OWN separate claim file;
//     - this node's OWN stale run is reclaimed under the local rules even with fresh
//       own presence (presence precedence guards PEERS, not oneself);
//     - the fleet sweep fires on ANY seek: starting one item reclaims a crashed
//       peer's orphan on another;
//     - THE UNCONFIGURED FLOOR: no mesh ⇒ only the started item's stale runs are
//       scanned, no presence read or required.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadWorkspace } from "../src/work.mjs";
import { invoke } from "../src/command-core.mjs";
import { meshDir, leaseClaimPath, presenceRecordPath } from "../src/mesh-store.mjs";
import { runRecordPath, runNodeRecordPath, isRetryable } from "../src/run-store.mjs";

const NOW = "2026-07-02T12:00:00.000Z";
const NODE_ID = "node-a"; // this node
const PEER_ID = "node-b"; // the (possibly crashed) peer
const PEER_RUN_ID = "20260702T090000000Z-0000";

const secondsBefore = (iso, seconds) => new Date(Date.parse(iso) - seconds * 1000).toISOString();

// The boundary literals (the feature's documented defaults): presence 90s (strict >),
// run heartbeat 15 minutes (strict >).
const PRESENCE_STALE = secondsBefore(NOW, 120); //  > 90s  ⇒ stale
const PRESENCE_FRESH = secondsBefore(NOW, 30); //  ≤ 90s  ⇒ fresh
const PRESENCE_AT = secondsBefore(NOW, 90); //  == 90s ⇒ still LIVE (strict >)
const HEARTBEAT_STALE = secondsBefore(NOW, 16 * 60); // > 15m ⇒ stale
const HEARTBEAT_FRESH = secondsBefore(NOW, 60); //  ≤ 15m ⇒ fresh

function frontmatter(fields) {
  const body = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("\n");
  return `---\n${body}\n---\n`;
}

// Two milestones: 00 (the peer's item, in-progress — the rollback target) and 01 (the
// unrelated item THIS node starts). Mesh configured with the 90s documented default
// spelled explicitly in fixture config.
async function makeRepo({ mesh = { nodeId: NODE_ID, presence: { stalenessSeconds: 90 } } } = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-fleet-reclaim-"));
  const workDir = path.join(repo, "wiki", "work");
  const items = {};
  for (const m of [
    { number: "00", slug: "m0", status: "in-progress" },
    { number: "01", slug: "m1", status: "not-started" },
  ]) {
    const dir = path.join(workDir, `${m.number}_milestone_${m.slug}`);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "SPEC.md"),
      frontmatter({ type: "milestone", number: m.number, slug: m.slug, status: m.status, created: "2026-07-01", updated: "2026-07-01" }),
      "utf8"
    );
    items[m.number] = { ref: m.number, dir };
  }
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  const config = { name: "fixture", work: { dir: "./wiki/work" } };
  if (mesh !== undefined && mesh !== null) config.mesh = mesh;
  await writeFile(path.join(repo, ".aof", "aof.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  const workspace = await loadWorkspace(repo);
  return { repo, workDir, workspace, items };
}

// A FOURTEEN-key run record written directly at its owner's partition (node null ⇒ flat).
async function seedRun(item, { runId = PEER_RUN_ID, state = "running", node = PEER_ID, heartbeatAt = HEARTBEAT_STALE, failureReason = null, reclaimedAt = null, attempt = 1, sessionId = null } = {}) {
  const record = {
    runId,
    itemRef: item.ref,
    state,
    attempt,
    outcome: state === "running" || state === "queued" ? null : state,
    sessionId,
    brief: {},
    createdAt: "2026-07-02T09:00:00.000Z",
    updatedAt: "2026-07-02T09:00:00.000Z",
    failureReason,
    heartbeatAt,
    retryOf: null,
    reclaimedAt,
    node,
  };
  const target = node ? runNodeRecordPath(item, node, runId) : runRecordPath(item, runId);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(record, null, 2), "utf8");
  return target;
}

async function seedPresence(workspace, nodeId, heartbeatAt) {
  await mkdir(path.join(meshDir(workspace), "presence"), { recursive: true });
  await writeFile(
    presenceRecordPath(workspace, nodeId),
    JSON.stringify({ nodeId, heartbeatAt, activeRuns: [], aofVersion: "0.1.0" }, null, 2),
    "utf8"
  );
}

async function seedClaim(workspace, itemRef, nodeId, state = "claimed") {
  const target = leaseClaimPath(workspace, itemRef, nodeId);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(
    target,
    JSON.stringify({ itemRef, nodeId, state, claimedAt: "2026-07-02T09:00:00.000Z", runId: PEER_RUN_ID, aofVersion: "0.1.0" }, null, 2),
    "utf8"
  );
  return target;
}

const itemStatus = async (item) => /(^|\n)status:\s*(.+)/.exec(await readFile(path.join(item.dir, "SPEC.md"), "utf8"))[2].trim();

const cleanup = (dir) => rm(dir, { recursive: true, force: true });

export const fleetOrphanReclaimTests = [
  // ══ Scenario Outline: a peer's running run is reclaimed only under DUAL staleness —
  //    presence precedence (6 rows, incl. the never-beat KR2 guard) ══
  {
    name: "fleet-reclaim/03 a peer's running run is reclaimed ONLY under dual staleness — presence precedence (stale+stale reclaims; fresh presence is hands-off even with a stale heartbeat; stale+fresh waits; exactly AT the presence threshold is still LIVE; NO presence record is unknown liveness — hands off)",
    async run() {
      const rows = [
        { label: "stale presence + stale heartbeat", presence: PRESENCE_STALE, heartbeat: HEARTBEAT_STALE, reclaimed: true },
        { label: "fresh presence + stale heartbeat (hands off — presence precedence)", presence: PRESENCE_FRESH, heartbeat: HEARTBEAT_STALE, reclaimed: false },
        { label: "stale presence + fresh heartbeat (wait — conservative)", presence: PRESENCE_STALE, heartbeat: HEARTBEAT_FRESH, reclaimed: false },
        { label: "fresh presence + fresh heartbeat", presence: PRESENCE_FRESH, heartbeat: HEARTBEAT_FRESH, reclaimed: false },
        { label: "exactly AT the presence threshold (age == 90s) + stale heartbeat — AT is still LIVE", presence: PRESENCE_AT, heartbeat: HEARTBEAT_STALE, reclaimed: false },
        // THE NEVER-BEAT ROW (the PO-added sixth Examples row — QA F1): a holder with
        // NO presence record is UNKNOWN liveness, not staleness (the m23 lock) —
        // hands off. This row guards the KR2 direction: flipping the null-guard to
        // treat missing-presence-as-stale reclaims a possibly-live peer and MUST go red.
        { label: "no presence record (never beat) + stale heartbeat — unknown liveness, hands off", presence: null, heartbeat: HEARTBEAT_STALE, reclaimed: false },
      ];
      for (const row of rows) {
        const fx = await makeRepo();
        try {
          // The peer owns a running run for item 00, under the peer's node partition.
          // A null presence row seeds NO presence record for the holder.
          const runPath = await seedRun(fx.items["00"], { heartbeatAt: row.heartbeat });
          if (row.presence != null) await seedPresence(fx.workspace, PEER_ID, row.presence);
          const runBefore = await readFile(runPath, "utf8");
          const statusBefore = await itemStatus(fx.items["00"]);

          // This node seeks work — the claim path is the only reclaim trigger.
          const result = await invoke("work:run-start", { ref: "01", now: NOW }, { workspace: fx.workspace, relayClient: null });
          assert.equal(result.state, "running", `[${row.label}] the seeker's own start proceeds`);

          const runAfter = JSON.parse(await readFile(runPath, "utf8"));
          if (row.reclaimed) {
            assert.equal(runAfter.state, "failed", `[${row.label}] the peer's run is force-failed`);
            assert.equal(runAfter.failureReason, "runtime_offline", `[${row.label}] with failureReason runtime_offline`);
            assert.equal(runAfter.reclaimedAt, NOW, `[${row.label}] with a reclaimedAt stamp`);
            assert.equal(await itemStatus(fx.items["00"]), "not-started", `[${row.label}] the item's status is rolled back (offered again)`);
          } else {
            assert.equal(await readFile(runPath, "utf8"), runBefore, `[${row.label}] the peer's run is left byte-unchanged`);
            assert.equal(await itemStatus(fx.items["00"]), statusBefore, `[${row.label}] the item's status is untouched`);
          }
        } finally {
          await cleanup(fx.repo);
        }
      }
    },
  },

  // ══ Scenario: the reclaimed run is force-failed retryable, its item rolled back and
  //    offered again ══
  {
    name: "fleet-reclaim/03 the reclaimed run is force-failed retryable, its item rolled back and offered again — only the legal transition was written, every other peer record byte-unchanged",
    async run() {
      const fx = await makeRepo();
      try {
        const runPath = await seedRun(fx.items["00"], { heartbeatAt: HEARTBEAT_STALE });
        // Another record of the peer's — a terminal done run — that must stay untouched.
        const doneRunPath = await seedRun(fx.items["00"], { runId: "20260702T080000000Z-0001", state: "done", heartbeatAt: null });
        await seedPresence(fx.workspace, PEER_ID, PRESENCE_STALE);
        const doneBefore = await readFile(doneRunPath, "utf8");
        const presenceBefore = await readFile(presenceRecordPath(fx.workspace, PEER_ID), "utf8");

        await invoke("work:run-start", { ref: "01", now: NOW }, { workspace: fx.workspace, relayClient: null });

        const reclaimed = JSON.parse(await readFile(runPath, "utf8"));
        assert.equal(reclaimed.state, "failed", "the peer's run reads failed");
        assert.equal(reclaimed.failureReason, "runtime_offline", "with failureReason runtime_offline");
        assert.equal(reclaimed.reclaimedAt, NOW, "and a reclaimedAt stamp");
        assert.equal(isRetryable(reclaimed.failureReason), true, "the reclaimed failure is retryable (a crashed host is infra)");
        assert.equal(await itemStatus(fx.items["00"]), "not-started", "the item's status is rolled back so the stream reads honest");
        // The item is offered again to the next seeker.
        const next = await invoke("work:next", { now: NOW }, { workspace: fx.workspace });
        assert.equal(next.ref, "00", "the item is offered again to the next seeker");
        // Every other record of the peer's is byte-unchanged (only the legal transition).
        assert.equal(await readFile(doneRunPath, "utf8"), doneBefore, "the peer's terminal run is byte-unchanged");
        assert.equal(await readFile(presenceRecordPath(fx.workspace, PEER_ID), "utf8"), presenceBefore, "the peer's presence record is byte-unchanged");
      } finally {
        await cleanup(fx.repo);
      }
    },
  },

  // ══ Scenario: the reclaiming winner's new run carries the retry lineage ══
  {
    name: "fleet-reclaim/03 the reclaiming winner's new run carries retryOf → the reclaimed run, under the WINNER's partition — the reclaimed record stays terminal and byte-unchanged",
    async run() {
      const fx = await makeRepo();
      try {
        // The peer's run was already reclaimed (force-failed runtime_offline) and its
        // item is offered again (status rolled back to not-started).
        const reclaimedPath = await seedRun(fx.items["00"], {
          state: "failed",
          failureReason: "runtime_offline",
          reclaimedAt: secondsBefore(NOW, 300),
          heartbeatAt: HEARTBEAT_STALE,
        });
        await writeFile(
          path.join(fx.items["00"].dir, "SPEC.md"),
          frontmatter({ type: "milestone", number: "00", slug: "m0", status: "not-started", created: "2026-07-01", updated: "2026-07-01" }),
          "utf8"
        );
        const reclaimedBefore = await readFile(reclaimedPath, "utf8");

        // This node claims the item, wins the lease, and starts the new run.
        const result = await invoke("work:run-start", { ref: "00", now: NOW }, { workspace: fx.workspace, relayClient: null });

        assert.equal(result.state, "running", "the new run is minted running");
        assert.equal(result.retryOf, PEER_RUN_ID, "the new run's retryOf links the reclaimed run's runId");
        assert.equal(result.node, NODE_ID, "the new run carries THIS node's id");
        assert.ok(existsSync(runNodeRecordPath(fx.items["00"], NODE_ID, result.runId)), "and lands under this node's partition");
        assert.equal(await readFile(reclaimedPath, "utf8"), reclaimedBefore, "the reclaimed run record stays terminal and byte-unchanged by the retry");
      } finally {
        await cleanup(fx.repo);
      }
    },
  },

  // ══ The cross-node sessionId guard on the reclaimed lineage (architect C1 — the
  //    sanctioned retryRun sessionId override): a session is SAME-NODE resume state;
  //    it never crosses hosts. The winner's mint carries the winner's OWN input
  //    session (or null) — never the dead peer's.
  {
    name: "fleet-reclaim/03 the reclaimed lineage NEVER carries the dead peer's sessionId — the winner's mint carries its own input session, or null",
    async run() {
      const rows = [
        { label: "no input session", sessionId: undefined, expected: null },
        { label: "the winner's own input session", sessionId: "sess-winner", expected: "sess-winner" },
      ];
      for (const row of rows) {
        const fx = await makeRepo();
        try {
          // The reclaimed prior carries the DEAD PEER's non-null sessionId.
          await seedRun(fx.items["00"], {
            state: "failed",
            failureReason: "runtime_offline",
            reclaimedAt: secondsBefore(NOW, 300),
            heartbeatAt: HEARTBEAT_STALE,
            sessionId: "sess-dead-peer",
          });
          await writeFile(
            path.join(fx.items["00"].dir, "SPEC.md"),
            frontmatter({ type: "milestone", number: "00", slug: "m0", status: "not-started", created: "2026-07-01", updated: "2026-07-01" }),
            "utf8"
          );

          const input = row.sessionId === undefined ? { ref: "00", now: NOW } : { ref: "00", now: NOW, sessionId: row.sessionId };
          const result = await invoke("work:run-start", input, { workspace: fx.workspace, relayClient: null });

          assert.equal(result.retryOf, PEER_RUN_ID, `[${row.label}] the mint still carries the reclaimed lineage`);
          assert.notEqual(result.sessionId, "sess-dead-peer", `[${row.label}] the winner's mint does NOT carry the dead peer's sessionId`);
          assert.equal(result.sessionId, row.expected, `[${row.label}] the mint carries ${row.expected === null ? "null" : "the winner's own session"}`);
        } finally {
          await cleanup(fx.repo);
        }
      }
    },
  },

  // ══ Scenario: the dead peer's lease lapses by rule — no foreign lease write, ever ══
  {
    name: "fleet-reclaim/03 the dead peer's lease lapses by RULE — its claim file is byte-unchanged, its lapsed claim does not block, and the reclaimer acquires its OWN separate claim file",
    async run() {
      const fx = await makeRepo();
      try {
        // The dual-stale peer holds a claim file for item 00 in state "claimed".
        const runPath = await seedRun(fx.items["00"], { heartbeatAt: HEARTBEAT_STALE });
        const peerClaimPath = await seedClaim(fx.workspace, "00", PEER_ID, "claimed");
        await seedPresence(fx.workspace, PEER_ID, PRESENCE_STALE);
        const peerClaimBefore = await readFile(peerClaimPath, "utf8");

        // This node reclaims the item and claims it for itself.
        const result = await invoke("work:run-start", { ref: "00", now: NOW }, { workspace: fx.workspace, relayClient: null });

        // The lapsed claim did not block: this node holds and runs.
        assert.equal(result.state, "running", "the peer's lapsed claim did not block this node's claim (live iff presence fresh — the rule)");
        assert.equal(JSON.parse(await readFile(runPath, "utf8")).state, "failed", "the orphan was reclaimed on the way");
        // The peer's claim file is byte-unchanged — no foreign lease write, ever.
        assert.equal(await readFile(peerClaimPath, "utf8"), peerClaimBefore, "the peer's claim file is byte-unchanged (no foreign lease write)");
        // This node holds its OWN claim file — a separate file under its own id.
        const ownClaimPath = leaseClaimPath(fx.workspace, "00", NODE_ID);
        assert.notEqual(ownClaimPath, peerClaimPath, "the reclaimer's claim is a separate file under this node's id");
        const own = JSON.parse(await readFile(ownClaimPath, "utf8"));
        assert.equal(own.state, "claimed", "this node holds its OWN claim file for the item");
        assert.equal(own.nodeId, NODE_ID, "under its own id");
      } finally {
        await cleanup(fx.repo);
      }
    },
  },

  // ══ Scenario: this node's own stale run is reclaimed under the local rules ══
  {
    name: "fleet-reclaim/03 this node's OWN stale run is reclaimed under the local rules even though its own presence is fresh — presence precedence guards peers, not oneself",
    async run() {
      const fx = await makeRepo();
      try {
        // THIS node is alive (fresh presence) and owns a running run whose heartbeat is
        // stale, for the item being started — the identical shape a fresh-presence PEER
        // is hands-off for.
        const runPath = await seedRun(fx.items["00"], { node: NODE_ID, heartbeatAt: HEARTBEAT_STALE });
        await seedPresence(fx.workspace, NODE_ID, PRESENCE_FRESH);

        const result = await invoke("work:run-start", { ref: "00", now: NOW }, { workspace: fx.workspace, relayClient: null });

        const own = JSON.parse(await readFile(runPath, "utf8"));
        assert.equal(own.state, "failed", "this node's own stale run is force-failed (today's restart-time reclaim, unchanged)");
        assert.equal(own.failureReason, "runtime_offline", "with failureReason runtime_offline");
        assert.equal(await itemStatus(fx.items["00"]), "not-started", "the item's status is rolled back");
        assert.equal(result.state, "running", "and the new start proceeds");
      } finally {
        await cleanup(fx.repo);
      }
    },
  },

  // ══ Scenario: seeking work on one item reclaims a crashed peer's orphan on another ══
  {
    name: "fleet-reclaim/03 seeking work on one item reclaims a crashed peer's orphan on ANOTHER item — the sweep fires when any node seeks work, and the unrelated start proceeds",
    async run() {
      const fx = await makeRepo();
      try {
        // A dual-stale peer owns a running run for item 00; this node starts item 01.
        const runPath = await seedRun(fx.items["00"], { heartbeatAt: HEARTBEAT_STALE });
        await seedPresence(fx.workspace, PEER_ID, PRESENCE_STALE);

        const result = await invoke("work:run-start", { ref: "01", now: NOW }, { workspace: fx.workspace, relayClient: null });

        const orphan = JSON.parse(await readFile(runPath, "utf8"));
        assert.equal(orphan.state, "failed", "the peer's orphaned run on the other item is force-failed");
        assert.equal(orphan.failureReason, "runtime_offline", "with failureReason runtime_offline");
        assert.equal(orphan.reclaimedAt, NOW, "and a reclaimedAt stamp");
        assert.equal(await itemStatus(fx.items["00"]), "not-started", "the other item's status is rolled back so it is offered again");
        assert.equal(result.state, "running", "the unrelated item's own start proceeds normally");
        assert.equal(result.itemRef, "01", "on the item this node asked for");
      } finally {
        await cleanup(fx.repo);
      }
    },
  },

  // ══ Scenario: with no mesh configured only the started item's stale runs are scanned ══
  {
    name: "fleet-reclaim/03 with NO mesh configured only the started item's stale runs are scanned — the other item's stale run is byte-unchanged and no presence record was read or required",
    async run() {
      const fx = await makeRepo({ mesh: null }); // no mesh config at all
      try {
        // Both items carry stale FLAT running runs (today's single-node shape).
        const startedRunPath = await seedRun(fx.items["00"], { node: null, heartbeatAt: HEARTBEAT_STALE });
        const otherRunPath = await seedRun(fx.items["01"], { runId: "20260702T090000000Z-0001", node: null, heartbeatAt: HEARTBEAT_STALE });
        const otherBefore = await readFile(otherRunPath, "utf8");
        // NO presence record exists anywhere — none is read or required for the decision.
        assert.ok(!existsSync(path.join(meshDir(fx.workspace), "presence")), "no presence record exists in the fixture");

        const result = await invoke("work:run-start", { ref: "00", now: NOW }, { workspace: fx.workspace });

        const started = JSON.parse(await readFile(startedRunPath, "utf8"));
        assert.equal(started.state, "failed", "the started item's stale run is force-failed (today's restart-time reclaim)");
        assert.equal(started.failureReason, "runtime_offline", "with failureReason runtime_offline");
        assert.equal(await readFile(otherRunPath, "utf8"), otherBefore, "the other item's stale run is left byte-unchanged (no fleet sweep without mesh)");
        assert.equal(result.state, "running", "the start proceeds — no presence record was read or required");
      } finally {
        await cleanup(fx.repo);
      }
    },
  },
];
