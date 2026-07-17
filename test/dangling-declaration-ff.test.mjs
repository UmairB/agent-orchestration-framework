// Traceability wiring for milestone 39 / story 04 (dangling-declaration-fitness), task
//   wiki/work/39_milestone_delivery-memory-outcome/stories/04_story_dangling-declaration-fitness/
//     tasks/00_dangling-declaration-ff.feature
// Every @executable scenario (and each Scenario Outline row) below is wired against the
// SAME pure detector the fitness function itself uses
// (test/arch/acd-outcome-declared-field-has-producer.test.mjs) — no re-implementation, per
// the build brief: "Refactor the detector so BOTH your FF and the traceability test import
// ONE shared pure function."
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MEMORY_RECORD_FIELDS } from "../src/memory/local-retrieval.mjs";
import {
  archTests as declaredFieldHasProducerArchTests,
  findDanglingFields,
  IN_SCOPE_DECLARATION_CLASSES,
  OUT_OF_SCOPE_DECLARATION_CLASSES,
  readProducerSources,
  isCliFlagShaped,
  isHttpEndpointShaped,
  SELF_MODULE_PATH,
} from "./arch/acd-outcome-declared-field-has-producer.test.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const OUT_OF_SCOPE_ROWS = [
  "CLI flag",
  "HTTP endpoint",
  "config key",
  "dynamically or reflectively written field",
  "cross-language producer",
];

export const danglingDeclarationFfTests = [
  // Scenario: a field set whose every declared field has a producer passes
  {
    name: "dangling-declaration-ff: a field set whose every declared field has a producer passes",
    run: async () => {
      const sources = await readProducerSources(repoRoot);
      const dangling = findDanglingFields(MEMORY_RECORD_FIELDS, sources);
      assert.deepEqual(dangling, [], `unexpected dangling fields: ${JSON.stringify(dangling)}`);
    },
  },

  // Scenario: a declared field with no producer trips the same detector and fails red
  {
    name: "dangling-declaration-ff: a declared field with no producer (the warnings_delivered shape) trips the same detector and fails red",
    run: async () => {
      const sources = await readProducerSources(repoRoot);
      // "it is the same detector that passes the clean field set" — one function,
      // two calls, one on the real field list, one on a planted-negative field list.
      assert.deepEqual(findDanglingFields(MEMORY_RECORD_FIELDS, sources), [], "the clean field set still passes");
      const planted = [...MEMORY_RECORD_FIELDS, "warnings_delivered"];
      const dangling = findDanglingFields(planted, sources);
      assert.deepEqual(dangling, ["warnings_delivered"], "the planted field is reported dangling — fails red");
    },
  },

  // Scenario: a dangling field is caught even though no OUTCOME.md declared it — the
  // verdict is a PURE function of the field list × producer modules; an OUTCOME.md's
  // presence/absence/content is never consulted.
  {
    name: "dangling-declaration-ff: a dangling field is caught even though no OUTCOME.md anywhere owns up to it, and the verdict is unchanged whether an OUTCOME.md is present",
    run: async () => {
      const sources = await readProducerSources(repoRoot);
      const planted = [...MEMORY_RECORD_FIELDS, "warnings_delivered"];

      const beforeAnyOutcome = findDanglingFields(planted, sources);
      assert.deepEqual(beforeAnyOutcome, ["warnings_delivered"], "caught with no OUTCOME.md anywhere");

      const tmpDir = await mkdtemp(path.join(os.tmpdir(), "aof-dangling-ff-"));
      try {
        // A real OUTCOME.md sitting on disk that says NOTHING about the planted field
        // (nobody wrote it down as a gap) — the detector's inputs are exactly the
        // field list and the producer modules, so this file is never read at all.
        await writeFile(
          path.join(tmpDir, "OUTCOME.md"),
          "# 39 · Delivery Memory — Outcome\n\n## Delivered\n### Something else\nAn unrelated capability.\n",
          "utf8",
        );
        const afterOutcomePresent = findDanglingFields(planted, sources);
        assert.deepEqual(afterOutcomePresent, beforeAnyOutcome, "verdict unchanged by an OUTCOME.md's mere presence");
        assert.deepEqual(afterOutcomePresent, ["warnings_delivered"], "the undeclared field is still caught");
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    },
  },

  // Scenario Outline row (in scope): a record-format field's producerless member
  // fails red.
  {
    name: 'dangling-declaration-ff: declared surface "record-format field" — a producerless member is in the declared surface and fails red',
    run: async () => {
      assert.ok(IN_SCOPE_DECLARATION_CLASSES.includes("record-format field"), "record-format field is documented in scope");
      const sources = await readProducerSources(repoRoot);
      const dangling = findDanglingFields([...MEMORY_RECORD_FIELDS, "warnings_delivered"], sources);
      assert.ok(dangling.includes("warnings_delivered"), "the producerless record-format-field member fails red");
    },
  },

  // Scenario Outline rows (out of scope): the check reads no such declaration and
  // renders no verdict — claimed nowhere in scope, and structurally absent from the
  // declared surface the detector actually consumes.
  //
  // Review fix (FIX 10): a bare `field !== cls` string comparison (e.g.
  // "recordType" !== "CLI flag") is trivially true for every row and exercises
  // nothing real. "CLI flag" and "HTTP endpoint" DO have a real structural
  // shape predicate — reuse the arch FF's own `isCliFlagShaped`/
  // `isHttpEndpointShaped` to prove no declared field actually matches that
  // shape. The remaining three classes ("config key" / "dynamically or
  // reflectively written field" / "cross-language producer") have no static
  // shape predicate in this codebase — those rows instead assert the
  // arch-side invariant directly: the class is documented in the arch FF's
  // own "honest scope boundary" self-test (which reads and asserts against
  // its OWN source), not merely echoed back from a constant this file also
  // imports.
  ...OUT_OF_SCOPE_ROWS.map((cls) => ({
    name: `dangling-declaration-ff: declared surface "${cls}" is outside the declared surface — no verdict, no claim of safety`,
    run: async () => {
      assert.ok(OUT_OF_SCOPE_DECLARATION_CLASSES.includes(cls), `"${cls}" is documented as out of scope`);
      assert.ok(!IN_SCOPE_DECLARATION_CLASSES.includes(cls), `"${cls}" is not claimed in scope`);

      if (cls === "CLI flag") {
        for (const field of MEMORY_RECORD_FIELDS) {
          assert.ok(!isCliFlagShaped(field), `${field} does not structurally match the "CLI flag" shape ("--…")`);
        }
      } else if (cls === "HTTP endpoint") {
        for (const field of MEMORY_RECORD_FIELDS) {
          assert.ok(!isHttpEndpointShaped(field), `${field} does not structurally match the "HTTP endpoint" shape ("/…")`);
        }
      } else {
        // covered-by-arch: no static structural shape predicate exists for
        // this class — assert the arch-side self-test's own invariant
        // (its top-of-file disclaimer names the class out of scope) rather
        // than a vacuous per-field comparison.
        const archSelfSource = await readFile(SELF_MODULE_PATH, "utf8");
        assert.ok(archSelfSource.includes(cls), `the arch FF's own scope disclaimer documents "${cls}" as out of scope`);
      }
    },
  })),

  // Scenario: the dangling-declaration fitness function is registered in the
  // assembled test runner. RED until the orchestrator wires
  // test/arch/acd-outcome-declared-field-has-producer.test.mjs's archTests into
  // scripts/test.mjs at integration (this story does not edit scripts/test.mjs —
  // see the story build brief).
  {
    name: "dangling-declaration-ff: the dangling-declaration fitness function is registered in the assembled test runner",
    run: async () => {
      const { tests } = await import("../scripts/test.mjs");
      const runnerNames = new Set(tests.map((t) => t.name));
      for (const test of declaredFieldHasProducerArchTests) {
        assert.ok(runnerNames.has(test.name), `"${test.name}" is registered in the assembled runner`);
      }
    },
  },
];
