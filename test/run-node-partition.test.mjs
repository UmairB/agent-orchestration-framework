// Traceability wiring for milestone 26 / story 00 — node-dimensioned run records.
//
// Covers EVERY @executable scenario in
//   tasks/00_node-dimensioned-records.feature
// exercising the REAL src/run-store.mjs in-process against a temp fixture repo
// (mkdtemp → mkdir → run → rm in finally — the run-dedup-atomic-persist idiom). One
// test object per @executable scenario (Scenario-Outline rows folded into one entry
// iterating the rows), each name tracing to feature + scenario. node:assert/strict.
//
//   00_node-dimensioned-records.feature — a run minted WITH a node id persists under
//     runs/<node>/ carrying node as the fourteenth key; minted WITHOUT ⇒ the flat
//     legacy path with node null (the single-node floor — thirteen legacy values
//     verbatim, the one additive delta); every generation of record reads forward
//     through one normalization; readRuns returns one runId-ascending UNION across
//     the flat dir and node subdirs; torn-file tolerance spans partitions; the dedup
//     guard refuses a duplicate non-terminal run ACROSS nodes (terminal never
//     blocks); completeRun's no-runId resolution spans the union and persists back
//     AT the node path; the refusal matrix (ambiguous-run / no-running-run) counts
//     the union as ONE population; runId uniqueness spans the union (same instant ⇒
//     -0000 then -0001, never an overwrite).
//
// Key ORDER is fitness #2's seam (acd-run-record-node-additive) — the scenarios here
// assert key PRESENCE and VALUE (the locked QA reading in the feature comments).
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// --- fixture builders --------------------------------------------------------

async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-run-node-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(workDir, { recursive: true });
  return { repo, workDir };
}

async function milestoneItem(workDir, { number = "26", slug = "distributed-runs" } = {}) {
  const dir = path.join(workDir, `${number}_milestone_${slug}`);
  await mkdir(dir, { recursive: true });
  return { ref: number, dir };
}

const flatPath = (item, runId) => path.join(item.dir, "runs", `${runId}.json`);
const nodePath = (item, node, runId) => path.join(item.dir, "runs", node, `${runId}.json`);

// Write a run-record file DIRECTLY at the flat path or under a node subdir (the
// directly-written-fixture pattern — the dedup guard forbids minting the second
// non-terminal preconditions through the store). `exact` replaces the full record
// shape when a specific GENERATION (nine-key / thirteen-key) is needed.
async function writeRecord(item, { node = null, exact = null, ...overrides } = {}) {
  const base = {
    runId: "20260630T000000000Z-0000",
    itemRef: item.ref,
    state: "running",
    attempt: 1,
    outcome: null,
    sessionId: null,
    brief: {},
    createdAt: "2026-06-30T00:00:00.000Z",
    updatedAt: "2026-06-30T00:00:00.000Z",
    failureReason: null,
    heartbeatAt: null,
    retryOf: null,
    reclaimedAt: null,
    node,
  };
  const record = exact ?? { ...base, ...overrides };
  const target = node ? nodePath(item, node, record.runId) : flatPath(item, record.runId);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(record, null, 2), "utf8");
  return record;
}

// Every run-record file across the union (flat entries + one level of subdirs),
// keyed by its relative path under runs/ — for exact no-new-file / byte-unchanged
// assertions.
async function unionFiles(item) {
  const runs = path.join(item.dir, "runs");
  const out = new Map();
  let entries = [];
  try {
    entries = await readdir(runs, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      for (const name of await readdir(path.join(runs, entry.name))) {
        if (!name.endsWith(".json")) continue;
        out.set(`${entry.name}/${name}`, await readFile(path.join(runs, entry.name, name), "utf8"));
      }
      continue;
    }
    if (entry.name.endsWith(".json")) {
      out.set(entry.name, await readFile(path.join(runs, entry.name), "utf8"));
    }
  }
  return out;
}

async function nodeSubdirs(item) {
  let entries = [];
  try {
    entries = await readdir(path.join(item.dir, "runs"), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

async function expectRejectsWithCode(fn, code) {
  let caught = null;
  try {
    await fn();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `expected a thrown error with code "${code}"`);
  assert.equal(caught.code, code, `the error carries code "${code}"`);
  return caught;
}

export const runNodePartitionTests = [
  // ── Scenario Outline: a minted run's placement and node key derive from the node id supplied at mint ──
  {
    name: "run-node-partition/00 a minted run's placement and node key derive from the node id supplied at mint (nested with node, flat without — never both)",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { startRun } = await import("../src/run-store.mjs");
        const now = "2026-07-02T10:00:00.000Z";

        // Row 1: node "node-a" supplied ⇒ under runs/node-a/ with the run-id leaf
        // unchanged; node key "node-a"; NOT at the flat runs/ path.
        const withNode = await milestoneItem(workDir, { slug: "mint-with-node" });
        const nested = await startRun(withNode, { node: "node-a", now });
        assert.ok(
          existsSync(nodePath(withNode, "node-a", nested.runId)),
          "the record is persisted under the runs/node-a/ subdir"
        );
        assert.deepEqual(
          await readdir(path.join(withNode.dir, "runs", "node-a")),
          [`${nested.runId}.json`],
          "the run-id leaf on disk is unchanged (byte-identical to the flat leaf form)"
        );
        const nestedOnDisk = JSON.parse(await readFile(nodePath(withNode, "node-a", nested.runId), "utf8"));
        assert.equal(nestedOnDisk.node, "node-a", "the persisted record's node key reads \"node-a\"");
        assert.ok(!existsSync(flatPath(withNode, nested.runId)), "no run record exists at the flat runs/ path");

        // Row 2: node absent ⇒ the flat legacy path; node key null; NO node subdir.
        const withoutNode = await milestoneItem(workDir, { slug: "mint-without-node" });
        const flat = await startRun(withoutNode, { now });
        assert.ok(existsSync(flatPath(withoutNode, flat.runId)), "the record is persisted at the flat legacy runs/<run-id>.json path");
        const flatOnDisk = JSON.parse(await readFile(flatPath(withoutNode, flat.runId), "utf8"));
        assert.equal(flatOnDisk.node, null, "the persisted record's node key reads null");
        assert.deepEqual(await nodeSubdirs(withoutNode), [], "no run record exists under any node subdir");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  // ── Scenario: a run minted without a node id keeps the single-node install's flat behaviour with node null appended ──
  {
    name: "run-node-partition/00 a run minted without a node id keeps the single-node flat behaviour — the thirteen legacy values verbatim, node null the one additive delta",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { startRun } = await import("../src/run-store.mjs");
        const item = await milestoneItem(workDir);
        const now = "2026-07-02T10:00:00.000Z";

        const record = await startRun(item, { now });

        // Placement: the flat legacy path, and NO node subdir exists under runs/.
        assert.ok(existsSync(flatPath(item, record.runId)), "the record is persisted at the flat legacy runs/<run-id>.json path");
        assert.deepEqual(await nodeSubdirs(item), [], "no node subdir exists under runs/");

        // The PARSED record's thirteen legacy keys carry exactly today's mint values
        // for the same injected inputs (the locked byte-identity reading: values
        // verbatim here; key ORDER is fitness #2's seam; the pretty persist is
        // unchanged — jointly byte-identity on the thirteen-key prefix).
        const onDisk = JSON.parse(await readFile(flatPath(item, record.runId), "utf8"));
        assert.equal(onDisk.state, "running", "state reads \"running\"");
        assert.equal(onDisk.attempt, 1, "attempt reads 1");
        assert.equal(onDisk.outcome, null, "outcome reads null");
        assert.equal(onDisk.retryOf, null, "retryOf reads null");
        assert.equal(onDisk.sessionId, null, "sessionId reads null (not supplied)");
        assert.deepEqual(onDisk.brief, {}, "brief reads the empty object");
        assert.equal(onDisk.createdAt, now, "createdAt reads the injected instant verbatim");
        assert.equal(onDisk.updatedAt, now, "updatedAt equals createdAt at start");
        assert.equal(onDisk.failureReason, null, "failureReason reads null");
        assert.equal(onDisk.heartbeatAt, null, "heartbeatAt reads null");
        assert.equal(onDisk.reclaimedAt, null, "reclaimedAt reads null");
        assert.equal(onDisk.itemRef, item.ref, "itemRef reads the item's ref");
        assert.equal(
          onDisk.runId,
          "20260702T100000000Z-0000",
          "runId reads the deterministic mint id for the injected instant over an empty runs/"
        );

        // The one additive delta — benign to every legacy reader.
        assert.equal(onDisk.node, null, "the record's node key reads null (the one additive delta)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  // ── Scenario Outline: run records of every generation read forward through one normalization ──
  {
    name: "run-node-partition/00 run records of every generation (nine-key m19, thirteen-key m20, fourteen-key node) read forward through one normalization",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { readRuns } = await import("../src/run-store.mjs");

        // Row 1: a nine-key milestone-19 record at the flat path — resilience keys
        // read null (defaulted, absence benign), node reads null.
        const m19Item = await milestoneItem(workDir, { slug: "gen-m19" });
        await writeRecord(m19Item, {
          exact: {
            runId: "20260629T000000000Z-0000",
            itemRef: m19Item.ref,
            state: "running",
            attempt: 1,
            outcome: null,
            sessionId: "sess-m19",
            brief: { note: "from m19" },
            createdAt: "2026-06-29T00:00:00.000Z",
            updatedAt: "2026-06-29T00:00:00.000Z",
          },
        });
        const m19Runs = await readRuns(m19Item);
        assert.equal(m19Runs.length, 1, "[nine-key] exactly one run returns and no error is raised");
        assert.equal(m19Runs[0].node, null, "[nine-key] its node key reads null");
        for (const key of ["failureReason", "heartbeatAt", "retryOf", "reclaimedAt"]) {
          assert.equal(m19Runs[0][key], null, `[nine-key] the m20 resilience key "${key}" reads null (defaulted, absence benign)`);
        }

        // Row 2: a thirteen-key milestone-20 record at the flat path — the thirteen
        // values read back verbatim, node reads null.
        const m20Item = await milestoneItem(workDir, { slug: "gen-m20" });
        const m20 = {
          runId: "20260630T000000000Z-0000",
          itemRef: m20Item.ref,
          state: "failed",
          attempt: 2,
          outcome: "failed",
          sessionId: "sess-m20",
          brief: { k: "v" },
          createdAt: "2026-06-30T00:00:00.000Z",
          updatedAt: "2026-06-30T01:00:00.000Z",
          failureReason: "timeout",
          heartbeatAt: "2026-06-30T00:30:00.000Z",
          retryOf: "20260629T000000000Z-0000",
          reclaimedAt: null,
        };
        await writeRecord(m20Item, { exact: m20 });
        const m20Runs = await readRuns(m20Item);
        assert.equal(m20Runs.length, 1, "[thirteen-key] exactly one run returns and no error is raised");
        assert.equal(m20Runs[0].node, null, "[thirteen-key] its node key reads null");
        for (const [key, value] of Object.entries(m20)) {
          assert.deepEqual(m20Runs[0][key], value, `[thirteen-key] the "${key}" value reads back verbatim as written`);
        }

        // Row 3: a fourteen-key record carrying node "node-a" under runs/node-a/ —
        // the fourteen values read back verbatim, node reads "node-a".
        const m26Item = await milestoneItem(workDir, { slug: "gen-m26" });
        const m26 = await writeRecord(m26Item, {
          node: "node-a",
          runId: "20260702T000000000Z-0000",
          sessionId: "sess-m26",
          brief: { deep: { nested: true } },
          createdAt: "2026-07-02T00:00:00.000Z",
          updatedAt: "2026-07-02T00:00:00.000Z",
        });
        const m26Runs = await readRuns(m26Item);
        assert.equal(m26Runs.length, 1, "[fourteen-key] exactly one run returns and no error is raised");
        assert.equal(m26Runs[0].node, "node-a", "[fourteen-key] its node key reads \"node-a\"");
        for (const [key, value] of Object.entries(m26)) {
          assert.deepEqual(m26Runs[0][key], value, `[fourteen-key] the "${key}" value reads back verbatim as written`);
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  // ── Scenario: reading an item's runs returns one runId-ascending union across the flat dir and every node subdir ──
  {
    name: "run-node-partition/00 reading an item's runs returns one runId-ascending union — the flat record sits BETWEEN the node records (sorted by runId, never by walk order)",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { readRuns } = await import("../src/run-store.mjs");
        const item = await milestoneItem(workDir);

        // The fixture interleaves ids across locations: the FLAT record holds the
        // MIDDLE id, so the ordering provably sorts by runId, never directory walk.
        await writeRecord(item, { node: "node-a", runId: "20260702T090000000Z-0000", state: "done", outcome: "done", createdAt: "2026-07-02T09:00:00.000Z", updatedAt: "2026-07-02T09:00:00.000Z" });
        await writeRecord(item, { node: null, runId: "20260702T100000000Z-0000", state: "done", outcome: "done", createdAt: "2026-07-02T10:00:00.000Z", updatedAt: "2026-07-02T10:00:00.000Z" });
        await writeRecord(item, { node: "node-b", runId: "20260702T110000000Z-0000", createdAt: "2026-07-02T11:00:00.000Z", updatedAt: "2026-07-02T11:00:00.000Z" });

        const runs = await readRuns(item);
        assert.equal(runs.length, 3, "exactly three runs return");
        assert.deepEqual(
          runs.map((r) => r.runId),
          ["20260702T090000000Z-0000", "20260702T100000000Z-0000", "20260702T110000000Z-0000"],
          "they are ordered runId-ascending — the flat record sits BETWEEN the node records"
        );
        assert.deepEqual(
          runs.map((r) => r.node),
          ["node-a", null, "node-b"],
          "their node keys read \"node-a\", null, and \"node-b\" respectively"
        );
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  // ── Scenario: a torn run file inside a node subdir is skipped without blinding the union ──
  {
    name: "run-node-partition/00 a torn run file inside a node subdir is skipped without blinding the union (degrades to one missing run, never a failed read)",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { readRuns } = await import("../src/run-store.mjs");
        const item = await milestoneItem(workDir);

        await writeRecord(item, { node: "node-a", runId: "20260702T090000000Z-0000" , state: "done", outcome: "done" });
        // An unparseable torn run file under runs/node-b/.
        const tornDir = path.join(item.dir, "runs", "node-b");
        await mkdir(tornDir, { recursive: true });
        await writeFile(path.join(tornDir, "20260702T100000000Z-0000.json"), '{"runId": "20260702T1000', "utf8");
        await writeRecord(item, { node: null, runId: "20260702T110000000Z-0000" });

        let runs = null;
        await assert.doesNotReject(async () => {
          runs = await readRuns(item);
        }, "no error is raised — the torn file degrades to one missing run");
        assert.equal(runs.length, 2, "exactly two runs return (the node-a record and the flat record)");
        assert.deepEqual(
          runs.map((r) => r.runId).sort(),
          ["20260702T090000000Z-0000", "20260702T110000000Z-0000"],
          "the surviving runs are the node-a record and the flat record"
        );
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  // ── Scenario Outline: a peer node's non-terminal run blocks a new mint across nodes and a terminal one does not ──
  {
    name: "run-node-partition/00 a peer node's non-terminal run blocks a new mint across nodes (duplicate-run, nothing minted anywhere) and a terminal one does not",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { startRun } = await import("../src/run-store.mjs");
        const now = "2026-07-02T12:00:00.000Z";

        const rows = [
          { peerState: "queued", outcome: null, blocks: true },
          { peerState: "running", outcome: null, blocks: true },
          { peerState: "done", outcome: "done", blocks: false },
          { peerState: "failed", outcome: "failed", blocks: false },
          { peerState: "cancelled", outcome: "cancelled", blocks: false },
        ];
        for (const row of rows) {
          const item = await milestoneItem(workDir, { slug: `dedup-${row.peerState}` });
          await writeRecord(item, {
            node: "node-a",
            state: row.peerState,
            outcome: row.outcome,
            failureReason: row.peerState === "failed" ? "timeout" : null,
          });
          const before = await unionFiles(item);

          if (row.blocks) {
            // Refused with the EXISTING code literal — one guard widened, never a
            // second code — and NOTHING minted under ANY partition of the item.
            await expectRejectsWithCode(() => startRun(item, { node: "node-b", now }), "duplicate-run");
            const after = await unionFiles(item);
            assert.deepEqual(
              [...after.keys()].sort(),
              [...before.keys()].sort(),
              `[${row.peerState}] no new run file exists under any partition of the item`
            );
          } else {
            const minted = await startRun(item, { node: "node-b", now });
            assert.ok(
              existsSync(nodePath(item, "node-b", minted.runId)),
              `[${row.peerState}] the new record is persisted under the runs/node-b/ subdir`
            );
          }
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  // ── Scenario: completing without a runId resolves the one running run inside a node subdir and persists it back at its node path ──
  {
    name: "run-node-partition/00 completing without a runId resolves the one running run inside a node subdir and persists it back AT its node path (never relocated; the flat terminal run untouched)",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { completeRun } = await import("../src/run-store.mjs");
        const item = await milestoneItem(workDir);

        const running = await writeRecord(item, { node: "node-a", runId: "20260702T100000000Z-0000" });
        await writeRecord(item, { node: null, runId: "20260702T090000000Z-0000", state: "done", outcome: "done" });
        const flatBytesBefore = await readFile(flatPath(item, "20260702T090000000Z-0000"), "utf8");

        const completed = await completeRun(item, { outcome: "done", now: "2026-07-02T11:00:00.000Z" });

        assert.equal(completed.runId, running.runId, "the node-a running run is the resolved target");
        const onDisk = JSON.parse(await readFile(nodePath(item, "node-a", running.runId), "utf8"));
        assert.equal(onDisk.state, "done", "the node-a run's state reads \"done\"");
        assert.ok(existsSync(nodePath(item, "node-a", running.runId)), "the completed record is persisted at its runs/node-a/ path");
        assert.ok(!existsSync(flatPath(item, running.runId)), "the completed record is never relocated to the flat path");
        assert.equal(onDisk.node, "node-a", "its node key still reads \"node-a\"");
        assert.equal(
          await readFile(flatPath(item, "20260702T090000000Z-0000"), "utf8"),
          flatBytesBefore,
          "the flat terminal run's file is byte-unchanged"
        );
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  // ── Scenario Outline: completion without a runId is refused when the union holds zero or several running runs ──
  {
    name: "run-node-partition/00 completion without a runId is refused across the union (ambiguous-run over any partition mix; no-running-run when only terminals) and a refusal writes nothing",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { completeRun } = await import("../src/run-store.mjs");

        const rows = [
          {
            label: "running in node-a AND running in node-b",
            code: "ambiguous-run",
            async setup(item) {
              await writeRecord(item, { node: "node-a", runId: "20260702T090000000Z-0000" });
              await writeRecord(item, { node: "node-b", runId: "20260702T100000000Z-0000" });
            },
          },
          {
            label: "running at the flat path AND running in node-a (flat+nested is ONE population)",
            code: "ambiguous-run",
            async setup(item) {
              await writeRecord(item, { node: null, runId: "20260702T090000000Z-0000" });
              await writeRecord(item, { node: "node-a", runId: "20260702T100000000Z-0000" });
            },
          },
          {
            label: "only terminal runs, spread across the flat path and a node subdir",
            code: "no-running-run",
            async setup(item) {
              await writeRecord(item, { node: null, runId: "20260702T090000000Z-0000", state: "done", outcome: "done" });
              await writeRecord(item, { node: "node-a", runId: "20260702T100000000Z-0000", state: "failed", outcome: "failed", failureReason: "timeout" });
            },
          },
        ];
        for (const row of rows) {
          const item = await milestoneItem(workDir, { slug: `refuse-${rows.indexOf(row)}` });
          await row.setup(item);
          const before = await unionFiles(item);

          await expectRejectsWithCode(
            () => completeRun(item, { outcome: "done", now: "2026-07-02T12:00:00.000Z" }),
            row.code
          );

          const after = await unionFiles(item);
          assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort(), `[${row.label}] no run file appears or disappears`);
          for (const [rel, bytes] of before) {
            assert.equal(after.get(rel), bytes, `[${row.label}] "${rel}" is byte-unchanged (a refusal writes nothing)`);
          }
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  // ── Scenario: two nodes minting at the same injected instant get distinct run ids across the union ──
  {
    name: "run-node-partition/00 two nodes minting at the same injected instant get distinct run ids across the union (-0000 then -0001, never a silent overwrite)",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { startRun } = await import("../src/run-store.mjs");
        const item = await milestoneItem(workDir);
        const now = "2026-07-02T10:00:00.000Z";

        // The pre-existing node-a run is TERMINAL (done) so the dedup guard does not
        // fire — this scenario isolates the id mint, not the guard.
        await writeRecord(item, {
          node: "node-a",
          runId: "20260702T100000000Z-0000",
          state: "done",
          outcome: "done",
          createdAt: now,
          updatedAt: now,
        });
        const nodeABytesBefore = await readFile(nodePath(item, "node-a", "20260702T100000000Z-0000"), "utf8");

        const minted = await startRun(item, { node: "node-b", now });

        assert.equal(
          minted.runId,
          "20260702T100000000Z-0001",
          "the new record's runId is 20260702T100000000Z-0001 (distinct from node-a's, same instant, next seq)"
        );
        assert.ok(existsSync(nodePath(item, "node-a", "20260702T100000000Z-0000")), "node-a's record exists under its own node subdir");
        assert.ok(existsSync(nodePath(item, "node-b", "20260702T100000000Z-0001")), "node-b's record exists under its own node subdir");
        assert.equal(
          await readFile(nodePath(item, "node-a", "20260702T100000000Z-0000"), "utf8"),
          nodeABytesBefore,
          "node-a's record file is byte-unchanged (the second mint never overwrote the first)"
        );
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];
