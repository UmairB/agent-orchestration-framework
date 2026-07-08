// Traceability wiring for milestone 26 / story 01 — the lease-of-record claim +
// arbitration protocol (tasks/00_lease-claim-and-arbitration.feature, ADR-003).
//
// Covers EVERY @executable scenario / Scenario-Outline row in
// 00_lease-claim-and-arbitration.feature. The real-git rows drive acquireLease over
// TWO clones of one shared bare remote, SEQUENTIALLY in one process (the proven
// mesh-git-sync-transport buildFixture/clonePeer pattern), with runSync a closure
// over the REAL syncMesh engine; the push-rejected + ambiguity outline rows drive
// the LOCKED scripted-envelope fake: one pre-scripted frozen envelope per runSync
// call, in order, the test planting the competitor's claim bytes on the local tree
// between calls to stand in for the pull. Hold/stand-down is decided ONLY from
// (re-read claims × presence) + the envelope's synced/reason; retries are bounded
// by the exported MAX_CLAIM_SYNC_ATTEMPTS the ambiguity rows count against.
//
//   00_lease-claim-and-arbitration.feature —
//     - the unopposed claim is HELD, its file reaches the remote, the persisted
//       record carries EXACTLY the frozen six keys (no TTL / no expiry key);
//     - THE RACE: of two claimants exactly one holds; the loser's OWN file flips
//       "released", the winner's file is byte-untouched, exactly one "claimed"
//       file exists on the converged tree, the loser is told to mint nothing;
//     - the push-rejected re-sync outline (competitor observed ⇒ stand down;
//       unrelated remote movement ⇒ held);
//     - AMBIGUITY FAILS CLOSED (push-failed + pull-failed rows): bounded attempts,
//       not held, own file released, mint nothing;
//     - claimedAt NEVER arbitrates (the later-stamped first-pusher still wins);
//     - release is an own-path STATE WRITE, never a delete, never a foreign write;
//     - the git-cadence skip: a live competitor already visible ⇒ no claim minted.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncMesh } from "../src/mesh-sync.mjs";
import { meshDir, leaseClaimPath, presenceRecordPath } from "../src/mesh-store.mjs";
import {
  acquireLease,
  releaseLease,
  MAX_CLAIM_SYNC_ATTEMPTS,
} from "../src/mesh-lease.mjs";
import { spawnSyncHardened } from "./support/cli-spawn.mjs";

const NOW = "2026-07-02T12:00:00.000Z";
// The staleness threshold the scenarios run under — fresh presence is seeded AT now
// (age 0), comfortably inside it. Passed as the acquire's config.
const CONFIG = { mesh: { presence: { stalenessSeconds: 60 } } };

// ---- the shared-bare-remote two-clone git fixture (the m22/m26-00 pattern) ----

function git(cwd, args) {
  const result = spawnSyncHardened("git", args, { cwd, encoding: "utf8" });
  return { status: typeof result.status === "number" ? result.status : 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error };
}

function configIdentity(repo) {
  git(repo, ["config", "user.email", "fixture@aof.local"]);
  git(repo, ["config", "user.name", "aof fixture"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  git(repo, ["config", "core.autocrlf", "false"]);
  git(repo, ["config", "core.eol", "lf"]);
  // The race IS a divergent pull (B commits its own claim, then pulls A's) — pin
  // merge (never rebase) so the add-only union is deterministic on any host git.
  git(repo, ["config", "pull.rebase", "false"]);
}

async function buildFixture() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-lease-"));
  const bare = path.join(tmp, "remote.git");
  await mkdir(bare, { recursive: true });
  let r = git(bare, ["init", "--bare", "-q", "-b", "main"]);
  if (r.error || r.status !== 0) {
    git(bare, ["init", "--bare", "-q"]);
    git(bare, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  }

  const clone = path.join(tmp, "node-a");
  r = git(tmp, ["clone", "-q", bare, "node-a"]);
  if (r.status !== 0) throw new Error(`git clone failed: ${r.stderr}`);
  configIdentity(clone);
  git(clone, ["checkout", "-q", "-b", "main"]);

  const workDir = path.join(clone, "wiki", "work");
  await mkdir(meshDir({ workDir, projectRoot: clone }), { recursive: true });
  await writeFile(path.join(clone, ".gitattributes"), "* -text\n", "utf8");
  await writeFile(path.join(clone, "README.md"), "fixture\n", "utf8");
  git(clone, ["add", "-A"]);
  git(clone, ["commit", "-q", "-m", "initial"]);
  git(clone, ["push", "-q", "-u", "origin", "main"]);

  return { tmp, bare, clone, workspace: { workDir, projectRoot: clone } };
}

async function clonePeer(fixture, name) {
  const peer = path.join(fixture.tmp, name);
  const r = git(fixture.tmp, ["clone", "-q", fixture.bare, name]);
  if (r.status !== 0) throw new Error(`peer clone failed: ${r.stderr}`);
  configIdentity(peer);
  git(peer, ["checkout", "-q", "main"]);
  const workDir = path.join(peer, "wiki", "work");
  await mkdir(meshDir({ workDir, projectRoot: peer }), { recursive: true });
  return { peer, workspace: { workDir, projectRoot: peer } };
}

// A NON-git workspace fixture for the scripted-envelope and pure own-path rows
// (acquireLease never spawns git itself — the sync runner is injected).
async function plainWorkspace() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-lease-plain-"));
  const workDir = path.join(tmp, "wiki", "work");
  await mkdir(meshDir({ workDir, projectRoot: tmp }), { recursive: true });
  return { tmp, workspace: { workDir, projectRoot: tmp } };
}

// Fixture writers — claim files and presence records written directly.
async function seedPresence(workspace, nodeId, heartbeatAt) {
  await mkdir(path.join(meshDir(workspace), "presence"), { recursive: true });
  await writeFile(
    presenceRecordPath(workspace, nodeId),
    JSON.stringify({ nodeId, heartbeatAt, activeRuns: [], aofVersion: "0.1.0" }, null, 2),
    "utf8"
  );
}

async function seedClaim(workspace, itemRef, nodeId, state, claimedAt = NOW) {
  const target = leaseClaimPath(workspace, itemRef, nodeId);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(
    target,
    JSON.stringify({ itemRef, nodeId, state, claimedAt, runId: null, aofVersion: "0.1.0" }, null, 2),
    "utf8"
  );
}

const readClaim = async (workspace, itemRef, nodeId) =>
  JSON.parse(await readFile(leaseClaimPath(workspace, itemRef, nodeId), "utf8"));

// Every claim file under the lease tree, recursively: [{ rel, record }].
async function allClaimFiles(workspace) {
  const root = path.join(meshDir(workspace), "leases");
  const out = [];
  async function walk(dir, rel) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const r = path.join(rel, entry.name);
      if (entry.isDirectory()) await walk(abs, r);
      else if (entry.name.endsWith(".json")) out.push({ rel: r, record: JSON.parse(await readFile(abs, "utf8")) });
    }
  }
  await walk(root, "");
  return out;
}

// The bytes of a path on the bare remote's branch tip — what a fresh clone sees.
function remoteShow(bare, relPath) {
  const r = git(bare, ["show", `main:${relPath.split(path.sep).join("/")}`]);
  return r.status === 0 ? r.stdout : null;
}

// The injected sync runner over the REAL engine, per workspace (lease records live
// under .mesh/, so the default root set carries them — the story-00 contract).
const realSync = (workspace) => () => syncMesh(workspace);

// The LOCKED scripted fake: one pre-scripted envelope per call, in order; a step's
// optional plant() puts the competitor's claim bytes on the tree (standing in for
// the pull) BEFORE the envelope is returned. Counts its calls for the bounded rows.
function scriptedSync(steps) {
  const remaining = [...steps];
  const runner = async () => {
    runner.calls += 1;
    const step = remaining.shift();
    if (!step) throw new Error("scripted runSync exhausted — more calls than scripted envelopes");
    if (step.plant) await step.plant();
    return step.envelope;
  };
  runner.calls = 0;
  return runner;
}

const CLEAN = { committed: true, pushed: ["a-claim"], pulled: [], noop: false };
const FAILURE = (reason) => ({ committed: true, pushed: [], pulled: [], noop: false, synced: false, reason });

const cleanup = (dir) => rm(dir, { recursive: true, force: true });

export const meshLeaseClaimArbitrationTests = [
  // ══ Scenario: an unopposed claim is held and its claim file reaches the remote with state "claimed" ══
  {
    name: "mesh-lease-arbitration/00 an unopposed claim is held, its file reaches the remote, and the persisted record carries exactly the frozen six keys (runId null, claimedAt UTC-Z, no TTL/expiry)",
    async run() {
      const fx = await buildFixture();
      try {
        // Every contender has fresh presence under the injected now.
        await seedPresence(fx.workspace, "node-a", NOW);

        const result = await acquireLease(fx.workspace, "item-x", "node-a", {
          runSync: realSync(fx.workspace),
          now: NOW,
          config: CONFIG,
          aofVersion: "0.1.0",
        });

        assert.equal(result.held, true, "node-a's claim result is held");
        // The own claim file reads state "claimed".
        const record = await readClaim(fx.workspace, "item-x", "node-a");
        assert.equal(record.state, "claimed", "node-a's own claim file reads state claimed");
        // The claim file has reached the shared remote (a fresh clone would see it).
        const onRemote = remoteShow(fx.bare, path.join(".aof", "mesh", "leases", "item-x", "node-a.json"));
        assert.ok(onRemote != null, "the claim file is on the remote's branch tip");
        assert.equal(JSON.parse(onRemote).state, "claimed", "the remote claim reads state claimed");
        // EXACTLY the frozen six keys, in ADR-003.1 order — no TTL, no expiry key.
        assert.deepEqual(
          Object.keys(record),
          ["itemRef", "nodeId", "state", "claimedAt", "runId", "aofVersion"],
          "the persisted claim carries exactly the frozen keys, in order"
        );
        assert.ok(!Object.keys(record).some((k) => /ttl|expir/i.test(k)), "no TTL and no expiry key");
        assert.equal(record.runId, null, "runId is null at claim time (the run tie is set later)");
        assert.match(record.claimedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/, "claimedAt is an ISO-8601 UTC-Z instant");
        assert.equal(record.itemRef, "item-x", "itemRef is the claimed ref");
        assert.equal(record.nodeId, "node-a", "nodeId is the contender");
      } finally {
        await cleanup(fx.tmp);
      }
    },
  },

  // ══ Scenario: of two claimants racing one item exactly one holds — the later claimant stands down ══
  {
    name: "mesh-lease-arbitration/00 of two claimants racing one item exactly one holds — the loser's OWN file flips released, the winner's is byte-untouched, and the loser is told to mint nothing",
    async run() {
      const fx = await buildFixture();
      try {
        // The peer clone is taken from the BASELINE — before node-a's claim exists —
        // so node-b's local tree carries no claim when it enters the race (the
        // deterministic interleave: b's SYNC, not its clone, surfaces a's claim).
        const b = await clonePeer(fx, "node-b");

        // node-a claims first: its claim (+ fresh presence) reaches the shared remote.
        await seedPresence(fx.workspace, "node-a", NOW);
        const aResult = await acquireLease(fx.workspace, "item-x", "node-a", {
          runSync: realSync(fx.workspace),
          now: NOW,
          config: CONFIG,
          aofVersion: "0.1.0",
        });
        assert.equal(aResult.held, true, "node-a's claim result is held");
        const aBytesAsPushed = await readFile(leaseClaimPath(fx.workspace, "item-x", "node-a"), "utf8");

        // node-b now claims: its sync pulls node-a's earlier claim mid-protocol.
        await seedPresence(b.workspace, "node-b", NOW);
        const bResult = await acquireLease(b.workspace, "item-x", "node-b", {
          runSync: realSync(b.workspace),
          now: NOW,
          config: CONFIG,
          aofVersion: "0.1.0",
        });

        // Exactly one holds: a held, b stood down naming a as the holder.
        assert.equal(bResult.held, false, "node-b's claim result is not held");
        assert.equal(bResult.heldBy, "node-a", "node-b's result names node-a as the holder");
        assert.equal(bResult.mint, false, "node-b's not-held result directs its caller to mint nothing");
        // b's OWN file flipped to released (the stand-down).
        const bOwn = await readClaim(b.workspace, "item-x", "node-b");
        assert.equal(bOwn.state, "released", "node-b's OWN claim file reads state released");
        // a's file on b's converged tree is byte-untouched by b (zero foreign write).
        const aOnB = await readFile(leaseClaimPath(b.workspace, "item-x", "node-a"), "utf8");
        assert.equal(aOnB, aBytesAsPushed, "node-a's claim file is byte-untouched by node-b");
        // Exactly one claim file for item-x reads "claimed" across the converged tree.
        const claimed = (await allClaimFiles(b.workspace)).filter(
          (f) => f.record.itemRef === "item-x" && f.record.state === "claimed"
        );
        assert.equal(claimed.length, 1, "exactly one claim file for item-x reads state claimed");
        assert.equal(claimed[0].record.nodeId, "node-a", "and it is the winner's");
      } finally {
        await cleanup(fx.tmp);
      }
    },
  },

  // ══ Scenario Outline: a rejected push triggers a bounded re-sync and the re-observation decides ══
  {
    name: "mesh-lease-arbitration/00 a rejected push triggers a bounded re-sync — a live competing claim that landed before ours means stand-down; an unrelated remote move means held (outline, both rows)",
    async run() {
      const rows = [
        {
          label: "a live competing claim landed before ours",
          plant: async (workspace) => {
            await seedClaim(workspace, "item-x", "node-a", "claimed");
            await seedPresence(workspace, "node-a", NOW);
          },
          held: false,
          heldBy: "node-a",
          ownState: "released",
        },
        {
          label: "no competing claim (an unrelated record moved the remote)",
          plant: null,
          held: true,
          heldBy: undefined,
          ownState: "claimed",
        },
      ];
      for (const row of rows) {
        const fx = await plainWorkspace();
        try {
          await seedPresence(fx.workspace, "node-b", NOW);
          // First sync reports push-failed (the remote moved mid-race); the re-sync
          // completes cleanly, having surfaced <re-sync surfaced> (planted bytes).
          const runSync = scriptedSync([
            { envelope: FAILURE("push-failed") },
            { envelope: CLEAN, plant: row.plant ? () => row.plant(fx.workspace) : undefined },
          ]);

          const result = await acquireLease(fx.workspace, "item-x", "node-b", {
            runSync,
            now: NOW,
            config: CONFIG,
            aofVersion: "0.1.0",
          });

          assert.equal(result.held, row.held, `node-b's claim result is ${row.held ? "held" : "not held"} (${row.label})`);
          if (!row.held) {
            assert.equal(result.heldBy, row.heldBy, `the not-held result names the competing holder (${row.label})`);
            assert.equal(result.mint, false, `mint nothing (${row.label})`);
          }
          const own = await readClaim(fx.workspace, "item-x", "node-b");
          assert.equal(own.state, row.ownState, `node-b's own claim file reads state ${row.ownState} (${row.label})`);
        } finally {
          await cleanup(fx.tmp);
        }
      }
    },
  },

  // ══ Scenario Outline: a claimant whose sync keeps failing stands down — ambiguity fails closed ══
  // The third row (review MUST-FIX 1) pins the fail-CLOSED direction for an ABSENT
  // envelope too: a runner returning undefined establishes nothing — it must count
  // as an ambiguous attempt (bounded retry ⇒ stand down), never a silent HELD.
  {
    name: "mesh-lease-arbitration/00 a claimant whose sync keeps failing (push-failed / pull-failed) — or whose runner returns NO envelope — completes after a BOUNDED number of attempts, is not held, flips its own file released and mints nothing — ambiguity fails closed",
    async run() {
      const rows = [
        { label: "push-failed", envelope: () => FAILURE("push-failed") },
        { label: "pull-failed", envelope: () => FAILURE("pull-failed") },
        // An absent envelope (a mis-wired runner that forgot to return the engine's
        // envelope) establishes NOTHING — it must never be read as a clean sync.
        { label: "absent envelope (undefined runSync return)", envelope: () => undefined },
      ];
      for (const row of rows) {
        const fx = await plainWorkspace();
        try {
          await seedPresence(fx.workspace, "node-b", NOW);
          // No competing claim is visible anywhere; every attempt establishes nothing.
          const runSync = scriptedSync(
            Array.from({ length: MAX_CLAIM_SYNC_ATTEMPTS + 3 }, () => ({ envelope: row.envelope() }))
          );

          const result = await acquireLease(fx.workspace, "item-x", "node-b", {
            runSync,
            now: NOW,
            config: CONFIG,
            aofVersion: "0.1.0",
          });

          // Bounded: the attempt completed after exactly the exported bound of sync
          // attempts — never unbounded retry, never held on hope.
          assert.equal(
            runSync.calls,
            MAX_CLAIM_SYNC_ATTEMPTS,
            `the claim attempt completed after the bounded ${MAX_CLAIM_SYNC_ATTEMPTS} sync attempts (${row.label})`
          );
          assert.equal(result.held, false, `node-b's claim result is not held (${row.label})`);
          assert.equal(result.mint, false, `node-b's not-held result directs its caller to mint nothing (${row.label})`);
          const own = await readClaim(fx.workspace, "item-x", "node-b");
          assert.equal(own.state, "released", `node-b's own claim file reads state released (${row.label})`);
        } finally {
          await cleanup(fx.tmp);
        }
      }
    },
  },

  // ══ Scenario: a later-stamped claim that reached the remote first still wins — claimedAt never arbitrates ══
  {
    name: "mesh-lease-arbitration/00 a later-stamped claim that reached the remote first still wins — claimedAt never arbitrates (remote-history order decides, not timestamp order)",
    async run() {
      const fx = await buildFixture();
      try {
        // The peer clone is taken from the BASELINE (before any claim), as in the race.
        const b = await clonePeer(fx, "node-b");

        // node-a's clock runs AHEAD: its claim carries a claimedAt LATER than node-b's
        // stamp — but node-a's claim reaches the shared remote FIRST.
        const aheadNow = "2026-07-02T12:10:00.000Z"; // 10 min ahead of NOW
        await seedPresence(fx.workspace, "node-a", aheadNow);
        const aResult = await acquireLease(fx.workspace, "item-x", "node-a", {
          runSync: realSync(fx.workspace),
          now: aheadNow,
          config: CONFIG,
          aofVersion: "0.1.0",
        });
        assert.equal(aResult.held, true, "node-a's claim result is held");

        // node-b claims with the EARLIER stamp; its sync pulls node-a's earlier-landed claim.
        await seedPresence(b.workspace, "node-b", NOW);
        const bResult = await acquireLease(b.workspace, "item-x", "node-b", {
          runSync: realSync(b.workspace),
          now: NOW,
          config: CONFIG,
          aofVersion: "0.1.0",
        });

        assert.equal(bResult.held, false, "node-b's claim result is not held");
        assert.equal(bResult.heldBy, "node-a", "node-b names node-a as the holder");
        // The earlier claimedAt stamp LOST: b's stamp is earlier than a's, yet a won.
        const aClaim = await readClaim(b.workspace, "item-x", "node-a");
        const bClaim = await readClaim(b.workspace, "item-x", "node-b");
        assert.ok(
          Date.parse(bClaim.claimedAt) < Date.parse(aClaim.claimedAt),
          "node-b's claimedAt is EARLIER than node-a's — the earlier stamp lost (remote-history order decided)"
        );
        assert.equal(bClaim.state, "released", "the earlier-stamped loser stood down");
        assert.equal(aClaim.state, "claimed", "the later-stamped first-pusher holds");
      } finally {
        await cleanup(fx.tmp);
      }
    },
  },

  // ══ Scenario: release is an own-path state write, never a delete ══
  {
    name: "mesh-lease-arbitration/00 release is an own-path state write, never a delete — the released file remains with its history and nobody else's file moves",
    async run() {
      const fx = await plainWorkspace();
      try {
        // node-a holds the lease on item-x; node-b holds a live claim on item-y.
        await seedClaim(fx.workspace, "item-x", "node-a", "claimed");
        await seedClaim(fx.workspace, "item-y", "node-b", "claimed");
        await seedPresence(fx.workspace, "node-b", NOW);
        const bBytesBefore = await readFile(leaseClaimPath(fx.workspace, "item-y", "node-b"), "utf8");
        const filesBefore = (await allClaimFiles(fx.workspace)).map((f) => f.rel).sort();

        await releaseLease(fx.workspace, "item-x", "node-a");

        // The released file STILL EXISTS at its own path, reading state released.
        assert.ok(existsSync(leaseClaimPath(fx.workspace, "item-x", "node-a")), "node-a's claim file for item-x still exists at its own path");
        const released = await readClaim(fx.workspace, "item-x", "node-a");
        assert.equal(released.state, "released", "it reads state released");
        assert.equal(released.itemRef, "item-x", "the record's history (itemRef) survives the state write");
        // No claim file was deleted anywhere under the lease tree.
        const filesAfter = (await allClaimFiles(fx.workspace)).map((f) => f.rel).sort();
        assert.deepEqual(filesAfter, filesBefore, "no claim file was deleted anywhere under the lease tree");
        // node-b's file is byte-untouched (release writes only the releaser's own path).
        const bBytesAfter = await readFile(leaseClaimPath(fx.workspace, "item-y", "node-b"), "utf8");
        assert.equal(bBytesAfter, bBytesBefore, "node-b's claim file for item-y is byte-untouched");
      } finally {
        await cleanup(fx.tmp);
      }
    },
  },

  // ══ Scenario: a live competing claim already visible locally means no claim is even attempted ══
  {
    name: "mesh-lease-arbitration/00 a live competing claim already on the local tree means node-b never enters the race — no own claim file minted, the holder named, mint nothing (the git-cadence skip)",
    async run() {
      const fx = await plainWorkspace();
      try {
        // node-a's LIVE claim for item-x is already on node-b's local tree.
        await seedClaim(fx.workspace, "item-x", "node-a", "claimed");
        await seedPresence(fx.workspace, "node-a", NOW);
        await seedPresence(fx.workspace, "node-b", NOW);
        const runSync = scriptedSync([]); // any call would throw — none may happen

        const result = await acquireLease(fx.workspace, "item-x", "node-b", {
          runSync,
          now: NOW,
          config: CONFIG,
          aofVersion: "0.1.0",
        });

        assert.equal(result.held, false, "node-b's claim result is not held");
        assert.equal(result.heldBy, "node-a", "node-b names node-a as the holder");
        assert.equal(result.mint, false, "node-b's not-held result directs its caller to mint nothing");
        // node-b wrote NO claim file of its own — it never entered the race.
        assert.ok(
          !existsSync(leaseClaimPath(fx.workspace, "item-x", "node-b")),
          "node-b wrote no claim file of its own for item-x"
        );
        assert.equal(runSync.calls, 0, "no sync was even attempted (the git-cadence skip)");
      } finally {
        await cleanup(fx.tmp);
      }
    },
  },
];
