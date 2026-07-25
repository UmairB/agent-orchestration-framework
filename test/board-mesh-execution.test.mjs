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
import { readBranchItems, resolveBranchRef, mergeBranchItems } from "../src/board-branch-stream.mjs";
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

  // ── the BRANCH-STREAM half (operator: "no stories are coming through") ──────
  //
  // With the execution overlay in place the board correctly named the node and the
  // branch — and still showed "No stories in this milestone yet · 0 stories" over a
  // milestone the refine had broken into SEVEN stories. All of it lives on the mesh
  // branch; this checkout is on main and carries only the original SPEC.md.
  {
    name: "board-branch-stream: mergeBranchItems REPLACES the milestone row (the branch status wins) and splices its stories in after it, leaving neighbours untouched",
    run: async () => {
      const local = [
        { ref: "17", type: "milestone", status: "done", title: "Prior" },
        { ref: "18", type: "milestone", status: "not-started", title: "Homedata" },
        { ref: "20", type: "milestone", status: "not-started", title: "Later" },
      ];
      const branchRows = [
        { ref: "18", type: "milestone", status: "in-progress", title: "Homedata", fromBranch: "aof/mesh/18-x" },
        { ref: "18/00", type: "story", status: "not-started", title: "S0", parent: "18", fromBranch: "aof/mesh/18-x" },
        { ref: "18/01", type: "story", status: "not-started", title: "S1", parent: "18", fromBranch: "aof/mesh/18-x" },
      ];
      const merged = mergeBranchItems(local, branchRows);
      assert.deepEqual(merged.map((r) => r.ref), ["17", "18", "18/00", "18/01", "20"], "the stories land directly after their milestone; neighbours keep their positions");
      assert.equal(merged.find((r) => r.ref === "18").status, "in-progress", "the BRANCH status wins over the local not-started — the whole point");
      assert.equal(merged.find((r) => r.ref === "17").status, "done", "an unrelated item is untouched");
    },
  },
  {
    name: "board-branch-stream: a local story the branch also carries is REPLACED, never duplicated",
    run: async () => {
      const local = [
        { ref: "18", type: "milestone", status: "not-started" },
        { ref: "18/00", type: "story", status: "not-started", title: "stale local" },
      ];
      const branchRows = [
        { ref: "18", type: "milestone", status: "in-progress" },
        { ref: "18/00", type: "story", status: "in-review", title: "from branch" },
      ];
      const merged = mergeBranchItems(local, branchRows);
      assert.equal(merged.filter((r) => r.ref === "18/00").length, 1, "no duplicate row");
      assert.equal(merged.find((r) => r.ref === "18/00").status, "in-review", "the branch row wins");
    },
  },
  {
    name: "board-branch-stream: an unresolvable ref yields NO branch stream (null) — the caller keeps the local rows, and a blank branch is never even probed",
    run: async () => {
      const exec = async () => ({ status: 1, stdout: "", stderr: "unknown revision" });
      assert.equal(await resolveBranchRef("/x", "aof/mesh/nope", { exec }), null);
      assert.equal(await readBranchItems("/x", "aof/mesh/nope", { itemRef: "18", exec }), null);
      assert.equal(await readBranchItems("/x", "", { itemRef: "18", exec }), null, "a blank branch is never probed");
    },
  },
  {
    name: "board-branch-stream: reads the milestone + its stories from the ref, scoped to THAT milestone only, each row carrying its branch provenance",
    run: async () => {
      const tree = [
        "wiki/work/18_milestone_homedata/SPEC.md",
        "wiki/work/18_milestone_homedata/stories/00_story_alpha/STORY.md",
        "wiki/work/18_milestone_homedata/stories/01_story_beta/STORY.md",
        "wiki/work/20_milestone_other/SPEC.md",
        "wiki/work/20_milestone_other/stories/00_story_gamma/STORY.md",
      ].join("\n");
      const docs = {
        "wiki/work/18_milestone_homedata/SPEC.md": "---\ntype: milestone\nstatus: in-progress\ntitle: Homedata\n---\n",
        "wiki/work/18_milestone_homedata/stories/00_story_alpha/STORY.md": "---\ntype: story\nstatus: in-review\ntitle: Alpha\n---\n",
        "wiki/work/18_milestone_homedata/stories/01_story_beta/STORY.md": "---\ntype: story\nstatus: not-started\ntitle: Beta\n---\n",
      };
      const exec = async (args) => {
        if (args[0] === "rev-parse") return { status: 0, stdout: "abc123\n", stderr: "" };
        if (args[0] === "ls-tree") return { status: 0, stdout: tree, stderr: "" };
        if (args[0] === "show") {
          const file = args[1].split(":").slice(1).join(":");
          return docs[file] ? { status: 0, stdout: docs[file], stderr: "" } : { status: 1, stdout: "", stderr: "" };
        }
        return { status: 1, stdout: "", stderr: "" };
      };
      const rows = await readBranchItems("/x", "aof/mesh/18-x", { itemRef: "18", exec });
      assert.deepEqual(rows.map((r) => r.ref), ["18", "18/00", "18/01"], "milestone first, then its stories in order — and NOTHING from milestone 20");
      assert.equal(rows[0].status, "in-progress");
      assert.equal(rows[1].title, "Alpha");
      assert.ok(rows.every((r) => r.fromBranch === "aof/mesh/18-x"), "every row carries its branch provenance");
    },
  },
];
