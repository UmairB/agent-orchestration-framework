// Traceability wiring for milestone 40 / story 02 (migration registry &
// `aof upgrade`), task
//   wiki/work/40_milestone_work-item-versioning-upgrade/stories/
//     02_story_migration-registry-and-upgrade/tasks/00_registry-contiguous-chain.feature
// Every @executable scenario below is wired against the LOCKED registry —
// `WORK_ITEM_MIGRATIONS` + `WORK_ITEM_SCHEMA_VERSION` (src/work-upgrade.mjs /
// src/work.mjs) — and the engine's per-item selection (`planUpgrade`), read
// back from the module's own exported descriptors + a fixture item's on-disk
// schema. No source read.
import assert from "node:assert/strict";
import path from "node:path";
import { WORK_ITEM_MIGRATIONS, planUpgrade } from "../src/work-upgrade.mjs";
import { WORK_ITEM_SCHEMA_VERSION } from "../src/work.mjs";
import { withWork, writeItem } from "./support/work-upgrade-fixture.mjs";

export const workUpgradeRegistryChainTests = [
  // "the registry is a contiguous chain rooted at the schema-0 baseline"
  {
    name: "work-upgrade/registry: the exported descriptors, ordered by from, begin at from 0, with no gap and no repeat, each to exactly one greater than its own from",
    run: () =>
      withWork(async () => {
        const chain = [...WORK_ITEM_MIGRATIONS].sort((a, b) => a.from - b.from);
        assert.equal(chain[0].from, 0, "the chain, ordered by from, begins at 0 (the pre-versioning baseline)");
        for (let i = 1; i < chain.length; i += 1) {
          assert.equal(chain[i].from, chain[i - 1].to, `descriptor ${i}'s from (${chain[i].from}) equals the previous descriptor's to (${chain[i - 1].to}) — no gap, no repeat`);
        }
        for (const transform of chain) {
          assert.equal(transform.to, transform.from + 1, `descriptor ${transform.id}'s to (${transform.to}) is exactly one greater than its from (${transform.from})`);
        }
      }),
  },

  // "the chain's highest transform target equals WORK_ITEM_SCHEMA_VERSION"
  {
    name: "work-upgrade/registry: the greatest `to` across all exported descriptors equals the exported WORK_ITEM_SCHEMA_VERSION constant",
    run: () =>
      withWork(async () => {
        const highest = Math.max(...WORK_ITEM_MIGRATIONS.map((transform) => transform.to));
        assert.equal(highest, WORK_ITEM_SCHEMA_VERSION, `the registry's highest to (${highest}) equals WORK_ITEM_SCHEMA_VERSION (${WORK_ITEM_SCHEMA_VERSION})`);
      }),
  },

  // "the 0→1 stamp transform is the chain's first entry"
  {
    name: "work-upgrade/registry: the descriptor with from 0 has to 1, and it is the first descriptor in the chain order",
    run: () =>
      withWork(async () => {
        const zeroFrom = WORK_ITEM_MIGRATIONS.find((transform) => transform.from === 0);
        assert.ok(zeroFrom, "a descriptor with from 0 exists");
        assert.equal(zeroFrom.to, 1, "the from-0 descriptor's to is 1 (the stamp transform)");
        assert.equal(WORK_ITEM_MIGRATIONS[0], zeroFrom, "the from-0 descriptor is the FIRST entry in the registry's declared order");
      }),
  },

  // "an item at the schema-0 baseline selects the whole chain to current"
  {
    name: "work-upgrade/registry: an item at the schema-0 baseline selects every descriptor whose from is 0 or higher, in ascending chain order, ending at WORK_ITEM_SCHEMA_VERSION",
    run: () =>
      withWork(async (work) => {
        const dir = path.join(work, "00_milestone_sample");
        await writeItem(dir, { type: "milestone", number: "00", slug: "sample" }); // unstamped -> schema 0
        const plan = await planUpgrade(work);
        assert.equal(plan.length, 1, "the fixture stream carries exactly one item");
        const expected = [...WORK_ITEM_MIGRATIONS].sort((a, b) => a.from - b.from);
        assert.deepEqual(
          plan[0].transforms.map((t) => t.id),
          expected.map((t) => t.id),
          "the planned transforms equal every exported descriptor whose from is 0 or higher, in ascending chain order",
        );
        assert.equal(
          plan[0].transforms[plan[0].transforms.length - 1].to,
          WORK_ITEM_SCHEMA_VERSION,
          "the last planned transform's to equals WORK_ITEM_SCHEMA_VERSION",
        );
      }),
  },

  // "an item already at the current schema selects the empty chain"
  {
    name: "work-upgrade/registry: an item already at WORK_ITEM_SCHEMA_VERSION selects the empty chain",
    run: () =>
      withWork(async (work) => {
        const dir = path.join(work, "00_milestone_sample");
        await writeItem(dir, { type: "milestone", number: "00", slug: "sample", schema: WORK_ITEM_SCHEMA_VERSION });
        const plan = await planUpgrade(work);
        assert.equal(plan.length, 1, "the fixture stream carries exactly one item");
        assert.deepEqual(plan[0].transforms, [], "an item already at the current schema plans an EMPTY chain");
      }),
  },
];
