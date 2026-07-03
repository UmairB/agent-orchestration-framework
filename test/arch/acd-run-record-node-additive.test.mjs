// Fitness function: acd-run-record-node-additive (milestone 26 / story 00 /
// ADR-001 / fitness #2) — "The fourteen-key record."
//
//   "buildRecord/normalizeRecord carry EXACTLY the fourteen keys — 20/ADR-001's
//    thirteen unchanged in name/order + `node` appended, defaulting null — so a
//    legacy flat record reads forward (absence benign)."
//
// Key ORDER is asserted HERE and only here (the task-00 feature's scenarios assert
// key PRESENCE and VALUE — the locked QA seam split). Exercised through the real
// store against mkdtemp fixtures: a mint (with and without a node) and a
// thirteen-key legacy record read forward.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// The FROZEN fourteen: 20/ADR-001's thirteen — the original nine + the four
// resilience keys — unchanged in name/order, then `node` APPENDED.
const THIRTEEN_KEYS = ["runId", "itemRef", "state", "attempt", "outcome", "sessionId", "brief", "createdAt", "updatedAt", "failureReason", "heartbeatAt", "retryOf", "reclaimedAt"];
const FOURTEEN_KEYS = [...THIRTEEN_KEYS, "node"];

async function makeItem() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-node-additive-"));
  const dir = path.join(repo, "wiki", "work", "26_milestone_x");
  await mkdir(dir, { recursive: true });
  return { repo, item: { ref: "26", dir } };
}

export const archTests = [
  {
    name: "arch/run-record-node-additive: the fourteen-key freeze — a minted record carries EXACTLY the fourteen keys in order (the m20 thirteen unchanged, node appended), in memory and on disk",
    run: async () => {
      const { repo, item } = await makeItem();
      try {
        const { startRun } = await import("../../src/run-store.mjs");

        // Non-vacuous anchor: the fourteen-key list's thirteen-key PREFIX is the
        // m20 freeze verbatim (names AND order — the supersede is additive-only).
        assert.deepEqual(FOURTEEN_KEYS.slice(0, 13), THIRTEEN_KEYS, "the first thirteen keys are 20/ADR-001's freeze, unchanged in name and order");
        assert.equal(FOURTEEN_KEYS[13], "node", "the fourteenth key is `node`, appended last");

        // Minted WITH a node: fourteen keys, in order, node carrying the value.
        const withNode = await startRun(item, { node: "node-a", now: "2026-07-02T10:00:00.000Z" });
        assert.deepEqual(Object.keys(withNode), FOURTEEN_KEYS, "a minted record carries exactly the fourteen keys, in order");
        assert.equal(withNode.node, "node-a", "the node key carries the injected node id");
        const onDisk = JSON.parse(
          await readFile(path.join(item.dir, "runs", "node-a", `${withNode.runId}.json`), "utf8")
        );
        assert.deepEqual(Object.keys(onDisk), FOURTEEN_KEYS, "the ON-DISK record carries exactly the fourteen keys, in order");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/run-record-node-additive: a mint without a node defaults the fourteenth key to null (the single-node install's record — the one additive delta)",
    run: async () => {
      const { repo, item } = await makeItem();
      try {
        const { startRun } = await import("../../src/run-store.mjs");
        const record = await startRun(item, { now: "2026-07-02T10:00:00.000Z" });
        assert.deepEqual(Object.keys(record), FOURTEEN_KEYS, "the no-node record still carries the fourteen keys, in order");
        assert.equal(record.node, null, "node defaults to null");
        const onDisk = JSON.parse(await readFile(path.join(item.dir, "runs", `${record.runId}.json`), "utf8"));
        assert.deepEqual(Object.keys(onDisk), FOURTEEN_KEYS, "the on-disk no-node record carries the fourteen keys, in order");
        assert.equal(onDisk.node, null, "the on-disk node value is null");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/run-record-node-additive: a thirteen-key (m20) record on disk normalizes forward with node: null — absence is benign, never an error or a distinct shape",
    run: async () => {
      const { repo, item } = await makeItem();
      try {
        const { readRuns } = await import("../../src/run-store.mjs");
        const thirteen = {
          runId: "20260630T000000000Z-0000",
          itemRef: item.ref,
          state: "running",
          attempt: 1,
          outcome: null,
          sessionId: "sess-13",
          brief: { note: "m20" },
          createdAt: "2026-06-30T00:00:00.000Z",
          updatedAt: "2026-06-30T00:00:00.000Z",
          failureReason: null,
          heartbeatAt: null,
          retryOf: null,
          reclaimedAt: null,
        };
        assert.deepEqual(Object.keys(thirteen), THIRTEEN_KEYS, "the fixture IS a genuine thirteen-key m20 record (non-vacuous)");
        await mkdir(path.join(item.dir, "runs"), { recursive: true });
        await writeFile(path.join(item.dir, "runs", `${thirteen.runId}.json`), JSON.stringify(thirteen, null, 2), "utf8");

        const runs = await readRuns(item);
        assert.equal(runs.length, 1, "the legacy record reads back as one run, no error");
        assert.deepEqual(Object.keys(runs[0]), FOURTEEN_KEYS, "the normalized record carries the fourteen keys, in order");
        assert.equal(runs[0].node, null, "the missing node key reads as null (absence benign)");
        for (const key of THIRTEEN_KEYS) {
          assert.deepEqual(runs[0][key], thirteen[key], `the legacy "${key}" value is preserved verbatim`);
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];
