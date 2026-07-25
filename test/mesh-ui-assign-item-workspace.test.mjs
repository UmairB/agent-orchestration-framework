// Traceability wiring for milestone 38 / story 04 / task 05 —
// tasks/05_assign-targets-the-items-own-workspace.feature (@executable).
//
// ⛔ BLOCKER F21, measured LIVE at the 2026-07-24 two-machine soak: the operator
// clicked "Homedata Live Property Data" (ref 18, let-shield-portal) and the mesh
// minted an assignment for ref 18 in the CONTROL's OWN aof workspace — an
// entirely different milestone — off a `200 ok`.
//
// ARCHITECTURE 38/ADR-012 AMENDMENT (2026-07-24), invariants 5 + 6: the wire is
// { ref, nodeId, workspaceId } with all three REQUIRED (blank/absent ⇒ coded
// `invalid-workspace`, NEVER a fallback), resolution runs through
// queryGlobalMeshStatus → status.workspaces[] → projectRoot
// (`workspace-not-found` / `workspace-not-local`), and the route ASSERTS the
// loaded workspace's OWN derived id equals the requested one BEFORE the mint
// (`workspace-id-mismatch`).
//
// EVERY lane here runs in a TWO-WORKSPACE fixture, because that is part of the
// contract and not an implementation detail: tasks 00–03 are honest producer-fed
// lanes over the REAL route, the REAL verb and the REAL store, and they could
// not see F21 — a single-workspace fixture makes the wrong answer and the right
// answer the SAME value. Both workspaces carry ref "18" (the soak's own
// collision) and BOTH have an eligible `worker-a`, so a mis-target returns a
// plausible 200 and mints, exactly as it did live.
import assert from "node:assert/strict";
import {
  withTwoWorkspaceAssignFixture,
  postAssign,
  sameOriginAssign,
  readAssignmentRows,
  countAllAssignmentRows,
} from "./support/mesh-ui-assign-fixture.mjs";
import { withFleetApp } from "./support/fleet-app-harness.mjs";

async function statusOf(url) {
  const response = await fetch(new URL("/api/mesh/status", url));
  assert.equal(response.status, 200, "GET /api/mesh/status answers");
  return response.json();
}

export const meshUiAssignItemWorkspaceTests = [
  // ══ Scenario: assigning a card that belongs to a NON-daemon workspace ══
  {
    name: "mesh-ui-assign-item-workspace/05 assigning a card that belongs to a NON-daemon workspace mints in THAT workspace, against THAT workspace's item",
    async run() {
      await withTwoWorkspaceAssignFixture(async ({ url, home, workspaceIdA, workspaceIdB }) => {
        const response = await sameOriginAssign(url, "18", "worker-a", workspaceIdB);
        const body = await response.json();
        assert.equal(response.status, 200, `assigning the FOREIGN workspace's item succeeds — got ${response.status} ${JSON.stringify(body)}`);

        const inB = await readAssignmentRows({ home }, workspaceIdB, "18");
        assert.equal(inB.length, 1, "EXACTLY ONE global_assignments row exists for (\"18\", B) when read back through the REAL store");
        assert.equal(inB[0].state, "assigned");
        assert.equal(inB[0].target_node_id, "worker-a");
        assert.equal(body.workspaceId, workspaceIdB, "the response carries the id the operator clicked — which is the id the VERB stamped");
        assert.equal(
          (await readAssignmentRows({ home }, workspaceIdA, "18")).length,
          0,
          "nothing landed in the server's own workspace",
        );
      });
    },
  },

  // ══ Scenario: the ref COLLISION reproduced verbatim from the soak ══
  {
    name: "mesh-ui-assign-item-workspace/05 the soak's ref COLLISION — the mint lands on the clicked card and the daemon's own identically-refed milestone is untouched",
    async run() {
      await withTwoWorkspaceAssignFixture(async ({ url, home, workspaceIdA, workspaceIdB, titles }) => {
        // The precondition that makes this meaningful: ref "18" resolves to a
        // DIFFERENT milestone in each workspace, read from the REAL projection.
        const before = await statusOf(url);
        const itemA = before.items.find((item) => item.ref === "18" && item.workspaceId === workspaceIdA);
        const itemB = before.items.find((item) => item.ref === "18" && item.workspaceId === workspaceIdB);
        assert.equal(itemA?.title, titles.A, "the daemon's own ref 18 is a different milestone");
        assert.equal(itemB?.title, titles.B, "the clicked ref 18 is the portal's milestone");

        const response = await sameOriginAssign(url, "18", "worker-a", workspaceIdB);
        assert.equal(response.status, 200);

        assert.equal((await readAssignmentRows({ home }, workspaceIdB, "18")).length, 1, "EXACTLY ONE row for (\"18\", B)");
        assert.equal(
          (await readAssignmentRows({ home }, workspaceIdA, "18")).length,
          0,
          "F21: ZERO rows for (\"18\", A) — the daemon's own colliding ref is a COMPLETELY DIFFERENT milestone and must never be dispatched",
        );

        // The assigned item, resolved through the REAL projection's own join, is
        // the one the operator clicked — the assertion the live soak failed.
        const after = await statusOf(url);
        const assigned = after.items.filter((item) => item.assignment != null);
        assert.equal(assigned.length, 1, "exactly one item in the whole GLOBAL projection carries an assignment");
        assert.equal(assigned[0].title, titles.B, `the assignment hangs off "${titles.B}", not "${titles.A}"`);
        assert.equal(assigned[0].workspaceId, workspaceIdB);
      });
    },
  },

  // ══ Scenario: the daemon's OWN workspace still assigns ══
  {
    name: "mesh-ui-assign-item-workspace/05 assigning the daemon's OWN workspace still works — the fix targets the ITEM's workspace, it does not forbid the local one",
    async run() {
      await withTwoWorkspaceAssignFixture(async ({ url, home, workspaceIdA, workspaceIdB }) => {
        const response = await sameOriginAssign(url, "18", "worker-a", workspaceIdA);
        assert.equal(response.status, 200, "the daemon's own workspace is a legitimate target like any other");

        assert.equal((await readAssignmentRows({ home }, workspaceIdA, "18")).length, 1, "EXACTLY ONE row for (\"18\", A)");
        assert.equal((await readAssignmentRows({ home }, workspaceIdB, "18")).length, 0, "ZERO rows for (\"18\", B)");
      });
    },
  },

  // ══ Scenario Outline: every refusal is CODED, names its own cause, mints NOTHING ══
  {
    name: "mesh-ui-assign-item-workspace/05 every workspace-resolution refusal is coded, is never a 200, and mints NOTHING anywhere — no fallback on any leg",
    async run() {
      const rows = [
        { case: "no workspaceId field at all (the stale, pre-amendment client)", status: 400, code: "invalid-workspace", pick: () => ({ workspaceId: null }) },
        { case: "workspaceId: \"\" (blank)", status: 400, code: "invalid-workspace", pick: () => ({ workspaceId: "" }) },
        { case: "workspaceId not in the projection", status: 404, code: "workspace-not-found", pick: () => ({ workspaceId: "0000000000000000" }) },
        { case: "workspaceId whose checkout was DELETED from this machine", status: 409, code: "workspace-not-local", pick: (fx) => ({ workspaceId: fx.workspaceIdGone }) },
      ];

      for (const row of rows) {
        await withTwoWorkspaceAssignFixture(async (fx) => {
          const { url, home, workspaceIdA, workspaceIdB } = fx;
          const totalBefore = await countAllAssignmentRows({ home });

          const response = await postAssign(url, { ref: "18", nodeId: "worker-a", origin: "SAME", ...row.pick(fx) });
          assert.notEqual(response.status, 200, `${row.case}: never a 200`);
          const body = await response.json();
          assert.equal(response.status, row.status, `${row.case}: status ${row.status} — got ${response.status} ${JSON.stringify(body)}`);
          assert.equal(body.code, row.code, `${row.case}: the body code is "${row.code}"`);
          assert.notEqual(body.ok, true, `${row.case}: never an ok:true envelope`);

          assert.equal(
            (await readAssignmentRows({ home }, workspaceIdA, "18")).length,
            0,
            `${row.case}: NOTHING minted in the daemon's own workspace — the fallback IS the defect`,
          );
          assert.equal((await readAssignmentRows({ home }, workspaceIdB, "18")).length, 0, `${row.case}: nothing minted in B either`);
          assert.equal(
            await countAllAssignmentRows({ home }),
            totalBefore,
            `${row.case}: the TOTAL global_assignments row count is unchanged — nothing landed anywhere, including where nobody was looking`,
          );
        });
      }
    },
  },

  // ══ Scenario: a non-local project root names its OWN cause ══
  {
    name: "mesh-ui-assign-item-workspace/05 a project root that is not on THIS machine names its own cause — workspace-not-local, never a misleading ref-not-found",
    async run() {
      await withTwoWorkspaceAssignFixture(async ({ url, workspaceIdGone }) => {
        const response = await sameOriginAssign(url, "18", "worker-a", workspaceIdGone);
        const body = await response.json();
        assert.notEqual(
          body.code,
          "ref-not-found",
          "loadWorkspace degrades a missing config to an empty one and findWork then resolves nothing — an unchecked route reports a typo'd ref for \"that repo is not on this machine\"",
        );
        assert.equal(response.status, 409, `a project root absent on this machine is a 409 — got ${response.status} ${JSON.stringify(body)}`);
        assert.equal(body.code, "workspace-not-local");
      });
    },
  },

  // ══ Scenario: the mint's target is ASSERTED pre-mint ══
  {
    name: "mesh-ui-assign-item-workspace/05 the mint's target is asserted PRE-mint — a resolved workspace whose own config claims a DIFFERENT id refuses workspace-id-mismatch, minting nothing under EITHER id",
    async run() {
      await withTwoWorkspaceAssignFixture(async ({ url, home, workspaceIdRekeyed, rekeyedAs }) => {
        const totalBefore = await countAllAssignmentRows({ home });

        const response = await sameOriginAssign(url, "18", "worker-a", workspaceIdRekeyed);
        const body = await response.json();
        assert.equal(response.status, 409, `a re-keyed checkout is a 409 — got ${response.status} ${JSON.stringify(body)}`);
        assert.equal(body.code, "workspace-id-mismatch");

        // assignWork DERIVES the id it stamps from the workspace OBJECT it is
        // handed, so an un-asserted route here would have minted under the
        // OVERRIDE id while the operator clicked the projection's id — F21's
        // exact shape, one level down.
        assert.equal((await readAssignmentRows({ home }, workspaceIdRekeyed, "18")).length, 0, "nothing minted under the REQUESTED id");
        assert.equal((await readAssignmentRows({ home }, rekeyedAs, "18")).length, 0, "nothing minted under the workspace's OWN (override) id either");
        assert.equal(await countAllAssignmentRows({ home }), totalBefore, "the total row count is unchanged — the assertion ran BEFORE the mint, not after");
      });
    },
  },

  // ══ Scenario: the REAL built UI puts the item's own workspaceId on the wire ══
  {
    name: "mesh-ui-assign-item-workspace/05 the REAL production <Fleet/> puts the ITEM's own workspaceId on the wire — clicking the portal's card mints in the PORTAL's workspace, never the daemon's",
    async run() {
      await withTwoWorkspaceAssignFixture(async ({ url, home, workspaceIdA, workspaceIdB, titles }) => {
        await withFleetApp({ url }, async (app) => {
          // More than one candidate target is on screen — the configuration the
          // defect needed, and the operator's own experience.
          const cards = app.cards();
          assert.ok(cards.length >= 2, `the GLOBAL face renders cards from several workspaces — got ${cards.length}`);

          const clicked = app.cardByTitle(titles.B);
          assert.ok(clicked, `the card for "${titles.B}" renders with an affordance`);
          assert.deepEqual(clicked.options, ["worker-a"], "the picker is producer-fed from the REAL roster");

          await clicked.click();

          // What the app ACTUALLY sent — read off the real request the real
          // api.ts issued, not off a hand-built body. REVIEW FIX (QA, 2026-07-24):
          // the scenario says "the POST the app actually sent carries
          // workspaceId <B>", and this lane used to only COUNT the posts and then
          // assert the store — a store row cannot say whether the CLIENT or the
          // ROUTE chose the workspace.
          const posts = app.requests().filter((entry) => entry.url.includes("/api/mesh/assign"));
          assert.equal(posts.length, 1, "exactly one assign POST left the app");
          assert.equal(
            posts[0].body?.workspaceId,
            workspaceIdB,
            `the POST the app actually SENT carries the item's own workspaceId — the same datum the drill-in beside it passes to boardUrl. Got ${JSON.stringify(posts[0].body)}`,
          );
          assert.equal(posts[0].body?.ref, "18", "…with the clicked card's ref");

          assert.equal(
            (await readAssignmentRows({ home }, workspaceIdB, "18")).length,
            1,
            "EXACTLY ONE row for (\"18\", B) — the workspace of the card the operator clicked",
          );
          assert.equal(
            (await readAssignmentRows({ home }, workspaceIdA, "18")).length,
            0,
            "ZERO rows for (\"18\", A) — the daemon's own colliding milestone was never dispatched",
          );
        });
      });
    },
  },

  // ══ QA-e — the item's uniqueness gate is PER-WORKSPACE ══
  //
  // REVIEW FIX QA-e (2026-07-24): `findActiveAssignment` keys on
  // (workspace_id, item_ref) (src/assignment-record.mjs), and on a GLOBAL face
  // two cards legitimately carry ref "18". Nothing pinned that, so a future
  // "fix" that globalised the gate — keyed it on item_ref alone — would make the
  // SECOND card silently un-assignable ("already active, held by worker-a") with
  // the whole F21 fixture still green: the mis-target lanes only ever assign ONE
  // of the two colliding cards.
  {
    name: "mesh-ui-assign-item-workspace/05 the single-runner gate is keyed PER WORKSPACE — both colliding `18` cards assign cleanly, and only a REPEAT of the same (workspace, ref) is refused",
    async run() {
      await withTwoWorkspaceAssignFixture(async ({ url, home, workspaceIdA, workspaceIdB }) => {
        const first = await sameOriginAssign(url, "18", "worker-a", workspaceIdB);
        assert.equal(first.status, 200, "the portal's ref 18 assigns");

        // The daemon's own ref 18 is a DIFFERENT item that happens to share a
        // ref — it must remain assignable while B's assignment is active.
        const second = await sameOriginAssign(url, "18", "worker-a", workspaceIdA);
        const secondBody = await second.json();
        assert.equal(
          second.status,
          200,
          `the OTHER workspace's identically-refed milestone is a different item and stays assignable — got ${second.status} ${JSON.stringify(secondBody)}`,
        );
        assert.notEqual(secondBody.code, "assignment-already-active", "a colliding ref in another workspace is NOT the same item — the gate is (workspace_id, item_ref), never item_ref alone");

        assert.equal((await readAssignmentRows({ home }, workspaceIdB, "18")).length, 1, "one active record for (\"18\", B)");
        assert.equal((await readAssignmentRows({ home }, workspaceIdA, "18")).length, 1, "one active record for (\"18\", A)");

        // …and the gate still bites where it must: the SAME (workspace, ref).
        const repeat = await sameOriginAssign(url, "18", "worker-a", workspaceIdB);
        const repeatBody = await repeat.json();
        assert.ok(repeat.status >= 400 && repeat.status < 500, `a repeat of the SAME (workspace, ref) is refused — got ${repeat.status} ${JSON.stringify(repeatBody)}`);
        assert.equal(repeatBody.code, "assignment-already-active");
        assert.equal((await readAssignmentRows({ home }, workspaceIdB, "18")).length, 1, "still exactly one row for (\"18\", B) — the refusal minted nothing");
      });
    },
  },

  // ══ the stale-client refusal, at the ROUTE ══
  {
    name: "mesh-ui-assign-item-workspace/05 a stale client that omits workspaceId fails LOUDLY at the route — a coded 400 naming the missing field, minting nothing in EITHER workspace",
    // REVIEW FIX (QA, 2026-07-24) — RENAMED to what it is. It was called "…a
    // coded 400 the affordance surfaces INLINE" but never mounted the
    // affordance: it is a pure route probe, and the real client cannot be made
    // to omit the field (that is the point of the fix). The app-level "a coded
    // refusal surfaces inline in the `destructive` token" leg is task 06's, driven
    // through the REAL mounted <Fleet/> against a REAL verb refusal
    // (test/fleet-assign-acknowledgment.test.mjs).
    async run() {
      await withTwoWorkspaceAssignFixture(async ({ url, home, workspaceIdA, workspaceIdB }) => {
        const response = await postAssign(url, { ref: "18", nodeId: "worker-a", workspaceId: null, origin: "SAME" });
        assert.equal(response.status, 400);
        const body = await response.json();
        assert.equal(body.code, "invalid-workspace");
        // The blast radius of REQUIRED is deliberate: the message must name the
        // missing field so a stale client's failure is diagnosable.
        assert.match(String(body.error ?? ""), /workspaceId/, "the refusal names the field it is missing");
        assert.equal((await readAssignmentRows({ home }, workspaceIdA, "18")).length, 0);
        assert.equal((await readAssignmentRows({ home }, workspaceIdB, "18")).length, 0);
      });
    },
  },
];
