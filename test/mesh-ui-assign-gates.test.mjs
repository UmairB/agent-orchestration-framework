// Traceability wiring for milestone 38 / story 04 / task 01 —
// tasks/01_assign-gates-hold-on-ui-path.feature (@executable).
//
// ARCHITECTURE 38/ADR-012 decision — "the UI path re-runs the verb's OWN gates
// … the route MUST surface the verb's structured { ok:false, code } as a coded
// HTTP error, never a 200, never a second success path around the gates."
// SECURITY T13 control (a) — refused IDENTICALLY to the CLI.
//
// @executable over the REAL route + the REAL store: every refused row asserts
// the store's assignment row-count is UNCHANGED (the gate ran BEFORE any mint)
// AND asserts the route's code EQUALS the code assignWork(ref, nodeId) returns
// for the SAME input called directly against the SAME (untouched) store —
// producer-fed PARITY, not a re-implemented refusal (STATE.md F1/F4).
import assert from "node:assert/strict";
import { loadWorkspace } from "../src/work.mjs";
import { assignWork } from "../src/commands/mesh-assign.mjs";
import { withAssignRouteFixture, sameOriginAssign, seedTargetNode, readAssignmentRows } from "./support/mesh-ui-assign-fixture.mjs";

async function directAssignCode({ root, globalStoreOptions }, ref, nodeId) {
  const workspace = await loadWorkspace(root, undefined, { env: globalStoreOptions.env });
  const result = await assignWork(workspace, ref, nodeId, { globalWorkStoreOptions: globalStoreOptions });
  return result;
}

export const meshUiAssignGatesTests = [
  // ══ Scenario Outline: a gate miss on the UI path is a coded non-200 that mints nothing — identically to the CLI ══
  {
    name: "mesh-ui-assign-gates/01 a gate miss on the UI path is a coded non-200 that mints nothing, matching assignWork's own code called directly against the SAME store",
    async run() {
      const rows = [
        {
          case: "unknown / unregistered",
          ref: "38/04",
          nodeId: "ghost",
          code: "assignment-target-unknown",
          seed: async ({ home, workspaceId }) => {
            // "ghost" is deliberately NOT seeded — no row in global_nodes.
            void home; void workspaceId;
          },
        },
        {
          case: "known node, not a member",
          ref: "38/04",
          nodeId: "worker-a",
          code: "assignment-repo-unavailable",
          seed: async ({ home, workspaceId }) => {
            await seedTargetNode({ home }, { nodeId: "worker-a", workspaceId, member: false, published: true });
          },
        },
        {
          case: "workspace never published",
          ref: "38/04",
          nodeId: "worker-a",
          code: "assignment-repo-unavailable",
          seed: async ({ home, workspaceId }) => {
            await seedTargetNode({ home }, { nodeId: "worker-a", workspaceId, member: true, published: false });
          },
        },
        {
          case: "typo'd / unresolvable ref",
          ref: "38/99",
          nodeId: "worker-a",
          code: "ref-not-found",
          seed: async ({ home, workspaceId }) => {
            await seedTargetNode({ home }, { nodeId: "worker-a", workspaceId, member: true, published: true });
          },
        },
      ];

      for (const row of rows) {
        await withAssignRouteFixture(async (fx) => {
          const { url, home, root, workspaceId, globalStoreOptions } = fx;
          await row.seed({ home, workspaceId });

          const res = await sameOriginAssign(url, row.ref, row.nodeId);
          assert.ok(res.status >= 400 && res.status < 500, `${row.case}: a coded non-200 (4xx), never a 200 — got ${res.status}`);
          const body = await res.json();
          assert.equal(body.code, row.code, `${row.case}: the response body code is "${row.code}"`);
          assert.notEqual(body.ok, true, `${row.case}: never a success envelope`);

          const minted = await readAssignmentRows({ home }, workspaceId, row.ref);
          assert.equal(minted.length, 0, `${row.case}: NO global_assignments row was minted for the item`);

          // producer-fed parity: assignWork(ref, nodeId) called DIRECTLY against
          // the SAME (still-untouched) store returns the SAME code.
          const direct = await directAssignCode({ root, globalStoreOptions }, row.ref, row.nodeId);
          assert.equal(direct.ok, false, `${row.case}: the direct verb call also refuses`);
          assert.equal(direct.code, row.code, `${row.case}: the direct verb call's code matches the route's code (refused identically to the CLI)`);
          assert.equal(body.code, direct.code, `${row.case}: the route's code EQUALS the direct verb's code`);
        });
      }
    },
  },

  // ══ Scenario: the single-runner uniqueness invariant holds on the UI path ══
  {
    name: "mesh-ui-assign-gates/01 the single-runner uniqueness invariant holds on the UI path — a second assign is refused, minting no second row, naming the current holder",
    async run() {
      await withAssignRouteFixture(async ({ url, home, workspaceId }) => {
        await seedTargetNode({ home }, { nodeId: "worker-a", workspaceId, member: true, published: true });

        const first = await sameOriginAssign(url, "38/04", "worker-a");
        assert.equal(first.status, 200, "the first assign mints the active assignment");

        const second = await sameOriginAssign(url, "38/04", "worker-a");
        assert.ok(second.status >= 400 && second.status < 500, "the second assign is refused (a coded non-200)");
        const secondBody = await second.json();
        assert.equal(secondBody.code, "assignment-already-active");
        assert.equal(secondBody.holder, "worker-a", "the refusal names the current holder, the verb's own field, surfaced faithfully");

        const rows = await readAssignmentRows({ home }, workspaceId, "38/04");
        assert.equal(rows.length, 1, "still EXACTLY ONE active assignment row exists for \"38/04\" — no second row was minted");
      });
    },
  },

  // ══ Scenario: the uniqueness invariant is the ITEM's, not the node's ══
  {
    name: "mesh-ui-assign-gates/01 the uniqueness invariant is the ITEM's, not the node's — a second assign to a DIFFERENT eligible node is refused too",
    async run() {
      await withAssignRouteFixture(async ({ url, home, workspaceId }) => {
        await seedTargetNode({ home }, { nodeId: "worker-a", workspaceId, member: true, published: true });
        await seedTargetNode({ home }, { nodeId: "worker-b", workspaceId, member: true, published: true });

        const first = await sameOriginAssign(url, "38/04", "worker-a");
        assert.equal(first.status, 200);

        const second = await sameOriginAssign(url, "38/04", "worker-b");
        assert.ok(second.status >= 400 && second.status < 500);
        const secondBody = await second.json();
        assert.equal(secondBody.code, "assignment-already-active");

        const rows = await readAssignmentRows({ home }, workspaceId, "38/04");
        assert.equal(rows.length, 1, "still EXACTLY ONE active assignment row exists for \"38/04\"");
        assert.equal(rows[0].target_node_id, "worker-a", "held by \"worker-a\" — the item already has a runner");
      });
    },
  },
];
