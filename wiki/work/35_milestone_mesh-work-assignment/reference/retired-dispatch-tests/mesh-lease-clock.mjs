// Traceability wiring for milestone 26 / story 01 — presence is the lease clock
// (tasks/01_presence-is-the-lease-clock.feature, ADR-003.2).
//
// Covers EVERY @executable scenario / Scenario-Outline row in
// 01_presence-is-the-lease-clock.feature. Claim files and presence records are
// FIXTURES written directly; liveness is read under an INJECTED now (the 22/R2
// inject-the-clock discipline — never wall-clock), through the REAL exports of
// src/mesh-lease.mjs (readItemClaims + claimLiveness + withdrawOwnLapsedClaims +
// buildLeaseView) over the REAL m23 threshold resolver (resolveStalenessSeconds —
// the ONE knob; never a private copy).
//
//   01_presence-is-the-lease-clock.feature —
//     - THE TRUTH TABLE: liveness is state × holder-presence; only claimed-and-fresh
//       earns live; released rows are presence-blind;
//     - THE BOUNDARY: the m23 strict-> shape (age == threshold ⇒ STILL live);
//     - ONE THRESHOLD KNOB: config.mesh.presence.stalenessSeconds through the SAME
//       resolver with the SAME documented default (malformed ⇒ default);
//     - the lapse is a RULE, not an edit (zero writes anywhere);
//     - OWN-PATH HYGIENE: the returning owner withdraws its own lapsed claim;
//     - NO SECOND CLOCK: the same claim bytes read live then lapsed as only the
//       injected now advances; the record carries no TTL/expiry key;
//     - THE PO-LOCKED ROW: claimed + no presence ⇒ leased (skip) but NOT reclaimable.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { meshDir, leaseClaimPath, presenceRecordPath } from "../src/mesh-store.mjs";
import { resolveStalenessSeconds, readPresenceRecord } from "../src/mesh-presence.mjs";
import {
  readItemClaims,
  claimLiveness,
  withdrawOwnLapsedClaims,
  buildLeaseView,
} from "../src/mesh-lease.mjs";

const NOW = "2026-07-02T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);

// An ISO instant `seconds` before an ISO now.
const before = (nowIso, seconds) => new Date(Date.parse(nowIso) - seconds * 1000).toISOString();

async function plainWorkspace() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-lease-clock-"));
  const workDir = path.join(tmp, "wiki", "work");
  await mkdir(meshDir({ workDir, projectRoot: tmp }), { recursive: true });
  return { tmp, workspace: { workDir, projectRoot: tmp } };
}

async function seedPresence(workspace, nodeId, heartbeatAt) {
  await mkdir(path.join(meshDir(workspace), "presence"), { recursive: true });
  await writeFile(
    presenceRecordPath(workspace, nodeId),
    JSON.stringify({ nodeId, heartbeatAt, activeRuns: [], aofVersion: "0.1.0" }, null, 2),
    "utf8"
  );
}

async function seedClaim(workspace, itemRef, nodeId, state) {
  const target = leaseClaimPath(workspace, itemRef, nodeId);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(
    target,
    JSON.stringify({ itemRef, nodeId, state, claimedAt: before(NOW, 3600), runId: null, aofVersion: "0.1.0" }, null, 2),
    "utf8"
  );
}

// Read ONE claim's liveness the way every reader composes it: the claim off the
// tree, the holder's presence off disk, the pure predicate over the injected now.
async function readLiveness(workspace, itemRef, nodeId, nowMs, thresholdMs) {
  const claims = await readItemClaims(workspace, itemRef);
  const claim = claims.find((c) => c.nodeId === nodeId) ?? null;
  const presence = await readPresenceRecord(workspace, nodeId);
  return claimLiveness(claim, presence, nowMs, thresholdMs);
}

// Snapshot every file under the partition root (the byte-unchanged assertions).
async function snapshotTree(workspace) {
  const root = meshDir(workspace);
  const snap = {};
  async function walk(dir, rel) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const r = path.join(rel, entry.name);
      if (entry.isDirectory()) await walk(abs, r);
      else snap[r] = await readFile(abs, "utf8");
    }
  }
  await walk(root, "");
  return snap;
}

const cleanup = (dir) => rm(dir, { recursive: true, force: true });

export const meshLeaseClockTests = [
  // ══ Scenario Outline: claim liveness is state times holder-presence ══
  {
    name: "mesh-lease-clock/01 claim liveness is state × holder-presence — only claimed-and-fresh reads live; released rows are presence-blind (truth table, all five rows)",
    async run() {
      const thresholdMs = 60 * 1000;
      const rows = [
        { state: "claimed", presence: before(NOW, 30), reads: "live", label: "claimed + fresh" },
        { state: "claimed", presence: before(NOW, 61), reads: "lapsed", label: "claimed + stale" },
        { state: "released", presence: before(NOW, 30), reads: "not-held", label: "released + fresh" },
        { state: "released", presence: before(NOW, 61), reads: "not-held", label: "released + stale" },
        { state: "released", presence: null, reads: "not-held", label: "released + absent" },
      ];
      for (const row of rows) {
        const fx = await plainWorkspace();
        try {
          await seedClaim(fx.workspace, "item-x", "node-a", row.state);
          if (row.presence != null) await seedPresence(fx.workspace, "node-a", row.presence);
          const liveness = await readLiveness(fx.workspace, "item-x", "node-a", NOW_MS, thresholdMs);
          assert.equal(liveness, row.reads, `${row.label} ⇒ ${row.reads}`);
        } finally {
          await cleanup(fx.tmp);
        }
      }
    },
  },

  // ══ Scenario Outline: the lease clock is strict — at-threshold is still fresh ══
  {
    name: "mesh-lease-clock/01 the lease clock is strict-> — a holder exactly AT the threshold is still fresh, so its claim is still live (ages 0/59/60 live, 61/600 lapsed)",
    async run() {
      const thresholdMs = 60 * 1000;
      const rows = [
        { age: 0, reads: "live" },
        { age: 59, reads: "live" },
        { age: 60, reads: "live" }, // the load-bearing at-threshold row (60 > 60 is false)
        { age: 61, reads: "lapsed" },
        { age: 600, reads: "lapsed" },
      ];
      for (const row of rows) {
        const fx = await plainWorkspace();
        try {
          await seedClaim(fx.workspace, "item-x", "node-a", "claimed");
          await seedPresence(fx.workspace, "node-a", before(NOW, row.age));
          const liveness = await readLiveness(fx.workspace, "item-x", "node-a", NOW_MS, thresholdMs);
          assert.equal(liveness, row.reads, `age ${row.age}s under a 60s threshold reads ${row.reads} (strict >)`);
        } finally {
          await cleanup(fx.tmp);
        }
      }
    },
  },

  // ══ Scenario Outline: liveness is governed by the SAME configured threshold + documented default ══
  {
    name: "mesh-lease-clock/01 claim liveness is governed by the SAME configured stalenessSeconds through the SAME resolver, with the documented default fallback (configured 30 / absent / not-a-number)",
    async run() {
      const rows = [
        { config: { mesh: { presence: { stalenessSeconds: 30 } } }, age: 30, reads: "live", label: "configured 30, age 30" },
        { config: { mesh: { presence: { stalenessSeconds: 30 } } }, age: 31, reads: "lapsed", label: "configured 30, age 31" },
        { config: {}, age: 90, reads: "live", label: "absent (unset), age 90 (the documented 90s default, strict >)" },
        { config: {}, age: 91, reads: "lapsed", label: "absent (unset), age 91" },
        { config: { mesh: { presence: { stalenessSeconds: "not-a-number" } } }, age: 91, reads: "lapsed", label: '"not-a-number" falls back to the default — age 91 lapses exactly as under absent' },
      ];
      for (const row of rows) {
        const fx = await plainWorkspace();
        try {
          await seedClaim(fx.workspace, "item-x", "node-a", "claimed");
          await seedPresence(fx.workspace, "node-a", before(NOW, row.age));
          // The lease layer is governed by THAT resolver — the m23
          // resolveStalenessSeconds over config.mesh.presence.stalenessSeconds —
          // never a private copy or a private default.
          const thresholdMs = resolveStalenessSeconds(row.config) * 1000;
          const liveness = await readLiveness(fx.workspace, "item-x", "node-a", NOW_MS, thresholdMs);
          assert.equal(liveness, row.reads, `${row.label} ⇒ ${row.reads}`);
        } finally {
          await cleanup(fx.tmp);
        }
      }
    },
  },

  // ══ Scenario: a lapse is a rule, not an edit ══
  {
    name: "mesh-lease-clock/01 a lapse is a rule, not an edit — reading a stale holder's claim writes nothing anywhere; the claim still reads state claimed byte-for-byte",
    async run() {
      const fx = await plainWorkspace();
      try {
        await seedClaim(fx.workspace, "item-x", "node-a", "claimed");
        await seedPresence(fx.workspace, "node-a", before(NOW, 600)); // stale under any sane threshold
        const treeBefore = await snapshotTree(fx.workspace);
        const claimBytesBefore = await readFile(leaseClaimPath(fx.workspace, "item-x", "node-a"), "utf8");

        const liveness = await readLiveness(fx.workspace, "item-x", "node-a", NOW_MS, 60 * 1000);

        assert.equal(liveness, "lapsed", "the claim reads lapsed (reclaimable)");
        const claimBytesAfter = await readFile(leaseClaimPath(fx.workspace, "item-x", "node-a"), "utf8");
        assert.equal(claimBytesAfter, claimBytesBefore, "the stale holder's claim file is byte-unchanged");
        assert.equal(JSON.parse(claimBytesAfter).state, "claimed", "it still reads state claimed — nobody flipped it");
        assert.deepEqual(await snapshotTree(fx.workspace), treeBefore, "the whole lease and presence tree is byte-unchanged (the lapse exists only in the reading)");
      } finally {
        await cleanup(fx.tmp);
      }
    },
  },

  // ══ Scenario: an owner returning from staleness withdraws its own lapsed claim ══
  {
    name: "mesh-lease-clock/01 an owner returning from staleness withdraws its own lapsed claim — an own-path flip to released; a bystander's live claim is byte-untouched",
    async run() {
      const fx = await plainWorkspace();
      try {
        const thresholdMs = 60 * 1000;
        // node-a's claim has lapsed (its presence is stale); node-b holds a live claim.
        await seedClaim(fx.workspace, "item-x", "node-a", "claimed");
        await seedPresence(fx.workspace, "node-a", before(NOW, 600));
        await seedClaim(fx.workspace, "item-y", "node-b", "claimed");
        await seedPresence(fx.workspace, "node-b", before(NOW, 5));
        const bBytesBefore = await readFile(leaseClaimPath(fx.workspace, "item-y", "node-b"), "utf8");

        // node-a returns: its own-claim hygiene runs (BEFORE its fresh heartbeat —
        // the resolved ordering), then it beats fresh.
        const withdrawn = await withdrawOwnLapsedClaims(fx.workspace, "node-a", { nowMs: NOW_MS, thresholdMs });
        await seedPresence(fx.workspace, "node-a", NOW); // the subsequent fresh beat

        assert.deepEqual(withdrawn, ["item-x"], "the hygiene withdrew exactly the own lapsed claim");
        const own = JSON.parse(await readFile(leaseClaimPath(fx.workspace, "item-x", "node-a"), "utf8"));
        assert.equal(own.state, "released", "node-a's claim file for item-x reads state released");
        assert.ok(existsSync(leaseClaimPath(fx.workspace, "item-x", "node-a")), "the file still exists at its own path (a state write, not a delete)");
        const bBytesAfter = await readFile(leaseClaimPath(fx.workspace, "item-y", "node-b"), "utf8");
        assert.equal(bBytesAfter, bBytesBefore, "node-b's claim file for item-y is byte-untouched (hygiene is own-path only)");
      } finally {
        await cleanup(fx.tmp);
      }
    },
  },

  // ══ Scenario (own-path hygiene, the no-op halves): fresh presence / no presence ⇒ zero writes ══
  {
    name: "mesh-lease-clock/01 hygiene with fresh own presence — and with NO own presence (never-beat is not stale) — is a zero-write no-op",
    async run() {
      for (const seed of ["fresh", "absent"]) {
        const fx = await plainWorkspace();
        try {
          await seedClaim(fx.workspace, "item-x", "node-a", "claimed");
          if (seed === "fresh") await seedPresence(fx.workspace, "node-a", before(NOW, 5));
          const treeBefore = await snapshotTree(fx.workspace);
          const withdrawn = await withdrawOwnLapsedClaims(fx.workspace, "node-a", { nowMs: NOW_MS, thresholdMs: 60 * 1000 });
          assert.deepEqual(withdrawn, [], `nothing is withdrawn under ${seed} own presence`);
          assert.deepEqual(await snapshotTree(fx.workspace), treeBefore, `the tree is byte-unchanged (${seed} own presence ⇒ zero-write no-op)`);
        } finally {
          await cleanup(fx.tmp);
        }
      }
    },
  },

  // ══ Scenario: the same claim bytes read live then lapsed as only the presence ages ══
  {
    name: "mesh-lease-clock/01 the same claim bytes read live then lapsed as only the injected now advances — no clock lives in the claim (the frozen six keys, no TTL/expiry)",
    async run() {
      const fx = await plainWorkspace();
      try {
        const thresholdMs = 60 * 1000;
        const heartbeat = NOW; // fixed at one instant
        await seedClaim(fx.workspace, "item-x", "node-a", "claimed");
        await seedPresence(fx.workspace, "node-a", heartbeat);
        const claimBytes = await readFile(leaseClaimPath(fx.workspace, "item-x", "node-a"), "utf8");

        // 30 seconds after the heartbeat ⇒ live.
        const at30 = Date.parse(heartbeat) + 30 * 1000;
        assert.equal(await readLiveness(fx.workspace, "item-x", "node-a", at30, thresholdMs), "live", "30s after the heartbeat the claim reads live");

        // 120 seconds after the heartbeat, the claim bytes untouched ⇒ lapsed.
        const at120 = Date.parse(heartbeat) + 120 * 1000;
        assert.equal(await readLiveness(fx.workspace, "item-x", "node-a", at120, thresholdMs), "lapsed", "120s after the heartbeat the SAME claim reads lapsed");
        assert.equal(await readFile(leaseClaimPath(fx.workspace, "item-x", "node-a"), "utf8"), claimBytes, "the claim bytes are untouched between the two readings");

        // The persisted record carries no TTL and no expiry key — exactly the frozen six.
        const record = JSON.parse(claimBytes);
        assert.deepEqual(
          Object.keys(record),
          ["itemRef", "nodeId", "state", "claimedAt", "runId", "aofVersion"],
          "exactly the frozen six keys (presence is the one clock)"
        );
        assert.ok(!Object.keys(record).some((k) => /ttl|expir/i.test(k)), "no TTL and no expiry key");
      } finally {
        await cleanup(fx.tmp);
      }
    },
  },

  // ══ Scenario: the PO-LOCKED row — claimed + no presence is leased but NOT reclaimable ══
  {
    name: "mesh-lease-clock/01 a claimed item whose holder has never published presence is leased but NOT reclaimable — not live, not lapsed, the reader skips (KR2-safe), no error",
    async run() {
      const fx = await plainWorkspace();
      try {
        const thresholdMs = 60 * 1000;
        await seedClaim(fx.workspace, "item-x", "node-a", "claimed");
        // node-a has NO presence record at all.
        let liveness, threw = false;
        try {
          liveness = await readLiveness(fx.workspace, "item-x", "node-a", NOW_MS, thresholdMs);
        } catch {
          threw = true;
        }
        assert.equal(threw, false, "no error is raised (a missing presence record is benign)");
        assert.notEqual(liveness, "live", "the claim does NOT read live (no fresh heartbeat exists to earn live)");
        assert.notEqual(liveness, "lapsed", "the claim does NOT read lapsed/reclaimable (the holder is not affirmatively stale)");
        assert.equal(liveness, "leased-unknown", "the PO-locked reading: leased-unknown");

        // A READER treats item-x as LEASED — the skip direction: the view maps the
        // no-presence holder to the leased-live (skip) bucket, never leased-stale.
        const claims = await readItemClaims(fx.workspace, "item-x");
        const view = buildLeaseView(claims, new Map(), { nowMs: NOW_MS, thresholdMs });
        assert.equal(view.get("item-x")?.state, "leased-live", "a reader treats item-x as leased (the skip bucket — KR2-safe)");
      } finally {
        await cleanup(fx.tmp);
      }
    },
  },
];
