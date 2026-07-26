// Fitness function: acd-session-presence-additive (milestone 38 / ADR-001) —
// "the live-session signal is an ADDITIVE key on the FROZEN m23 presence record; the
// m23 four keys keep their byte-order, and a record with no sessions is byte-stable."
//
// The m23 presence record is FROZEN at { nodeId, heartbeatAt, activeRuns, aofVersion }
// (23/ADR-002, mesh-presence-record.test.mjs — key order load-bearing, byte-equivalence
// on read-back). Milestone 38 evolves it ADDITIVELY: a `sessions` array is inserted
// before the trailing `aofVersion`, so the frozen four keep their RELATIVE order and a
// no-session record's first-four-keys projection stays byte-identical to an m23 record.
//
// STATE OF BUILD: the `sessions` key is not yet emitted by assemblePresenceRecord (the
// story builds it). Until then this fitness function pins the INVARIANT that survives
// the evolution: whatever assemblePresenceRecord returns, its FROZEN FOUR m23 keys
// appear in the m23 order as a contiguous, order-preserving subsequence — so an additive
// key can never reorder or drop them. This assertion is TRUE today (the four keys are the
// whole record) and STAYS true after the additive `sessions` key lands; it fails only if
// the m23 order is broken. The self-check plants exactly that break.
//
// Proofs:
//  1. The m23 four keys appear in EXACTLY the m23 relative order in the assembled record
//     (a subsequence check — additive keys allowed, reorder/drop forbidden).
//  2. The four-key PROJECTION (only the m23 keys) is byte-identical to a hand-built m23
//     record for the same inputs — the additive evolution never disturbs the frozen four.
//  Self-check (m03 non-vacuous): a reordered / dropped m23 key trips the SAME detector.
import assert from "node:assert/strict";
import { assemblePresenceRecord } from "../../src/mesh-presence.mjs";

const M23_FROZEN_KEYS = ["nodeId", "heartbeatAt", "activeRuns", "aofVersion"];

const SAMPLE = {
  nodeId: "node-a",
  heartbeatAt: "2026-07-10T12:00:00.000Z",
  activeRuns: ["run-1"],
  aofVersion: "1.2.3",
};

// The m23 four keys must appear, in the m23 order, as a subsequence of the record's keys
// (additive keys interleaved are fine; a reorder or a drop is not).
function m23KeysInOrder(keys) {
  let i = 0;
  for (const key of keys) {
    if (key === M23_FROZEN_KEYS[i]) i += 1;
  }
  return i === M23_FROZEN_KEYS.length;
}

// The four-key projection of a record — only the m23 keys, in m23 order — stringified.
function m23Projection(record) {
  const projected = {};
  for (const key of M23_FROZEN_KEYS) projected[key] = record[key];
  return JSON.stringify(projected);
}

export const archTests = [
  {
    name: "arch/38 ADR-001 (acd-session-presence-additive): the m23 four keys appear in the m23 relative order in the assembled presence record (additive-safe subsequence)",
    run: async () => {
      const record = assemblePresenceRecord(SAMPLE);
      assert.ok(
        m23KeysInOrder(Object.keys(record)),
        `m23 keys not in frozen order; got ${JSON.stringify(Object.keys(record))}`,
      );
    },
  },
  {
    name: "arch/38 ADR-001 (acd-session-presence-additive): the m23 four-key projection is byte-identical to a hand-built m23 record — the additive evolution never disturbs the frozen four",
    run: async () => {
      const record = assemblePresenceRecord(SAMPLE);
      const expected = JSON.stringify({
        nodeId: SAMPLE.nodeId,
        heartbeatAt: SAMPLE.heartbeatAt,
        activeRuns: SAMPLE.activeRuns,
        aofVersion: SAMPLE.aofVersion,
      });
      assert.equal(m23Projection(record), expected, "the m23 four-key projection must be byte-stable");
    },
  },
  {
    name: "arch/38 ADR-001 (acd-session-presence-additive): self-check — a reordered or dropped m23 key trips the SAME subsequence detector",
    run: async () => {
      assert.ok(m23KeysInOrder(Object.keys(assemblePresenceRecord(SAMPLE))), "the real record is clean");
      // Reorder: aofVersion before activeRuns — breaks the m23 relative order.
      assert.ok(!m23KeysInOrder(["nodeId", "heartbeatAt", "aofVersion", "activeRuns"]), "a reordered m23 key must trip the detector");
      // Drop: activeRuns missing — breaks the subsequence.
      assert.ok(!m23KeysInOrder(["nodeId", "heartbeatAt", "sessions", "aofVersion"]), "a dropped m23 key must trip the detector");
      // Additive-safe: sessions inserted before aofVersion — the four keys still in order.
      assert.ok(m23KeysInOrder(["nodeId", "heartbeatAt", "activeRuns", "sessions", "aofVersion"]), "an additive key must NOT trip the detector");
    },
  },
];
