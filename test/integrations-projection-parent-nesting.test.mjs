// Traceability wiring for milestone 18 / story 01, task 01 —
// tasks/01_projection-parent-nesting.feature (@executable, every scenario). One test
// object per @executable scenario; ADR-001/003/005/006.
//
// Drives the SAME path sync-work uses: resolveNotionRouting (story 00's resolver, over
// an on-disk .integrations.json descriptor) → projectMilestone. A resolved parent ⇒ a
// relation to that page id through the board's relationProperty (the SAME property a
// story uses); a raw page-id ⇒ verbatim; an absent/unresolvable parent ⇒ no relation +
// the resolver's honest reason (top-level, never a fabricated id); stories keep the §A3
// self-relation read from the ROUTED board's sidecar bucket; a milestone that is BOTH
// unmapped-status AND unresolvable-parent reports BOTH reasons.
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

// The Background: a board "ops" whose relationProperty is "Sub-tasks" and whose parents
// bind "p1" → "page-P1"; the default board is "ops".
const board = (extra = {}) => ({
  dataSourceId: "ds-ops",
  tokenEnv: "NOTION_API_TOKEN",
  statusProperty: "Status",
  statusMap: FULL_STATUS_MAP,
  relationProperty: "Sub-tasks",
  parents: { p1: "page-P1" },
  ...extra,
});

const REGISTRY = (opsExtra = {}) => ({
  default: "ops",
  boards: { ops: board(opsExtra) },
});

// The fixture milestone "18" + a story "18/00", milestone FIRST.
function fixtureItems({ status18 = "in-progress" } = {}) {
  return [
    { ref: "18", type: "milestone", slug: "demo", meta: { title: "Demo", status: status18 } },
    { ref: "18/00", type: "story", slug: "projection", meta: { title: "Story", status: "in-progress" } },
  ];
}

const mapping = (dataSourceId, entries = {}) => ({ dataSourceId, entries });

// Build an on-disk fixture milestone folder + a `.integrations.json` descriptor.
async function makeItem(descriptor) {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-proj-parent-"));
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

function projectVia(routing, items, sidecar) {
  return projectMilestone({
    items,
    config: routing.board,
    mapping: sidecar ?? mapping(routing.board.dataSourceId),
    parentPageId: routing.parentPageId,
    reason: routing.reason,
  });
}

export const integrationsProjectionParentNestingTests = [
  {
    // Scenario: a milestone with a resolved parent carries a relation to the parent page id
    name: "integrations-projection-parent-nesting/01 a milestone with a resolved parent key carries a relation to the parent page id",
    async run() {
      const { repo, item } = await makeItem({ notion: { board: "ops", parent: "p1" } });
      try {
        const routing = resolveNotionRouting(item, REGISTRY());
        const m = opFor(projectVia(routing, fixtureItems()), "18");
        assert.equal(m.relation.property, "Sub-tasks", 'the relation is through "Sub-tasks"');
        assert.equal(m.relation.parentPageId, "page-P1", 'the relation parent is "page-P1"');
        assert.deepEqual(m.properties.relation, m.relation, "properties.relation carries the same relation");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: a raw page-id parent nests the milestone under that page verbatim
    name: "integrations-projection-parent-nesting/01 a raw page-id parent nests the milestone under that page verbatim",
    async run() {
      const RAW = "11112222333344445555666677778888";
      const { repo, item } = await makeItem({ notion: { board: "ops", parent: RAW } });
      try {
        const routing = resolveNotionRouting(item, REGISTRY());
        const m = opFor(projectVia(routing, fixtureItems()), "18");
        assert.equal(m.relation.property, "Sub-tasks", 'the relation is through "Sub-tasks"');
        assert.equal(m.relation.parentPageId, RAW, "the raw page-id is the relation parent verbatim");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: an unresolvable parent key projects top-level carrying the resolver's reason
    name: "integrations-projection-parent-nesting/01 an unresolvable parent key projects top-level carrying the resolver's reason",
    async run() {
      const { repo, item } = await makeItem({ notion: { board: "ops", parent: "ghost" } });
      try {
        const routing = resolveNotionRouting(item, REGISTRY());
        const m = opFor(projectVia(routing, fixtureItems()), "18");
        assert.equal(m.relation, undefined, "the milestone op carries no parent relation");
        assert.equal(m.properties.relation, undefined, "no fabricated relation in properties");
        assert.ok(m.reason && m.reason.includes("ghost"), "the op carries the resolver's reason naming the unresolvable parent key");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: a milestone with a board but no parent projects top-level with no reason
    name: "integrations-projection-parent-nesting/01 a milestone with a board but no parent projects top-level with no reason",
    async run() {
      const { repo, item } = await makeItem({ notion: { board: "ops" } });
      try {
        const routing = resolveNotionRouting(item, REGISTRY());
        const m = opFor(projectVia(routing, fixtureItems()), "18");
        assert.equal(m.relation, undefined, "the milestone op carries no parent relation");
        assert.equal(m.reason, undefined, "the milestone op records no reason");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: a story's self-relation parent is read from the routed board's sidecar bucket
    name: "integrations-projection-parent-nesting/01 a story's self-relation parent is read from the routed board's sidecar bucket",
    async run() {
      const { repo, item } = await makeItem({ notion: { board: "ops", parent: "p1" } });
      try {
        const routing = resolveNotionRouting(item, REGISTRY());
        // The sidecar passed in is the ROUTED board's bucket (ds-ops), holding "18" →
        // "page-M". A DIFFERENT id lives under ds-growth in the file, but readMapping for
        // ds-ops only ever exposes the ds-ops bucket — so the story relates to "page-M",
        // not the other board's id. (Here the sidecar IS the ds-ops bucket directly.)
        const sidecar = mapping("ds-ops", {
          "18": { pageId: "page-M", lastStatus: "Stale", lastSyncedAt: null },
        });
        const plan = projectVia(routing, fixtureItems(), sidecar);
        const s = opFor(plan, "18/00");
        assert.equal(s.relation.property, "Sub-tasks", 'the story relation is through "Sub-tasks"');
        assert.equal(s.relation.parentPageId, "page-M", 'the story relates to the ds-ops-scoped milestone page id "page-M"');
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    // Scenario: a milestone both unmapped-status and unresolvable-parent reports both reasons
    name: "integrations-projection-parent-nesting/01 a milestone both unmapped-status and unresolvable-parent reports both reasons",
    async run() {
      // The ops board's statusMap OMITS the milestone's on-disk status ("in-review")
      // AND the parent key "ghost" is absent from its parents map ⇒ skip with BOTH reasons.
      const partialMap = { "not-started": "Not started", "in-progress": "In progress", done: "Done" };
      const { repo, item } = await makeItem({ notion: { board: "ops", parent: "ghost" } });
      try {
        const routing = resolveNotionRouting(item, REGISTRY({ statusMap: partialMap }));
        const m = opFor(projectVia(routing, fixtureItems({ status18: "in-review" })), "18");
        assert.equal(m.op, "skip", 'the milestone op is "skip"');
        assert.ok(m.reason.includes("in-review"), "the reason names the missing status mapping");
        assert.ok(m.reason.includes("ghost"), "the reason names the unresolvable parent key");
        assert.equal(m.relation, undefined, "the milestone op carries no parent relation");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];
