// Traceability wiring for milestone 38 / story 04 / task 03 —
// tasks/03_assign-affordance-renders.feature (@executable).
//
// ARCHITECTURE 38/ADR-008 — "a component must be tested through the component
// PRODUCTION RENDERS / INVOKES … establish, from the producer, WHICH component
// the real payload mounts." This repo ships no React test harness: the
// render-logic under test lives in the pure fleet helpers
// (ui/src/fleet/scope.mjs's `assignableNodeOptions` + assignments.mjs's
// `assignmentChip`) — the SAME helpers the production Fleet.tsx card renders
// the picker + chip from (ui/src/fleet/Fleet.tsx's GlobalMilestoneCard).
//
// @executable proves the DATA is PRODUCER-FED, not fixture-shaped: the roster
// the picker offers is derived from the REAL GET /api/mesh/status payload
// (empty / one / live+stale), and the chip is derived from a REAL minted
// record (through the REAL POST /api/mesh/assign route, task 00) — never a
// hand-built node list nor a hand-built assignment object (STATE.md F1/F4/F9).
//
// Driven over withPublishedAssignFixture (test/support/mesh-ui-assign-fixture.mjs)
// — a REAL end-to-end publish (workspace snapshot + node registry), so a node is
// VISIBLE through the REAL registry read, not just eligible on the write side.
import assert from "node:assert/strict";
import { assignableNodeOptions } from "../ui/src/fleet/scope.mjs";
import { assignmentChip } from "../ui/src/fleet/assignments.mjs";
import { withPublishedAssignFixture, sameOriginAssign } from "./support/mesh-ui-assign-fixture.mjs";

async function fetchStatus(url) {
  const res = await fetch(new URL("/api/mesh/status", url));
  assert.equal(res.status, 200, "GET /api/mesh/status answers");
  return res.json();
}

export const fleetAssignAffordanceTests = [
  // ══ Scenario Outline: the node-picker offers exactly the assignable nodes the REAL roster carries ══
  {
    name: "fleet-assign-affordance/03 the node-picker offers exactly the assignable nodes the REAL /api/mesh/status roster carries — empty roster",
    async run() {
      await withPublishedAssignFixture(async ({ url }) => {
        const status = await fetchStatus(url);
        assert.deepEqual(status.nodes, [], "the REAL roster is empty — nothing was published");
        const options = assignableNodeOptions(status.nodes);
        assert.deepEqual(options, [], "an empty roster offers no options");
      });
    },
  },
  {
    name: "fleet-assign-affordance/03 the node-picker offers exactly the assignable nodes the REAL /api/mesh/status roster carries — one worker",
    async run() {
      await withPublishedAssignFixture(async ({ url }) => {
        const status = await fetchStatus(url);
        assert.equal(status.nodes.length, 1, "the REAL roster carries the one published node");
        const options = assignableNodeOptions(status.nodes);
        assert.deepEqual(options, ["worker-a"], "the single worker in the roster is the ONE offered option");
        assert.ok(
          status.nodes.every((node) => options.includes(node.nodeId)),
          "every offered option is a node carried by the route's roster"
        );
      }, { nodes: ["worker-a"] });
    },
  },
  {
    name: "fleet-assign-affordance/03 the node-picker offers exactly the assignable nodes the REAL /api/mesh/status roster carries — many known nodes (both known-but-stale in this fixture), neither dropped (liveness is orthogonal to the node-known gate)",
    async run() {
      await withPublishedAssignFixture(async ({ url }) => {
        // Neither published node ever heartbeats in this fixture, so BOTH read
        // as "no presence"/stale on the real payload — the point the feature
        // makes (a stale-but-known node is not dropped from the picker;
        // liveness is orthogonal to the node-known gate the verb enforces).
        const status = await fetchStatus(url);
        assert.equal(status.nodes.length, 2, "the REAL roster carries both published nodes");
        const options = assignableNodeOptions(status.nodes);
        const optionSet = new Set(options);
        assert.equal(optionSet.size, 2, "both nodes in the roster are offered");
        assert.ok(optionSet.has("worker-a") && optionSet.has("worker-b"), "worker-a and worker-b are both options");
        assert.ok(
          status.nodes.every((node) => optionSet.has(node.nodeId)),
          "no node the roster carries is silently dropped from the picker"
        );
      }, { nodes: ["worker-a", "worker-b"] });
    },
  },

  // ══ Scenario: the empty-roster state renders a disabled / empty affordance ══
  {
    name: "fleet-assign-affordance/03 the empty-roster state offers NO node option and NO invented placeholder target",
    async run() {
      await withPublishedAssignFixture(async ({ url }) => {
        const status = await fetchStatus(url);
        const options = assignableNodeOptions(status.nodes);
        assert.equal(options.length, 0, "there is nothing to assign to");
        assert.ok(!options.includes("any"), "no invented \"any\" placeholder target the verb would refuse");
      });
    },
  },

  // ══ Scenario: the resulting `assigned` chip renders from the REAL minted record ══
  {
    name: "fleet-assign-affordance/03 the resulting assigned chip renders from the REAL minted record — the m35/story-03 read shape, closing the loop",
    async run() {
      await withPublishedAssignFixture(async ({ url }) => {
        const assignRes = await sameOriginAssign(url, "38/04", "worker-a");
        assert.equal(assignRes.status, 200, "the REAL route mints the assignment (task 00) — the published node is both visible and eligible");

        const status = await fetchStatus(url);
        const item = status.items.find((candidate) => candidate.ref === "38/04");
        assert.ok(item, "the assigned item surfaces in the REAL status payload");
        assert.ok(item.assignment, "the REAL minted record is attached to the item — the m35/story-03 read shape");

        // The SAME production projection Fleet.tsx's AssignmentChip renders from.
        const chip = assignmentChip(item.assignment);
        assert.equal(chip.label, "assigned");
        assert.equal(item.assignment.state, "assigned");
        assert.equal(item.assignment.targetNodeId, "worker-a");
      }, { nodes: ["worker-a"] });
    },
  },
];
