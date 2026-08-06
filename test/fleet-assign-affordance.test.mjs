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
import { POLL_MS } from "../ui/src/fleet/assign-affordance.mjs";
import {
  withPublishedAssignFixture,
  sameOriginAssign,
  dropNodeFromRoster,
  readAssignmentRows,
  settleAssignmentsFor,
} from "./support/mesh-ui-assign-fixture.mjs";
import { withFleetApp } from "./support/fleet-app-harness.mjs";

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

  // ══ Scenario: the target the row NAMES is the target the POST carries ══
  //
  // REVIEW FIX QA-a (2026-07-24) — F21's defect class, relocated to the NODE
  // axis, reproduced end-to-end in Chromium by QA and confirmed at source. The
  // fleet face is a LONG-LIVED monitor that re-polls every POLL_MS, so the
  // roster under a mounted picker changes while the row sits there. Remembered
  // selection alone went stale: the <select>'s DOM value coerced to the first
  // surviving option while React state kept the DEPARTED id, so the row
  // displayed one target and POSTed another — and `Sent` then sat beside the
  // wrong name.
  //
  // F21's lesson, generalised: a seam whose defect is a WRONG TARGET must be
  // exercised with ≥2 candidates where the chosen one can STOP BEING VALID. The
  // roster change is the codebase's own documented producer, not an invented
  // one: queryGlobalRegistry drops a `global_nodes` row whose descriptor file no
  // longer resolves, while assignWork's node-known gate reads `global_nodes`
  // DIRECTLY — so a node can leave the picker and remain assign-eligible, which
  // is exactly what makes the mis-dispatch SILENT rather than refused.
  {
    name: "fleet-assign-affordance/03 the target the row NAMES is the target the POST carries — when the roster changes under a mounted picker, the departed node is neither displayed nor dispatched",
    async run() {
      await withPublishedAssignFixture(async ({ url, home, workspaceId }) => {
        await withFleetApp({ url }, async (app) => {
          const atRest = app.affordance("38");
          assert.deepEqual(
            atRest.options,
            ["aaa-first-node", "zzz-second-node"],
            "the REAL roster feeds BOTH candidates into the picker (the ≥2-candidate configuration the defect needs)",
          );
          assert.equal(atRest.selectedNode, "aaa-first-node", "the row rests on the first option, untouched by the operator");

          // The roster CHANGES under the mounted row, through its own producer.
          await dropNodeFromRoster({ home }, "aaa-first-node");
          await app.advance(POLL_MS);

          const after = app.affordance("38");
          assert.deepEqual(after.options, ["zzz-second-node"], "the poll dropped the departed node from the picker");
          assert.ok(
            after.options.includes(after.selectedNode),
            `the value the row renders must be one of the options it renders — got ${JSON.stringify(after.selectedNode)} against ${JSON.stringify(after.options)}; a select whose value is not among its options DISPLAYS the first surviving one while holding the other, which is a row naming one target and dispatching another`,
          );
          assert.equal(after.selectedNode, "zzz-second-node", "…so the row NAMES the surviving node");

          await after.click();

          // What the app ACTUALLY sent — the app's own request body, not a
          // hand-built one: the store row alone cannot say whether the CLIENT or
          // the route chose the target.
          const posted = app.requests().filter((entry) => entry.url.includes("/api/mesh/assign"));
          assert.equal(posted.length, 1, "exactly one assign POST left the app");
          assert.equal(
            posted[0].body?.nodeId,
            after.selectedNode,
            `the POST carries the node the row NAMED — got ${JSON.stringify(posted[0].body)}`,
          );

          const rows = await readAssignmentRows({ home }, workspaceId, "38");
          assert.equal(rows.length, 1, "the click minted exactly one record");
          assert.equal(rows[0].target_node_id, "zzz-second-node", "the REAL minted record targets the node the operator could read");
        });

        // NON-VACUITY: the departed node was still fully ASSIGN-ELIGIBLE at the
        // moment of the click — proven through the REAL route on a second item.
        // So a mis-dispatch to it would have returned a plausible `200 ok` and
        // minted, exactly as the live defect did; nothing about this lane's pass
        // is owed to a gate catching the wrong target.
        //
        // m43/ADR-003 — the probe's VEHICLE changed, its claim did not. "38/04" is not
        // a second item any more: the item lock is symmetric over the execution scope,
        // so the click's own record on "38" now holds "38/04" too. Node eligibility is
        // a `global_nodes` fact that a withdraw does not touch, so the scope is released
        // first and the probe then asks the same question of the same node.
        await settleAssignmentsFor({ home }, workspaceId, "38");
        const stillEligible = await sameOriginAssign(url, "38/04", "aaa-first-node", "OWN");
        assert.equal(
          stillEligible.status,
          200,
          "the node that LEFT THE PICKER is still accepted by the verb — the picker and the gate read different tables, which is what makes a stale target silent",
        );
      }, { nodes: ["aaa-first-node", "zzz-second-node"] });
    },
  },

  // ══ Scenario: the resulting `assigned` chip renders from the REAL minted record ══
  {
    name: "fleet-assign-affordance/03 the resulting assigned chip renders from the REAL minted record — the m35/story-03 read shape, closing the loop",
    async run() {
      await withPublishedAssignFixture(async ({ url }) => {
        const assignRes = await sameOriginAssign(url, "38/04", "worker-a", "OWN");
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
