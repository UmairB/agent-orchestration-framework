// Traceability wiring for milestone 35 / story 03 / task 00 —
// tasks/00_status-shape.feature (@executable).
//
// `shapeGlobalStatus` (src/global-mesh-query.mjs) is a PURE function of its
// `{ paths, workProjection, registry, assignments, now }` inputs (zero I/O) — so
// every scenario/example row is asserted HEADLESSLY over planted projection +
// assignment inputs, no live SQLite, no server, mirroring the m34
// test/global-mesh-query.test.mjs convention.
//
// Prior-lesson discipline (R4/m21, work memory near-miss): a pure read-model
// helper needs explicit headless coverage of ordering/tie-breaks, non-mutation of
// the shared model, and unknown-state forward-compat, not just the happy path —
// this file asserts the "most-relevant assignment wins" tie-break, that the
// shaping never mutates its input arrays, and that every ADR-001 state
// (including the forward-compat `withdrawn`/`reclaimed` terminal states) travels
// through verbatim.
import assert from "node:assert/strict";
import { shapeGlobalStatus } from "../src/global-mesh-query.mjs";

function baseArgs(overrides = {}) {
  return {
    paths: { databasePath: "/tmp/global.sqlite" },
    workProjection: { workspaceId: null, workspaces: [], items: [], errors: [] },
    registry: { workspaces: [], nodes: [], errors: [] },
    assignments: [],
    now: "2026-07-09T00:00:00.000Z",
    ...overrides,
  };
}

function assignmentRow(overrides = {}) {
  return {
    assignmentId: "a1",
    itemRef: "35/00",
    workspaceId: "alpha",
    targetNodeId: "worker-b",
    issuer: "operator",
    state: "assigned",
    runId: null,
    assignedAt: "2026-07-08T10:00:00.000Z",
    updatedAt: "2026-07-08T10:00:00.000Z",
    reclaimedAt: null,
    ...overrides,
  };
}

export const assignmentFleetStatusShapeTests = [
  // Scenario: a work item carrying an assignment surfaces the assignment on its item row.
  {
    name: "assignment-fleet-status-shape/00 a work item carrying an assignment surfaces the assignment on its item row",
    run: () => {
      const item = { workspaceId: "alpha", ref: "35/00", type: "task", slug: "x", status: "in-progress", title: "X", parent: "35", sourcePath: "/x" };
      const args = baseArgs({
        workProjection: { workspaceId: null, workspaces: [], items: [item], errors: [] },
        assignments: [assignmentRow({ state: "running", runId: "run-1" })],
      });
      const result = shapeGlobalStatus(args);
      const row = result.items.find((i) => i.ref === "35/00");
      assert.ok(row, "the item row still surfaces");
      assert.ok(row.assignment, "the item row carries an assignment");
      assert.equal(row.assignment.state, "running");
      assert.equal(row.assignment.targetNodeId, "worker-b");
      assert.equal(row.assignment.runId, "run-1");
      assert.equal(row.assignment.assignedAt, "2026-07-08T10:00:00.000Z");
      assert.equal(row.assignment.updatedAt, "2026-07-08T10:00:00.000Z");
      assert.equal(row.assignment.reclaimedAt, null);
    },
  },

  // Scenario: a node holding assignments surfaces them keyed to that node.
  {
    name: "assignment-fleet-status-shape/00 a node holding assignments surfaces them keyed to that node",
    run: () => {
      const node = { nodeId: "worker-b", role: "worker" };
      const args = baseArgs({
        registry: { workspaces: [], nodes: [node], errors: [] },
        assignments: [
          assignmentRow({ assignmentId: "a1", itemRef: "35/00", state: "running" }),
          assignmentRow({ assignmentId: "a2", itemRef: "35/01", state: "accepted", assignedAt: "2026-07-08T09:00:00.000Z" }),
        ],
      });
      const result = shapeGlobalStatus(args);
      const row = result.nodes.find((n) => n.nodeId === "worker-b");
      assert.ok(row, "the node row still surfaces");
      assert.ok(Array.isArray(row.assignments), "the node row carries its held assignments");
      assert.equal(row.assignments.length, 2);
      const states = row.assignments.map((a) => a.state).sort();
      assert.deepEqual(states, ["accepted", "running"]);
      assert.ok(row.assignments.every((a) => a.targetNodeId === "worker-b"));
    },
  },

  // Scenario: an item and a node with no assignment carry nothing fabricated.
  {
    name: "assignment-fleet-status-shape/00 an item and a node with no assignment carry nothing fabricated — absent, not false",
    run: () => {
      const item = { workspaceId: "alpha", ref: "34", type: "milestone", slug: "y", status: "in-progress", title: "Y", parent: null, sourcePath: "/y" };
      const node = { nodeId: "worker-c", role: "worker" };
      const args = baseArgs({
        workProjection: { workspaceId: null, workspaces: [], items: [item], errors: [] },
        registry: { workspaces: [], nodes: [node], errors: [] },
        assignments: [],
      });
      const result = shapeGlobalStatus(args);
      const itemRow = result.items.find((i) => i.ref === "34");
      const nodeRow = result.nodes.find((n) => n.nodeId === "worker-c");
      assert.ok(!("assignment" in itemRow) || itemRow.assignment == null, "the item row carries no fabricated assignment");
      assert.ok(!("assignments" in nodeRow) || nodeRow.assignments == null, "the node row carries no fabricated assignments");
      assert.ok(!Object.prototype.hasOwnProperty.call(itemRow, "assignment"), "no placeholder assignment key is synthesized on the item row");
      assert.ok(!Object.prototype.hasOwnProperty.call(nodeRow, "assignments"), "no placeholder assignments key is synthesized on the node row");
    },
  },

  // Scenario: the assignment rows are additive — no existing status field changes meaning.
  {
    name: "assignment-fleet-status-shape/00 the assignment rows are additive — every pre-existing field keeps its m34 meaning, and the shaping mutates no input",
    run: () => {
      const item = { workspaceId: "alpha", ref: "35/00", type: "task", slug: "x", status: "in-progress", title: "X", parent: "35", sourcePath: "/x" };
      const workspace = { workspaceId: "alpha", projectRoot: "/alpha", workDir: "/alpha/wiki/work", name: "alpha", lastPublishedAt: "2026-07-08T00:00:00.000Z" };
      const node = { nodeId: "worker-b", role: "worker" };
      const itemsBefore = JSON.stringify([item]);
      const workspacesBefore = JSON.stringify([workspace]);
      const nodesBefore = JSON.stringify([node]);

      const args = baseArgs({
        workProjection: { workspaceId: null, workspaces: [workspace], items: [item], errors: [] },
        registry: { workspaces: [], nodes: [node], errors: [] },
        assignments: [assignmentRow()],
      });
      const result = shapeGlobalStatus(args);

      // the body still carries scope, workspaces, items, nodes, diagnostics
      assert.equal(result.scope, "global");
      assert.ok(Array.isArray(result.workspaces));
      assert.ok(Array.isArray(result.items));
      assert.ok(Array.isArray(result.nodes));
      assert.ok(result.diagnostics && typeof result.diagnostics === "object");

      // every pre-existing field keeps its m34 meaning unchanged
      const itemRow = result.items.find((i) => i.ref === "35/00");
      assert.equal(itemRow.workspaceId, item.workspaceId);
      assert.equal(itemRow.type, item.type);
      assert.equal(itemRow.slug, item.slug);
      assert.equal(itemRow.status, item.status);
      assert.equal(itemRow.title, item.title);
      assert.equal(itemRow.parent, item.parent);
      assert.equal(itemRow.sourcePath, item.sourcePath);

      // a reader that ignores the assignment field reads the same shape as before
      const { assignment: _ignored, ...withoutAssignment } = itemRow;
      assert.deepEqual(withoutAssignment, item);

      // the shaping never mutated the caller's input arrays/objects (non-mutation)
      assert.equal(JSON.stringify([item]), itemsBefore, "the input item row is unchanged");
      assert.equal(JSON.stringify([workspace]), workspacesBefore, "the input workspace row is unchanged");
      assert.equal(JSON.stringify([node]), nodesBefore, "the input node row is unchanged");
    },
  },

  // Scenario Outline: each lifecycle state travels through the read shape
  // verbatim, with reclaim provenance intact.
  {
    name: "assignment-fleet-status-shape/00 each lifecycle state travels through the read shape verbatim, with reclaim provenance intact",
    run: () => {
      const rows = [
        { state: "assigned", reclaimedAt: null },
        { state: "accepted", reclaimedAt: null },
        { state: "running", reclaimedAt: null },
        { state: "done", reclaimedAt: null },
        { state: "failed", reclaimedAt: null },
        { state: "withdrawn", reclaimedAt: null },
        { state: "reclaimed", reclaimedAt: "2026-07-08T10:05:00.000Z" },
      ];
      for (const { state, reclaimedAt } of rows) {
        const item = { workspaceId: "alpha", ref: "35/00", type: "task", slug: "x", status: "in-progress", title: "X", parent: "35", sourcePath: "/x" };
        const args = baseArgs({
          workProjection: { workspaceId: null, workspaces: [], items: [item], errors: [] },
          assignments: [assignmentRow({ state, reclaimedAt, updatedAt: reclaimedAt ?? "2026-07-08T10:00:00.000Z" })],
        });
        const result = shapeGlobalStatus(args);
        const itemRow = result.items.find((i) => i.ref === "35/00");
        assert.equal(itemRow.assignment.state, state, `state "${state}" travels through verbatim`);
        assert.equal(itemRow.assignment.reclaimedAt, reclaimedAt, `reclaimedAt for state "${state}" travels through verbatim`);
      }
    },
  },

  // The read layer applies no chip label or colour — the shape carries the RAW
  // ADR-001 state string, never a { label, token } descriptor (that's task 01).
  {
    name: "assignment-fleet-status-shape/00 the read layer applies no chip label or colour to the row",
    run: () => {
      const item = { workspaceId: "alpha", ref: "35/00", type: "task", slug: "x", status: "in-progress", title: "X", parent: "35", sourcePath: "/x" };
      const args = baseArgs({
        workProjection: { workspaceId: null, workspaces: [], items: [item], errors: [] },
        assignments: [assignmentRow({ state: "failed" })],
      });
      const result = shapeGlobalStatus(args);
      const itemRow = result.items.find((i) => i.ref === "35/00");
      assert.equal(itemRow.assignment.state, "failed");
      assert.ok(!("label" in itemRow.assignment), "no chip label is applied at the read layer");
      assert.ok(!("token" in itemRow.assignment), "no chip token/colour is applied at the read layer");
      assert.ok(!("mark" in itemRow.assignment), "no chip mark is applied at the read layer");
    },
  },

  // Tie-break coverage (R4/m21 discipline): when multiple rows exist for the
  // same item, an ACTIVE assignment always wins over a terminal one, even when
  // the terminal row is more recent — the chip prioritises the actionable state.
  {
    name: "assignment-fleet-status-shape/00 an active assignment wins the tie-break over a more-recent terminal row for the same item",
    run: () => {
      const item = { workspaceId: "alpha", ref: "35/00", type: "task", slug: "x", status: "in-progress", title: "X", parent: "35", sourcePath: "/x" };
      const args = baseArgs({
        workProjection: { workspaceId: null, workspaces: [], items: [item], errors: [] },
        // listAllAssignments orders most-recent-first — the terminal "done" row is
        // listed FIRST (more recent) but the ACTIVE "running" row must still win.
        assignments: [
          assignmentRow({ assignmentId: "a-done", state: "done", assignedAt: "2026-07-08T11:00:00.000Z" }),
          assignmentRow({ assignmentId: "a-running", state: "running", assignedAt: "2026-07-08T09:00:00.000Z" }),
        ],
      });
      const result = shapeGlobalStatus(args);
      const itemRow = result.items.find((i) => i.ref === "35/00");
      assert.equal(itemRow.assignment.assignmentId, "a-running", "the active row wins the tie-break, not the more-recent terminal row");
    },
  },
];
