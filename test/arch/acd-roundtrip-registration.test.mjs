// Registration meta-fitness for milestone 04 / story 00 / task 03.
//
// The three round-trip fitness functions (acd-roundtrip-isolation,
// acd-roundtrip-reuses-shipped-code, acd-roundtrip-harness-contract) are only
// load-bearing if the runner actually EXECUTES them. A fitness function that is
// authored but never wired into scripts/test.mjs is dead weight — it can rot RED
// (or worse, stay GREEN by never running) without anyone noticing.
//
// This no-drift guard closes that gap structurally: for EVERY
// `acd-roundtrip-*.test.mjs` file on disk under test/arch/, every arch-test it
// exports must be part of the runner's assembled suite — AND no such file may be
// absent from the suite. The runner names tests by their exported `name`, so the
// guard keys registration by name-set membership.
//
// It imports the assembled `tests` array EXPORTED from scripts/test.mjs (the
// runner only runs the suite when invoked directly, so importing it here is a
// pure, side-effect-free read of the registration).
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const archDir = here;
// scripts/test.mjs imports this meta-test, so resolve the assembled suite LAZILY
// inside run() (a deferred dynamic import) to avoid an eager import cycle that
// would read `tests` before the array literal has finished evaluating.
const runnerUrl = new URL("../../scripts/test.mjs", import.meta.url).href;

const ROUNDTRIP_FILE_RE = /^acd-roundtrip-[A-Za-z0-9-]+\.test\.mjs$/;

export const archTests = [
  {
    name: "arch/registration: every acd-roundtrip-* arch-test on disk is wired into the assembled runner suite (no drift)",
    run: async () => {
      // The names the runner will actually execute (lazy import — see above).
      const { tests: assembledTests } = await import(runnerUrl);
      const assembledNames = new Set(assembledTests.map((test) => test.name));

      // Discover every round-trip fitness file on disk.
      const entries = await readdir(archDir);
      const roundtripFiles = entries.filter((name) => ROUNDTRIP_FILE_RE.test(name)).sort();
      assert.ok(roundtripFiles.length >= 3, `found the round-trip fitness files on disk (got ${roundtripFiles.length}): ${roundtripFiles.join(", ")}`);

      for (const file of roundtripFiles) {
        const mod = await import(pathToFileURL(path.join(archDir, file)).href);
        assert.ok(Array.isArray(mod.archTests), `${file} exports an archTests array`);
        assert.ok(mod.archTests.length > 0, `${file} exports at least one arch-test`);
        for (const test of mod.archTests) {
          assert.ok(
            assembledNames.has(test.name),
            `arch-test "${test.name}" from ${file} is registered in the assembled runner suite`
          );
        }
      }
    }
  }
];
