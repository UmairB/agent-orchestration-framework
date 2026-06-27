// Traceability wiring for milestone 18 / story 01, task 00 —
// tasks/00_projection-board-routing.feature (@executable, every scenario). One test
// object per @executable scenario; ADR-003/005.
//
// Drives the SAME path sync-work uses: resolveNotionRouting (story 00's resolver, over
// an on-disk .integrations.json descriptor) → projectMilestone (the pure projection,
// no Notion call, no fs beyond the descriptor read). The plan's dataSourceId is the
// CHOSEN board's; the sidecar passed in is read for THAT board's data-source; an absent
// descriptor ⇒ the default board and a plan byte-for-byte identical to the m17 flat-config
// plan (the no-regression invariant).
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveNotionRouting } from "../src/integrations/routing.mjs";
import { projectMilestone } from "../src/notion/projection.mjs";

const FULL_STATUS_MAP = {
  "not-started": "Not started",
  "in-progress": "In progress",
  "in-review": "In review",
  done: "Done",
};

// A board connection (m17 flat shape) with a distinct dataSourceId so the resolved
// board is identifiable. `statusMap`/`parents` overridable per scenario.
const board = (extra = {}) => ({
  dataSourceId: "ds-x",
  tokenEnv: "NOTION_API_TOKEN",
  statusProperty: "Status",
  statusMap: FULL_STATUS_MAP,
  relationProperty: "Sub-tasks",
  ...extra,
});

// The Background registry: boards "ops" and "growth", default "ops".
const REGISTRY = (extra = {}) => ({
  default: "ops",
  boards: {
    ops: board({ dataSourceId: "ds-ops" }),
    growth: board({ dataSourceId: "ds-growth" }),
    ...extra.boards,
  },
  ...extra.top,
});

// An equivalent FLAT m17 config (no boards key) — the implicit default board. Mirrors
// the "ops" board's shape so the no-regression deep-equal arm is meaningful: the flat
// block IS the default board's connection, just expressed in the m17 single-board shape.
const FLAT = board({ dataSourceId: "ds-ops" });

// The fixture milestone "18" + a story "18/00", milestone FIRST, each carrying its
// on-disk frontmatter as `meta`. Used as the projectMilestone `items` array.
function fixtureItems({ status18 = "in-progress", status1800 = "in-progress" } = {}) {
  return [
    { ref: "18", type: "milestone", slug: "demo", meta: { title: "Demo", status: status18 } },
    { ref: "18/00", type: "story", slug: "projection", meta: { title: "Story", status: status1800 } },
  ];
}

// A sidecar mapping for a given data-source's bucket (the readMapping return shape).
const mapping = (dataSourceId, entries = {}) => ({ dataSourceId, entries });

// Build an on-disk fixture milestone folder + an optional `.integrations.json`
// descriptor (undefined ⇒ no file), returning the resolver-shaped item + a cleanup.
async function makeItem(descriptor) {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-proj-routing-"));
  const dir = path.join(repo, "wiki", "work", "18_milestone_demo");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "SPEC.md"), "---\ntype: milestone\nnumber: 18\nslug: demo\n---\n", "utf8");
  if (descriptor !== undefined) {
    await writeFile(path.join(dir, ".integrations.json"), `${JSON.stringify(descriptor, null, 2)}\n`, "utf8");
  }
  const item = { type: "milestone", dir, ref: "18", parent: null };
  return { repo, item };
}

const opFor = (plan, ref) => plan.ops.find((o) => o.ref === ref);

// Resolve routing for the on-disk item, then project over the items + sidecar — the
// exact sync-work path (routing.board → config, routing.parentPageId/reason threaded).
function projectVia(routing, items, sidecar) {
  return projectMilestone({
    items,
    config: routing.board,
    mapping: sidecar ?? mapping(routing.board.dataSourceId),
    parentPageId: routing.parentPageId,
    reason: routing.reason,
  });
}

export const integrationsProjectionBoardRoutingTests = [
  {
    // Scenario: a milestone routed to a board produces a plan addressing that board
    name: "integrations-projection-board-routing/00 a milestone routed to a board produces a plan addressing that board",
    async run() {
      const { repo, item } = await makeItem({ notion: { board: "growth" } });
      try {
        const routing = resolveNotionRouting(item, REGISTRY());
        const plan = projectVia(routing, fixtureItems());
        assert.equal(plan.dataSourceId, "ds-growth", "the plan's dataSourceId is the growth board's dataSourceId");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: a milestone with no descriptor addresses the default board
    name: "integrations-projection-board-routing/00 a milestone with no descriptor addresses the default board",
    async run() {
      const { repo, item } = await makeItem(); // no .integrations.json
      try {
        const routing = resolveNotionRouting(item, REGISTRY());
        const plan = projectVia(routing, fixtureItems());
        assert.equal(plan.dataSourceId, "ds-ops", "the plan's dataSourceId is the default ops board's dataSourceId");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: an unrouted milestone and its stories project byte-for-byte as milestone 17
    name: "integrations-projection-board-routing/00 an unrouted milestone and its stories project byte-for-byte as m17",
    async run() {
      const { repo, item } = await makeItem(); // no descriptor
      try {
        const items = fixtureItems();
        // The boards-config path: resolve (default ops, no parent) then project.
        const routingDefault = resolveNotionRouting(item, REGISTRY());
        const planBoards = projectVia(routingDefault, items);
        // The equivalent flat m17 config path: resolve the flat block (implicit default
        // board) and project the SAME items/sidecar — the m17 op, no routing.
        const routingFlat = resolveNotionRouting(item, FLAT);
        const planFlat = projectVia(routingFlat, items);

        // The two SyncPlans are deep-equal — same dataSourceId, same ops in the same order.
        assert.deepEqual(planBoards, planFlat, "the boards-config plan equals the flat m17 plan byte-for-byte");
        // …and each op is identical in op/pageId/properties/reason (subsumed by deepEqual,
        // asserted explicitly for the traceability arms in the feature).
        assert.deepEqual(
          planBoards.ops.map((o) => o.ref),
          ["18", "18/00"],
          "the ops are in traversal order with the milestone first"
        );
        const m = opFor(planBoards, "18");
        assert.equal(m.relation, undefined, "the milestone op carries no parent relation");
        assert.equal(m.reason, undefined, "the milestone op records no reason (clean top-level)");
        const s = opFor(planBoards, "18/00");
        assert.equal(s.relation.property, "Sub-tasks", "every story op carries its §A3 self-relation property as under m17");
        assert.deepEqual(s, opFor(planFlat, "18/00"), "the story op is identical under both configs");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: the sidecar lookup for the plan is scoped to the routed board's data-source
    name: "integrations-projection-board-routing/00 the sidecar lookup is scoped to the routed board's data-source",
    async run() {
      const { repo, item } = await makeItem({ notion: { board: "growth" } });
      try {
        const routing = resolveNotionRouting(item, REGISTRY());
        // The sidecar holds a binding for "18" only under the OPS board's data-source —
        // readMapping for "ds-growth" returns an EMPTY bucket, so the projection sees no
        // page id for "18" (a routing bug that read ds-ops would wrongly reuse "page-ops").
        const growthSidecar = mapping("ds-growth", {}); // the ds-growth bucket is empty
        const plan = projectVia(routing, fixtureItems(), growthSidecar);
        const m = opFor(plan, "18");
        assert.equal(m.op, "create", 'the milestone op is "create" (no ds-growth binding)');
        assert.notEqual(m.pageId, "page-ops", 'the plan does not reuse the "ops"-scoped page id');
        assert.equal(m.pageId, null, "the create op has pageId null");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: a sidecar hit under the routed board still decides patch
    name: "integrations-projection-board-routing/00 a sidecar hit under the routed board still decides patch",
    async run() {
      const { repo, item } = await makeItem({ notion: { board: "growth" } });
      try {
        const routing = resolveNotionRouting(item, REGISTRY());
        // The ds-growth bucket binds "18" with a STALE lastStatus (≠ the mapped option)
        // so the decision is patch (a HIT under the routed board).
        const sidecar = mapping("ds-growth", {
          "18": { pageId: "page-growth", lastStatus: "Stale option", lastSyncedAt: null },
        });
        const plan = projectVia(routing, fixtureItems(), sidecar);
        const m = opFor(plan, "18");
        assert.equal(m.op, "patch", 'the milestone op is "patch"');
        assert.equal(m.pageId, "page-growth", 'the op\'s pageId is the "growth"-scoped page id');
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: a status unmapped on the routed board skips, naming the routed board's missing mapping
    name: "integrations-projection-board-routing/00 a status unmapped on the routed board skips, naming the routed board's missing mapping",
    async run() {
      // The growth board's statusMap OMITS "in-review"; ops maps it. The milestone's
      // on-disk status is "in-review" — mapped on the default ops board, ABSENT from the
      // routed growth board ⇒ skip (proving the ROUTED board's statusMap is consulted).
      const partialMap = { "not-started": "Not started", "in-progress": "In progress", done: "Done" };
      const registry = REGISTRY({
        boards: {
          ops: board({ dataSourceId: "ds-ops" }), // full map maps in-review
          growth: board({ dataSourceId: "ds-growth", statusMap: partialMap }),
        },
      });
      const { repo, item } = await makeItem({ notion: { board: "growth" } });
      try {
        const routing = resolveNotionRouting(item, registry);
        const plan = projectVia(routing, fixtureItems({ status18: "in-review" }));
        const m = opFor(plan, "18");
        assert.equal(m.op, "skip", 'the milestone op is "skip"');
        assert.equal(m.properties.statusOption, undefined, "the op carries no statusOption");
        assert.ok(m.reason && m.reason.includes("in-review"), "the reason names the missing status mapping on the routed board");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: a routed sidecar hit already at the mapped option decides noop
    name: "integrations-projection-board-routing/00 a routed sidecar hit already at the mapped option decides noop",
    async run() {
      const { repo, item } = await makeItem({ notion: { board: "growth" } });
      try {
        const routing = resolveNotionRouting(item, REGISTRY());
        // The ds-growth bucket binds "18" with lastStatus EQUAL to the growth-mapped
        // option for the on-disk status ("in-progress" → "In progress") ⇒ noop.
        const sidecar = mapping("ds-growth", {
          "18": { pageId: "page-growth", lastStatus: "In progress", lastSyncedAt: null },
        });
        const plan = projectVia(routing, fixtureItems({ status18: "in-progress" }), sidecar);
        assert.equal(opFor(plan, "18").op, "noop", 'the milestone op is "noop"');
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: projecting over a flat m17 config addresses the flat block's data-source
    name: "integrations-projection-board-routing/00 projecting over a flat m17 config addresses the flat block's data-source",
    async run() {
      const { repo, item } = await makeItem(); // no descriptor
      try {
        const routing = resolveNotionRouting(item, FLAT);
        const plan = projectVia(routing, fixtureItems());
        assert.equal(plan.dataSourceId, "ds-ops", "the plan's dataSourceId is the flat block's dataSourceId");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];
