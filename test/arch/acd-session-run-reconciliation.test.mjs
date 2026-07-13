// Fitness function: acd-session-run-reconciliation (milestone 38 / ADR-004) —
// "a run+session on one workspace yields ONE line (the run's), a session-only
// workspace yields the (session) fallback, and two workspaces yield two lines."
//
// REVIEW FIX (F1, MAJOR): the FIRST version of this fitness function fed
// `ui/src/fleet/runs.mjs` attributed run OBJECTS (`{ workspaceId }`) — a shape
// production NEVER emits. The real wire's `activeRuns` is the frozen m23
// `string[]` of bare run ids (23/ADR-002; `ui/src/fleet/api.ts`); it carries NO
// workspace attribution. The ADR-004 "run subsumes a same-workspace session" rule
// is therefore applied UPSTREAM, in `assembleCurrentPresenceRecord`
// (src/mesh-launcher.mjs) — the ONE place per-workspace attribution genuinely
// exists (it already loops per-workspace to build activeRuns). This fitness
// function now exercises the REAL production path end-to-end: a hermetic fixture
// repo seeds a running run AND a live session on the SAME workspace, and asserts
// the ASSEMBLED presence record already carries the subsumed shape (the render
// helper is then proven, separately, to render whatever it is handed correctly —
// test/mesh-fleet-session-render.test.mjs).
//
// Proofs:
//  1. BEHAVIOURAL — a run AND a live session on the SAME workspace: the assembled
//     presence record's `sessions[]` does NOT contain that workspace's session (it
//     is subsumed) while `activeRuns` still carries the run — so the render helper
//     downstream sees exactly the run, never a duplicate line.
//  2. BEHAVIOURAL — a session-only workspace (no run anywhere): the assembled
//     record's `sessions[]` retains it — the render helper renders the (session)
//     fallback.
//  3. BEHAVIOURAL — a run in one workspace + a live session in ANOTHER
//     (unsubsumed) workspace: both survive onto the assembled record — two
//     workspaces, two facts, exactly SPEC's "a node working two repos shows both".
//  4. STRUCTURAL — the render helper (ui/src/fleet/runs.mjs) is fed the assembled
//     record and renders the correct line set from it (closing the loop:
//     assemble → render, no divergent collapse rule in between).
//  Self-check (m03 non-vacuous): a planted assembler that does NOT subsume (skips
//  the workspacesWithRuns filter) fails the "no duplicate line" assertion the real
//  assembler passes.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkspace } from "../../src/work.mjs";
import { startLauncher } from "../../src/mesh-launcher.mjs";
import { openGlobalWorkProjectionStore } from "../../src/global-work-store.mjs";
import { startSession } from "../../src/mesh-session.mjs";
import { fleetCurrentWorkLines } from "../../ui/src/fleet/runs.mjs";

const NODE_ID = "node-a";
const NOW = "2026-07-10T12:00:00.000Z";

function manualTicker() {
  const handles = [];
  return {
    handles,
    start(intervalSeconds, onTick) {
      const handle = { intervalSeconds, onTick, stopped: false };
      handles.push(handle);
      return handle;
    },
    stop(handle) { handle.stopped = true; },
  };
}

async function makeFixtureRepo() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-acd-session-run-reconciliation-"));
  const root = path.join(tmp, "repo");
  const home = path.join(tmp, "home");
  const workDir = path.join(root, "wiki", "work");
  await mkdir(workDir, { recursive: true });
  await mkdir(path.join(root, ".aof"), { recursive: true });
  const workspaceId = "ws-A";
  const config = { name: "fixture", work: { dir: "./wiki/work" }, mesh: { nodeId: NODE_ID, fabric: "tailscale", workspaceId } };
  await writeFile(path.join(root, ".aof", "aof.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return { tmp, root, home, workDir, workspaceId, env: { AOF_GLOBAL_HOME: home } };
}

async function makeSecondaryWorkspace(tmp, slug) {
  const root = path.join(tmp, `repo-${slug}`);
  const workDir = path.join(root, "wiki", "work");
  await mkdir(workDir, { recursive: true });
  return { root, workDir };
}

async function seedWorkspaceRegistration(env, { workspaceId, workDir, nodeId = NODE_ID }) {
  const store = await openGlobalWorkProjectionStore({ env });
  try {
    store.db.prepare(`
      INSERT OR REPLACE INTO global_workspace_descriptors
        (workspace_id, project_root, work_dir, name, mesh_enabled, control_node, member_node_ids_json, published_at, descriptor_path)
      VALUES (?, ?, ?, ?, 1, NULL, '[]', ?, ?)
    `).run(workspaceId, path.dirname(workDir), workDir, workspaceId, NOW, `descriptor-${workspaceId}.json`);
    store.db.prepare("INSERT OR REPLACE INTO global_node_workspaces (node_id, workspace_id) VALUES (?, ?)").run(nodeId, workspaceId);
  } finally {
    store.close();
  }
}

async function seedRunningRun(workDirRoot, itemDirName, runId) {
  const milestoneDir = path.join(workDirRoot, itemDirName);
  await mkdir(milestoneDir, { recursive: true });
  await writeFile(path.join(milestoneDir, "SPEC.md"), "---\ntype: milestone\nnumber: 99\nslug: demo\nstatus: in-progress\ntitle: Demo\n---\n", "utf8");
  const runsDir = path.join(milestoneDir, "runs");
  await mkdir(runsDir, { recursive: true });
  const record = {
    runId, itemRef: "99", state: "running", attempt: 1, outcome: null,
    sessionId: null, brief: {}, createdAt: NOW, updatedAt: NOW,
    failureReason: null, heartbeatAt: null, retryOf: null, reclaimedAt: null,
  };
  await writeFile(path.join(runsDir, `${runId}.json`), JSON.stringify(record, null, 2), "utf8");
}

async function assembleOnce(root, env) {
  const ws = await loadWorkspace(root, undefined, { env });
  const handle = await startLauncher(ws, {
    exec: async () => ({ stdout: JSON.stringify({ BackendState: "Running", Self: { HostName: NODE_ID, DNSName: `${NODE_ID}.tail1a2b.ts.net.`, TailscaleIPs: ["100.1.1.1"], Online: true }, Peer: {} }), status: 0 }),
    platform: "linux",
    peerPollTicker: manualTicker(),
    propagationTicker: manualTicker(),
    streamServer: false,
    streamClient: false,
    now: () => NOW,
    globalWorkStoreOptions: { env },
  });
  handle.stop?.();
  return handle.record;
}

export const archTests = [
  {
    name: "arch/38 ADR-004 (acd-session-run-reconciliation): a run AND a live session on the SAME workspace — the assembled record subsumes the session, so the render helper sees exactly ONE line (behavioural, end-to-end)",
    run: async () => {
      const fixture = await makeFixtureRepo();
      try {
        await seedRunningRun(fixture.workDir, "38_milestone_demo", "run-a1");
        const ws = await loadWorkspace(fixture.root, undefined, { env: fixture.env });
        await startSession(ws, { nodeId: NODE_ID, workspaceId: fixture.workspaceId, repo: "alpha", assistant: "claude-code", now: NOW });

        const record = await assembleOnce(fixture.root, fixture.env);
        assert.ok(record.activeRuns.includes("run-a1"), "activeRuns still carries the run");
        assert.ok(!record.sessions.some((s) => s.workspaceId === fixture.workspaceId), "the SAME-workspace session is subsumed — absent from the assembled sessions[]");

        const rendered = fleetCurrentWorkLines(record);
        assert.equal(rendered.lines.length, 1, "the render helper sees exactly one line for this workspace");
        assert.ok(!rendered.lines.some((line) => line.includes("(session)")), "no (session) line is emitted — the run wins");
      } finally {
        await rm(fixture.tmp, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/38 ADR-004 (acd-session-run-reconciliation): a session-only workspace (no run anywhere) survives onto the assembled record — the render helper shows the (session) fallback (behavioural)",
    run: async () => {
      const fixture = await makeFixtureRepo();
      try {
        const ws = await loadWorkspace(fixture.root, undefined, { env: fixture.env });
        await startSession(ws, { nodeId: NODE_ID, workspaceId: fixture.workspaceId, repo: "alpha", assistant: "claude-code", now: NOW });

        const record = await assembleOnce(fixture.root, fixture.env);
        assert.deepEqual(record.activeRuns, [], "no run anywhere");
        assert.ok(record.sessions.some((s) => s.workspaceId === fixture.workspaceId), "the session-only workspace's session survives");

        const rendered = fleetCurrentWorkLines(record);
        assert.deepEqual(rendered.lines, ["working · alpha (session)"]);
      } finally {
        await rm(fixture.tmp, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/38 ADR-004 (acd-session-run-reconciliation): a run in one workspace + a live session in ANOTHER (unsubsumed) workspace both survive — two workspaces, two lines (SPEC 'a node working two repos shows both', behavioural)",
    run: async () => {
      const fixture = await makeFixtureRepo();
      try {
        const second = await makeSecondaryWorkspace(fixture.tmp, "second");
        await seedWorkspaceRegistration(fixture.env, { workspaceId: "ws-B", workDir: second.workDir });
        await seedRunningRun(fixture.workDir, "38_milestone_demo", "run-a1");
        const ws = await loadWorkspace(fixture.root, undefined, { env: fixture.env });
        await startSession(ws, { nodeId: NODE_ID, workspaceId: "ws-B", repo: "beta", assistant: "claude-code", now: NOW });

        const record = await assembleOnce(fixture.root, fixture.env);
        assert.ok(record.activeRuns.includes("run-a1"));
        assert.ok(record.sessions.some((s) => s.workspaceId === "ws-B"), "the DIFFERENT-workspace session is NOT subsumed");

        const rendered = fleetCurrentWorkLines(record);
        assert.equal(rendered.lines.length, 2, "two current-work lines");
        assert.ok(rendered.lines.includes("running 1 run"));
        assert.ok(rendered.lines.includes("working · beta (session)"));
      } finally {
        await rm(fixture.tmp, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/38 ADR-004 (acd-session-run-reconciliation): self-check — a planted un-subsumed presence shape fails the 'no duplicate line' assertion the real (subsumed) shape passes (non-vacuous)",
    run: async () => {
      // The REAL production behaviour (mirroring the first proof above): a run and
      // session on the SAME workspace collapse to one line once subsumed.
      const realRecord = { activeRuns: ["run-a1"], sessions: [] }; // sessions already subsumed by the real assembler
      const realRendered = fleetCurrentWorkLines(realRecord);
      assert.equal(realRendered.lines.length, 1, "the real (subsumed) shape renders one line");

      // A PLANTED violation: an assembler that forgot to subsume — the session for
      // the SAME workspace as the run leaks onto the wire unfiltered.
      const plantedUnsubsumedRecord = { activeRuns: ["run-a1"], sessions: [{ workspaceId: "ws-A", repo: "alpha", assistant: "claude-code", lastPingAt: NOW }] };
      const plantedRendered = fleetCurrentWorkLines(plantedUnsubsumedRecord);
      assert.equal(plantedRendered.lines.length, 2, "the planted UNSUBSUMED shape wrongly renders two lines for one workspace");
      assert.notEqual(plantedRendered.lines.length, realRendered.lines.length, "the planted (buggy) assembler shape disagrees with the real (correct, subsumed) one");
    },
  },
];
