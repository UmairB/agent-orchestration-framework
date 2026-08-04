// Fitness function: acd-test-suite-registration (m43 / ADR-014/E7, TECH_DEBT item 17) —
//
//   "A test suite that no runner imports is not a weak gate. It is NO gate."
//
// WHY THIS EXISTS, measured rather than imagined (2026-08-03, 43/04's structural review).
// Both runners register their suites by EXPLICIT IMPORT (`scripts/test.mjs` and
// `scripts/test-unit.mjs`), and nothing checked that the set of imports covers the set of
// files on disk. Six suites were imported by neither — and FOUR of them are milestone
// 43/03's behavioural proof (38 scenarios), for a story that was reviewed, accepted and
// merged. They pass when run by hand; nothing would have said a word the day they stopped.
// A seventh (`mesh-ui-write-isolation-bounded`) has been RED and invisible since m25,
// testing a route that no longer exists.
//
// This is the generalisation of `acd-roundtrip-registration` (m04/00/03), which makes the
// same argument for one family: "a fitness function that is authored but never wired into
// scripts/test.mjs is dead weight — it can rot RED (or worse, stay GREEN by never running)
// without anyone noticing." The argument was never specific to round-trip tests.
//
// SHRINK-ONLY, with the baseline NAMED rather than counted. The six existing orphans are
// listed below with their origin, so (a) the SEVENTH fails CI immediately, and (b) paying
// one down is a visible edit to this list rather than a number quietly ticking. That is
// ADR-013/C5's rule: a baseline is reviewed by re-measuring it, never by its rationale.
//
// The check is deliberately FILENAME-based, not export-based: a runner imports a module by
// path, so "is this file wired in" is answerable from the runner's own source text without
// importing anything (no cycles, no side effects, no suite execution).
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const TEST_DIRS = ["test", path.join("test", "arch")];
const RUNNERS = [path.join("scripts", "test.mjs"), path.join("scripts", "test-unit.mjs")];

// THE BASELINE — every suite on disk that no runner imports today, with why it is here.
// Shrink-only: an entry leaves this list when the suite is registered (or retired); nothing
// is ever added without an ADR, because the whole point is that the next one fails.
const UNREGISTERED_BASELINE = [
  // Exports no runner-shaped array — it is a `node:test` file (`import test from "node:test"`),
  // so registering it is a CONVERSION, not a one-line import. Carried so the count is honest
  // rather than convenient, and deliberately not converted inside 43/04's diff.
  "test/work-observe.test.mjs",
];
// PAID DOWN 2026-08-03, in the story that raised the ratchet (43/04), five of the six:
//   · m43/03's four (`artifact-sync-{drain,enqueue-hook,manifest}`, `claude-settings-merge`)
//     are now imported by scripts/test.mjs. They were green the day they were found — the
//     gap was registration, not correctness — so an ACCEPTED story's 38 scenarios now
//     actually gate CI. Re-measured on registration, per ADR-013/C5.
//   · the m25-era orphan `mesh-ui-write-isolation-bounded` was RETIRED, not repaired: its
//     subject (`POST /api/mesh/issue`) no longer exists, and its own siblings — including
//     `acd-mesh-issue-route-same-origin` — were parked in milestone 35's
//     reference/retired-dispatch-tests/ during m34's "global mesh only" correction. It was
//     missed then; it is there now, renamed `*.test.mjs` → `*.mjs` per that dir's convention
//     so no runner or glob picks it up.

async function suiteFiles() {
  const out = [];
  for (const dir of TEST_DIRS) {
    for (const entry of await readdir(path.join(repoRoot, dir))) {
      if (entry.endsWith(".test.mjs")) out.push(`${dir.replaceAll("\\", "/")}/${entry}`);
    }
  }
  return out.sort();
}

export const archTests = [
  {
    name: "arch/43 ADR-014/E7 (acd-test-suite-registration): every test suite on disk is imported by a runner — the unregistered set only ever shrinks",
    run: async () => {
      const runners = (await Promise.all(RUNNERS.map((rel) => readFile(path.join(repoRoot, rel), "utf8")))).join("\n");
      const files = await suiteFiles();
      assert.ok(files.length > 300, `the test tree was actually read (non-vacuous): ${files.length} suites`);

      const unregistered = files.filter((rel) => !runners.includes(path.basename(rel)));
      assert.deepEqual(
        unregistered,
        [...UNREGISTERED_BASELINE].sort(),
        "a test suite imported by NEITHER scripts/test.mjs NOR scripts/test-unit.mjs is not a weak gate — it is no gate at all, and it is green, red or deleted with identical effect on CI (m43/ADR-014 E7; TECH_DEBT 17). Register it in a runner, or — if its subject is retired — move it under the owning milestone's reference/ directory. This list is SHRINK-ONLY.",
      );
    },
  },
  {
    name: "arch/43 ADR-014/E7 (acd-test-suite-registration): self-check — the detector keys on the runner's own import text, and a baseline entry that no longer exists on disk is itself a failure",
    run: async () => {
      const files = new Set(await suiteFiles());
      const ghosts = UNREGISTERED_BASELINE.filter((rel) => !files.has(rel));
      assert.deepEqual(
        ghosts,
        [],
        `a baseline entry naming a suite that is no longer on disk makes the ratchet guard a number that is not true (ADR-013/C5) — remove it: ${ghosts.join(", ")}`,
      );
      // The detector must genuinely read the runners: a suite the runner names is not an
      // orphan, and one it does not name is.
      const runner = 'import { xTests } from "../test/x-alpha.test.mjs";';
      assert.ok(runner.includes(path.basename("test/x-alpha.test.mjs")), "a named suite is detected as registered");
      assert.ok(!runner.includes(path.basename("test/x-beta.test.mjs")), "an unnamed suite is detected as an orphan");
    },
  },
];
