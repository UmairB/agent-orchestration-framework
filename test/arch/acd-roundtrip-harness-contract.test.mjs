// Fitness function for milestone 04 / ADR-005:
// "The round-trip harness exposes EXACTLY the frozen shared contract — the single
//  coupling point between the install-proof story and the loop-proof story:
//    createRoundTripRepo()      -> { dir, cleanup }
//    installBundle(dir, opts)   -> structured initWork result
//    seedSampleMilestone(dir)   -> { milestoneRef, storyRefs }
//  from ONE module. Each downstream story binds to the harness, not to its sibling
//  story's source."
//
// WHY structural: a round-trip proof is naturally sequential — you cannot prove the
// loop without an install. Extracting the shared setup (isolated repo + real install
// + seeded sample) into ONE frozen-API harness is what lets the two proof stories
// PARALLELISE, coupled only through this contract — exactly the technique milestone
// 01 used with its install-manifest schema (ADR-004/005 of 01). Freezing the API here
// is what buys the parallelism; this test pins it.
//
// EXPECTED RED until the harness story builds test/support/roundtrip-harness.mjs to
// this frozen contract. The test FILE imports only node: builtins at top level and
// resolves the harness LAZILY inside run(), so a missing module is a clean assertion
// red, not an import crash. It goes green once the harness exports exactly the three
// frozen functions with the frozen return shapes.
import assert from "node:assert/strict";
import { rm, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const harnessPath = path.join(repoRoot, "test", "support", "roundtrip-harness.mjs");
const harnessUrl = new URL("../support/roundtrip-harness.mjs", import.meta.url).href;

const FROZEN_EXPORTS = ["createRoundTripRepo", "installBundle", "seedSampleMilestone"];

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function loadHarness() {
  if (!(await exists(harnessPath))) {
    assert.fail("round-trip harness not found yet at test/support/roundtrip-harness.mjs — EXPECTED RED until the harness story builds it (ADR-005)");
  }
  return import(harnessUrl);
}

export const archTests = [
  {
    name: "arch/ADR-005: the harness exports exactly the three frozen contract functions from one module",
    run: async () => {
      const harness = await loadHarness();
      for (const name of FROZEN_EXPORTS) {
        assert.equal(typeof harness[name], "function", `harness exports ${name}() as the frozen contract requires`);
      }
    }
  },
  {
    name: "arch/ADR-005: createRoundTripRepo -> { dir, cleanup }, installBundle -> structured install result, seedSampleMilestone -> { milestoneRef, storyRefs }",
    run: async () => {
      const harness = await loadHarness();

      let repo;
      try {
        repo = await harness.createRoundTripRepo();
        assert.ok(repo && typeof repo === "object", "createRoundTripRepo returns an object");
        assert.equal(typeof repo.dir, "string", "createRoundTripRepo -> .dir (string path)");
        assert.equal(typeof repo.cleanup, "function", "createRoundTripRepo -> .cleanup (teardown handle)");

        const install = await harness.installBundle(repo.dir, { runtimes: ["claude"] });
        assert.ok(install && typeof install === "object", "installBundle returns a structured result");
        assert.ok(Array.isArray(install.actions), "installBundle result carries the engine actions[]");
        assert.ok(install.manifest && Array.isArray(install.manifest.files), "installBundle result carries the install manifest files[]");

        const seeded = await harness.seedSampleMilestone(repo.dir);
        assert.ok(seeded && typeof seeded === "object", "seedSampleMilestone returns an object");
        assert.equal(typeof seeded.milestoneRef, "string", "seedSampleMilestone -> .milestoneRef (the seeded milestone ref)");
        assert.ok(Array.isArray(seeded.storyRefs), "seedSampleMilestone -> .storyRefs[] (the seeded story refs)");
      } finally {
        if (repo && typeof repo.cleanup === "function") {
          await repo.cleanup();
        } else if (repo && typeof repo.dir === "string") {
          await rm(repo.dir, { recursive: true, force: true });
        }
      }
    }
  }
];
