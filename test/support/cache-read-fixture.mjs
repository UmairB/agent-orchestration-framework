// test/support/cache-read-fixture.mjs — the shared fixture for milestone 43 / story 06
// (the readers migrate: the cache becomes the READ surface).
//
// It is `cache-authority-fixture.mjs` (story 02's) reused verbatim for everything the two
// stories share — a hermetic AOF_GLOBAL_HOME, a real workspace carrying an arbitrary work
// stream, the registered descriptor a worker frame is checked against, the two REAL writers
// (the control's publish tick and a worker's authenticated frame), and the control-disk
// edits (`writeItem` / `deleteItem` / `breakItem` / `removeStream`) — plus the four things
// only the READ side needs:
//
//   (a) THE COMMANDS THEMSELVES. Every scenario in this story is written over a command's
//       `--json` document, so `runCommand` invokes through the SAME command core both faces
//       use, with the fixture's hermetic store options threaded. Nothing re-implements a
//       command's body.
//   (b) A PLANTED CACHE ROW WITH ITS AUTHOR. `plantCacheRow` writes a complete row through
//       the store with an EXPLICIT `node_id`/`updated_at`, which is how a fixture models
//       "last reported by the REMOTE node aof-wsl" without standing up a second machine.
//   (c) THE DEGRADE SINK, capturable. ADR-005's fallback is an EXPLICIT, REPORTED degrade,
//       and the feature files name the sink's coded entries as the observable — so the
//       fixture injects a recording sink through `degrade.mjs`'s own test seam rather than
//       reading a log file. `setDegradeSinkForTest` also clears the per-code throttle, which
//       is what makes each scenario's count its own.
//   (d) A TORN STORE. "present but TORN / unreadable" is a real state a control node reaches
//       and one of the four the seam must answer through, so it is producible here.
import { mkdir, writeFile, readFile, rm, cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { invoke, loadWorkspace } from "../../src/command-core.mjs";
import { upsertWorkItemContent } from "../../src/global-work-store.mjs";
import { globalMeshPaths } from "../../src/workspace.mjs";
import { setDegradeSinkForTest } from "../../src/degrade.mjs";
import { publishPresenceRecord } from "../../src/mesh-presence.mjs";
import { meshWorktreePath } from "../../src/mesh-worktree.mjs";
import {
  withCacheFixture, withStore, tick, stream, itemRow, rows, registerDescriptor,
  seedActive, settle, writeItem, deleteItem, breakItem, removeStream, authorOf, seedWorker,
} from "./cache-authority-fixture.mjs";

export {
  withStore, tick, stream, itemRow, rows, registerDescriptor,
  seedActive, settle, writeItem, deleteItem, breakItem, removeStream, authorOf, seedWorker,
};

// The two nodes every scenario in this story names.
export const CONTROL_NODE = "aof-control";
export const WORKER_NODE = "aof-wsl";

// A pinned instant, so a `syncedAt` a scenario asserts is a value rather than a race.
export const SYNCED_AT = "2026-08-04T09:00:00.000Z";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export async function withCacheReadFixture(body, { stream = [], nodeId = CONTROL_NODE, notion = false } = {}) {
  return withCacheFixture(async (fx) => {
    // The shared fixture copies the milestone/story templates; `promote-gap` scaffolds a
    // CHORE, so this story's fixture copies that family too (the work-insert-fixture
    // discipline: a scaffolding verb is exercised through the REAL templates it ships with).
    await cp(
      path.join(repoRoot, ".aof", "templates", "work", "chore"),
      path.join(fx.root, ".aof", "templates", "work", "chore"),
      { recursive: true },
    );
    if (notion) await configureNotion(fx);
    return body(fx);
  }, { stream, nodeId });
}

// configureNotion(fx) — the opt-in `work.integrations.notion` block. WITHOUT it
// `syncMilestoneWork` returns its honest no-op envelope before any traversal happens, so a
// scenario about the traversal would assert against a code path that never ran.
export async function configureNotion(fx) {
  const configPath = path.join(fx.root, ".aof", "aof.config.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  config.work = {
    ...(config.work ?? {}),
    integrations: {
      notion: {
        dataSourceId: "ds-fixture",
        tokenEnv: "NOTION_TOKEN_FIXTURE",
        statusProperty: "Status",
        statusMap: { "not-started": "Not started", "in-progress": "In progress", done: "Done" },
        relationProperty: "Parent item",
      },
    },
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

// workerTree(fx, refs, assignmentId) — the worker's OWN materialised worktree: at the real
// path, speaking for the SAME workspace id as the control.
//
// BOTH OF THOSE ARE LOAD-BEARING, AND BOTH WERE FOUND BY MUTATION rather than by reading.
// Story 02's `workerWorktree` builds a genuine second directory — which is exactly right for
// the frame-door scenarios it was written for — but it puts that directory at an arbitrary
// temp path and leaves its workspace id path-derived. Against THIS story's boundary both
// details flip the answer:
//   · a DIFFERENT workspace id means a worker-side read pointed at the cache finds no rows
//     and silently falls back to its own disk, so every "the worker read its own tree"
//     assertion passes for the wrong reason. A real per-assignment worktree reports under the
//     ASSIGNMENT's workspaceId — the control's — which is precisely what makes an
//     over-migration dangerous.
//   · an ARBITRARY PATH means the seam's own worktree check cannot recognise it. A real
//     worktree lives at `<origin>/.aof/mesh/worktrees/<assignmentId>` — `meshWorktreePath`,
//     "THE ONE SEAM" (m35/ADR-004) — and is built here through that same path builder, so the
//     fixture cannot drift from the production convention.
// Measured: with both corrected, mutating a worker-side read onto the seam turns the
// echo-chamber scenario RED; with either wrong, that mutation left the suite green.
export async function workerTree(fx, refs, assignmentId = "asg-worktree") {
  const root = meshWorktreePath(fx.root, assignmentId);
  const workDir = path.join(root, "wiki", "work");
  await mkdir(workDir, { recursive: true });
  for (const ref of refs) await writeItem(fx, ref, { workDir, title: `worktree ${ref}` });
  return {
    root,
    workDir,
    workspace: {
      // The worktree reports under the ASSIGNMENT's workspace — the SAME id as the control's.
      config: { name: "worktree", work: { dir: "./wiki/work" }, mesh: { enabled: true, nodeId: WORKER_NODE, workspaceId: fx.workspaceId } },
      projectRoot: root,
      workDir,
    },
  };
}

// seedStalePresence(fx, node, heartbeatAt) — a presence record for a peer that has gone
// AWAY. The reclaim's dual-staleness rule treats an ABSENT presence record as UNKNOWN
// liveness and hands off, so a reclaim scenario that seeds nothing tests the hands-off path
// rather than the reclaim.
export async function seedStalePresence(fx, node, heartbeatAt) {
  const workspace = await loadWorkspace(fx.root, undefined, { env: fx.env });
  await publishPresenceRecord(workspace, node, { nodeId: node, heartbeatAt, activeRuns: [], aofVersion: "1.0.0" });
}

// ------------------------------------------------------------- the commands --

// runCommand(fx, id, input) — one command, through the command core, on a freshly loaded
// workspace (so a config or disk edit made mid-scenario is picked up exactly as a new
// process would pick it up).
export async function runCommand(fx, id, input = {}) {
  const workspace = await loadWorkspace(fx.root, undefined, { env: fx.env });
  return invoke(id, input, {
    workspace,
    globalWorkStoreOptions: { env: fx.env },
    effectsJournalOptions: { env: fx.env },
  });
}

// refuse(run) — await a coded refusal and return the error, failing loudly when the call
// unexpectedly SUCCEEDS. A refusal test that passes because nothing threw is the worst
// possible false green (item-lock-fixture's rule, carried).
export async function refuseCommand(run) {
  try {
    const result = await run();
    throw new Error(`expected a coded refusal, but the call succeeded: ${JSON.stringify(result)?.slice(0, 300)}`);
  } catch (error) {
    if (error?.code == null) throw error;
    return error;
  }
}

// ------------------------------------------------------------ the cache side --

// plantCacheRow(fx, ref, { … }) — a cached row with EXACTLY the author and instant named.
// The row is complete and storable (every column the read surface binds), and the two
// provenance columns are set explicitly, which is how "last reported by aof-wsl" is
// modelled without a second machine.
export async function plantCacheRow(fx, ref, {
  status = "not-started", title, type, slug, parent, sourcePath,
  node = WORKER_NODE, at = SYNCED_AT,
} = {}) {
  const base = itemRow(ref, {
    ...(status === undefined ? {} : { status }),
    ...(title === undefined ? {} : { title }),
    ...(type === undefined ? {} : { type }),
    ...(slug === undefined ? {} : { slug }),
    ...(parent === undefined ? {} : { parent }),
    ...(sourcePath === undefined ? {} : { sourcePath }),
  });
  await withStore(fx, (store) => {
    store.db.prepare(`
      INSERT INTO work_items (workspace_id, ref, type, slug, status, title, parent, source_path, node_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, ref) DO UPDATE SET
        type = excluded.type, slug = excluded.slug, status = excluded.status, title = excluded.title,
        parent = excluded.parent, source_path = excluded.source_path,
        node_id = excluded.node_id, updated_at = excluded.updated_at
    `).run(fx.workspaceId, base.ref, base.type, base.slug, base.status, base.title, base.parent, base.sourcePath, node, at);
  });
  return base;
}

// streamDoc / streamTaskFeature / streamRun — ARTIFACTS reported by `node`, through the
// store's ONE content writer (the seam `applyWorktreeContentFrame` itself calls), so a
// streamed body's provenance is genuinely its own.
export async function streamDoc(fx, { ref, doc = "SPEC", body = "# cached\n", node = WORKER_NODE, at = SYNCED_AT }) {
  return withStore(fx, (store) => upsertWorkItemContent(store, fx.workspaceId, { docs: [{ ref, doc, body }], nodeId: node }, { now: at }));
}

export async function streamTaskFeature(fx, { ref, member, body, node = WORKER_NODE, at = SYNCED_AT }) {
  return withStore(fx, (store) => upsertWorkItemContent(store, fx.workspaceId, { docs: [{ ref, doc: `TASKS/${member}`, body }], nodeId: node }, { now: at }));
}

export async function streamRun(fx, { ref, runId, state = "done", node = WORKER_NODE, at = SYNCED_AT }) {
  return withStore(fx, (store) => upsertWorkItemContent(
    store, fx.workspaceId,
    { runs: [{ ref, runId, record: { runId, itemRef: ref, state, node } }], nodeId: node },
    { now: at },
  ));
}

// tearStore(fx) — "present but TORN / unreadable": the projection database file is replaced
// with bytes SQLite cannot open. The seam must still answer, from disk, and say so.
export async function tearStore(fx) {
  const paths = globalMeshPaths({ env: fx.env });
  await mkdir(path.dirname(paths.databasePath), { recursive: true });
  await writeFile(paths.databasePath, "this is not a sqlite database at all", "utf8");
  // The sibling WAL/SHM would otherwise let SQLite recover the real file behind our backs.
  for (const suffix of ["-wal", "-shm"]) await rm(`${paths.databasePath}${suffix}`, { force: true });
}

// removeStore(fx) — "absent — a fresh workspace that never published".
export async function removeStore(fx) {
  const paths = globalMeshPaths({ env: fx.env });
  for (const suffix of ["", "-wal", "-shm"]) await rm(`${paths.databasePath}${suffix}`, { force: true });
}

// ------------------------------------------------------------ the degrade sink --

// captureDegrade() — a recording sink installed through degrade.mjs's own test seam, plus
// the per-code throttle reset that makes each scenario's entries its own. Returns the live
// array of entries and a `restore` that puts the real sink back.
export function captureDegrade() {
  const entries = [];
  setDegradeSinkForTest(() => ({ write: (entry) => entries.push(entry) }));
  return {
    entries,
    codes: () => entries.map((entry) => entry.code),
    of: (code) => entries.filter((entry) => entry.code === code),
    restore: () => setDegradeSinkForTest(undefined),
  };
}

// withDegradeCapture(body) — the capture, always restored. Every scenario that asserts on the
// sink uses this, so one scenario's throttle state can never decide another's outcome.
export async function withDegradeCapture(body) {
  const sink = captureDegrade();
  try {
    return await body(sink);
  } finally {
    sink.restore();
  }
}

// ------------------------------------------------------------- the disk side --

// writeStory(fx, milestoneRef, storyNumber, fields) — a story folder on THIS node's disk,
// under an existing milestone, with a `tasks/` dir so `started-story-no-tasks` is a choice
// rather than an accident.
export async function writeStory(fx, ref, { status = "not-started", title, slug, tasks = [] } = {}) {
  const [milestone, story] = ref.split("/");
  const storySlug = slug ?? `s${milestone}-${story}`;
  const dir = path.join(fx.workDir, `${milestone}_milestone_m${milestone}`, "stories", `${story}_story_${storySlug}`);
  await mkdir(path.join(dir, "tasks"), { recursive: true });
  const fields = {
    type: "story", number: story, slug: storySlug, parent: milestone, status,
    title: title ?? `Story ${ref}`, created: "2026-08-01", updated: "2026-08-02", schema: 1,
  };
  await writeFile(path.join(dir, "STORY.md"), `---\n${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n`, "utf8");
  for (const task of tasks) await writeFile(path.join(dir, "tasks", task.file), task.body, "utf8");
  return dir;
}

// writeDoc(fx, ref, name, body) — any file inside an item's own folder on this node's disk.
export async function writeDoc(fx, ref, name, body) {
  const [milestone, story] = ref.split("/");
  const dir = story == null
    ? path.join(fx.workDir, `${milestone}_milestone_m${milestone}`)
    : path.join(fx.workDir, `${milestone}_milestone_m${milestone}`, "stories", `${story}_story_s${milestone}-${story}`);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), body, "utf8");
  return path.join(dir, name);
}

// itemDirOf(fx, ref) — the folder this node's disk would hold for a ref, whether or not it
// does. Used to assert that NOTHING was created for a cache-only ref.
export function itemDirOf(fx, ref) {
  const [milestone, story] = ref.split("/");
  const milestoneDir = path.join(fx.workDir, `${milestone}_milestone_m${milestone}`);
  return story == null ? milestoneDir : path.join(milestoneDir, "stories", `${story}_story_s${milestone}-${story}`);
}
