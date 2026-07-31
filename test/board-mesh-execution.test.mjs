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
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openGlobalWorkProjectionStore } from "../src/global-work-store.mjs";
import { assembleAssignmentRecord, insertAssignment, updateAssignmentState } from "../src/assignment-record.mjs";
import { setItemBranch } from "../src/mesh-assignment-directive.mjs";
import { readExecutionOverlay, applyExecutionOverlay, resolveScopedExecution } from "../src/board-mesh-execution.mjs";
import { resolveContinueDecision, resolveDirectivePhase } from "../src/commands/continue.mjs";
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
  // --- EXECUTION SCOPE (operator, 2026-07-26 — the story-continue defect): runs are
  // recorded at the TOP-LEVEL item, so a child ref inherits its scope's execution.
  // ONE rule, two consumers: the row overlay (below) and the continue decision. ---
  {
    name: "exec-scope: a STORY row inherits its milestone's execution (so the affordance says Running-on-node), WITHOUT a status override",
    run: async () => withStore(async ({ store, env }) => {
      seed(store, { assignmentId: "a1", itemRef: "18", state: "running" });
      const overlay = await readExecutionOverlay({ projectRoot: "/x", config: { mesh: { workspaceId: WS } } }, { globalWorkStoreOptions: { env } });
      const rows = applyExecutionOverlay([
        ...localRows(),
        { ref: "18/02", type: "story", slug: "uprn", status: "not-started", title: "UPRN", parent: "18", dir: "/x/18/02" },
      ], overlay);

      const story = rows.find((r) => r.ref === "18/02");
      assert.equal(story.execution?.active, true, "the story carries its milestone's live execution");
      assert.equal(story.execution?.nodeId, "umairs-mac-mini");
      assert.equal(story.execution?.scopeRef, "18", "…marked as inherited from the SCOPE, not its own");
      assert.equal(story.status, "not-started", "the story's OWN status is never overridden — the milestone runs, this story may be untouched");

      const milestone = rows.find((r) => r.ref === "18");
      assert.equal(milestone.execution?.scopeRef, "18", "an own-execution row carries scopeRef = itself");
      assert.equal(milestone.status, "in-progress", "the running milestone itself still reports progress");
    }),
  },
  {
    name: "exec-scope: resolveScopedExecution — own execution wins over the scope's; no execution anywhere → null",
    run: async () => {
      const overlay = new Map([
        ["18", { nodeId: "mac", active: true }],
        ["18/03", { nodeId: "other-node", active: false }],
      ]);
      assert.equal(resolveScopedExecution(overlay, "18/03").execution.nodeId, "other-node", "an own row wins");
      assert.equal(resolveScopedExecution(overlay, "18/03").scopeRef, "18/03");
      assert.equal(resolveScopedExecution(overlay, "18/02").execution.nodeId, "mac", "a story without its own row inherits the milestone's");
      assert.equal(resolveScopedExecution(overlay, "18/02").scopeRef, "18");
      assert.equal(resolveScopedExecution(overlay, "20"), null, "never-run → null (the local default)");
      assert.equal(resolveScopedExecution(new Map(), "18/02"), null);
    },
  },
  {
    name: "exec-scope: WORKER-ONLY story rows of a running milestone carry the inherited execution — overlay applies AFTER the worker merge (the reported defect: local checkout has no stories/, so the inserted rows skipped the overlay and still offered Continue)",
    run: async () => withStore(async ({ store, env }) => {
      seed(store, { assignmentId: "a1", itemRef: "18", state: "running" });
      const overlay = await readExecutionOverlay({ projectRoot: "/x", config: { mesh: { workspaceId: WS } } }, { globalWorkStoreOptions: { env } });
      // The control checkout holds ONLY the milestone scaffold; every story row comes
      // from the worker stream (the item-18 shape measured live 2026-07-26).
      const local = [{ ref: "18", type: "milestone", slug: "homedata", status: "not-started", title: "Homedata", parent: null, dir: "/x/18" }];
      const worker = new Map([
        ["18", { ref: "18", type: "milestone", slug: "homedata", status: "in-progress", title: "Homedata", parent: null, sourcePath: "/w/18/SPEC.md" }],
        ["18/02", { ref: "18/02", type: "story", slug: "uprn", status: "not-started", title: "UPRN", parent: "18", sourcePath: "/w/18/stories/02/STORY.md" }],
      ]);

      // The EXACT list.mjs composition: merge first, overlay last.
      const rows = applyExecutionOverlay(mergeWorkerItems(local, worker, overlay), overlay);

      const story = rows.find((r) => r.ref === "18/02");
      assert.ok(story, "the worker-only story row is present");
      assert.equal(story.fromWorker, true);
      assert.equal(story.execution?.active, true, "the inserted story carries the milestone's live execution — the affordance can now say Running-on-node");
      assert.equal(story.execution?.scopeRef, "18");
      assert.equal(story.status, "not-started", "its own streamed status is untouched");

      const milestone = rows.find((r) => r.ref === "18");
      assert.equal(milestone.execution?.active, true);
      assert.equal(milestone.status, "in-progress", "the fromWorker milestone keeps the WORKER's streamed status (the live truth), not a blanket override");
    }),
  },
  {
    name: "continue-decision: a story whose milestone is RUNNING answers 'running' — never local, never a second dispatch (the reported defect)",
    run: () => {
      const overlay = new Map([["18", { nodeId: "umairs-mac-mini", active: true, state: "running", assignmentId: "a1" }]]);
      const d = resolveContinueDecision(overlay, "18/02", { localNodeId: "control-node" });
      assert.equal(d.where, "running", "clicking Continue on a story of a live milestone spawns NOTHING");
      assert.equal(d.node, "umairs-mac-mini");
      assert.equal(d.scopeRef, "18");
      assert.equal(d.resolvedBy, "active-run");
      // …and the milestone itself answers the same.
      assert.equal(resolveContinueDecision(overlay, "18", { localNodeId: "control-node" }).where, "running");
    },
  },
  {
    name: "continue-decision: a story whose milestone LAST RAN remotely routes remote AT THE SCOPE ref (one branch/worktree per top-level item)",
    run: () => {
      const overlay = new Map([["18", { nodeId: "umairs-mac-mini", active: false, state: "done" }]]);
      const d = resolveContinueDecision(overlay, "18/02", { localNodeId: "control-node" });
      assert.equal(d.where, "remote");
      assert.equal(d.node, "umairs-mac-mini", "the node that last worked the scope");
      assert.equal(d.dispatchRef, "18", "dispatched at the SCOPE — assigning the child ref would mint a divergent second branch");
      assert.equal(d.resolvedBy, "last-node");
    },
  },
  {
    name: "continue-decision: never-ran stays local at the EXACT ref; last-ran-here stays local; an explicit node wins and dispatches at scope",
    run: () => {
      const empty = new Map();
      const local = resolveContinueDecision(empty, "18/02", { localNodeId: "control-node" });
      assert.equal(local.where, "local");
      assert.equal(local.dispatchRef, "18/02", "a local continue keeps the exact ref — a session can continue one story directly");
      assert.equal(local.resolvedBy, "no-prior-run");

      const ranHere = new Map([["18", { nodeId: "control-node", active: false, state: "done" }]]);
      assert.equal(resolveContinueDecision(ranHere, "18/02", { localNodeId: "control-node" }).where, "local", "last node IS this node → local");

      const explicit = resolveContinueDecision(empty, "18/02", { requestedNode: "umairs-mac-mini", localNodeId: "control-node" });
      assert.equal(explicit.where, "remote");
      assert.equal(explicit.dispatchRef, "18", "an explicit remote target still dispatches at the scope ref");
      assert.equal(explicit.resolvedBy, "requested");
    },
  },

  // ── the DIRECTIVE phase (operator, 2026-07-26: "continue xy should be a continuation
  // of the entire milestone. All stories. Why is it not CONTINUING UNTIL COMPLETION") ──
  //
  // WHAT continuing an item means: a MILESTONE continue resolves to the `autonomous`
  // cascade (drive every story refine → build → verify until the milestone is done);
  // a story/task continue and every refine/verify keep their single-phase directive.
  {
    name: "directive-phase: a MILESTONE continue resolves to the autonomous cascade; a story continue stays single-phase",
    run: async () => {
      const home = await mkdtemp(path.join(os.tmpdir(), "aof-directive-phase-"));
      try {
        const workDir = path.join(home, "wiki", "work");
        const msDir = path.join(workDir, "18_milestone_homedata");
        await mkdir(path.join(msDir, "stories", "02_story_tenants", "tasks"), { recursive: true });
        await writeFile(path.join(msDir, "SPEC.md"), `---\ntype: milestone\nnumber: "18"\nslug: homedata\nstatus: in-progress\n---\n# 18\n`, "utf8");
        await writeFile(
          path.join(msDir, "stories", "02_story_tenants", "STORY.md"),
          `---\ntype: story\nnumber: "02"\nslug: tenants\nstatus: not-started\nparent: "18"\n---\n# 18/02\n`,
          "utf8",
        );
        const workspace = { projectRoot: home, workDir, config: {} };

        assert.equal(
          await resolveDirectivePhase(workspace, "continue", "18", { env: { AOF_GLOBAL_HOME: home } }),
          "autonomous",
          "continuing a milestone means continuing the WHOLE milestone — the cascade, never one slice",
        );
        assert.equal(
          await resolveDirectivePhase(workspace, "continue", "18/02", { env: { AOF_GLOBAL_HOME: home } }),
          "continue",
          "a single story continue keeps its single-phase directive",
        );
        assert.equal(
          await resolveDirectivePhase(workspace, "verify", "18", { env: { AOF_GLOBAL_HOME: home } }),
          "verify",
          "refine/verify are never rewritten — only what CONTINUE means changes with the item type",
        );
        assert.equal(
          await resolveDirectivePhase(workspace, "continue", "99", { env: { AOF_GLOBAL_HOME: home } }),
          "continue",
          "an unresolvable ref degrades to the single phase — the act is never blocked by a type lookup",
        );
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
  },
  {
    // The OWED lane from m42's soak day (STATE.md §MISSING TESTS): the STREAMED-row
    // fallback. A control checkout often does not hold a worker's items locally —
    // the type then comes from the worker-streamed `work_items` row (the SAME
    // local-then-streamed order every read command uses), so a milestone continue
    // dispatched from a control node that never checked the milestone out still
    // resolves to the autonomous cascade.
    name: "directive-phase: the STREAMED-row fallback — a locally-absent milestone resolves through the worker-streamed row; a streamed story stays single-phase",
    run: async () => {
      const home = await mkdtemp(path.join(os.tmpdir(), "aof-directive-phase-streamed-"));
      try {
        const workDir = path.join(home, "wiki", "work");
        await mkdir(workDir, { recursive: true });
        const workspace = { projectRoot: home, workDir, config: {} };
        const env = { AOF_GLOBAL_HOME: home };

        // Seed the worker-streamed rows for refs the local index has NEVER held.
        const store = await openGlobalWorkProjectionStore({ env });
        try {
          const { resolveWorkspaceId } = await import("../src/workspace-identity.mjs");
          const workspaceId = resolveWorkspaceId(workspace);
          const insert = store.db.prepare(
            "INSERT INTO work_items (workspace_id, ref, type, slug, status, title, parent, source_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          );
          insert.run(workspaceId, "44", "milestone", "remote-ms", "in-progress", "Remote milestone", null, "streamed/44");
          insert.run(workspaceId, "44/01", "story", "remote-story", "not-started", "Remote story", "44", "streamed/44-01");
        } finally {
          store.close();
        }

        assert.equal(
          await resolveDirectivePhase(workspace, "continue", "44", { env }),
          "autonomous",
          "a milestone the local index misses resolves through the STREAMED row — the cascade still fires",
        );
        assert.equal(
          await resolveDirectivePhase(workspace, "continue", "44/01", { env }),
          "continue",
          "a streamed STORY keeps its single-phase directive",
        );
        assert.equal(
          await resolveDirectivePhase(workspace, "continue", "45", { env }),
          "continue",
          "no local item AND no streamed row degrades to the single phase",
        );
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
  },
];
