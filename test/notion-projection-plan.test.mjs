// Traceability wiring for milestone 17 / story 01 — the PURE projection
// (00_projection-plan.feature, @executable; ADR-003). One test object per
// @executable scenario / Scenario-Outline row.
//
// projectMilestone({ items, config, mapping }) is pure — no Notion call, no fs — so
// these run fully in-process over a fixture milestone + a directly-constructed
// sidecar mapping ({ dataSourceId, entries }, the shape readMapping returns).
import assert from "node:assert/strict";
import { projectMilestone } from "../src/notion/projection.mjs";

const DATA_SOURCE_ID = "ds-fixture";

// A complete statusMap (all four aof statuses → board option names).
const FULL_STATUS_MAP = {
  "not-started": "Not started",
  "in-progress": "In progress",
  "in-review": "In review",
  done: "Done",
};

const CONFIG = {
  dataSourceId: DATA_SOURCE_ID,
  tokenEnv: "NOTION_API_TOKEN",
  statusProperty: "Status",
  statusMap: FULL_STATUS_MAP,
  relationProperty: "Sub-tasks",
};

// The fixture milestone "17" + stories "17/01" and "17/02", in traversal order
// (milestone FIRST), each carrying its on-disk frontmatter as `meta`.
function fixtureItems({ status17 = "in-progress", status0101 = "in-progress", status0102 = "done" } = {}) {
  return [
    { ref: "17", type: "milestone", slug: "notion-work-sync", meta: { title: "Notion Work-Board Sync", status: status17 } },
    { ref: "17/01", type: "story", slug: "projection", meta: { title: "Projection story", status: status0101 } },
    { ref: "17/02", type: "story", slug: "apply", meta: { title: "Apply story", status: status0102 } },
  ];
}

// A sidecar mapping with the given per-ref entries (the readMapping return shape).
function mapping(entries = {}) {
  return { version: 1, dataSourceId: DATA_SOURCE_ID, entries };
}

const opFor = (plan, ref) => plan.ops.find((o) => o.ref === ref);

export const notionProjectionPlanTests = [
  {
    // Scenario: the plan is addressed by the configured data_source_id with ops in traversal order
    name: "notion-projection/plan/00 the plan is addressed by data_source_id with ops in traversal order",
    async run() {
      const plan = projectMilestone({ items: fixtureItems(), config: CONFIG, mapping: mapping() });
      assert.equal(plan.dataSourceId, DATA_SOURCE_ID, "the SyncPlan dataSourceId equals the configured data_source_id");
      assert.deepEqual(
        plan.ops.map((o) => o.ref),
        ["17", "17/01", "17/02"],
        "the plan's ops are in traversal order: milestone 17 first, then 17/01, then 17/02"
      );
    },
  },
  {
    // Scenario: the milestone op carries its title and the statusMap'd board option name
    name: "notion-projection/plan/01 the milestone op carries its title and the statusMap'd board option",
    async run() {
      const items = fixtureItems({ status17: "in-progress" });
      const plan = projectMilestone({ items, config: CONFIG, mapping: mapping() });
      const op = opFor(plan, "17");
      assert.equal(op.properties.title, "Notion Work-Board Sync", "properties.title equals the milestone's on-disk title");
      assert.equal(
        op.properties.statusOption,
        FULL_STATUS_MAP["in-progress"],
        "properties.statusOption equals the board option statusMap assigns its status"
      );
    },
  },
  {
    // Scenario: a story op carries a self-relation to the milestone page id in the same data-source
    name: "notion-projection/plan/02 a story op carries a self-relation to the milestone page id (same data-source)",
    async run() {
      const items = fixtureItems();
      const plan = projectMilestone({
        items,
        config: CONFIG,
        mapping: mapping({ "17": { pageId: "page-M", lastStatus: null, lastSyncedAt: null } }),
      });
      const story = opFor(plan, "17/01");
      assert.equal(story.relation.property, CONFIG.relationProperty, "relation.property equals the configured relationProperty");
      assert.equal(story.relation.parentPageId, "page-M", 'relation.parentPageId equals "page-M"');
      assert.equal(plan.dataSourceId, DATA_SOURCE_ID, "the story op is addressed in the same dataSourceId as the milestone op");
    },
  },
  {
    // Scenario: an item with no sidecar page id is a create op; a sidecar HIT is a patch op
    name: "notion-projection/plan/03 no sidecar page id is a create; a sidecar HIT is a patch",
    async run() {
      const items = fixtureItems();
      const plan = projectMilestone({
        items,
        config: CONFIG,
        // "17" has a page id (with a DIFFERING lastStatus so it patches, not noops);
        // "17/01" has nothing.
        mapping: mapping({ "17": { pageId: "page-M", lastStatus: "Stale option", lastSyncedAt: null } }),
      });
      const m = opFor(plan, "17");
      const s = opFor(plan, "17/01");
      assert.equal(m.op, "patch", 'the op for "17" is "patch"');
      assert.equal(m.pageId, "page-M", 'the op for "17" has pageId "page-M"');
      assert.equal(s.op, "create", 'the op for "17/01" is "create"');
      assert.equal(s.pageId, null, 'the op for "17/01" has pageId null');
    },
  },
  {
    // Scenario Outline: the op is decided from the sidecar lookup and the local status match alone
    name: "notion-projection/plan/04 the op is decided from the sidecar lookup + local status match (outline rows)",
    async run() {
      // The on-disk status of "17/01" used by every row. "maps" rows use in-progress
      // (a status the FULL map covers); "omits" rows use a status omitted from a
      // PARTIAL map so no entry exists.
      const partialMap = { "not-started": "Not started", "in-progress": "In progress", done: "Done" };
      const mappedOption = FULL_STATUS_MAP["in-progress"];

      const rows = [
        // | sidecar        | lastStatus | mapped | op     |
        { sidecar: "none", lastStatus: null, mapped: "maps", expected: "create" },
        { sidecar: "id", lastStatus: "differs", mapped: "maps", expected: "patch" },
        { sidecar: "id", lastStatus: "equals", mapped: "maps", expected: "noop" },
        { sidecar: "none", lastStatus: null, mapped: "omits", expected: "skip" },
        { sidecar: "id", lastStatus: "differs", mapped: "omits", expected: "skip" },
      ];

      for (const row of rows) {
        const config = row.mapped === "maps" ? CONFIG : { ...CONFIG, statusMap: partialMap };
        // The aof status of "17/01": in-progress for "maps", in-review for "omits"
        // (in-review is the status the partial map deliberately omits).
        const status0101 = row.mapped === "maps" ? "in-progress" : "in-review";

        let entries = {};
        if (row.sidecar === "id") {
          const lastStatus = row.lastStatus === "equals" ? mappedOption : "A different option";
          entries = { "17/01": { pageId: "page-S", lastStatus, lastSyncedAt: null } };
        }

        const items = fixtureItems({ status0101 });
        const plan = projectMilestone({ items, config, mapping: mapping(entries) });
        const op = opFor(plan, "17/01");
        assert.equal(
          op.op,
          row.expected,
          `row [sidecar=${row.sidecar}, lastStatus=${row.lastStatus}, mapped=${row.mapped}] → op "${row.expected}"`
        );
      }
    },
  },
];
