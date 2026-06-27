// Traceability wiring for milestone 17 / story 01 — status-map projection + the
// honest skip (03_status-map-and-honest-skip.feature, @executable; ADR-003/004).
// One test object per @executable scenario / Scenario-Outline row.
//
// The fixture statusMap maps not-started, in-progress, and done but OMITS in-review
// — so an item with on-disk status in-review is an honest skip, computed BEFORE any
// write, carrying a reason naming the missing mapping, with NO create/patch op.
import assert from "node:assert/strict";
import { projectMilestone } from "../src/notion/projection.mjs";

const DATA_SOURCE_ID = "ds-fixture";

// A PARTIAL statusMap: not-started, in-progress, done mapped — in-review OMITTED.
const PARTIAL_STATUS_MAP = {
  "not-started": "Not started",
  "in-progress": "In progress",
  done: "Done",
};

const CONFIG = {
  dataSourceId: DATA_SOURCE_ID,
  tokenEnv: "NOTION_API_TOKEN",
  statusProperty: "Status",
  statusMap: PARTIAL_STATUS_MAP,
  relationProperty: "Sub-tasks",
};

// The fixture milestone "17" + stories "17/01" and "17/02". The status of "17/01" is
// the variable under test.
function fixtureItems(status0101) {
  return [
    { ref: "17", type: "milestone", slug: "notion-work-sync", meta: { title: "Notion Work-Board Sync", status: "in-progress" } },
    { ref: "17/01", type: "story", slug: "projection", meta: { title: "Projection story", status: status0101 } },
    { ref: "17/02", type: "story", slug: "apply", meta: { title: "Apply story", status: "done" } },
  ];
}

const mapping = () => ({ version: 1, dataSourceId: DATA_SOURCE_ID, entries: {} });
const opFor = (plan, ref) => plan.ops.find((o) => o.ref === ref);

export const notionStatusMapSkipTests = [
  {
    // Scenario: an aof status with a statusMap entry projects to that board option name
    name: "notion-status-map/00 a mapped aof status projects to that board option name",
    async run() {
      const plan = projectMilestone({ items: fixtureItems("in-progress"), config: CONFIG, mapping: mapping() });
      const op = opFor(plan, "17/01");
      assert.equal(
        op.properties.statusOption,
        PARTIAL_STATUS_MAP["in-progress"],
        'properties.statusOption equals the board option statusMap assigns "in-progress"'
      );
      assert.notEqual(op.op, "skip", 'the op for "17/01" is not a skip');
    },
  },
  {
    // Scenario: an aof status with no statusMap entry is an honest skip naming the missing mapping
    name: "notion-status-map/01 an unmapped aof status is an honest skip naming the missing mapping",
    async run() {
      const plan = projectMilestone({ items: fixtureItems("in-review"), config: CONFIG, mapping: mapping() });
      const op = opFor(plan, "17/01");
      assert.equal(op.op, "skip", 'the op for "17/01" is "skip"');
      assert.ok(
        typeof op.reason === "string" && op.reason.includes("in-review"),
        "the op carries a reason that names the missing in-review mapping"
      );
      // No create or patch op is emitted for "17/01" (the skip IS its sole op).
      const opsFor0101 = plan.ops.filter((o) => o.ref === "17/01");
      assert.equal(opsFor0101.length, 1, 'exactly one op exists for "17/01"');
      assert.ok(
        !opsFor0101.some((o) => o.op === "create" || o.op === "patch"),
        'no create or patch op is emitted for "17/01"'
      );
    },
  },
  {
    // Scenario: the skip is computed before any write, never a page op with a fabricated value
    name: "notion-status-map/02 the skip carries no statusOption value and no create/patch op",
    async run() {
      const plan = projectMilestone({ items: fixtureItems("in-review"), config: CONFIG, mapping: mapping() });
      const op = opFor(plan, "17/01");
      assert.equal(op.op, "skip", 'the op for "17/01" is "skip"');
      assert.equal(
        op.properties.statusOption,
        undefined,
        "the skip has no properties.statusOption value to write"
      );
      assert.ok(
        !plan.ops.some((o) => o.ref === "17/01" && (o.op === "create" || o.op === "patch")),
        'the plan contains no create or patch op for "17/01"'
      );
    },
  },
  {
    // Scenario Outline: each aof status maps to its board option or becomes an honest skip
    name: "notion-status-map/03 each aof status maps to its board option or becomes an honest skip (outline rows)",
    async run() {
      const rows = [
        { aofStatus: "not-started", outcome: "mapped" },
        { aofStatus: "in-progress", outcome: "mapped" },
        { aofStatus: "in-review", outcome: "skip" },
        { aofStatus: "done", outcome: "mapped" },
      ];
      for (const row of rows) {
        const plan = projectMilestone({ items: fixtureItems(row.aofStatus), config: CONFIG, mapping: mapping() });
        const op = opFor(plan, "17/01");
        if (row.outcome === "skip") {
          assert.equal(op.op, "skip", `row "${row.aofStatus}" → skip`);
        } else {
          assert.notEqual(op.op, "skip", `row "${row.aofStatus}" → mapped (not a skip)`);
          assert.equal(
            op.properties.statusOption,
            PARTIAL_STATUS_MAP[row.aofStatus],
            `row "${row.aofStatus}" projects to its board option`
          );
        }
      }
    },
  },
];
