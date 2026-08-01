// Traceability wiring for milestone 38 / story 00
// tasks/10_bug-workspace-workdir-absolute.feature — FINDING F11 (aof:verify 38,
// BLOCKER): "A registered workspace's work dir is resolvable from ANY cwd, so
// presence genuinely aggregates across workspaces."
//
// THE ASSERTION WHOSE ABSENCE LET F11 SHIP (the @qa note on the feature itself):
// "resolve the node's workspaces FROM A FOREIGN CWD and still read each workspace's
// real items." Every test here exercises the REAL descriptor store — real
// workspaces (loadWorkspace over real fixture repos), published through the REAL
// write path (publishGlobalRegistryDescriptorsToStore, exactly what
// mesh-launcher.mjs's propagation tick calls in production) — NEVER an injected
// workspace list with a hand-written absolute workDir. That convenience fixture
// (test/mesh-presence-aggregate-workspaces.test.mjs's seedWorkspaceRegistration raw
// INSERT of an already-absolute workDir) is exactly what let F11 ship undetected:
// it never fed the aggregation the RAW RELATIVE `config.work.dir` shape the real
// registry actually writes/reads. The two scenarios that deliberately DO seed a raw
// descriptor row via SQL (the "legacy relative row" and "genuinely-missing workdir"
// scenarios below) are the sanctioned exception — they simulate PRE-EXISTING rows
// written by the pre-fix code, which is a real, distinct concern from "convenient
// but unrealistic test fixture".
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkspace } from "../src/work.mjs";
import { startLauncher } from "../src/mesh-launcher.mjs";
import { resolveNodeWorkspaces } from "../src/mesh-presence.mjs";
import { startSession } from "../src/mesh-session.mjs";
import { openGlobalWorkProjectionStore } from "../src/global-work-store.mjs";
import { publishGlobalRegistryDescriptorsToStore } from "../src/global-node-registry.mjs";
import { publishNodeRecord } from "../src/mesh-store.mjs";
import { meshCheckoutPath } from "../src/mesh-worker-execution.mjs";

const NODE_ID = "node-a";
const NOW = "2026-07-12T09:00:00.000Z";

async function withTemp(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-workdir-absolute-"));
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

// A REAL fixture repo whose committed config carries the literal RELATIVE
// `config.work.dir` value F11 measured live ("./wiki/work") — never a
// pre-resolved/absolute one. `workspaceId` (when supplied) pins
// config.mesh.workspaceId to a known literal so assertions can key off it.
async function makeRealRepo(root, { workspaceId } = {}) {
  const workDir = path.join(root, "wiki", "work");
  await mkdir(workDir, { recursive: true });
  await mkdir(path.join(root, ".aof"), { recursive: true });
  const config = {
    name: path.basename(root),
    work: { dir: "./wiki/work" },
    mesh: { nodeId: NODE_ID, fabric: "tailscale", ...(workspaceId ? { workspaceId } : {}) },
  };
  await writeFile(path.join(root, ".aof", "aof.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return { root, workDir };
}

async function seedRunningRun(workDirRoot, itemDirName, runId) {
  const milestoneDir = path.join(workDirRoot, itemDirName);
  await mkdir(milestoneDir, { recursive: true });
  await writeFile(
    path.join(milestoneDir, "SPEC.md"),
    "---\ntype: milestone\nnumber: 99\nslug: demo\nstatus: in-progress\ntitle: Demo\n---\n",
    "utf8",
  );
  const runsDir = path.join(milestoneDir, "runs");
  await mkdir(runsDir, { recursive: true });
  const record = {
    runId, itemRef: "99", state: "running", attempt: 1, outcome: null,
    sessionId: null, brief: {}, createdAt: NOW, updatedAt: NOW,
    failureReason: null, heartbeatAt: null, retryOf: null, reclaimedAt: null,
  };
  await writeFile(path.join(runsDir, `${runId}.json`), JSON.stringify(record, null, 2), "utf8");
}

// A ticker that never fires — the launcher publishes once at start + once at the
// (single, synchronous) initial propagation call, then this suite reads the
// returned handle. Mirrors test/mesh-presence-aggregate-workspaces.test.mjs's
// manualTicker idiom.
function manualTicker() {
  return { start() { return null; }, stop() {} };
}

// The REAL write path: seed a node record (readNodeRecords' source) THEN publish
// this workspace's descriptor + node-workspace membership through
// publishGlobalRegistryDescriptorsToStore — the SAME function mesh-launcher.mjs's
// propagation tick calls in production. Never a hand-written absolute workDir.
async function publishRealDescriptor(store, ws) {
  await publishNodeRecord(ws, NODE_ID, {
    nodeId: NODE_ID, host: NODE_ID, os: "win32", runtimes: ["codex"],
    aofVersion: "1.2.3", publishedAt: NOW,
  });
  return publishGlobalRegistryDescriptorsToStore(store, ws, { now: NOW });
}

async function withCwd(dir, fn) {
  const original = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(original);
  }
}

async function startLauncherOnce(ws, env) {
  const handle = await startLauncher(ws, {
    exec: async () => ({
      stdout: JSON.stringify({
        BackendState: "Running",
        Self: { HostName: NODE_ID, DNSName: `${NODE_ID}.tail1a2b.ts.net.`, TailscaleIPs: ["100.1.1.1"], Online: true },
        Peer: {},
      }),
      status: 0,
    }),
    platform: "linux",
    peerPollTicker: manualTicker(),
    propagationTicker: manualTicker(),
    streamServer: false,
    streamClient: false,
    now: () => NOW,
    globalWorkStoreOptions: { env },
  });
  handle.stop?.();
  return handle;
}

export const meshWorkspaceWorkdirAbsoluteTests = [
  // ══ Scenario: a published workspace descriptor stores an ABSOLUTE work dir ══
  {
    name: "mesh-workspace-workdir-absolute/10 a published workspace descriptor stores an ABSOLUTE work dir, resolved against its OWN project_root — a config.work.dir of './wiki/work' is stored resolved, not verbatim",
    async run() {
      await withTemp(async (tmp) => {
        const home = path.join(tmp, "home");
        const env = { AOF_GLOBAL_HOME: home };
        const alpha = await makeRealRepo(path.join(tmp, "alpha"), { workspaceId: "ws-alpha" });
        const wsAlpha = await loadWorkspace(alpha.root, undefined, { env });
        const store = await openGlobalWorkProjectionStore({ env });
        try {
          await publishRealDescriptor(store, wsAlpha);
          const row = store.db.prepare("SELECT project_root, work_dir FROM global_workspace_descriptors WHERE workspace_id = ?").get("ws-alpha");
          assert.ok(row, "the descriptor row was published");
          assert.ok(path.isAbsolute(row.work_dir), "work_dir is stored ABSOLUTE");
          assert.equal(row.work_dir, path.resolve(wsAlpha.projectRoot, "./wiki/work"), "work_dir equals the work dir resolved against THIS workspace's OWN project_root");
          assert.notEqual(row.work_dir, "./wiki/work", "the raw relative config.work.dir string is never stored verbatim");
        } finally {
          store.close();
        }
      });
    },
  },

  // ══ Scenario: presence aggregation reads each workspace's OWN items, from a foreign cwd (the root fix, for real) ══
  {
    name: "mesh-workspace-workdir-absolute/10 resolveNodeWorkspaces resolves BOTH real workspaces with ABSOLUTE, DISTINCT work dirs from a FOREIGN cwd (the exact live resolveNodeWorkspaces('umairs-msi') measurement)",
    async run() {
      await withTemp(async (tmp) => {
        const home = path.join(tmp, "home");
        const env = { AOF_GLOBAL_HOME: home };
        const alpha = await makeRealRepo(path.join(tmp, "alpha"), { workspaceId: "ws-alpha" });
        const beta = await makeRealRepo(path.join(tmp, "beta"), { workspaceId: "ws-beta" });
        const wsAlpha = await loadWorkspace(alpha.root, undefined, { env });
        const wsBeta = await loadWorkspace(beta.root, undefined, { env });
        const store = await openGlobalWorkProjectionStore({ env });
        try {
          await publishRealDescriptor(store, wsAlpha);
          await publishRealDescriptor(store, wsBeta);
        } finally {
          store.close();
        }

        const foreignDir = path.join(tmp, "install-dir");
        await mkdir(foreignDir, { recursive: true });

        const result = await withCwd(foreignDir, () => resolveNodeWorkspaces(NODE_ID, { globalWorkStoreOptions: { env } }));

        assert.equal(result.ok, true);
        assert.equal(result.workspaces.length, 2, "BOTH registered workspaces resolve, from a cwd that is NEITHER of them");
        const byId = new Map(result.workspaces.map((w) => [w.workspaceId, w]));
        assert.ok(path.isAbsolute(byId.get("ws-alpha").workDir));
        assert.ok(path.isAbsolute(byId.get("ws-beta").workDir));
        assert.equal(byId.get("ws-alpha").workDir, wsAlpha.workDir);
        assert.equal(byId.get("ws-beta").workDir, wsBeta.workDir);
        assert.notEqual(byId.get("ws-alpha").workDir, byId.get("ws-beta").workDir, "the two workspaces resolve to DISTINCT dirs — never the same dir read twice");
        assert.deepEqual(result.skipped, [], "no legitimate workspace is skipped");
      });
    },
  },
  {
    name: "mesh-workspace-workdir-absolute/10 presence aggregation reads EACH workspace's OWN items from a foreign cwd — the aggregate is the union across two DISTINCT workspaces",
    async run() {
      await withTemp(async (tmp) => {
        const home = path.join(tmp, "home");
        const env = { AOF_GLOBAL_HOME: home };
        const alpha = await makeRealRepo(path.join(tmp, "alpha"), { workspaceId: "ws-alpha" });
        const beta = await makeRealRepo(path.join(tmp, "beta"), { workspaceId: "ws-beta" });
        const wsAlpha = await loadWorkspace(alpha.root, undefined, { env });
        const wsBeta = await loadWorkspace(beta.root, undefined, { env });
        const store = await openGlobalWorkProjectionStore({ env });
        try {
          await publishRealDescriptor(store, wsAlpha);
          await publishRealDescriptor(store, wsBeta);
        } finally {
          store.close();
        }

        await seedRunningRun(alpha.workDir, "38_milestone_alpha", "run-alpha");
        await seedRunningRun(beta.workDir, "38_milestone_beta", "run-beta");

        const foreignDir = path.join(tmp, "install-dir");
        await mkdir(foreignDir, { recursive: true });

        const handle = await withCwd(foreignDir, () => startLauncherOnce(wsAlpha, env));
        assert.deepEqual(
          [...handle.record.activeRuns].sort(),
          ["run-alpha", "run-beta"],
          "the union covers BOTH workspaces' own runs, each read from its own absolute dir — never the same workspace counted twice",
        );
      });
    },
  },

  // ══ Scenario: one running run is reported once, not once per registered workspace ══
  {
    name: "mesh-workspace-workdir-absolute/10 ONE running run in ONE workspace is reported EXACTLY ONCE — even when cwd is the workspace ITSELF (the exact 'accidental success' condition that hid the bug)",
    async run() {
      await withTemp(async (tmp) => {
        const home = path.join(tmp, "home");
        const env = { AOF_GLOBAL_HOME: home };
        const alpha = await makeRealRepo(path.join(tmp, "alpha"), { workspaceId: "ws-alpha" });
        const beta = await makeRealRepo(path.join(tmp, "beta"), { workspaceId: "ws-beta" });
        const wsAlpha = await loadWorkspace(alpha.root, undefined, { env });
        const wsBeta = await loadWorkspace(beta.root, undefined, { env });
        const store = await openGlobalWorkProjectionStore({ env });
        try {
          await publishRealDescriptor(store, wsAlpha);
          await publishRealDescriptor(store, wsBeta);
        } finally {
          store.close();
        }
        await seedRunningRun(alpha.workDir, "38_milestone_alpha", "run-only");

        // cwd = alpha ITSELF — the launch-cwd workspace is ALSO its own separately
        // registered global_workspace_descriptors row; pre-fix this raw relative
        // "./wiki/work" row + the absolute ws.workDir entry were TWO DIFFERENT dedup
        // keys, double-counting the SAME run.
        const handle = await withCwd(alpha.root, () => startLauncherOnce(wsAlpha, env));

        assert.deepEqual(handle.record.activeRuns, ["run-only"], "activeRuns contains the run id EXACTLY ONCE — never duplicated by the workspace also being its own registry entry");
      });
    },
  },

  // ══ Scenario: a run in one workspace does NOT subsume a live session in a DIFFERENT workspace (ADR-004 integrity) ══
  {
    name: "mesh-workspace-workdir-absolute/10 a run in workspace A does NOT subsume a live session in workspace B — B's session survives, A's own same-workspace session is subsumed",
    async run() {
      await withTemp(async (tmp) => {
        const home = path.join(tmp, "home");
        const env = { AOF_GLOBAL_HOME: home };
        const alpha = await makeRealRepo(path.join(tmp, "alpha"), { workspaceId: "ws-alpha" });
        const beta = await makeRealRepo(path.join(tmp, "beta"), { workspaceId: "ws-beta" });
        const wsAlpha = await loadWorkspace(alpha.root, undefined, { env });
        const wsBeta = await loadWorkspace(beta.root, undefined, { env });
        const store = await openGlobalWorkProjectionStore({ env });
        try {
          await publishRealDescriptor(store, wsAlpha);
          await publishRealDescriptor(store, wsBeta);
        } finally {
          store.close();
        }

        await seedRunningRun(alpha.workDir, "38_milestone_alpha", "run-alpha");
        await startSession(wsAlpha, { nodeId: NODE_ID, workspaceId: "ws-alpha", repo: "repo-alpha", assistant: "claude-code", now: NOW });
        await startSession(wsAlpha, { nodeId: NODE_ID, workspaceId: "ws-beta", repo: "repo-beta", assistant: "claude-code", now: NOW });

        const foreignDir = path.join(tmp, "install-dir");
        await mkdir(foreignDir, { recursive: true });

        const handle = await withCwd(foreignDir, () => startLauncherOnce(wsAlpha, env));

        assert.ok(handle.record.activeRuns.includes("run-alpha"), "A's run still aggregates");
        assert.ok(!handle.record.sessions.some((s) => s.workspaceId === "ws-alpha"), "A's own same-workspace session is subsumed by its run (ADR-004)");
        assert.ok(handle.record.sessions.some((s) => s.workspaceId === "ws-beta"), "B's session SURVIVES — no run exists in B");
      });
    },
  },

  // ══ Scenario: a packaged tray app launched from its install dir reflects real work ══
  {
    name: "mesh-workspace-workdir-absolute/10 the tray-app case: cwd is an install dir that is NO registered workspace — resolves a NON-EMPTY workspace set and the node does NOT read idle while a registered workspace is genuinely worked",
    async run() {
      await withTemp(async (tmp) => {
        const home = path.join(tmp, "home");
        const env = { AOF_GLOBAL_HOME: home };
        const alpha = await makeRealRepo(path.join(tmp, "alpha"), { workspaceId: "ws-alpha" });
        const beta = await makeRealRepo(path.join(tmp, "beta"), { workspaceId: "ws-beta" });
        const wsAlpha = await loadWorkspace(alpha.root, undefined, { env });
        const wsBeta = await loadWorkspace(beta.root, undefined, { env });
        const store = await openGlobalWorkProjectionStore({ env });
        try {
          await publishRealDescriptor(store, wsAlpha);
          await publishRealDescriptor(store, wsBeta);
        } finally {
          store.close();
        }

        // No run anywhere; only B carries a live session — alpha (the launch-cwd)
        // is genuinely idle on its own.
        await startSession(wsAlpha, { nodeId: NODE_ID, workspaceId: "ws-beta", repo: "repo-beta", assistant: "claude-code", now: NOW });

        const installDir = path.join(tmp, "install-dir");
        await mkdir(installDir, { recursive: true });

        const resolved = await withCwd(installDir, () => resolveNodeWorkspaces(NODE_ID, { globalWorkStoreOptions: { env } }));
        assert.ok(resolved.workspaces.length > 0, "the install-dir cwd still resolves a NON-EMPTY registered-workspace set — never silently zero");

        const handle = await withCwd(installDir, () => startLauncherOnce(wsAlpha, env));
        assert.equal(handle.record.activeRuns.length, 0);
        assert.ok(handle.record.sessions.some((s) => s.workspaceId === "ws-beta"), "B's live session surfaces");
        const overall = handle.record.activeRuns.length > 0 || handle.record.sessions.length > 0 ? "working" : "idle";
        assert.equal(overall, "working", "the node reads working — never idle — while a registered (non-launch-cwd) workspace is genuinely worked on");
      });
    },
  },

  // ══ Scenario: a WORKER-side membership row with NO descriptor resolves through its mesh checkout ══
  //
  // Measured 2026-07-26: the Mac worker's membership row for the assignment-cloned
  // let-shield repo could NEVER resolve — the workspace descriptor lives only in the
  // CONTROL's store — so every 5s presence tick warned workspace-workdir-unresolvable,
  // flooding the remote log ring (259 of its 260 entries) and hiding every real line.
  // On a worker, the workspace IS its mesh checkout: the launcher now recovers a
  // `no-descriptor` skip through meshCheckoutPath before warning.
  {
    name: "mesh-workspace-workdir-absolute/no-descriptor membership resolves through the MESH CHECKOUT — it aggregates like any workspace and emits NO unresolvable warning; a membership with no checkout still warns",
    async run() {
      await withTemp(async (tmp) => {
        const home = path.join(tmp, "home");
        const env = { AOF_GLOBAL_HOME: home };

        // The launch-cwd workspace (published normally, its own descriptor).
        const alpha = await makeRealRepo(path.join(tmp, "alpha"), { workspaceId: "ws-alpha" });
        const wsAlpha = await loadWorkspace(alpha.root, undefined, { env });

        // A real repo AT the mesh checkout path for ws-checkout — exactly what the
        // worker's clone-on-assignment leaves behind (config pinned to the id).
        const checkoutRoot = meshCheckoutPath("ws-checkout", { env });
        const checkout = await makeRealRepo(checkoutRoot, { workspaceId: "ws-checkout" });
        await seedRunningRun(checkout.workDir, "18_milestone_checkout", "run-checkout");

        const store = await openGlobalWorkProjectionStore({ env });
        try {
          await publishRealDescriptor(store, wsAlpha);
          // Membership rows ONLY — no descriptor (the worker's exact live state):
          // one workspace whose checkout exists, one ghost with nothing behind it.
          store.db.prepare("INSERT OR REPLACE INTO global_node_workspaces (node_id, workspace_id) VALUES (?, ?)").run(NODE_ID, "ws-checkout");
          store.db.prepare("INSERT OR REPLACE INTO global_node_workspaces (node_id, workspace_id) VALUES (?, ?)").run(NODE_ID, "ws-ghost");
        } finally {
          store.close();
        }

        const foreignDir = path.join(tmp, "install-dir");
        await mkdir(foreignDir, { recursive: true });
        const handle = await withCwd(foreignDir, () => startLauncherOnce(wsAlpha, env));

        assert.ok(
          handle.record.activeRuns.includes("run-checkout"),
          "the checkout-backed workspace joins the aggregation — its run surfaces despite the absent descriptor",
        );
        const unresolvable = handle.warnings.filter((w) => w.code === "workspace-workdir-unresolvable");
        assert.ok(
          !unresolvable.some((w) => w.message.includes("ws-checkout")),
          "the recovered workspace emits NO unresolvable warning — the every-5s false alarm is dead",
        );
        assert.ok(
          unresolvable.some((w) => w.message.includes("ws-ghost")),
          "a membership with NO checkout behind it still warns loudly — the genuine diagnostic survives",
        );
      });
    },
  },

  // ══ Scenario: an existing descriptor row holding a legacy RELATIVE work dir is tolerated, not trusted ══
  {
    name: "mesh-workspace-workdir-absolute/10 a legacy descriptor row holding the RAW RELATIVE work_dir './wiki/work' (written before this fix) is resolved against ITS OWN project_root from a foreign cwd — not skipped",
    async run() {
      await withTemp(async (tmp) => {
        const home = path.join(tmp, "home");
        const env = { AOF_GLOBAL_HOME: home };
        const beta = await makeRealRepo(path.join(tmp, "beta"), { workspaceId: "ws-legacy" });
        const store = await openGlobalWorkProjectionStore({ env });
        try {
          // Simulate a row written by the PRE-FIX write path: work_dir stored
          // verbatim-relative — this is what rows already on the real machine hold.
          store.db.prepare(`
            INSERT INTO global_workspace_descriptors
              (workspace_id, project_root, work_dir, name, mesh_enabled, control_node, member_node_ids_json, published_at, descriptor_path)
            VALUES (?, ?, ?, ?, 1, NULL, '[]', ?, ?)
          `).run("ws-legacy", path.resolve(beta.root), "./wiki/work", "beta", NOW, "descriptor-ws-legacy.json");
          store.db.prepare("INSERT OR REPLACE INTO global_node_workspaces (node_id, workspace_id) VALUES (?, ?)").run(NODE_ID, "ws-legacy");
        } finally {
          store.close();
        }

        const foreignDir = path.join(tmp, "install-dir");
        await mkdir(foreignDir, { recursive: true });
        const result = await withCwd(foreignDir, () => resolveNodeWorkspaces(NODE_ID, { globalWorkStoreOptions: { env } }));

        assert.equal(result.ok, true);
        const entry = result.workspaces.find((w) => w.workspaceId === "ws-legacy");
        assert.ok(entry, "the legacy relative row is NOT silently skipped");
        assert.equal(entry.workDir, path.resolve(beta.root, "./wiki/work"), "resolved against ITS OWN project_root, never the reader's cwd");
        assert.ok(path.isAbsolute(entry.workDir));
        assert.equal(result.skipped.length, 0);
      });
    },
  },

  // ══ Scenario: a workspace whose work dir genuinely does not exist is skipped LOUDLY, not silently ══
  {
    name: "mesh-workspace-workdir-absolute/10 a workspace whose resolved absolute work dir genuinely does not exist is skipped, and the skip is SURFACED — never a silent, unexplained empty aggregate",
    async run() {
      await withTemp(async (tmp) => {
        const home = path.join(tmp, "home");
        const env = { AOF_GLOBAL_HOME: home };
        const missingRoot = path.join(tmp, "vanished-repo");
        const store = await openGlobalWorkProjectionStore({ env });
        try {
          store.db.prepare(`
            INSERT INTO global_workspace_descriptors
              (workspace_id, project_root, work_dir, name, mesh_enabled, control_node, member_node_ids_json, published_at, descriptor_path)
            VALUES (?, ?, ?, ?, 1, NULL, '[]', ?, ?)
          `).run("ws-gone", path.resolve(missingRoot), "./wiki/work", "gone", NOW, "descriptor-ws-gone.json");
          store.db.prepare("INSERT OR REPLACE INTO global_node_workspaces (node_id, workspace_id) VALUES (?, ?)").run(NODE_ID, "ws-gone");
        } finally {
          store.close();
        }

        const foreignDir = path.join(tmp, "install-dir");
        await mkdir(foreignDir, { recursive: true });
        const result = await withCwd(foreignDir, () => resolveNodeWorkspaces(NODE_ID, { globalWorkStoreOptions: { env } }));

        assert.equal(result.ok, true);
        assert.equal(result.workspaces.length, 0, "the unresolvable workspace contributes nothing to the resolved set");
        assert.equal(result.skipped.length, 1, "the skip is SURFACED, not silent");
        assert.equal(result.skipped[0].workspaceId, "ws-gone");
        assert.equal(result.skipped[0].reason, "workdir-missing");

        // The diagnostic also reaches the LAUNCHER's own surfaced warnings (not just
        // the low-level resolveNodeWorkspaces return) — a genuinely-resolvable
        // sibling workspace (alpha, the launch cwd) still aggregates alongside it.
        const alpha = await makeRealRepo(path.join(tmp, "alpha"), { workspaceId: "ws-alpha" });
        const wsAlpha = await loadWorkspace(alpha.root, undefined, { env });
        const store2 = await openGlobalWorkProjectionStore({ env });
        try {
          await publishRealDescriptor(store2, wsAlpha);
        } finally {
          store2.close();
        }

        const handle = await withCwd(foreignDir, () => startLauncherOnce(wsAlpha, env));
        assert.ok(
          handle.warnings.some((w) => w.code === "workspace-workdir-unresolvable" && w.message.includes("ws-gone")),
          "the loud skip is surfaced on the launcher's own warnings — a zero/short aggregation never masquerades as silently healthy",
        );
      });
    },
  },
];
