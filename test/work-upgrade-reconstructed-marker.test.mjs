// Traceability wiring for milestone 40 / story 02 (migration registry &
// `aof upgrade`), task
//   wiki/work/40_milestone_work-item-versioning-upgrade/stories/
//     02_story_migration-registry-and-upgrade/tasks/04_reconstructed-marker-expressible.feature
// Every @executable scenario below is wired against the LOCKED engine's
// injectable `migrations` seam (runUpgrade/planUpgrade's `{ migrations }`
// option, src/work-upgrade.mjs) — a SYNTHETIC reconstructing transform drives
// expressibility (ADR-008); the real 0->1 stamp transform is exercised
// separately to prove it sets NO marker and transforms shape only. No
// backfill is performed — the real WORK_ITEM_MIGRATIONS declares no
// reconstructing transform, asserted directly here too. No source read.
import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { WORK_ITEM_MIGRATIONS, runUpgrade } from "../src/work-upgrade.mjs";
import { withWork, writeItem } from "./support/work-upgrade-fixture.mjs";

const bodyOf = (text) => text.slice(text.indexOf("\n---", 3) + "\n---".length);

// A SYNTHETIC transform declaring `reconstructs: true` — the ADR-008 test
// seam. Its own `apply` does nothing beyond a trivial, non-inferential
// frontmatter add (it must NOT set the marker itself — that is the ENGINE's
// job, mechanically, whenever `reconstructs: true` is declared).
const SYNTHETIC_RECONSTRUCTING_TRANSFORM = {
  id: "synthetic-reconstruct-0-to-1",
  from: 0,
  to: 1,
  summary: "TEST-ONLY synthetic transform proving the registry can express a reconstructed-marker (ADR-008 readiness) — never registered for real.",
  reconstructs: true,
  apply: (block) => `${block}\nsyntheticField: probe`,
};

export const workUpgradeReconstructedMarkerTests = [
  // "a transform declaring `reconstructs: true` produces a doc carrying the `reconstructed: true` marker"
  {
    name: "work-upgrade/reconstructed-marker: a synthetic transform declaring reconstructs:true produces a doc carrying a reconstructed:true frontmatter marker",
    run: () =>
      withWork(async (work) => {
        const dir = path.join(work, "00_milestone_sample");
        const { doc } = await writeItem(dir, { type: "milestone", number: "00", slug: "sample" }); // unstamped -> schema 0

        const result = await runUpgrade(work, { apply: true, migrations: [SYNTHETIC_RECONSTRUCTING_TRANSFORM] });
        assert.equal(result.applied.length, 1, "the synthetic transform applied to the one fixture item");

        const after = await readFile(path.join(dir, doc), "utf8");
        assert.match(after, /^reconstructed:\s*true\s*$/m, "the doc the synthetic reconstructing transform produced carries a reconstructed: true frontmatter marker");
      }),
  },

  // "the 0→1 stamp transform sets NO reconstructed marker"
  {
    name: "work-upgrade/reconstructed-marker: the real 0->1 stamp transform sets schema:1 + aofVersion but NO reconstructed marker, and its own descriptor declares no reconstructs flag",
    run: () =>
      withWork(async (work) => {
        const dir = path.join(work, "00_milestone_sample");
        const { doc } = await writeItem(dir, { type: "milestone", number: "00", slug: "sample" }); // unstamped

        const result = await runUpgrade(work, { apply: true }); // the REAL registry (default)
        assert.equal(result.applied.length, 1, "the real 0->1 stamp transform applied to the one fixture item");

        const after = await readFile(path.join(dir, doc), "utf8");
        assert.match(after, /^schema:\s*1\s*$/m, "the item now reads schema: 1");
        assert.match(after, /^aofVersion:\s*\S+\s*$/m, "the item now carries an aofVersion string");
        assert.ok(!/^reconstructed:/m.test(after), "the item's frontmatter carries NO reconstructed marker — the stamp is a true version record, not a reconstruction");

        const stampDescriptor = WORK_ITEM_MIGRATIONS.find((transform) => transform.from === 0 && transform.to === 1);
        assert.ok(stampDescriptor, "the exported registry carries the 0->1 stamp descriptor");
        assert.notEqual(stampDescriptor.reconstructs, true, "the exported 0->1 stamp descriptor does not declare reconstructs: true");
      }),
  },

  // "`aof upgrade` transforms frontmatter shape only and leaves authored body prose byte-identical"
  {
    name: "work-upgrade/reconstructed-marker: applying aof upgrade over an unstamped item with authored body prose changes only the leading frontmatter block — the body is byte-identical",
    run: () =>
      withWork(async (work) => {
        const dir = path.join(work, "00_milestone_sample");
        const { doc, before } = await writeItem(dir, { type: "milestone", number: "00", slug: "sample" });

        await runUpgrade(work, { apply: true });
        const after = await readFile(path.join(dir, doc), "utf8");

        assert.notEqual(after, before, "the frontmatter block changed");
        assert.equal(bodyOf(after), bodyOf(before), "the authored body prose is byte-identical to before the upgrade");
      }),
  },

  // "the marker is expressible but no reconstruction is performed in this milestone"
  {
    name: "work-upgrade/reconstructed-marker: no descriptor in the exported WORK_ITEM_MIGRATIONS declares reconstructs:true, and applying aof upgrade over the fixture stream produces no doc carrying a reconstructed marker",
    run: () =>
      withWork(async (work) => {
        assert.ok(
          WORK_ITEM_MIGRATIONS.every((transform) => transform.reconstructs !== true),
          "no descriptor in the exported WORK_ITEM_MIGRATIONS declares reconstructs: true — the real registry performs no backfill",
        );

        const dir = path.join(work, "00_milestone_sample");
        const { doc } = await writeItem(dir, { type: "milestone", number: "00", slug: "sample" });
        await runUpgrade(work, { apply: true }); // the REAL registry
        const after = await readFile(path.join(dir, doc), "utf8");
        assert.ok(!/^reconstructed:/m.test(after), "running aof upgrade over the fixture stream with the REAL registry produces no doc carrying a reconstructed marker");
      }),
  },
];
