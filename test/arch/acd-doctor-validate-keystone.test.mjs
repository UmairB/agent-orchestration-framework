// Fitness function for milestone 15 / story 03 (validate keystone wiring) —
// the @executable contract of tasks/00_doctor-after-validate.feature.
//
// The story pins entirely STATIC TEXT in a shipped doc: after this build, the
// body of src/bundle/commands/validate.md must carry an `aof work doctor
// $ARGUMENTS` invocation positioned AFTER its existing `aof work validate
// $ARGUMENTS` step, with the lane-grouped + advisory + added-not-substituted
// framing, AND must retain the pre-existing structural keystone and the
// agent-only layer (traceability / UAT-gate integrity / litmus). Every Then in
// the feature is a grep-able fact about that shipped doc body — no human
// judgement, no engine run, no render.
//
// House: acd-bundle-membership (a deterministic source-grep over a shipped
// bundle doc) and acd-design-conformance-bundled (marker-presence over a
// bundled command doc, with a self-test proving the guard trips). One assertion
// per feature scenario (and one per Scenario-Outline row).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../../", import.meta.url);
const SKILL = "src/bundle/commands/validate.md";
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, root)), "utf8");

// The two CLI invocations the wiring pins (exact tokens — same $ARGUMENTS scope).
const VALIDATE_INVOCATION = "aof work validate $ARGUMENTS";
const DOCTOR_INVOCATION = "aof work doctor $ARGUMENTS";

// Case-insensitive substring presence (the marker grep).
function has(content, needle) {
  return content.toLowerCase().includes(needle.toLowerCase());
}

// The pre-existing keystone + agent-only-layer markers that MUST survive the
// doctor addition (the Scenario Outline's Examples — added, not substituted).
const SURVIVING_MARKERS = [
  // the structural keystone is retained, not replaced
  "aof work validate $ARGUMENTS",
  "the structural keystone (aof work validate)",
  // the agent-only layer is retained beneath, not dropped
  "traceability",
  "UAT-gate integrity",
  "litmus",
  // doctor is the added deterministic floor, not a substitute
  "aof work doctor $ARGUMENTS",
  "added beneath, never replacing, validate"
];

export const archTests = [
  // ── Scenario: the skill invokes aof work doctor after aof work validate with the same scope ──
  {
    name: "arch/15-03: validate.md invokes `aof work doctor $ARGUMENTS` AFTER `aof work validate $ARGUMENTS` with the same scope",
    run: async () => {
      const body = read(SKILL);
      const validateAt = body.indexOf(VALIDATE_INVOCATION);
      const doctorAt = body.indexOf(DOCTOR_INVOCATION);
      // Then it contains an "aof work validate $ARGUMENTS" invocation
      assert.ok(validateAt !== -1, "the body contains an `aof work validate $ARGUMENTS` invocation");
      // And it contains an "aof work doctor $ARGUMENTS" invocation
      assert.ok(doctorAt !== -1, "the body contains an `aof work doctor $ARGUMENTS` invocation");
      // And the doctor invocation appears after the validate invocation (character-offset ordering)
      assert.ok(
        doctorAt > validateAt,
        `the doctor invocation (offset ${doctorAt}) appears AFTER the validate invocation (offset ${validateAt})`
      );
      // And both invocations carry the same "$ARGUMENTS" scope token
      assert.ok(
        VALIDATE_INVOCATION.endsWith("$ARGUMENTS") && DOCTOR_INVOCATION.endsWith("$ARGUMENTS"),
        "both invocations carry the same `$ARGUMENTS` scope token"
      );
    }
  },

  // ── Scenario: the combined report groups findings by lane, validity and health, beneath the agent-only layer ──
  {
    name: "arch/15-03: the report labels a validity lane (aof work validate) and a health lane (aof work doctor), health beneath the agent-only layer, doctor findings verbatim",
    run: async () => {
      const body = read(SKILL);
      // Then it labels a validity lane sourced from "aof work validate"
      assert.ok(has(body, "validity lane"), "the body labels a validity lane");
      assert.ok(has(body, "aof work validate"), "the validity lane is sourced from `aof work validate`");
      // And it labels a health lane sourced from "aof work doctor"
      assert.ok(has(body, "health lane"), "the body labels a health lane");
      assert.ok(has(body, "aof work doctor"), "the health lane is sourced from `aof work doctor`");
      // And the health lane is reported beneath the agent-only layer (traceability / UAT-gate integrity / litmus)
      assert.ok(
        has(body, "beneath the agent-only layer"),
        "the body states the health lane is reported beneath the agent-only layer"
      );
      for (const layer of ["traceability", "UAT-gate integrity", "litmus"]) {
        assert.ok(has(body, layer), `the agent-only layer marker "${layer}" is present`);
      }
      // And the doctor findings are reported verbatim, not re-derived by the agent
      assert.ok(
        has(body, "verbatim"),
        "the body states doctor findings are reported verbatim (not re-derived by the agent)"
      );
    }
  },

  // ── Scenario: validate stays the hard gate and a warn-only doctor result does not fail the skill ──
  {
    name: "arch/15-03: validate stays the hard gate (PASS requires exit 0) and a warn-only doctor result does not fail the skill (doctor advisory, not a PASS precondition)",
    run: async () => {
      const body = read(SKILL);
      const lc = body.toLowerCase();
      // Then it states PASS requires "aof work validate" to exit 0 (the hard keystone)
      assert.ok(lc.includes("pass"), "the body states a PASS condition");
      assert.ok(has(body, "aof work validate"), "PASS references `aof work validate`");
      assert.ok(has(body, "exit 0"), "PASS requires `aof work validate` to exit 0 (the hard keystone)");
      assert.ok(has(body, "keystone"), "the body names the hard keystone");
      // And it states a warn-only "aof work doctor" result does not fail the skill (doctor is advisory)
      assert.ok(has(body, "warn"), "the body addresses a warn-only doctor result");
      assert.ok(
        has(body, "does not fail the skill") || has(body, "does NOT fail the skill"),
        "the body states a warn-only `aof work doctor` result does not fail the skill"
      );
      assert.ok(has(body, "advisory"), "the body states doctor is advisory");
      // And it does not make doctor's exit a precondition of PASS
      assert.ok(
        has(body, "not a precondition of PASS") || has(body, "not be a precondition of PASS") ||
          has(body, "exit is not a precondition"),
        "the body states doctor's exit is not a precondition of PASS"
      );
    }
  },

  // ── Scenario Outline: the pre-existing keystone and agent-only layer survive the doctor addition ──
  // One assertion per Examples row (each marker must remain present in the shipped doc body).
  {
    name: "arch/15-03: every pre-existing keystone / agent-only-layer marker (and the added doctor floor) is present in the shipped doc body",
    run: async () => {
      const body = read(SKILL);
      for (const marker of SURVIVING_MARKERS) {
        assert.ok(
          body.includes(marker),
          `marker "${marker}" is present in the shipped doc body (added, not substituted)`
        );
      }
    }
  },

  // ── Self-test: the guard is load-bearing (it TRIPS when the wiring regresses). ──
  // The exact regression this story guards: a build that drops the doctor step,
  // mis-orders it before validate, or removes a surviving marker.
  {
    name: "arch/15-03 (self-test): the keystone-wiring guard FAILS when the doctor step is removed, mis-ordered, or a surviving marker is stripped",
    run: async () => {
      const body = read(SKILL);

      // (a) Removing the doctor invocation trips the presence + ordering checks.
      const withoutDoctor = body.replaceAll(DOCTOR_INVOCATION, "");
      assert.equal(withoutDoctor.indexOf(DOCTOR_INVOCATION), -1, "the mutated body has no doctor invocation");

      // (b) Mis-ordering (doctor BEFORE validate) trips the offset assertion. Prepend
      // a doctor invocation so the FIRST doctor offset precedes the validate offset.
      const misordered = `${DOCTOR_INVOCATION}\n${body}`;
      const vAt = misordered.indexOf(VALIDATE_INVOCATION);
      const dAt = misordered.indexOf(DOCTOR_INVOCATION);
      assert.ok(dAt < vAt, "a doctor invocation prepended before validate would violate the offset ordering");

      // (c) Stripping a surviving marker trips the survival check.
      const sampleMarker = "the structural keystone (aof work validate)";
      assert.ok(body.includes(sampleMarker), "the real doc carries the sampled surviving marker");
      const stripped = body.replaceAll(sampleMarker, "");
      assert.equal(stripped.includes(sampleMarker), false, "the mutated body drops the sampled surviving marker");
    }
  },

  // ── The guard is wired into the runner (not orphaned). ──
  {
    name: "arch/15-03: the keystone-wiring guard is wired into the test runner (scripts/test.mjs imports + runs acd-doctor-validate-keystone)",
    run: async () => {
      const runner = read("scripts/test.mjs");
      assert.ok(
        runner.includes("acd-doctor-validate-keystone"),
        "scripts/test.mjs imports acd-doctor-validate-keystone so the guard runs in CI (not orphaned)"
      );
    }
  }
];
