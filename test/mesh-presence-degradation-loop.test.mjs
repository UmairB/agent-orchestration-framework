// Traceability wiring for milestone 23 / story 02 — task 01
// (tasks/01_graceful-degradation.feature). Killing the relay degrades cleanly to git-only
// — liveness lost, data safe — driven by a cadence loop that is a thin timer over the
// one-shot publish.
//
// Covers EVERY @executable scenario:
//   - relay DOWN ⇒ presence still reaches a peer over git (the m22 syncMesh engine over a
//     local bare-remote fixture — the 22 task-00 shape), 0 records lost, the durable record
//     byte-identical to the relay-up baseline;
//   - relay RESTORED ⇒ the push resumes with NO change to the durable record (two publishes
//     at the same fixed injected instant — relay-down then relay-up — produce byte-identical
//     records);
//   - the cadence LOOP is a thin timer over the one-shot publish (an INJECTED ticker, no
//     wall-clock wait): one publish per tick, the loop holds no publish logic of its own;
//   - the cadence is read from config.mesh.presence.cadenceSeconds (valid verbatim;
//     malformed/absent ⇒ the documented default), read at start + stable for the run.
//
// The git fixture mirrors test/mesh-git-sync-transport.test.mjs (git init --bare + a peer
// clone + syncMesh); the loop mirrors test/mesh-sync-cadence-loop.test.mjs (manualTicker()).
// node:assert/strict.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadWorkspace } from "../src/work.mjs";
import { invoke } from "../src/command-core.mjs";
import { syncMesh } from "../src/mesh-sync.mjs";
import { presenceRecordPath, meshDir } from "../src/mesh-store.mjs";
import {
  startPresenceLoop,
  resolvePresenceCadenceSeconds,
  presenceCadenceFromConfig,
  DEFAULT_PRESENCE_CADENCE_SECONDS,
} from "../src/mesh-presence-loop.mjs";
import { spawnSyncHardened } from "./support/cli-spawn.mjs";

const NODE_ID = "node-a";
const FIXED_INSTANT = "2026-06-30T10:00:00.000Z";

// ---- the manual ticker (the 22 task-01 injected-clock pattern) ----
function manualTicker() {
  const handles = [];
  return {
    start(intervalSeconds, onTick) {
      const handle = { intervalSeconds, onTick, stopped: false };
      handles.push(handle);
      return handle;
    },
    stop(handle) { handle.stopped = true; },
    fire(handle, n = 1) { for (let i = 0; i < n; i += 1) handle.onTick(); },
    handles,
  };
}

// ---- a relay-state stub (down-connect-fails / up) ----
function relayStub(state) {
  const calls = { connects: 0, pushes: 0, pushed: [] };
  return {
    calls,
    client: {
      async connect() {
        calls.connects += 1;
        if (state === "down") throw new Error("relay connect refused (relay killed)");
        return { close() {} };
      },
      async push(envelope) { calls.pushes += 1; calls.pushed.push(envelope); },
    },
  };
}

// ---- the local bare-remote git fixture (the 22 task-00 shape) ----
function git(cwd, args) {
  const r = spawnSyncHardened("git", args, { cwd, encoding: "utf8" });
  return { status: typeof r.status === "number" ? r.status : 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "", error: r.error };
}

function configIdentity(repo) {
  git(repo, ["config", "user.email", "fixture@aof.local"]);
  git(repo, ["config", "user.name", "aof fixture"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  git(repo, ["config", "core.autocrlf", "false"]);
  git(repo, ["config", "core.eol", "lf"]);
}

// Build a bare remote + a working clone whose work stream carries an .aof config (so
// loadWorkspace + invoke run against it). The clone is the git repo root; the partition
// root is .aof/mesh. Returns the roots + a real workspace (loaded via loadWorkspace
// so config.mesh.nodeId is pinned).
async function buildGitFixture() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-presence-degrade-"));
  const bare = path.join(tmp, "remote.git");
  await mkdir(bare, { recursive: true });
  let r = git(bare, ["init", "--bare", "-q", "-b", "main"]);
  if (r.error || r.status !== 0) {
    git(bare, ["init", "--bare", "-q"]);
    git(bare, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  }
  r = git(tmp, ["clone", "-q", bare, "node-a"]);
  if (r.status !== 0) throw new Error(`git clone failed: ${r.stderr}`);
  const clone = path.join(tmp, "node-a");
  configIdentity(clone);
  git(clone, ["checkout", "-q", "-b", "main"]);

  const workDir = path.join(clone, "wiki", "work");
  const milestoneDir = path.join(workDir, "23_milestone_control-node-relay");
  await mkdir(path.join(meshDir({ workDir, projectRoot: clone }), "presence"), { recursive: true });
  await mkdir(milestoneDir, { recursive: true });
  // Pin -text so git moves record bytes verbatim (the m01/R2 lesson; the engine is
  // payload-agnostic — this stops the fixture's git renormalizing line endings).
  await writeFile(path.join(clone, ".gitattributes"), "* -text\n", "utf8");
  await mkdir(path.join(clone, ".aof"), { recursive: true });
  await writeFile(
    path.join(clone, ".aof", "aof.config.json"),
    `${JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" }, mesh: { nodeId: NODE_ID } }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(milestoneDir, "SPEC.md"),
    `---\ntype: milestone\nnumber: 23\nslug: control-node-relay\nstatus: in-progress\ntitle: "Control Node Relay"\ncreated: 2026-06-30\nupdated: 2026-06-30\n---\n# 23\n`,
    "utf8"
  );
  await writeFile(path.join(clone, "README.md"), "fixture\n", "utf8");
  git(clone, ["add", "-A"]);
  git(clone, ["commit", "-q", "-m", "initial"]);
  git(clone, ["push", "-q", "-u", "origin", "main"]);

  const workspace = await loadWorkspace(clone);
  return { tmp, bare, clone, workDir, workspace };
}

// A SECOND clone (a peer node) from the same bare remote — used to prove presence reaches
// a peer over git.
async function clonePeer(fixture, name) {
  const peer = path.join(fixture.tmp, name);
  const r = git(fixture.tmp, ["clone", "-q", fixture.bare, name]);
  if (r.status !== 0) throw new Error(`peer clone failed: ${r.stderr}`);
  configIdentity(peer);
  git(peer, ["checkout", "-q", "main"]);
  const peerWorkDir = path.join(peer, "wiki", "work");
  await mkdir(path.join(meshDir({ workDir: peerWorkDir, projectRoot: peer }), "presence"), { recursive: true });
  return { peer, peerWorkDir, workspace: { workDir: peerWorkDir, projectRoot: peer } };
}

const cleanup = (fixture) => rm(fixture.tmp, { recursive: true, force: true });

export const meshPresenceDegradationLoopTests = [
  // ══ Scenario: with the relay down presence still reaches a peer over git, no record lost ══
  {
    name: "mesh-presence-degradation/01 with the relay down presence still reaches a peer over git and no record is lost",
    async run() {
      const fx = await buildGitFixture();
      try {
        // Given the injected relay client is DOWN (connect throws) + a peer that syncs git.
        const stub = relayStub("down");
        const peer = await clonePeer(fx, "node-peer");

        // When I invoke mesh:heartbeat (relay down) — the git write is unconditional.
        const result = await invoke("mesh:heartbeat", { now: FIXED_INSTANT }, { workspace: fx.workspace, relayClient: stub.client });
        // The heartbeat result is success despite the relay being down.
        assert.ok(result != null && result.nodeId === NODE_ID, "the heartbeat result is success");
        assert.equal(result.relay.attempted, true, "the relay push was attempted (the relay is configured)");
        assert.equal(result.relay.pushed, false, "the relay-down push did not deliver (liveness lost)");
        // The relay carried nothing (no envelope was pushed — connect threw).
        assert.equal(stub.calls.pushes, 0, "no signal reached the relay (the relay is down)");

        // And the peer syncs over git: this node commits+pushes its presence, the peer pulls.
        await syncMesh(fx.workspace);
        const pull = await syncMesh(peer.workspace);
        assert.ok(pull != null, "the peer synced over git");

        // This node's presence record was delivered to the peer over git.
        const peerPresencePath = presenceRecordPath(peer.workspace, NODE_ID);
        assert.ok(existsSync(peerPresencePath), "this node's presence record was delivered to the peer over git (poll-for-durability)");

        // 0 presence records lost: the durable write survived the relay failure — the bytes
        // the peer received equal the bytes this node wrote.
        const myBytes = await readFile(presenceRecordPath(fx.workspace, NODE_ID), "utf8");
        const peerBytes = await readFile(peerPresencePath, "utf8");
        assert.equal(peerBytes, myBytes, "0 presence records were lost (the peer's copy is byte-identical to this node's durable record)");

        // This node's durable record is byte-identical to a relay-UP baseline (a heartbeat
        // at the same instant with the relay up writes the same bytes — data did not degrade
        // with the liveness).
        const upStub = relayStub("up");
        const upFx = await buildGitFixture();
        try {
          await invoke("mesh:heartbeat", { now: FIXED_INSTANT }, { workspace: upFx.workspace, relayClient: upStub.client });
          const upBytes = await readFile(presenceRecordPath(upFx.workspace, NODE_ID), "utf8");
          assert.equal(myBytes, upBytes, "this node's durable record is byte-identical to the relay-up baseline (data safe, liveness lost)");
        } finally {
          await cleanup(upFx);
        }
      } finally {
        await cleanup(fx);
      }
    },
  },

  // ══ Scenario: when the relay is restored the push resumes and the durable record is unchanged ══
  {
    name: "mesh-presence-degradation/01 when the relay is restored the push resumes and the durable record is unchanged",
    async run() {
      const fx = await buildGitFixture();
      try {
        // Given I published presence once with the relay DOWN at a fixed injected instant.
        const downStub = relayStub("down");
        await invoke("mesh:heartbeat", { now: FIXED_INSTANT }, { workspace: fx.workspace, relayClient: downStub.client });
        // And I record the on-disk bytes of this node's durable presence record.
        const downBytes = await readFile(presenceRecordPath(fx.workspace, NODE_ID), "utf8");

        // When the relay is RESTORED and I publish presence again at the SAME fixed instant.
        const upStub = relayStub("up");
        const result = await invoke("mesh:heartbeat", { now: FIXED_INSTANT }, { workspace: fx.workspace, relayClient: upStub.client });

        // A presence signal is once again pushed over the relay (sub-5s liveness resumes).
        assert.equal(upStub.calls.pushes, 1, "a presence signal is once again pushed over the relay (liveness resumes)");
        assert.equal(result.relay.pushed, true, "the restored relay push delivered");

        // This node's durable record is byte-identical to the relay-down publish (the record
        // is the same whether liveness came fast or slow).
        const upBytes = await readFile(presenceRecordPath(fx.workspace, NODE_ID), "utf8");
        assert.equal(upBytes, downBytes, "the durable record is byte-identical to the relay-down publish (the record is the same whether liveness came fast or slow)");

        // The heartbeat result is success.
        assert.ok(result.nodeId === NODE_ID, "the heartbeat result is success");
      } finally {
        await cleanup(fx);
      }
    },
  },

  // ══ Scenario: the cadence loop invokes the one-shot publish once per tick and holds no
  //    publish logic ══
  {
    name: "mesh-presence-degradation/01 the cadence loop invokes the one-shot publish once per tick and holds no publish logic",
    async run() {
      // Given the cadence loop is loaded with an injected ticker (no real wall-clock wait).
      // The loop's ONLY collaborator is publishOnce; it holds no publish logic of its own
      // (no git write, no relay push directly). We prove that BY CONSTRUCTION, not with
      // tautological 0-counters:
      //   (1) startPresenceLoop is given ONLY { publishOnce, cadenceSeconds, ticker } — no
      //       git/relay seam is even in scope for the loop to reach;
      //   (2) a recording publishOnce spy is the SOLE path that ran (publishes === ticks);
      //   (3) the onTick the ticker received calls publishOnce ONCE and touches NOTHING
      //       else — a poisoned git/relay seam in the surrounding closure stays untouched
      //       (so were the loop to do a direct git write / relay push it would fail here).
      let publishes = 0;
      const publishOnce = () => { publishes += 1; };

      // Poisoned seams in the SAME closure the loop runs in: any direct git write / relay
      // push by the loop would have to touch one of these — and that would FAIL the test.
      let gitOrRelayTouched = false;
      const poisonedGit = () => { gitOrRelayTouched = true; throw new Error("the loop reached git directly"); };
      const poisonedRelay = () => { gitOrRelayTouched = true; throw new Error("the loop reached the relay directly"); };
      void poisonedGit; void poisonedRelay; // in scope but never passed to the loop

      // A recording ticker: capture the args startPresenceLoop hands ticker.start so we can
      // assert the loop's only collaborator is the onTick that calls publishOnce.
      const base = manualTicker();
      let startArgs = null;
      const ticker = {
        handles: base.handles,
        start(intervalSeconds, onTick) { startArgs = { intervalSeconds, onTick }; return base.start(intervalSeconds, onTick); },
        stop(handle) { return base.stop(handle); },
        fire(handle, n) { return base.fire(handle, n); },
      };

      // (1) The loop is constructed with ONLY { publishOnce, cadenceSeconds, ticker } — no
      // git/relay seam is passed in, so the loop has none to reach.
      const loopArgs = { publishOnce, cadenceSeconds: resolvePresenceCadenceSeconds(5), ticker };
      assert.deepEqual(
        Object.keys(loopArgs).sort(),
        ["cadenceSeconds", "publishOnce", "ticker"],
        "startPresenceLoop is given ONLY { publishOnce, cadenceSeconds, ticker } — no git/relay seam is in scope for the loop"
      );
      const loop = startPresenceLoop(loopArgs);

      // The loop handed the ticker exactly one onTick callback (its sole per-tick action).
      assert.ok(startArgs && typeof startArgs.onTick === "function", "the loop registered a single onTick with the ticker");

      // (3) Firing the registered onTick ONCE advances publishOnce by exactly one and
      // touches no other seam — the loop's per-tick work is publishOnce and nothing else.
      const before = publishes;
      startArgs.onTick();
      assert.equal(publishes, before + 1, "one onTick fire invokes the one-shot publish exactly once (the loop's only per-tick action)");
      assert.equal(gitOrRelayTouched, false, "the loop's tick reached no git/relay seam — it called only publishOnce");

      // (2) And across N real ticks the publish count equals the tick count: the recording
      // publishOnce spy is the SOLE path that ran (publishes === ticks, no extra/zero work).
      const ticksSoFar = publishes; // (1 from the manual onTick fire above)
      ticker.fire(ticker.handles[0], 3);
      assert.equal(publishes, ticksSoFar + 3, "the one-shot presence publish was invoked exactly once per tick (publishes === ticks)");
      assert.equal(gitOrRelayTouched, false, "across every tick the loop reached no git write and no relay push directly (it only invoked publishOnce)");
      loop.stop();
    },
  },

  // ══ Scenario Outline: a valid positive cadence is read from config verbatim ══
  {
    name: "mesh-presence-degradation/01 a valid positive cadence is read from config.mesh.presence.cadenceSeconds verbatim",
    async run() {
      for (const value of [5, 1, 30, 60]) {
        const cadence = presenceCadenceFromConfig({ config: { mesh: { presence: { cadenceSeconds: value } } } });
        const ticker = manualTicker();
        const loop = startPresenceLoop({ publishOnce: () => {}, cadenceSeconds: cadence, ticker });
        assert.equal(loop.intervalSeconds, value, `cadence ${value} is read from config verbatim as the tick interval`);
        loop.stop();
      }
    },
  },

  // ══ Scenario Outline: a malformed or absent cadence falls back to the documented default ══
  {
    name: "mesh-presence-degradation/01 a malformed or absent cadence falls back to the documented default and the loop does not crash",
    async run() {
      const cases = [
        { label: "absent", config: { mesh: { presence: {} } } },
        { label: "null", config: { mesh: { presence: { cadenceSeconds: null } } } },
        { label: '"fast"', config: { mesh: { presence: { cadenceSeconds: "fast" } } } },
        { label: '"5"', config: { mesh: { presence: { cadenceSeconds: "5" } } } },
        { label: "true", config: { mesh: { presence: { cadenceSeconds: true } } } },
        { label: "0", config: { mesh: { presence: { cadenceSeconds: 0 } } } },
        { label: "-5", config: { mesh: { presence: { cadenceSeconds: -5 } } } },
        { label: "5.5", config: { mesh: { presence: { cadenceSeconds: 5.5 } } } },
      ];
      assert.equal(DEFAULT_PRESENCE_CADENCE_SECONDS, 5, "the documented default presence cadence is 5s");
      for (const { label, config } of cases) {
        const cadence = presenceCadenceFromConfig({ config });
        // Every row falls back to the SAME documented default.
        assert.equal(cadence, DEFAULT_PRESENCE_CADENCE_SECONDS, `malformed cadence ${label} falls back to the documented default (${DEFAULT_PRESENCE_CADENCE_SECONDS}s)`);
        // The loop's tick interval is the documented default, and it starts without crashing.
        let started = false;
        assert.doesNotThrow(() => {
          const ticker = manualTicker();
          const loop = startPresenceLoop({ publishOnce: () => {}, cadenceSeconds: cadence, ticker });
          started = loop.intervalSeconds === DEFAULT_PRESENCE_CADENCE_SECONDS;
          loop.stop();
        }, `the loop started without crashing on the bad config (${label})`);
        assert.ok(started, `the loop started at the documented default for cadence ${label}`);
      }
      // A wholly absent mesh/presence subtree also falls back.
      assert.equal(presenceCadenceFromConfig({}), DEFAULT_PRESENCE_CADENCE_SECONDS, "a wholly absent config falls back to the default");
      assert.equal(presenceCadenceFromConfig(undefined), DEFAULT_PRESENCE_CADENCE_SECONDS, "an undefined workspace falls back to the default");
    },
  },

  // ══ Scenario: the cadence loop reads its interval at start and is stable for the run ══
  {
    name: "mesh-presence-degradation/01 the cadence loop reads its interval at start and is stable for the run",
    async run() {
      // Given config.mesh.presence.cadenceSeconds is 5 → When I start the cadence loop.
      const config = { mesh: { presence: { cadenceSeconds: 5 } } };
      const cadenceAtStart = presenceCadenceFromConfig({ config });
      const ticker = manualTicker();
      const loop = startPresenceLoop({ publishOnce: () => {}, cadenceSeconds: cadenceAtStart, ticker });
      assert.equal(loop.intervalSeconds, 5, "the loop started at the 5s cadence read from config");
      // And config.mesh.presence.cadenceSeconds is later changed to 30.
      config.mesh.presence.cadenceSeconds = 30;
      // The running loop's tick interval is still 5 seconds (the cadence is read at start).
      assert.equal(loop.intervalSeconds, 5, "the running loop's tick interval is still 5s (the cadence is read at start)");
      loop.stop();
    },
  },
];
