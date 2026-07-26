// schema v5 (TECH_DEBT item 6 — finish the board bridge): the board's drill-downs
// answer from the worker-streamed projection when the LOCAL checkout cannot.
//
// THE DEFECT (measured live, 2026-07-26): the worker→control stream bridged an
// item's ROWS, so the board correctly listed a milestone's seven streamed stories —
// then every drill-down read the control node's local disk and dead-ended:
//   - clicking a streamed story → `Could not load STORY: No item resolves to ref "18/03"`
//   - the RUNS tab read the local runs/ dir → "No runs yet", for an item RUNNING remotely
// The board asserted a state it could not evidence. These tests pin the fix at the
// command layer (work:doc / work:run-status — every face gains the fallback):
//   - a ref the local checkout has never seen answers from the streamed projection,
//     marked fromWorker + reportedBy (whose view this is)
//   - a locally-resolved item whose doc file is absent answers from the projection
//   - the local disk WINS whenever it can answer (local-first, like the row merge)
//   - nothing streamed → behaviour is byte-identical to before (404 / absent / [])
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkspace, invoke } from "../src/command-core.mjs";
import { openGlobalWorkProjectionStore, upsertWorkItemContent } from "../src/global-work-store.mjs";

const WORKSPACE_ID = "ws-board-content";
const NOW = "2026-07-26T10:00:00.000Z";

function frontmatter(fields) {
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

// A control-node-shaped fixture: the milestone resolves locally as a pre-run
// scaffold (SPEC only — no stories/, no runs/), exactly the item-18 shape measured
// live. The workspace pins mesh.workspaceId so the command's projection lookup and
// the seeded store speak the same id (the item-4 identity lesson).
async function makeRepo(root) {
  const repo = path.join(root, "repo");
  const workDir = path.join(repo, "wiki", "work");
  const mDir = path.join(workDir, "18_milestone_integration-descriptor");
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  await mkdir(mDir, { recursive: true });
  await writeFile(
    path.join(repo, ".aof", "aof.config.json"),
    JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" }, mesh: { workspaceId: WORKSPACE_ID } }, null, 2),
    "utf8",
  );
  await writeFile(
    path.join(mDir, "SPEC.md"),
    frontmatter({ type: "milestone", number: "18", slug: "integration-descriptor", status: "in-progress", title: '"Integration descriptor"', created: "2026-07-01", updated: "2026-07-01" }) + "# local scaffold SPEC\n",
    "utf8",
  );
  return repo;
}

async function withFixture(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-board-content-"));
  try {
    const home = path.join(root, "global-home");
    const repo = await makeRepo(root);
    const env = { AOF_GLOBAL_HOME: home };
    const ctx = { workspace: await loadWorkspace(repo), globalWorkStoreOptions: { env } };
    return await fn({ ctx, env });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function seedStreamedContent(env, { docs = [], runs = [] }) {
  const store = await openGlobalWorkProjectionStore({ env });
  try {
    upsertWorkItemContent(store, WORKSPACE_ID, { docs, runs, nodeId: "umairs-mac-mini" }, { now: NOW });
  } finally {
    store.close();
  }
}

const RUN_RECORD = { runId: "run-1", itemRef: "18", state: "running", attempt: 1, createdAt: NOW, updatedAt: NOW };

export const boardWorkerContentTests = [
  {
    name: "board-worker-content/v5 a streamed story's doc answers from the projection where it used to dead-end ref-not-found",
    async run() {
      await withFixture(async ({ ctx, env }) => {
        await seedStreamedContent(env, { docs: [{ ref: "18/03", doc: "STORY", body: "# the worker's story\n" }] });
        const result = await invoke("work:doc", { ref: "18/03", doc: "STORY" }, ctx);
        assert.equal(result.present, true);
        assert.equal(result.body, "# the worker's story\n");
        assert.equal(result.fromWorker, true, "the surface can say this is the worker's view");
        assert.equal(result.reportedBy, "umairs-mac-mini", "…and whose view it is");
      });
    },
  },
  {
    name: "board-worker-content/v5 a locally-resolved item with an absent doc file answers from the projection; a locally-present doc wins",
    async run() {
      await withFixture(async ({ ctx, env }) => {
        await seedStreamedContent(env, {
          docs: [
            { ref: "18", doc: "VERIFICATION", body: "# worker verification\n" },
            { ref: "18", doc: "SPEC", body: "# worker SPEC — must NOT shadow the local file\n" },
          ],
        });
        const verification = await invoke("work:doc", { ref: "18", doc: "VERIFICATION" }, ctx);
        assert.equal(verification.present, true, "the absent local file falls back to the streamed body");
        assert.equal(verification.body, "# worker verification\n");
        assert.equal(verification.fromWorker, true);

        const spec = await invoke("work:doc", { ref: "18", doc: "SPEC" }, ctx);
        assert.equal(spec.fromWorker, undefined, "a doc the local disk holds is answered locally");
        assert.ok(spec.body.includes("# local scaffold SPEC"), "local disk wins whenever it can answer");
      });
    },
  },
  {
    name: "board-worker-content/v5 nothing streamed → work:doc behaviour is unchanged (404 for an unknown ref, absent for a missing doc)",
    async run() {
      await withFixture(async ({ ctx }) => {
        await assert.rejects(
          invoke("work:doc", { ref: "18/03", doc: "STORY" }, ctx),
          (error) => error.code === "ref-not-found" && error.status === 404,
          "an unknown ref with no streamed body is still ref-not-found",
        );
        const result = await invoke("work:doc", { ref: "18", doc: "VERIFICATION" }, ctx);
        assert.deepEqual(result, { ref: "18", doc: "VERIFICATION", present: false, body: "" }, "a missing doc with no streamed body is still absent-not-error");
      });
    },
  },
  {
    name: "board-worker-content/v5 the RUNS view answers streamed run records for an item running remotely (and for a streamed-only ref)",
    async run() {
      await withFixture(async ({ ctx, env }) => {
        await seedStreamedContent(env, { runs: [{ ref: "18", runId: "run-1", record: RUN_RECORD }, { ref: "18/03", runId: "run-1", record: { ...RUN_RECORD, itemRef: "18/03" } }] });

        // The item resolves locally but has no runs/ dir — it used to render
        // "No runs yet" for an item running on the worker at that moment.
        const milestone = await invoke("work:run-status", { ref: "18" }, ctx);
        assert.equal(milestone.runs.length, 1);
        assert.deepEqual(milestone.runs[0], RUN_RECORD, "the worker's run record is the answer, not the empty local dir");
        assert.equal(milestone.fromWorker, true);
        assert.equal(milestone.reportedBy, "umairs-mac-mini");

        // The streamed story does not resolve locally at all.
        const story = await invoke("work:run-status", { ref: "18/03" }, ctx);
        assert.equal(story.runs[0].itemRef, "18/03");
        assert.equal(story.fromWorker, true);
      });
    },
  },
  {
    name: "board-worker-content/v5 nothing streamed → work:run-status behaviour is unchanged (404 / empty history)",
    async run() {
      await withFixture(async ({ ctx }) => {
        await assert.rejects(
          invoke("work:run-status", { ref: "18/03" }, ctx),
          (error) => error.code === "ref-not-found" && error.status === 404,
        );
        const result = await invoke("work:run-status", { ref: "18" }, ctx);
        assert.deepEqual(result, { ref: "18", runs: [] }, "an item with no runs anywhere is still an empty history, not an error");
      });
    },
  },
];
