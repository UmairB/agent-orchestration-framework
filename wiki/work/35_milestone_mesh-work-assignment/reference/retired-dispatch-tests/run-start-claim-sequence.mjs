// Traceability wiring for milestone 26 / story 02 — the frozen A2 claim sequence in
// work:run-start (tasks/00_claim-sequence-a2.feature, ADR-004.3 + ADR-003).
//
// Covers EVERY @executable scenario / Scenario-Outline row. The relay-state rows drive
// the REGISTERED work:run-start (loadWorkspace + invoke) over a REAL shared-bare-remote
// git fixture with an INJECTED relay client (the mesh-heartbeat ctx.relayClient idiom —
// the makeRelayStub four-state matrix, NO real ws server; null models unconfigured).
// The race rows drive TWO contenders sequentially IN ONE PROCESS over one bare remote
// (the proven m22 buildFixture/clonePeer idiom — syncMesh spawns git synchronously so
// the interleave is deterministic). Claim/run stamps ride the run-start white-box `now`
// input, so the byte-identical baselines are deterministically assertable.
//
//   00_claim-sequence-a2.feature —
//     - THE INVARIANT MATRIX (up / down-connect-fails / unconfigured / push-throws):
//       the durable claim file is byte-identical to the relay-up baseline, the git
//       sync ran (the claim reached the remote), the start HOLDS on git evidence
//       alone, and no relay failure propagates;
//     - the happy path pushes EXACTLY ONE lease intent (best-effort ≠ skipped) with
//       the frozen { kind:"lease", nodeId, signal } envelope;
//     - HOLD mints the run WITH this node's id under its partition and ties the
//       runId back onto the claim file;
//     - a competing live claim on the remote stands this node down: NO mint, heldBy,
//       the own file flips released, the peer's file byte-untouched;
//     - THE PRIMARY-SPIKE ROW: an unopposed relay broadcast + a lost git race ⇒
//       stand down (the relay grant is worth nothing without the git win);
//     - RELAY WHOLLY ABSENT: two contenders still arbitrate to exactly one winner at
//       the git cadence.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadWorkspace } from "../src/work.mjs";
import { invoke } from "../src/command-core.mjs";
import { syncMesh, runsPathspec } from "../src/mesh-sync.mjs";
import { meshDir, leaseClaimPath, presenceRecordPath } from "../src/mesh-store.mjs";
import { readRuns, runNodeRecordPath } from "../src/run-store.mjs";
import { LEASE_SIGNAL_KIND } from "../src/mesh-relay-client.mjs";
import { spawnSyncHardened } from "./support/cli-spawn.mjs";

const NOW = "2026-07-02T12:00:00.000Z";
const ITEM_REF = "00";
const ITEM_DIRNAME = "00_milestone_m0";

// ---- the shared-bare-remote two-clone git fixture (the m22/m26 pattern) ----

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
  git(repo, ["config", "pull.rebase", "false"]);
}

const SPEC = `---
type: milestone
number: 00
slug: m0
status: in-progress
title: "M0"
created: 2026-07-01
updated: 2026-07-01
---
# 00
`;

// Write a clone's OWN, UNTRACKED .aof config (each contender carries its own nodeId —
// the config never rides the bus; syncMesh stages only the mesh/runs roots).
async function writeNodeConfig(repo, nodeId, { relayConfigured = true } = {}) {
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  const mesh = { nodeId, presence: { stalenessSeconds: 60 } };
  if (relayConfigured) mesh.relay = { url: "ws://127.0.0.1:7799/ws/relay" };
  await writeFile(
    path.join(repo, ".aof", "aof.config.json"),
    `${JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" }, mesh }, null, 2)}\n`,
    "utf8"
  );
}

async function buildFixture({ nodeId = "node-a", relayConfigured = true } = {}) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-claim-seq-"));
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
  const itemDir = path.join(workDir, ITEM_DIRNAME);
  await mkdir(itemDir, { recursive: true });
  await writeFile(path.join(itemDir, "SPEC.md"), SPEC, "utf8");
  await writeFile(path.join(clone, ".gitattributes"), "* -text\n", "utf8");
  git(clone, ["add", "-A"]);
  git(clone, ["commit", "-q", "-m", "initial"]);
  git(clone, ["push", "-q", "-u", "origin", "main"]);

  // The config is written AFTER the baseline commit — UNTRACKED, per-clone.
  await writeNodeConfig(clone, nodeId, { relayConfigured });
  const workspace = await loadWorkspace(clone);
  return { tmp, bare, clone, workDir, itemDir, workspace, item: { ref: ITEM_REF, dir: itemDir } };
}

// A second contender cloned from the CURRENT remote state (clone it from the BASELINE —
// before the first claim — so its sync, not its clone, surfaces the winner's claim).
async function clonePeer(fixture, name, nodeId, { relayConfigured = true } = {}) {
  const peer = path.join(fixture.tmp, name);
  const r = git(fixture.tmp, ["clone", "-q", fixture.bare, name]);
  if (r.status !== 0) throw new Error(`peer clone failed: ${r.stderr}`);
  configIdentity(peer);
  git(peer, ["checkout", "-q", "main"]);
  await writeNodeConfig(peer, nodeId, { relayConfigured });
  const workDir = path.join(peer, "wiki", "work");
  const itemDir = path.join(workDir, ITEM_DIRNAME);
  const workspace = await loadWorkspace(peer);
  return { peer, workDir, itemDir, workspace, item: { ref: ITEM_REF, dir: itemDir } };
}

// The four-relay-state stub (the mesh-presence-dual-bus makeRelayStub idiom).
function makeRelayStub(state) {
  const calls = { connects: 0, pushes: 0, pushed: [], closes: 0 };
  return {
    calls,
    client: {
      async connect() {
        calls.connects += 1;
        if (state === "connect-fails") throw new Error("relay connect refused (unreachable)");
        return { close() { calls.closes += 1; } };
      },
      async push(envelope) {
        calls.pushes += 1;
        if (state === "push-throws") throw new Error("relay push failed mid-send");
        calls.pushed.push(envelope);
      },
    },
  };
}

async function seedPresence(workspace, nodeId, heartbeatAt) {
  await mkdir(path.join(meshDir(workspace), "presence"), { recursive: true });
  await writeFile(
    presenceRecordPath(workspace, nodeId),
    JSON.stringify({ nodeId, heartbeatAt, activeRuns: [], aofVersion: "0.1.0" }, null, 2),
    "utf8"
  );
}

// The bytes of a path on the bare remote's branch tip — what a fresh clone sees.
function remoteShow(bare, relPath) {
  const r = git(bare, ["show", `main:${relPath.split(path.sep).join("/")}`]);
  return r.status === 0 ? r.stdout : null;
}

const claimRelPath = (root, workspace, itemRef, nodeId) =>
  path.relative(root, leaseClaimPath(workspace, itemRef, nodeId));

const cleanup = (dir) => rm(dir, { recursive: true, force: true });

// The relay-UP baseline: the claim bytes a relay-up run-start persists at the fixed
// instant. Every other relay-state row must persist a byte-identical claim file.
async function relayUpBaselineClaim() {
  const fx = await buildFixture();
  try {
    const stub = makeRelayStub("up");
    await invoke("work:run-start", { ref: ITEM_REF, now: NOW }, { workspace: fx.workspace, relayClient: stub.client });
    return await readFile(leaseClaimPath(fx.workspace, ITEM_REF, "node-a"), "utf8");
  } finally {
    await cleanup(fx.tmp);
  }
}

export const runStartClaimSequenceTests = [
  // ══ Scenario Outline: the durable claim is written byte-identically and the start
  //    holds on git evidence for every relay state ══
  {
    name: "run-start-claim/00 the durable claim is byte-identical to the relay-up baseline, the sync runs, and the start holds for every relay state (up / connect-fails / unconfigured / push-throws)",
    async run() {
      const baseline = await relayUpBaselineClaim();
      const rows = [
        { state: "up", relayConfigured: true },
        { state: "connect-fails", relayConfigured: true },
        { state: "unconfigured", relayConfigured: false },
        { state: "push-throws", relayConfigured: true },
      ];
      for (const row of rows) {
        const fx = await buildFixture({ relayConfigured: row.relayConfigured });
        try {
          const stub = row.state === "unconfigured" ? null : makeRelayStub(row.state);
          const relayClient = stub === null ? null : stub.client;
          let result;
          // (d) no relay failure propagates to the start result — the invoke resolves.
          await assert.doesNotReject(async () => {
            result = await invoke("work:run-start", { ref: ITEM_REF, now: NOW }, { workspace: fx.workspace, relayClient });
          }, `[${row.state}] no relay failure propagated to the start result`);
          // (c) the start HOLDS and mints the run on git evidence alone.
          assert.equal(result.state, "running", `[${row.state}] the start result is held — run minted`);
          // Best-effort never collapses into silently-skipped (QA W1): on every
          // configured-relay row the push was ATTEMPTED — the failing rows connected
          // (and push-throws pushed) before their failure was caught.
          if (row.state === "up") {
            assert.equal(stub.calls.pushed.length, 1, "[up] the intent was pushed once");
          } else if (row.state === "connect-fails") {
            assert.ok(stub.calls.connects >= 1, "[connect-fails] the push was ATTEMPTED (connect was tried, then caught)");
          } else if (row.state === "push-throws") {
            assert.ok(stub.calls.connects >= 1 && stub.calls.pushes >= 1, "[push-throws] the push was ATTEMPTED (connected + pushed, then caught)");
          }
          // (a) this node's claim file is persisted under the lease seam, state claimed…
          const claimPath = leaseClaimPath(fx.workspace, ITEM_REF, "node-a");
          const claimBytes = await readFile(claimPath, "utf8");
          assert.equal(JSON.parse(claimBytes).state, "claimed", `[${row.state}] the claim file reads state claimed`);
          // …byte-identical to the relay-up baseline (the durable claim does not depend
          // on relay state).
          assert.equal(claimBytes, baseline, `[${row.state}] the persisted claim is byte-identical to the relay-up baseline`);
          // (b) the claim reached the shared remote — the authoritative git sync ran.
          const onRemote = remoteShow(fx.bare, claimRelPath(fx.clone, fx.workspace, ITEM_REF, "node-a"));
          assert.ok(onRemote != null, `[${row.state}] the claim reached the shared remote`);
          assert.equal(JSON.parse(onRemote).state, "claimed", `[${row.state}] the remote claim reads state claimed`);
        } finally {
          await cleanup(fx.tmp);
        }
      }
    },
  },

  // ══ Scenario: when the relay is up exactly one lease intent envelope is pushed ══
  {
    name: "run-start-claim/00 when the relay is up exactly one lease intent envelope is pushed — kind lease, this node's id, the claim record as the opaque signal; the outcome was still decided by git",
    async run() {
      const fx = await buildFixture();
      try {
        const stub = makeRelayStub("up");
        const result = await invoke("work:run-start", { ref: ITEM_REF, now: NOW }, { workspace: fx.workspace, relayClient: stub.client });

        // Exactly ONE lease intent was pushed — best-effort did not collapse into skipped.
        assert.equal(stub.calls.pushed.length, 1, "exactly one lease intent was pushed over the relay client");
        const envelope = stub.calls.pushed[0];
        assert.equal(envelope.kind, LEASE_SIGNAL_KIND, "the pushed envelope carries kind lease");
        assert.equal(envelope.kind, "lease", "the frozen kind literal is 'lease'");
        assert.equal(envelope.nodeId, "node-a", "the pushed envelope carries this node's nodeId");
        // The opaque signal is this node's claim record for the item — a genuine
        // PRE-SYNC intent (ADR-004.3): state "claimed", runId still null (the run is
        // minted only after the git win; the tie-back comes later).
        assert.equal(envelope.signal.itemRef, ITEM_REF, "the signal carries the claimed itemRef");
        assert.equal(envelope.signal.nodeId, "node-a", "the signal carries this node's id");
        assert.equal(envelope.signal.state, "claimed", "the signal is the claimed claim record");
        assert.equal(envelope.signal.runId, null, "the intent's runId is null — pushed BEFORE any mint (a pre-sync intent)");
        // The start outcome was still decided by the git sync, not the push: the run
        // minted AND the claim is on the remote (the authoritative act happened).
        assert.equal(result.state, "running", "the start held (decided by the git sync)");
        assert.ok(
          remoteShow(fx.bare, claimRelPath(fx.clone, fx.workspace, ITEM_REF, "node-a")) != null,
          "the claim is on the remote — the intent was advisory only"
        );
      } finally {
        await cleanup(fx.tmp);
      }
    },
  },

  // ══ THE ORDER, OBSERVED (ADR-004.3: claim-write → intent → sync — the must-fix
  //    directional assertion): the recording relay stub snapshots the REMOTE at push
  //    time. The intent goes out while the claim is NOT yet on the remote (the first
  //    sync has not run), and only the sync afterwards lands it — pinned through the
  //    real command over the real engine, no fake runSync needed.
  {
    name: "run-start-claim/00 the intent push lands BEFORE the first authoritative sync — at push time the claim is not yet on the remote (claim-write → intent → sync)",
    async run() {
      const fx = await buildFixture();
      try {
        const observedAtPush = [];
        const relayClient = {
          async connect() {
            return { close() {} };
          },
          async push(envelope) {
            // Snapshot the shared remote AT PUSH TIME: was the claim already synced?
            observedAtPush.push({
              envelope,
              remoteClaim: remoteShow(fx.bare, claimRelPath(fx.clone, fx.workspace, ITEM_REF, "node-a")),
            });
          },
        };

        const result = await invoke("work:run-start", { ref: ITEM_REF, now: NOW }, { workspace: fx.workspace, relayClient });

        assert.equal(result.state, "running", "the start held");
        assert.equal(observedAtPush.length, 1, "exactly one intent was pushed");
        // THE DIRECTION: at push time the remote had NO claim — the intent preceded
        // the first sync round (the fast path does not wait out the sync).
        assert.equal(observedAtPush[0].remoteClaim, null, "at push time the claim had NOT yet reached the remote — the intent preceded the first sync");
        assert.equal(observedAtPush[0].envelope.signal.state, "claimed", "the pre-sync intent carries state claimed");
        assert.equal(observedAtPush[0].envelope.signal.runId, null, "the pre-sync intent carries runId null (no mint yet)");
        // …and the sync AFTER the push landed the claim (the authoritative act ran).
        assert.ok(
          remoteShow(fx.bare, claimRelPath(fx.clone, fx.workspace, ITEM_REF, "node-a")) != null,
          "after the command the claim IS on the remote — the sync followed the intent"
        );
      } finally {
        await cleanup(fx.tmp);
      }
    },
  },

  // ══ Scenario: a held claim mints the run with this node's id and ties the runId back ══
  {
    name: "run-start-claim/00 a held claim mints the run with this node's id under this node's partition and ties the runId back onto the claim file",
    async run() {
      const fx = await buildFixture();
      try {
        const result = await invoke("work:run-start", { ref: ITEM_REF, now: NOW }, { workspace: fx.workspace, relayClient: null });

        assert.equal(result.state, "running", "a run is minted for the item in state running");
        assert.equal(result.node, "node-a", "the minted run record carries this node's id as its node key");
        // The record is persisted under THIS node's partition of the item's runs.
        assert.ok(
          existsSync(runNodeRecordPath(fx.item, "node-a", result.runId)),
          "the run record is persisted under runs/node-a/ (this node's partition)"
        );
        // The lease-to-run tie-back: the claim file now carries the minted runId.
        const claim = JSON.parse(await readFile(leaseClaimPath(fx.workspace, ITEM_REF, "node-a"), "utf8"));
        assert.equal(claim.runId, result.runId, "the claim file carries the minted run's runId (the tie-back)");
        assert.equal(claim.state, "claimed", "the tied claim still reads state claimed");
      } finally {
        await cleanup(fx.tmp);
      }
    },
  },

  // ══ Scenario: a competing live claim on the remote stands this node down ══
  {
    name: "run-start-claim/00 a competing live claim on the remote stands this node down — no run minted, heldBy names the peer, the own file flips released, the peer's file is byte-unchanged",
    async run() {
      const fx = await buildFixture({ nodeId: "node-a" });
      try {
        // The contender clone is taken from the BASELINE — before the peer's claim
        // exists — so its SYNC, not its clone, surfaces the peer's claim mid-protocol.
        const b = await clonePeer(fx, "node-b", "node-b");

        // The peer (node-a) claims first — its LIVE claim (+ fresh presence) reaches
        // the shared remote through its own run-start.
        await seedPresence(fx.workspace, "node-a", NOW);
        const aResult = await invoke("work:run-start", { ref: ITEM_REF, now: NOW }, { workspace: fx.workspace, relayClient: null });
        assert.equal(aResult.state, "running", "the peer's start held");

        // This node (node-b) now starts the same item: its sync pulls the peer's claim.
        await seedPresence(b.workspace, "node-b", NOW);
        const result = await invoke("work:run-start", { ref: ITEM_REF, now: NOW }, { workspace: b.workspace, relayClient: null });

        // NO run is minted; the result says stood-down and names the holding peer.
        assert.equal(result.stoodDown, true, "the result says stood-down");
        assert.equal(result.state, "stood-down", "the result state is stood-down");
        assert.equal(result.heldBy, "node-a", "the result names the holding peer (heldBy)");
        const runs = await readRuns(b.item);
        assert.ok(!runs.some((run) => run.node === "node-b"), "NO run was minted by this node for the item");
        // The own claim file flipped to released (the own-path withdrawal).
        const own = JSON.parse(await readFile(leaseClaimPath(b.workspace, ITEM_REF, "node-b"), "utf8"));
        assert.equal(own.state, "released", "this node's own claim file flips to state released");
        // The peer's claim file is byte-unchanged (never a foreign write): this node's
        // copy equals the bytes the peer pushed to the remote.
        const peerOnRemote = remoteShow(fx.bare, claimRelPath(fx.clone, fx.workspace, ITEM_REF, "node-a"));
        const peerOnB = await readFile(leaseClaimPath(b.workspace, ITEM_REF, "node-a"), "utf8");
        assert.equal(peerOnB, peerOnRemote, "the peer's claim file is left byte-unchanged (never a foreign write)");
      } finally {
        await cleanup(fx.tmp);
      }
    },
  },

  // ══ Scenario: a node whose intent broadcast unopposed but whose git race is lost
  //    stands down — THE PRIMARY-SPIKE ROW ══
  {
    name: "run-start-claim/00 a node whose intent broadcast unopposed but whose git race is lost stands down — the relay grant is worth nothing without the git win",
    async run() {
      const fx = await buildFixture({ nodeId: "node-a" });
      try {
        const b = await clonePeer(fx, "node-b", "node-b");

        // The peer's claim reached the shared remote BEFORE this node's sync landed.
        await seedPresence(fx.workspace, "node-a", NOW);
        await invoke("work:run-start", { ref: ITEM_REF, now: NOW }, { workspace: fx.workspace, relayClient: null });

        // This node broadcasts over a healthy relay and hears NO competing intent
        // (nothing was ever delivered to it) — the "relay grant".
        await seedPresence(b.workspace, "node-b", NOW);
        const stub = makeRelayStub("up");
        const result = await invoke("work:run-start", { ref: ITEM_REF, now: NOW }, { workspace: b.workspace, relayClient: stub.client });

        // The authoritative git sync observed the peer's earlier claim ⇒ stand down.
        assert.equal(result.stoodDown, true, "this node stands down — NO run is minted");
        assert.equal(result.heldBy, "node-a", "the result names the peer that won the git race");
        assert.ok(!(await readRuns(b.item)).some((run) => run.node === "node-b"), "no run was minted");
        // The broadcast DID go out unopposed — and carried no authority: the decision
        // came from git observation alone. It was a genuine PRE-SYNC intent (the
        // ADR-004.3 slot): state "claimed", runId null — pushed before the git race
        // was even observed, and still worth nothing without the git win.
        assert.equal(stub.calls.pushes, 1, "the relay broadcast went out (unopposed) — and granted nothing");
        assert.equal(stub.calls.pushed[0].signal.state, "claimed", "the unopposed broadcast was the pre-sync claimed intent");
        assert.equal(stub.calls.pushed[0].signal.runId, null, "the unopposed broadcast carried runId null (no mint had happened)");
      } finally {
        await cleanup(fx.tmp);
      }
    },
  },

  // ══ Scenario: with the relay wholly absent two contenders still arbitrate to exactly
  //    one winner at the git cadence ══
  {
    name: "run-start-claim/00 with the relay wholly absent two contenders still arbitrate to exactly one winner at the git cadence — the loser stands down naming the winner",
    async run() {
      const fx = await buildFixture({ nodeId: "node-a", relayConfigured: false });
      try {
        const b = await clonePeer(fx, "node-b", "node-b", { relayConfigured: false });
        await seedPresence(fx.workspace, "node-a", NOW);
        await seedPresence(b.workspace, "node-b", NOW);

        // Both contenders invoke work:run-start for the same item — neither has any
        // relay configured (null client: the push is SKIPPED, nothing transported).
        const aResult = await invoke("work:run-start", { ref: ITEM_REF, now: NOW }, { workspace: fx.workspace, relayClient: null });
        // The winner's mint rides the NEXT sync tick to the remote (push-for-liveness,
        // poll-for-durability) — tick it so the converged tree is observable.
        await syncMesh(fx.workspace, { roots: [meshDir(fx.workspace), runsPathspec(fx.workspace)] });
        const bResult = await invoke("work:run-start", { ref: ITEM_REF, now: NOW }, { workspace: b.workspace, relayClient: null });

        // Exactly one contender holds and mints; the other stands down naming the winner.
        assert.equal(aResult.state, "running", "exactly one contender (node-a) holds and mints a run");
        assert.equal(bResult.stoodDown, true, "the other contender stands down with NO run minted");
        assert.equal(bResult.heldBy, "node-a", "the loser names the winner (heldBy)");
        // The converged tree carries exactly ONE running run for the item — the winner's.
        const runs = (await readRuns(b.item)).filter((run) => run.state === "running");
        assert.equal(runs.length, 1, "exactly one running run exists for the item across the converged tree");
        assert.equal(runs[0].node, "node-a", "and it is the winner's, under the winner's node id");
      } finally {
        await cleanup(fx.tmp);
      }
    },
  },
];
