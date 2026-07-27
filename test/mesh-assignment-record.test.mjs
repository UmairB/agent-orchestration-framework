// task 00 — the frozen assignment record + the state→producer enum + the additive
// global_assignments table (v2→v3) + dedicated single-row writers + snapshot survival
// (milestone 35 / story 00, ADR-001). Hermetic over AOF_GLOBAL_HOME opening a v3 store
// (the m34 global-store test convention) + an injected clock for the ISO-8601-Z stamps.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  openGlobalWorkProjectionStore,
  publishWorkspaceSnapshot,
  GLOBAL_WORK_SCHEMA_VERSION,
} from "../src/global-work-store.mjs";
import {
  assembleAssignmentRecord,
  ASSIGNMENT_STATE_PRODUCERS,
  ASSIGNMENT_STATES,
  insertAssignment,
  updateAssignmentState,
  readAssignment,
  producerFor,
  classificationFor,
} from "../src/assignment-record.mjs";

async function withTemp(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-assignment-record-"));
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function openStore(home) {
  return openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });
}

async function makeWorkspace(root) {
  const workDir = path.join(root, "wiki", "work");
  const milestoneDir = path.join(workDir, "35_milestone_demo");
  await mkdir(path.join(milestoneDir, "stories", "00_story_a"), { recursive: true });
  await writeFile(
    path.join(milestoneDir, "SPEC.md"),
    "---\ntype: milestone\nnumber: 35\nslug: demo\nstatus: in-progress\ntitle: Demo\n---\n",
    "utf8",
  );
  return {
    config: { name: path.basename(root), work: { dir: "./wiki/work" } },
    projectRoot: root,
    workDir,
  };
}

export const meshAssignmentRecordTests = [
  {
    name: "assignment-record/00 the assembler returns exactly the ten frozen keys, in order",
    run: async () => {
      const record = assembleAssignmentRecord({
        itemRef: "35/00",
        workspaceId: "ws-1",
        targetNodeId: "worker-a",
        issuer: "control-a",
        now: "2026-07-08T10:00:00.000Z",
      });
      assert.deepEqual(
        Object.keys(record),
        ["assignmentId", "itemRef", "workspaceId", "targetNodeId", "issuer", "state", "runId", "assignedAt", "updatedAt", "reclaimedAt"],
      );
    },
  },
  {
    name: "assignment-record/00 the record defaults state to assigned and runId/reclaimedAt to null",
    run: async () => {
      const record = assembleAssignmentRecord({
        itemRef: "35/00",
        workspaceId: "ws-1",
        targetNodeId: "worker-a",
        issuer: "control-a",
        now: "2026-07-08T10:00:00.000Z",
      });
      assert.equal(record.state, "assigned");
      assert.equal(record.runId, null);
      assert.equal(record.reclaimedAt, null);
    },
  },
  {
    name: "assignment-record/00 each lifecycle state maps to exactly one named producer + classification",
    run: async () => {
      const expected = {
        assigned: { producer: "assign verb", classification: "control-created" },
        accepted: { producer: "the worker", classification: "worker-reported" },
        running: { producer: "the worker", classification: "worker-reported" },
        done: { producer: "the worker", classification: "worker-reported term" },
        failed: { producer: "the worker", classification: "worker-reported term" },
        withdrawn: { producer: "withdraw verb", classification: "control-created term" },
        reclaimed: { producer: "reclaim path", classification: "control-created term" },
      };
      for (const [state, { producer, classification }] of Object.entries(expected)) {
        assert.equal(producerFor(state), producer, `${state} producer`);
        assert.equal(classificationFor(state), classification, `${state} classification`);
      }
    },
  },
  {
    name: "assignment-record/00 the state enum admits no state without a producer",
    run: async () => {
      assert.deepEqual(
        [...ASSIGNMENT_STATES].sort(),
        ["accepted", "assigned", "done", "failed", "reclaimed", "running", "withdrawn"],
      );
      for (const state of ASSIGNMENT_STATES) {
        const producer = ASSIGNMENT_STATE_PRODUCERS[state].producer;
        assert.ok(typeof producer === "string" && producer.length > 0, `${state} has a non-empty producer`);
      }
    },
  },
  {
    name: "assignment-record/00 opening a v2 store with a v3 build adds global_assignments and leaves the v2 tables unchanged",
    run: async () => withTemp(async (home) => {
      // Force a v2 store by opening with a pinned schema version, mirroring the
      // future-schema-refuses fixture shape (global-work-store.test.mjs).
      const v2 = await openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });
      v2.db.prepare("UPDATE aof_schema SET value = 2 WHERE key = 'version'").run();
      const ws = await makeWorkspace(path.join(home, "..", "repo-v2"));
      await v2.publishWorkspaceSnapshot(ws, { now: "2026-07-08T09:00:00.000Z" });
      v2.close();

      const v3 = await openStore(home);
      try {
        // review fix (live soak, 2026-07-17): schema v4 adds global_workspace_descriptors.clone_url
        // (ADR-010 Gap A extended) — this pin is deliberately bumped alongside it,
        // catching any FUTURE unintentional version drift, not this one.
        // v5 (TECH_DEBT item 6): the additive work_item_docs/work_item_runs content
        // tables — the pin bumps again, same rationale.
        // v7 (m42 interactive worker terminals): the additive global_assignments.code
        // column (the needs-input status refinement) — same rationale again.
        assert.equal(GLOBAL_WORK_SCHEMA_VERSION, 7);
        assert.equal(v3.schemaVersion, 7);
        const version = v3.db.prepare("SELECT value FROM aof_schema WHERE key = 'version'").get();
        assert.equal(version.value, 7);

        const tables = v3.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((r) => r.name);
        assert.ok(tables.includes("global_assignments"), "global_assignments table exists");
        for (const table of ["workspaces", "work_items", "projection_metadata", "projection_errors", "global_nodes", "global_workspace_descriptors", "global_node_workspaces"]) {
          assert.ok(tables.includes(table), `v2 table ${table} is present`);
        }

        const rows = v3.db.prepare("SELECT * FROM workspaces").all();
        assert.equal(rows.length, 1, "the existing projected workspace row is still queryable");
      } finally {
        v3.close();
      }
    }),
  },
  {
    name: "assignment-record/00 opening a v3 store (no global_workspace_descriptors.clone_url) with a v4 build adds the column via ALTER TABLE, losing no existing row",
    run: async () => withTemp(async (home) => {
      // Force a v3 store: open fresh (creates clone_url, since CREATE TABLE IF NOT
      // EXISTS always uses the CURRENT full schema on a brand-new file), then drop
      // back to a table shape WITHOUT the column the way a REAL pre-v4 database
      // would have it — SQLite has no DROP COLUMN pre-3.35, so rebuild the table by
      // hand to model an authentically-old file.
      const v3 = await openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });
      v3.db.exec(`
        CREATE TABLE global_workspace_descriptors_v3_shape (
          workspace_id TEXT PRIMARY KEY,
          project_root TEXT NOT NULL,
          work_dir TEXT NOT NULL,
          name TEXT,
          mesh_enabled INTEGER NOT NULL DEFAULT 0,
          control_node TEXT,
          member_node_ids_json TEXT NOT NULL DEFAULT '[]',
          published_at TEXT,
          descriptor_path TEXT NOT NULL
        );
        INSERT INTO global_workspace_descriptors_v3_shape
          SELECT workspace_id, project_root, work_dir, name, mesh_enabled, control_node, member_node_ids_json, published_at, descriptor_path
          FROM global_workspace_descriptors;
        DROP TABLE global_workspace_descriptors;
        ALTER TABLE global_workspace_descriptors_v3_shape RENAME TO global_workspace_descriptors;
      `);
      v3.db.prepare(`
        INSERT INTO global_workspace_descriptors (workspace_id, project_root, work_dir, name, mesh_enabled, control_node, member_node_ids_json, published_at, descriptor_path)
        VALUES ('ws-preexisting', '/pre/root', '/pre/root/wiki/work', 'pre-existing', 1, 'control-a', '[]', '2026-07-01T00:00:00.000Z', '/pre/descriptor.json')
      `).run();
      v3.db.prepare("UPDATE aof_schema SET value = 3 WHERE key = 'version'").run();
      v3.close();

      const v4 = await openStore(home);
      try {
        const columns = v4.db.prepare("PRAGMA table_info(global_workspace_descriptors)").all().map((c) => c.name);
        assert.ok(columns.includes("clone_url"), "clone_url is added by the v3->v4 migration, not just on a brand-new database");

        const row = v4.db.prepare("SELECT * FROM global_workspace_descriptors WHERE workspace_id = ?").get("ws-preexisting");
        assert.ok(row, "the pre-existing row survives the ALTER TABLE untouched");
        assert.equal(row.project_root, "/pre/root", "every pre-existing column value is preserved byte-identical");
        assert.equal(row.clone_url, null, "the new column reads null for a row that predates it, never a fabricated value");
      } finally {
        v4.close();
      }
    }),
  },
  {
    name: "assignment-record/00 an assignment is inserted and mutated only through dedicated single-row writers keyed by assignmentId",
    run: async () => withTemp(async (home) => {
      const store = await openStore(home);
      try {
        const record = assembleAssignmentRecord({
          itemRef: "35/00",
          workspaceId: "ws-1",
          targetNodeId: "worker-a",
          issuer: "control-a",
          now: "2026-07-08T10:00:00.000Z",
        });
        insertAssignment(store, record);

        const rows = store.db.prepare("SELECT * FROM global_assignments").all();
        assert.equal(rows.length, 1, "exactly one row exists");

        const updated = updateAssignmentState(store, record.assignmentId, "accepted", { now: "2026-07-08T10:05:00.000Z" });
        assert.equal(updated.state, "accepted");
        assert.equal(updated.updatedAt, "2026-07-08T10:05:00.000Z");
        assert.notEqual(updated.updatedAt, record.assignedAt, "updatedAt is restamped");

        const rowsAfter = store.db.prepare("SELECT * FROM global_assignments").all();
        assert.equal(rowsAfter.length, 1, "no other global_assignments row was touched");
      } finally {
        store.close();
      }
    }),
  },
  {
    name: "assignment-record/00 an inserted assignment survives a full publishWorkspaceSnapshot cycle byte-identical",
    run: async () => withTemp(async (home) => {
      const store = await openStore(home);
      try {
        const record = assembleAssignmentRecord({
          itemRef: "35/00",
          workspaceId: "ws-1",
          targetNodeId: "worker-a",
          issuer: "control-a",
          state: "running",
          runId: "run-123",
          now: "2026-07-08T10:00:00.000Z",
        });
        insertAssignment(store, record);
        const before = readAssignment(store, record.assignmentId);

        const ws = await makeWorkspace(path.join(home, "..", "repo-snap"));
        await publishWorkspaceSnapshot(store, ws, { workspaceId: "ws-1", now: "2026-07-08T11:00:00.000Z" });

        const after = readAssignment(store, record.assignmentId);
        assert.deepEqual(after, before, "the assignment row reads back byte-identical to before the publish");
      } finally {
        store.close();
      }
    }),
  },
  {
    name: "assignment-record/00 the snapshot write path source touches no global_assignments statement",
    run: async () => {
      const { readFile } = await import("node:fs/promises");
      const { fileURLToPath } = await import("node:url");
      const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
      const source = await readFile(path.join(repoRoot, "src", "global-work-store.mjs"), "utf8");
      const start = source.indexOf("export async function publishWorkspaceSnapshot");
      const nextFn = source.indexOf("\nexport function recordWorkspaceProjectionError");
      const body = source.slice(start, nextFn === -1 ? undefined : nextFn);
      assert.ok(body.length > 0, "publishWorkspaceSnapshot body located");
      assert.ok(!body.includes("global_assignments"), "publishWorkspaceSnapshot never references global_assignments");
    },
  },
  {
    name: "assignment-record/00 a terminal control transition (withdrawn) flips state and stamps but never deletes the row",
    run: async () => withTemp(async (home) => {
      const store = await openStore(home);
      try {
        const record = assembleAssignmentRecord({
          itemRef: "35/00",
          workspaceId: "ws-1",
          targetNodeId: "worker-a",
          issuer: "control-a",
          now: "2026-07-08T10:00:00.000Z",
        });
        insertAssignment(store, record);

        const updated = updateAssignmentState(store, record.assignmentId, "withdrawn", { now: "2026-07-08T10:10:00.000Z" });
        assert.equal(updated.state, "withdrawn");
        assert.equal(updated.reclaimedAt, null, "reclaimedAt remains null");
        const row = store.db.prepare("SELECT * FROM global_assignments WHERE assignment_id = ?").get(record.assignmentId);
        assert.ok(row, "the row still exists");
      } finally {
        store.close();
      }
    }),
  },
  {
    name: "assignment-record/00 a terminal control transition (reclaimed) flips state and stamps reclaimedAt but never deletes the row",
    run: async () => withTemp(async (home) => {
      const store = await openStore(home);
      try {
        const record = assembleAssignmentRecord({
          itemRef: "35/00",
          workspaceId: "ws-1",
          targetNodeId: "worker-a",
          issuer: "control-a",
          now: "2026-07-08T10:00:00.000Z",
        });
        insertAssignment(store, record);

        const updated = updateAssignmentState(store, record.assignmentId, "reclaimed", {
          now: "2026-07-08T10:10:00.000Z",
          reclaimedAt: "2026-07-08T10:10:00.000Z",
        });
        assert.equal(updated.state, "reclaimed");
        assert.equal(updated.reclaimedAt, "2026-07-08T10:10:00.000Z", "reclaimedAt is stamped with the reclaim time");
        const row = store.db.prepare("SELECT * FROM global_assignments WHERE assignment_id = ?").get(record.assignmentId);
        assert.ok(row, "the row still exists");
      } finally {
        store.close();
      }
    }),
  },
];
