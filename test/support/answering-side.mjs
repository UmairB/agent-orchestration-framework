// test/support/answering-side.mjs — the ONE statement of what milestone 43 / story 06
// (ADR-005) is allowed to add to a milestone-03 frozen envelope, and of what it is not.
//
// WHY THIS EXISTS RATHER THAN SIX EDITED `deepEqual`s. ADR-005 rule 3 requires that "every
// row says which side answered it", so every read surface's answer gains an answering-side
// stamp. Milestone 03 / ADR-002 froze several of those answers at an EXACT key set
// (`work list`'s seven row fields, `work:doc`'s four, `work:tasks`' two), and those exact-key
// assertions live in five separate suites. Re-pointing each one at a hand-written new list
// would replace one frozen contract with five, and would quietly permit the NEXT key too.
//
// This helper preserves the GUARANTEE those assertions encode rather than their literal form
// (the m08 lesson, restated in ADR-014/E1 and ADR-015: a superseding ADR must ENUMERATE the
// tests that assert the old meaning, and an amended test must still hold what the original
// held). It asserts:
//   · every frozen key is STILL PRESENT — nothing was renamed, dropped or retyped;
//   · the ONLY permitted additions are the three answering-side keys below — a sixth key
//     from some future story fails exactly as the original `deepEqual` would have.
//
// `reportedBy` / `syncedAt` are 43/04's wire provenance and ride only on a CACHE-answered
// answer; `answeredFrom` rides on every answer, because "this came from the local disk" is
// the fact an operator most needs when the row looks wrong.
import assert from "node:assert/strict";

export const ANSWERING_SIDE_KEYS = Object.freeze(["answeredFrom", "reportedBy", "syncedAt"]);

// assertFrozenShape(value, frozenKeys, label) — the amended form of an exact-key assertion.
export function assertFrozenShape(value, frozenKeys, label = "envelope") {
  const keys = Object.keys(value ?? {});
  const missing = frozenKeys.filter((key) => !keys.includes(key));
  assert.deepEqual(missing, [], `${label}: the milestone-03 frozen keys are all present (missing: ${missing.join(", ")})`);
  const extra = keys.filter((key) => !frozenKeys.includes(key) && !ANSWERING_SIDE_KEYS.includes(key));
  assert.deepEqual(extra, [], `${label}: the only additions permitted are m43/ADR-005's answering-side keys (unexpected: ${extra.join(", ")})`);
}

// assertAnswersFrom(value, side, label) — the stamp itself, with its two-value domain pinned.
export function assertAnswersFrom(value, side, label = "answer") {
  assert.ok(
    value?.answeredFrom === "cache" || value?.answeredFrom === "disk",
    `${label}: answeredFrom is exactly "cache" or "disk", got ${JSON.stringify(value?.answeredFrom)}`,
  );
  if (side != null) assert.equal(value.answeredFrom, side, `${label}: answered from ${side}`);
}
