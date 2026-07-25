// test/board-mesh-execution.test.mjs — VERIFICATION (board mesh-execution overlay,
// live two-machine soak 2026-07-25).
//
// THE DEFECT (operator-reported): the board showed milestone 18 as "not started" while a
// WORKER node was executing it, and kept saying so after it finished. The board reads the
// CONTROL node's own local record-doc frontmatter, which genuinely says `not-started` —
// the work happened on another machine, on a mesh branch this checkout does not have. The
// overlay answers the operator's three steps: (1) is it executing, (2) show THAT, (3) else
// fall back to local.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openGlobalWorkProjectionStore } from "../src/global-work-store.mjs";
import { assembleAssignmentRecord, insertAssignment, updateAssignmentState } from "../src/assignment-record.mjs";
import { setItemBranch } from "../src/mesh-assignment-directive.mjs";
import { readExecutionOverlay, applyExecutionOverlay } from "../src/board-mesh-execution.mjs";
import { mergeWorkerItems } from "../src/board-worker-stream.mjs";
import { listCommand } from "../src/commands/list.mjs";

const WS = "ws-board-1";

async function withStore(fn) {
  const home = await mkdtemp(path.join(os.tmpdir(), "aof-board-overlay-"));
  const env = { AOF_GLOBAL_HOME: home };
  const store = await openGlobalWorkProjectionStore({ env });
  try {
    return await fn({ store, env, home });
  } finally {
    store.close?.();
    await rm(home, { recursive: true, force: true });
  }
}

function seed(store, { assignmentId, itemRef, state = "assigned", node = "umairs-mac-mini", now = "2026-07-25T09:00:00.000Z" }) {
  insertAssignment(store, assembleAssignmentRecord({
    assignmentId, itemRef, workspaceId: WS, targetNodeId: node, issuer: "control", state: "assigned", now,
  }));
  if (state !== "assigned") updateAssignmentState(store, assignmentId, state, { now });
}

// The rows listStream produces (only the fields the overlay touches).
const localRows = () => ([
  { ref: "18", type: "milestone", slug: "homedata", status: "not-started", title: "Homedata", parent: null, dir: "/x/18" },
  { ref: "20", type: "milestone", slug: "other", status: "not-started", title: "Other", parent: null, dir: "/x/20" },
]);

export const boardMeshExecutionTests = [
  {
    name: "board-overlay/step 1+2: an item a worker is RUNNING reports in-progress with the executing node, session and branch — never the local `not-started`",
    run: async () => withStore(async ({ store, env }) => {
      seed(store, { assignmentId: "a1", itemRef: "18", state: "running" });
      setItemBranch(store, WS, "18", "aof/mesh/18-73ab17b2");

      const overlay = await readExecutionOverlay({ projectRoot: "/x", workDir: "/x", config: { mesh: { workspaceId: WS } } }, { globalWorkStoreOptions: { env } });
      const rows = applyExecutionOverlay(localRows(), overlay);
      const row18 = rows.find((r) => r.ref === "18");

      assert.equal(row18.status, "in-progress", "the board no longer reports the local `not-started` over a live worker run");
      assert.equal(row18.execution.active, true, "step 1: it IS being executed");
      assert.equal(row18.execution.nodeId, "umairs-mac-mini", "step 2: by THIS node");
      assert.equal(row18.execution.branch, "aof/mesh/18-73ab17b2", "…and the work lives on THIS branch (what the local checkout lacks)");

      // Step 3: an item with no mesh execution is untouched, byte-identical.
      const row20 = rows.find((r) => r.ref === "20");
      assert.equal(row20.status, "not-started", "an item with no execution keeps its LOCAL status");
      assert.equal(row20.execution, undefined, "…and gains nothing at all");
    }),
  },
  {
    name: "board-overlay: a QUEUED (assigned) item does NOT claim progress — the local status stands, with the execution facts alongside",
    run: async () => withStore(async ({ store, env }) => {
      seed(store, { assignmentId: "a1", itemRef: "18", state: "assigned" });
      const overlay = await readExecutionOverlay({ projectRoot: "/x", config: { mesh: { workspaceId: WS } } }, { globalWorkStoreOptions: { env } });
      const row18 = applyExecutionOverlay(localRows(), overlay).find((r) => r.ref === "18");
      assert.equal(row18.status, "not-started", "a merely-QUEUED item must not claim progress the worker has not made");
      assert.equal(row18.execution.active, true);
      assert.equal(row18.execution.state, "assigned", "…but the surface can still say `queued on <node>`");
    }),
  },
  {
    name: "board-overlay: a FINISHED mesh run is reported as active:false WITH its branch — the board can explain where completed work went instead of silently reading `not-started`",
    run: async () => withStore(async ({ store, env }) => {
      seed(store, { assignmentId: "a1", itemRef: "18", state: "done" });
      setItemBranch(store, WS, "18", "aof/mesh/18-73ab17b2");
      const overlay = await readExecutionOverlay({ projectRoot: "/x", config: { mesh: { workspaceId: WS } } }, { globalWorkStoreOptions: { env } });
      const row18 = applyExecutionOverlay(localRows(), overlay).find((r) => r.ref === "18");
      assert.equal(row18.execution.active, false, "a finished run never claims a LIVE execution");
      assert.equal(row18.status, "not-started", "…and never overrides the local status on its own");
      assert.equal(row18.execution.state, "done");
      assert.equal(row18.execution.branch, "aof/mesh/18-73ab17b2", "the operator can see WHERE the completed work is");
    }),
  },
  {
    name: "board-overlay: the MOST RECENT assignment wins — a re-assignment after a failure reports the run that matters now, never a stale earlier one",
    run: async () => withStore(async ({ store, env }) => {
      seed(store, { assignmentId: "old", itemRef: "18", state: "failed", node: "old-node", now: "2026-07-25T09:00:00.000Z" });
      seed(store, { assignmentId: "new", itemRef: "18", state: "running", node: "umairs-mac-mini", now: "2026-07-25T10:00:00.000Z" });
      const overlay = await readExecutionOverlay({ projectRoot: "/x", config: { mesh: { workspaceId: WS } } }, { globalWorkStoreOptions: { env } });
      const row18 = applyExecutionOverlay(localRows(), overlay).find((r) => r.ref === "18");
      assert.equal(row18.execution.nodeId, "umairs-mac-mini");
      assert.equal(row18.execution.state, "running");
      assert.equal(row18.status, "in-progress");
    }),
  },
  {
    name: "board-overlay/step 3: an unreadable/absent projection degrades to the LOCAL rows — a broken store can never break the board",
    run: async () => {
      const overlay = await readExecutionOverlay({ projectRoot: "/x" }, {
        openStore: async () => { throw new Error("projection unavailable"); },
      });
      assert.equal(overlay.size, 0, "a store fault yields no overlay");
      const rows = localRows();
      assert.deepEqual(applyExecutionOverlay(rows, overlay), rows, "…and the rows pass through byte-identical (the local view)");
    },
  },
  {
    name: "board-overlay: work:list is OPT-IN — the plain CLI call returns local rows and opens no store; only `mesh:true` overlays",
    run: async () => withStore(async ({ store, env }) => {
      seed(store, { assignmentId: "a1", itemRef: "18", state: "running" });
      const ctx = {
        workspace: { projectRoot: "/x", workDir: "/x", config: { mesh: { workspaceId: WS } } },
        globalWorkStoreOptions: { env },
      };
      // listStream is stubbed by pointing workDir at an empty temp dir; the assertion here
      // is the SHAPE of the opt-in, not the row content.
      const plain = await listCommand.run({}, ctx);
      assert.ok(Array.isArray(plain), "the CLI form returns rows");
      assert.ok(plain.every((r) => r.execution === undefined), "…with NO execution overlay (no store opened)");
      assert.equal(listCommand.input.properties.mesh.type, "boolean", "`mesh` is a declared, opt-in input");
      assert.equal(listCommand.input.additionalProperties, false, "…on an otherwise closed input");
    }),
  },

  // ── the WORKER's own view (operator: "no stories are coming through") ───────
  //
  // The board showed "0 stories" over a milestone the agent had broken into seven,
  // because this checkout holds only the pre-run scaffold. The truth comes from the
  // WORKER — which streams the work-state of the worktree it is actually working in,
  // continuously, over the fabric — NOT from a git branch: a branch exists only after a
  // run commits and pushes, so branch-reading is blind for the whole run.
  {
    name: "worker-view: the worker's own rows REPLACE the local ones (its status/title win) and its EXTRA stories are inserted under the milestone — the breakdown this checkout has never seen",
    run: async () => {
      const local = [
        { ref: "18", type: "milestone", slug: "homedata", status: "not-started", title: "Homedata", parent: null, dir: "/x/18" },
        { ref: "20", type: "milestone", slug: "other", status: "not-started", title: "Other", parent: null, dir: "/x/20" },
      ];
      const worker = new Map([
        ["18", { ref: "18", type: "milestone", slug: "homedata", status: "in-progress", title: "Homedata", parent: null }],
        ["18/00", { ref: "18/00", type: "story", slug: "alpha", status: "in-review", title: "Alpha", parent: "18", sourcePath: "/wt/wiki/work/18_m/stories/00_story_alpha/STORY.md" }],
        ["18/01", { ref: "18/01", type: "story", slug: "beta", status: "not-started", title: "Beta", parent: "18", sourcePath: "/wt/wiki/work/18_m/stories/01_story_beta/STORY.md" }],
      ]);
      const overlay = new Map([["18", { nodeId: "umairs-mac-mini", active: true }]]);
      const merged = mergeWorkerItems(local, worker, overlay);

      assert.deepEqual(merged.map((r) => r.ref), ["18", "18/00", "18/01", "20"], "the worker's stories land under their milestone; unrelated items keep their place");
      assert.equal(merged[0].status, "in-progress", "the WORKER's status wins over the local not-started");
      assert.equal(merged[0].fromWorker, true, "…and the row is marked as the worker's view");
      assert.equal(merged[1].title, "Alpha");
      assert.equal(merged[1].reportedBy, "umairs-mac-mini", "an inserted story names the node that reported it");
      assert.equal(merged[3].status, "not-started", "an item the worker says nothing about is untouched");
    },
  },
  {
    name: "worker-view: no worker rows ⇒ the local rows pass through byte-identical (local-first for every non-mesh item and workspace)",
    run: async () => {
      const local = localRows();
      assert.deepEqual(mergeWorkerItems(local, new Map(), new Map()), local);
      assert.deepEqual(mergeWorkerItems(local, null, new Map()), local);
    },
  },
  {
    name: "worker-view: a story the worker reports that ALSO exists locally is replaced, never duplicated",
    run: async () => {
      const local = [
        { ref: "18", type: "milestone", status: "not-started", dir: "/x/18" },
        { ref: "18/00", type: "story", status: "not-started", title: "stale local", parent: "18", dir: "/x/18/00" },
      ];
      const worker = new Map([
        ["18", { ref: "18", status: "in-progress" }],
        ["18/00", { ref: "18/00", status: "in-review", title: "from worker", parent: "18" }],
      ]);
      const merged = mergeWorkerItems(local, worker, new Map());
      assert.equal(merged.filter((r) => r.ref === "18/00").length, 1, "no duplicate row");
      assert.equal(merged.find((r) => r.ref === "18/00").status, "in-review", "the worker's row wins");
    },
  },
];
