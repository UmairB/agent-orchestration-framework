// test/support/artifact-sync-fixture.mjs — the shared fixture for milestone 43 /
// story 03 (write-triggered artifact sync), tasks 01 and 02.
//
// It stands up the REAL production path end to end, in one process:
//
//   a WORKER daemon  — `startLauncher` with an injected fabric exec, an injected
//                      `streamSyncTicker` and a fake transport (the idiom
//                      `mesh-launcher-stream-role.test.mjs` already proves). The tick
//                      it fires is the REAL `pushStreamSnapshot`, so the drain, the
//                      reconciliation read, the content hash and the frame all run as
//                      they do in production. There is no seam that "is" the drain.
//   a WORKTREE       — registered through `registerActiveWorktree`, the SAME
//                      module-level seam the execution handler writes through.
//   a CONTROL node   — a second workspace whose mesh workspaceId is the assignment's,
//                      with a `global_workspace_descriptors` row (the frame door's
//                      admission gate), fed by `applyWorktreeContentFrame` — the
//                      control-stream server's own door, with the CONNECTION-bound
//                      node id, never a self-reported one.
//   the READ side    — the real `work:doc` / `work:tasks` commands, run against the
//                      control workspace. Every `Then` about "the control node answers"
//                      goes through them; nothing reads the store behind their back
//                      except the provenance probes below (`updatedAt`/`reportedBy`),
//                      which are the columns the contract's litmus names.
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkspace } from "../../src/work.mjs";
import { startLauncher } from "../../src/mesh-launcher.mjs";
import { openGlobalWorkProjectionStore, readWorkItemDoc } from "../../src/global-work-store.mjs";
import { applyWorktreeContentFrame, applyDeltaFrame, applyLogEntriesFrame } from "../../src/control-stream-server.mjs";
import { buildLogEntriesFrame } from "../../src/worker-stream-client.mjs";
import { meshLogsCommand } from "../../src/commands/mesh-logs.mjs";
import { publishNodeRecord } from "../../src/mesh-store.mjs";
import { registerActiveWorktree, clearActiveWorktree } from "../../src/mesh-worker-execution.mjs";
import { docCommand } from "../../src/commands/doc.mjs";
import { tasksCommand } from "../../src/commands/tasks.mjs";
import { artifactSyncQueuePath } from "../../src/artifact-sync.mjs";
import { globalMeshPaths } from "../../src/workspace.mjs";

export const WORKER_ID = "worker-a";
export const CONTROL_ID = "control-1";
export const ASSIGNMENT_ID = "asg-43-03";
export const ASSIGNMENT_WORKSPACE_ID = "ws43030000000000";
export const ITEM_REF = "43/03";

// The eight record docs the manifest names, so a fixture can seed "all fourteen
// artifacts" (8 docs on the story + 6 features) the way task 02's Givens describe.
export const RECORD_DOCS = ["SPEC.md", "STORY.md", "VERIFICATION.md", "RETROSPECTIVE.md", "ARCHITECTURE.md", "DESIGN.md", "RESEARCH.md", "STATE.md"];

function frontmatter(fields) {
  return `---\n${Object.entries(fields).map(([key, value]) => `${key}: ${value}`).join("\n")}\n---\n`;
}

function statusFixture(selfHostName, peers) {
  return {
    BackendState: "Running",
    Self: { HostName: selfHostName, DNSName: `${selfHostName}.tail1a2b.ts.net.`, TailscaleIPs: ["100.1.1.1"], Online: true },
    Peer: peers,
  };
}

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
    fire(handle) { return handle.onTick(); },
  };
}

function fakeWorkerTransport() {
  const frames = [];
  let down = false;
  return {
    frames,
    setDown(value) { down = value; },
    async connect() {
      if (down) throw new Error("transport down");
      return { id: 1 };
    },
    async send(handle, frame) {
      if (down) throw new Error("transport down");
      frames.push(frame);
    },
    close() {},
    onDrop() {},
  };
}

// withArtifactSyncFixture(body, options) — the whole rig. `body(fx)` gets:
//   fx.worktree            the worker's worktree root (where the queue and the item live)
//   fx.itemDir / fx.milestoneDir
//   fx.enqueue(lines)      append raw NDJSON lines exactly as the hook would
//   fx.tick()              fire the REAL stream tick once
//   fx.contentFrames()     the worktree-content frames the tick sent
//   fx.deliver()           apply every frame the tick sent to the CONTROL store
//   fx.doc(ref, name, member?) / fx.tasks(ref)  the real read commands, control-side
//   fx.stamp(ref, docKey)  the control row's { updatedAt, reportedBy } (the litmus read)
//   fx.warnings()          the launcher's coded warning channel
export async function withArtifactSyncFixture(body, { stories = ["03"] } = {}) {
  const tmp = await realpath(await mkdtemp(path.join(os.tmpdir(), "aof-artifact-sync-")));
  const home = path.join(tmp, "home");
  const workerRepo = path.join(tmp, "worker");
  const worktree = path.join(tmp, "worktree");
  const controlRepo = path.join(tmp, "control");
  const priorHome = process.env.AOF_GLOBAL_HOME;
  process.env.AOF_GLOBAL_HOME = home;
  const env = { AOF_GLOBAL_HOME: home };
  let handle = null;
  let store = null;
  try {
    // --- the worker's LAUNCH workspace (not the worktree) ---------------------
    await mkdir(path.join(workerRepo, "wiki", "work"), { recursive: true });
    await mkdir(path.join(workerRepo, ".aof"), { recursive: true });
    await writeFile(path.join(workerRepo, ".aof", "aof.config.json"), `${JSON.stringify({
      name: "worker",
      work: { dir: "./wiki/work" },
      mesh: { nodeId: WORKER_ID, fabric: "tailscale", relay: { controlNode: CONTROL_ID, url: "ws://control-node.test:4182/ws/relay" } },
    }, null, 2)}\n`, "utf8");

    // --- the WORKTREE the agent works in -------------------------------------
    const worktreeWorkDir = path.join(worktree, "wiki", "work");
    const milestoneDir = path.join(worktreeWorkDir, "43_milestone_mesh-artifact-authority");
    await mkdir(milestoneDir, { recursive: true });
    await mkdir(path.join(worktree, ".aof"), { recursive: true });
    await writeFile(path.join(worktree, ".aof", "aof.config.json"), `${JSON.stringify({ name: "assigned", work: { dir: "./wiki/work" } }, null, 2)}\n`, "utf8");
    await writeFile(path.join(milestoneDir, "SPEC.md"), frontmatter({ type: "milestone", number: 43, slug: "mesh-artifact-authority", status: "in-progress", title: "Mesh artifact authority" }), "utf8");
    const storyDirs = {};
    for (const story of stories) {
      const storyDir = path.join(milestoneDir, "stories", `${story}_story_artifact-sync`);
      await mkdir(storyDir, { recursive: true });
      await writeFile(path.join(storyDir, "STORY.md"), frontmatter({ type: "story", number: story, slug: "artifact-sync", parent: 43, status: "in-progress", title: `Story ${story}` }), "utf8");
      storyDirs[`43/${story}`] = storyDir;
    }
    const itemDir = storyDirs[ITEM_REF];

    // --- the CONTROL node's own checkout (deliberately WITHOUT the item) ------
    const controlWorkDir = path.join(controlRepo, "wiki", "work");
    await mkdir(controlWorkDir, { recursive: true });
    await mkdir(path.join(controlRepo, ".aof"), { recursive: true });
    await writeFile(path.join(controlRepo, ".aof", "aof.config.json"), `${JSON.stringify({
      name: "control",
      work: { dir: "./wiki/work" },
      mesh: { enabled: true, nodeId: CONTROL_ID, workspaceId: ASSIGNMENT_WORKSPACE_ID },
    }, null, 2)}\n`, "utf8");

    const workerWs = await loadWorkspace(workerRepo, undefined, { env });
    const controlWs = await loadWorkspace(controlRepo, undefined, { env });
    for (const id of [WORKER_ID, CONTROL_ID]) {
      await publishNodeRecord(workerWs, id, { nodeId: id, host: id, os: "linux", runtimes: [], skills: [], aofVersion: "1.0.0", publishedAt: "2026-08-02T10:00:00.000Z" });
    }

    store = await openGlobalWorkProjectionStore({ env, paths: globalMeshPaths({ env }) });
    store.db.prepare(`
      INSERT OR REPLACE INTO global_workspace_descriptors
        (workspace_id, project_root, work_dir, name, mesh_enabled, control_node, member_node_ids_json, published_at, descriptor_path)
      VALUES (?, ?, ?, ?, 1, ?, '[]', '2026-08-02T09:00:00.000Z', ?)
    `).run(ASSIGNMENT_WORKSPACE_ID, controlRepo, controlWorkDir, "control", CONTROL_ID, `${controlRepo}/descriptor.json`);

    const transport = fakeWorkerTransport();
    const streamSyncTicker = manualTicker();
    // `onWarning` is the EXACT hop `aof mesh serve` uses to turn a launcher warning
    // into an `aof mesh logs` line: it builds a log ENTRY and forwards it to the
    // control's node_logs ring over `sendLogEntries` (commands/mesh-serve.mjs:58-65).
    // The fixture reproduces that mapping verbatim and lands the entries through the
    // control's own `applyLogEntriesFrame` door, so a scenario can assert on what
    // `aof mesh logs --node <worker> --json` actually prints — not on an in-process
    // array one hop short of the channel the contract names.
    const pendingLogEntries = [];
    handle = await startLauncher(workerWs, {
      onWarning: (warning) => {
        pendingLogEntries.push({
          at: new Date().toISOString(),
          level: warning.level ?? "warn",
          code: warning.code ?? "warning",
          message: warning.message ?? "",
          path: warning.path ?? null,
        });
      },
      exec: async () => ({ stdout: JSON.stringify(statusFixture(WORKER_ID, { a: { HostName: CONTROL_ID, DNSName: `${CONTROL_ID}.tail1a2b.ts.net.`, TailscaleIPs: ["100.90.249.80"], Online: true } })), status: 0 }),
      platform: "linux",
      ticker: manualTicker(),
      peerPollTicker: manualTicker(),
      streamSyncTicker,
      createWorkerWsTransport: () => transport,
      globalWorkStoreOptions: { env },
    });
    registerActiveWorktree(ASSIGNMENT_ID, {
      worktreePath: worktree,
      workspaceId: ASSIGNMENT_WORKSPACE_ID,
      itemRef: ITEM_REF,
      projectRoot: worktree,
      workDir: worktreeWorkDir,
    });

    let deliveredUpTo = 0;
    const ctx = { workspace: controlWs, globalWorkStoreOptions: { env } };

    const fx = {
      tmp, home, worktree, worktreeWorkDir, milestoneDir, itemDir, storyDirs, controlRepo, controlWorkDir, controlWs, workerWs, env, transport, handle,
      queuePath: artifactSyncQueuePath(worktree),

      async enqueue(lines) {
        const text = (Array.isArray(lines) ? lines : [lines]).map((line) => (typeof line === "string" ? line : JSON.stringify(line))).join("\n");
        await mkdir(path.dirname(fx.queuePath), { recursive: true });
        const { appendFileSync } = await import("node:fs");
        appendFileSync(fx.queuePath, `${text}\n`);
      },
      // A raw append that leaves the file WITHOUT a trailing newline — how a killed
      // hook leaves a torn final line behind.
      async enqueueRaw(text) {
        await mkdir(path.dirname(fx.queuePath), { recursive: true });
        const { appendFileSync } = await import("node:fs");
        appendFileSync(fx.queuePath, text);
      },

      tick: () => streamSyncTicker.fire(streamSyncTicker.handles[0]),
      warnings: () => handle.warnings,
      frames: () => transport.frames,
      contentFrames: () => transport.frames.filter((frame) => frame.kind === "worktree-content"),

      // Apply every frame the worker has sent since the last delivery to the control
      // node's own doors — content frames AND the item rows, exactly as the accept
      // loop does, with the CONNECTION-authenticated node id.
      async deliver() {
        // The launcher's warnings ride up as a log-entries frame, exactly as
        // `mesh serve` forwards them, and land in the control's node_logs ring.
        if (pendingLogEntries.length > 0) {
          const entries = pendingLogEntries.splice(0, pendingLogEntries.length);
          await applyLogEntriesFrame(store, buildLogEntriesFrame(WORKER_ID, entries, new Date().toISOString()), { nodeId: WORKER_ID });
        }
        const pending = transport.frames.slice(deliveredUpTo);
        deliveredUpTo = transport.frames.length;
        for (const frame of pending) {
          if (frame.kind === "worktree-content") {
            await applyWorktreeContentFrame(store, frame, { nodeId: WORKER_ID });
          } else if (frame.kind === "delta" || frame.kind === "snapshot") {
            // A reconnection re-snapshots by contract (the client's own frame rule), so
            // the rows can arrive as either kind; both are the same door.
            await applyDeltaFrame(store, frame, { nodeId: WORKER_ID });
          }
        }
        return pending.length;
      },

      // applyFrame(frame) — one frame through the control's own door, for the
      // scenarios that model a crash AFTER a send (the frame is built by the real
      // builder and admitted by the real door; only the tick is skipped).
      async applyFrame(frame) {
        return applyWorktreeContentFrame(store, frame, { nodeId: WORKER_ID });
      },

      async doc(ref, name, member) {
        return docCommand.run({ ref, doc: name, ...(member == null ? {} : { member }) }, ctx);
      },
      // `aof mesh logs --node <worker> --json`, run for real against the control's
      // node_logs ring — the channel task 01's litmus names for a coded degrade.
      async meshLogs({ node = WORKER_ID, tail = 200 } = {}) {
        return meshLogsCommand.run({ node, tail }, ctx);
      },
      async tasks(ref) {
        return tasksCommand.run({ ref }, ctx);
      },
      stamp(ref, docKey) {
        const row = readWorkItemDoc(store, ASSIGNMENT_WORKSPACE_ID, ref, docKey);
        return row == null ? null : { updatedAt: row.updatedAt, reportedBy: row.nodeId, body: row.body };
      },
      // Every artifact row the control holds for a ref, as { docKey: {updatedAt} }.
      stamps(ref) {
        const rows = store.db.prepare("SELECT doc, body, node_id, updated_at FROM work_item_docs WHERE workspace_id = ? AND ref = ? ORDER BY doc").all(ASSIGNMENT_WORKSPACE_ID, ref);
        return Object.fromEntries(rows.map((row) => [row.doc, { updatedAt: row.updated_at, reportedBy: row.node_id, body: row.body }]));
      },
    };

    return await body(fx);
  } finally {
    try { clearActiveWorktree(ASSIGNMENT_ID); } catch { /* never registered */ }
    try { handle?.stop?.(); } catch { /* already stopped */ }
    try { store?.close?.(); } catch { /* already closed */ }
    if (priorHome === undefined) delete process.env.AOF_GLOBAL_HOME;
    else process.env.AOF_GLOBAL_HOME = priorHome;
    await rm(tmp, { recursive: true, force: true });
  }
}

// writeArtifact(dir, relPath, body) — the agent's own write, spelled the way the
// hook's payload would name it (an absolute path with the platform's separators).
export async function writeArtifact(dir, relPath, body) {
  const full = path.join(dir, ...relPath.split("/"));
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, body, "utf8");
  return full;
}

// enqueueLine(tool, filePath) — the exact line shape the enqueue hook appends.
export function enqueueLine(tool, filePath) {
  return JSON.stringify({ tool, path: filePath });
}
