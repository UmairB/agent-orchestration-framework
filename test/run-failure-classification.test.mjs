// Traceability wiring for milestone 20 / story 00 — failure classification.
//
// Covers EVERY @executable scenario in
//   tasks/01_failure-classification.feature
// exercising the REAL pure functions of src/run-store.mjs in-process. The closed
// classification table and the shouldRetry ceiling matrix are asserted row-by-row
// (Scenario-Outline rows folded into one entry each). node:assert/strict.
//
//   01_failure-classification.feature — isRetryable evaluates failureReason against
//     ONE closed table (runtime_offline/timeout → retryable; agent_error/unknown/
//     null → fail closed); shouldRetry ANDs that verdict with the attempt ceiling
//     (true iff retryable AND attempt < maxAttempts, fails closed at the ceiling);
//     the ceiling is the supplied maxAttempts, not a constant; classification is
//     referentially transparent (same inputs → same verdict, no mutation).
import assert from "node:assert/strict";

export const runFailureClassificationTests = [
  // ── Scenario Outline: isRetryable returns the closed-table verdict for each failureReason ──
  {
    name: "run-failure-classification/01 isRetryable returns the closed-table verdict for each failureReason",
    async run() {
      const { isRetryable } = await import("../src/run-store.mjs");

      // the full closed table — both Examples blocks (infra → retryable; agent
      // rejection + unknown/null → fail closed). The literal string "null" row is
      // the actual null value (the feature's "<failureReason> null" row).
      const rows = [
        { failureReason: "runtime_offline", retryable: true },
        { failureReason: "timeout", retryable: true },
        { failureReason: "agent_error", retryable: false },
        { failureReason: "some_other_kind", retryable: false },
        { failureReason: null, retryable: false },
      ];
      for (const { failureReason, retryable } of rows) {
        assert.equal(isRetryable(failureReason), retryable, `isRetryable(${JSON.stringify(failureReason)}) is ${retryable}`);
      }
      // fail-closed extends to undefined / arbitrary unknowns too (the closed set is the
      // ONLY retryable membership) — pins "anything else → non-retryable".
      assert.equal(isRetryable(undefined), false, "isRetryable(undefined) fails closed");
      assert.equal(isRetryable("definitely_not_a_reason"), false, "an arbitrary unknown reason fails closed");
    },
  },
  // ── Scenario Outline: shouldRetry ANDs the classification with the attempt ceiling ──
  {
    name: "run-failure-classification/01 shouldRetry ANDs the classification with the attempt ceiling, failing closed at the ceiling",
    async run() {
      const { shouldRetry } = await import("../src/run-store.mjs");

      const rows = [
        // a retryable reason retries below the ceiling, halts at it
        { failureReason: "timeout", attempt: 1, maxAttempts: 3, shouldRetry: true },
        { failureReason: "timeout", attempt: 2, maxAttempts: 3, shouldRetry: true },
        { failureReason: "timeout", attempt: 3, maxAttempts: 3, shouldRetry: false },
        { failureReason: "runtime_offline", attempt: 1, maxAttempts: 3, shouldRetry: true },
        { failureReason: "runtime_offline", attempt: 4, maxAttempts: 3, shouldRetry: false },
        { failureReason: "timeout", attempt: 1, maxAttempts: 1, shouldRetry: false },
        // a non-retryable reason never retries, ceiling or not
        { failureReason: "agent_error", attempt: 1, maxAttempts: 3, shouldRetry: false },
        { failureReason: "some_other_kind", attempt: 1, maxAttempts: 3, shouldRetry: false },
        { failureReason: null, attempt: 1, maxAttempts: 3, shouldRetry: false },
      ];
      for (const { failureReason, attempt, maxAttempts, shouldRetry: expected } of rows) {
        const record = { failureReason, attempt };
        assert.equal(
          shouldRetry(record, maxAttempts),
          expected,
          `shouldRetry({failureReason:${JSON.stringify(failureReason)}, attempt:${attempt}}, ${maxAttempts}) is ${expected}`
        );
      }
    },
  },
  // ── Scenario: the ceiling is the supplied maxAttempts, not a fixed constant ──
  {
    name: "run-failure-classification/01 the ceiling is the supplied maxAttempts, not a fixed constant",
    async run() {
      const { shouldRetry } = await import("../src/run-store.mjs");

      // the SAME record yields a different verdict under a different maxAttempts —
      // proving the ceiling is the passed-in argument, not a baked-in constant.
      const record = { failureReason: "timeout", attempt: 2 };
      assert.equal(shouldRetry(record, 2), false, "at maxAttempts 2 the attempt-2 record halts (false)");
      assert.equal(shouldRetry(record, 3), true, "at maxAttempts 3 the same record retries (true)");
    },
  },
  // ── Scenario: classification is referentially transparent — same inputs, same verdict, no mutation ──
  {
    name: "run-failure-classification/01 classification is referentially transparent — same inputs same verdict, no mutation",
    async run() {
      const { shouldRetry } = await import("../src/run-store.mjs");

      const record = { failureReason: "timeout", attempt: 1 };
      const before = JSON.stringify(record);
      const first = shouldRetry(record, 3);
      const second = shouldRetry(record, 3);
      assert.equal(first, true, "the first verdict is true");
      assert.equal(second, true, "the second verdict is true");
      assert.equal(first, second, "both verdicts agree (referentially transparent)");
      // the record passed in is left unmutated by the call
      assert.equal(JSON.stringify(record), before, "the record passed in is left byte-unchanged by the call");
      assert.deepEqual(record, { failureReason: "timeout", attempt: 1 }, "the record's fields are untouched");
    },
  },
];
