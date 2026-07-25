// Traceability wiring for milestone 38 / story 04 / task 00 —
// tasks/00_fleet-face-assign-route.feature (@executable).
//
// ARCHITECTURE 38/ADR-012 — the read-only fleet face gains its FIRST live write
// route: POST /api/mesh/assign wraps assignWork(workspace, ref, nodeId, ctx)
// VERBATIM, minting the real global_assignments `assigned` record through NO
// other path. ADR-008's producer-fed conformance: every mint is proven by
// reading the row BACK from the REAL store (readAssignmentRows) — never
// asserted from the response body alone (STATE.md F1/F4 — "wiring is not a
// contract").
//
// Driven over the REAL serveMeshUi (test/support/mesh-ui-assign-fixture.mjs) —
// a loopback server over an isolated AOF_GLOBAL_HOME v3 projection + a
// resolvable "38/04" work item. No CLI is spawned (that is task 04's @manual
// soak).
import assert from "node:assert/strict";
import { withAssignRouteFixture, sameOriginAssign, postAssign, seedTargetNode, readAssignmentRows } from "./support/mesh-ui-assign-fixture.mjs";

export const meshUiAssignRouteTests = [
  // ══ Scenario: a same-origin POST /api/mesh/assign wraps assignWork and mints the real assigned record ══
  {
    name: "mesh-ui-assign-route/00 a same-origin POST /api/mesh/assign wraps assignWork and mints the real assigned record, read back through the REAL store",
    async run() {
      await withAssignRouteFixture(async ({ url, home, workspaceId }) => {
        await seedTargetNode({ home }, { nodeId: "worker-a", workspaceId, member: true, published: true });

        const res = await sameOriginAssign(url, "38/04", "worker-a", "OWN");
        assert.equal(res.status, 200, "the same-origin json request passes the guard and reaches the verb");

        const rows = await readAssignmentRows({ home }, workspaceId, "38/04");
        assert.equal(rows.length, 1, "EXACTLY one active assignment row exists for the item — the verb minted it, not a route-built record");
        assert.equal(rows[0].state, "assigned", "the minted row's state is \"assigned\"");
        assert.equal(rows[0].target_node_id, "worker-a", "the minted row's target_node_id is \"worker-a\"");
      });
    },
  },

  // ══ Scenario: the mint carries the verb's assembled shape, not the request body — assignWork is wrapped, not re-implemented ══
  {
    name: "mesh-ui-assign-route/00 the mint carries the verb's assembled shape, not the request body — a forged state/assignmentId/issuer rides no further than the route",
    async run() {
      await withAssignRouteFixture(async ({ url, home, workspaceId }) => {
        await seedTargetNode({ home }, { nodeId: "worker-a", workspaceId, member: true, published: true });

        const res = await postAssign(url, {
          origin: "SAME",
          contentType: "application/json",
          // The wire's THREE required fields (ADR-012 AMENDMENT) plus the forged
          // extras — every one of which must ride no further than this route.
          rawBody: JSON.stringify({ ref: "38/04", nodeId: "worker-a", workspaceId, state: "done", assignmentId: "forged-1", issuer: "attacker" }),
        });
        assert.equal(res.status, 200);

        const rows = await readAssignmentRows({ home }, workspaceId, "38/04");
        assert.equal(rows.length, 1);
        assert.equal(rows[0].state, "assigned", "the verb's assembled state, NOT the body's \"done\"");
        assert.notEqual(rows[0].assignment_id, "forged-1", "the verb's own minted id, NOT the body's \"forged-1\"");
        assert.equal(rows[0].issuer, "control-a", "the control node's own nodeId, NOT the body's \"attacker\"");
      });
    },
  },

  // ══ Scenario Outline: the posted nodeId is the verb's assign target — it rides through, never a default or an override ══
  {
    name: "mesh-ui-assign-route/00 the posted nodeId rides through verbatim as the minted target_node_id (worker-a / worker-b)",
    async run() {
      for (const nodeId of ["worker-a", "worker-b"]) {
        await withAssignRouteFixture(async ({ url, home, workspaceId }) => {
          await seedTargetNode({ home }, { nodeId: "worker-a", workspaceId, member: true, published: true });
          await seedTargetNode({ home }, { nodeId: "worker-b", workspaceId, member: true, published: true });

          const res = await sameOriginAssign(url, "38/04", nodeId, "OWN");
          assert.equal(res.status, 200, `assigning to "${nodeId}" succeeds`);

          const rows = await readAssignmentRows({ home }, workspaceId, "38/04");
          assert.equal(rows.length, 1);
          assert.equal(rows[0].target_node_id, nodeId, `the minted row targets "${nodeId}" when read back through the REAL store`);
        });
      }
    },
  },

  // ══ Scenario Outline: POST /api/mesh/assign is the ONLY mutation route — every other path/method stays a clean 405/404 ══
  {
    name: "mesh-ui-assign-route/00 POST /api/mesh/assign is the ONLY mutation route — every other path/method stays a clean 405/404, minting nothing",
    async run() {
      const rows = [
        { method: "POST", path: "/api/mesh/status", status: 405, code: "method-not-allowed", allow: "GET, HEAD" },
        { method: "POST", path: "/api/mesh/board-url", status: 405, code: "method-not-allowed", allow: "GET, HEAD" },
        { method: "PUT", path: "/api/mesh/assign", status: 405, code: "method-not-allowed", allow: "POST" },
        { method: "DELETE", path: "/api/mesh/assign", status: 405, code: "method-not-allowed", allow: "POST" },
        { method: "GET", path: "/api/mesh/assign", status: 405, code: "method-not-allowed", allow: "POST" },
        { method: "POST", path: "/api/mesh/revoke", status: 404, code: "not-found", allow: null },
        { method: "POST", path: "/api/mesh/issue", status: 404, code: "not-found", allow: null },
      ];
      await withAssignRouteFixture(async ({ url, home, workspaceId }) => {
        for (const row of rows) {
          const res = await fetch(new URL(row.path, url), {
            method: row.method,
            headers: { origin: new URL(url).origin, "content-type": "application/json" },
          });
          assert.equal(res.status, row.status, `${row.method} ${row.path} is ${row.status}`);
          const body = await res.json();
          assert.equal(body.code, row.code, `${row.method} ${row.path} carries code "${row.code}"`);
          if (row.status === 405) {
            assert.equal(res.headers.get("allow"), row.allow, `${row.method} ${row.path} carries Allow: ${row.allow}`);
          }
          assert.notEqual(body.ok, true, `${row.method} ${row.path} did not succeed`);
        }
        const rowsAfter = await readAssignmentRows({ home }, workspaceId, "38/04");
        assert.equal(rowsAfter.length, 0, "the store row-count is unchanged — nothing minted for any item, and the face did not crash");
        const survive = await fetch(new URL("/api/mesh/status", url));
        assert.equal(survive.status, 200, "the face survived every row — a follow-up GET still answers");
      });
    },
  },
];
