// Fitness function: acd-session-record-frozen (milestone 38 / ADR-002, fitness #2)
// — "the session-record assembler returns EXACTLY its ordered key set
// [nodeId, workspaceId, repo, assistant, startedAt, lastPingAt]."
//
// Proof: call assembleSessionRecord with representative input; assert
// Object.keys(record) deep-equals the frozen six, order-sensitive (mirroring the
// assignment record's ten-key freeze / the presence record's five-key freeze).
// Self-check (m03 non-vacuous): a planted assembler returning an extra/missing/
// reordered key fails the SAME order-sensitive assertion the real assembler passes.
import assert from "node:assert/strict";
import { assembleSessionRecord } from "../../src/mesh-session.mjs";

const FROZEN_KEYS = ["nodeId", "workspaceId", "repo", "assistant", "startedAt", "lastPingAt"];

const SAMPLE = {
  nodeId: "node-a",
  workspaceId: "ws-1",
  repo: "my-repo",
  assistant: "claude-code",
  startedAt: "2026-07-10T12:00:00.000Z",
  lastPingAt: "2026-07-10T12:00:00.000Z",
};

export const archTests = [
  {
    name: "arch/38 ADR-002 (acd-session-record-frozen): the assembler returns EXACTLY the six frozen keys, in order",
    run: async () => {
      const record = assembleSessionRecord(SAMPLE);
      assert.deepEqual(Object.keys(record), FROZEN_KEYS, "assembler key order matches the frozen six");
    },
  },
  {
    name: "arch/38 ADR-002 (acd-session-record-frozen): the freeze holds when lastPingAt diverges from startedAt (a ping refresh)",
    run: async () => {
      const record = assembleSessionRecord({ ...SAMPLE, lastPingAt: "2026-07-10T12:00:30.000Z" });
      assert.deepEqual(Object.keys(record), FROZEN_KEYS);
      assert.equal(record.startedAt, "2026-07-10T12:00:00.000Z", "startedAt is unchanged by a ping refresh");
      assert.equal(record.lastPingAt, "2026-07-10T12:00:30.000Z", "lastPingAt carries the refreshed value");
    },
  },
  {
    name: "arch/38 ADR-002 (acd-session-record-frozen): self-check — a planted assembler with an extra/missing/reordered key fails the SAME assertion the real one passes",
    run: async () => {
      const real = assembleSessionRecord(SAMPLE);
      assert.deepEqual(Object.keys(real), FROZEN_KEYS, "the real assembler is clean");

      const extraKey = { ...real, extra: "smuggled" };
      assert.notDeepEqual(Object.keys(extraKey), FROZEN_KEYS, "a planted extra key trips the detector");

      const { repo, ...missingKey } = real;
      assert.notDeepEqual(Object.keys(missingKey), FROZEN_KEYS, "a planted missing key trips the detector");

      const reordered = {
        nodeId: real.nodeId, workspaceId: real.workspaceId, assistant: real.assistant,
        repo: real.repo, startedAt: real.startedAt, lastPingAt: real.lastPingAt,
      };
      assert.notDeepEqual(Object.keys(reordered), FROZEN_KEYS, "a planted reordering trips the order-sensitive detector");
    },
  },
];
