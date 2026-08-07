// Traceability wiring for milestone 19 / story 00 — the run-record store.
//
// Covers EVERY @executable scenario in tasks/00_run-record-store.feature,
// exercising the REAL src/run-store.mjs in-process against a temp fixture repo
// (mkdtemp → mkdir → writeFile → run → rm in finally). One test object per
// @executable scenario (Scenario-Outline rows folded into one entry), each name
// tracing to feature + scenario. node:assert/strict.
//
//   00_run-record-store.feature — create persists ONE runs/<run-id>.json carrying
//     the frozen schema (sortable runId, itemRef, state, attempt, outcome,
//     sessionId, opaque brief, createdAt/updatedAt); read returns the item's runs;
//     a story's runs live under the story folder's own runs/.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// The FOURTEEN frozen schema keys, IN ORDER (26/ADR-001 SUPERSEDES 20/ADR-001's
// thirteen-key freeze, which superseded 19/ADR-003's nine): the original nine,
// unchanged in name/order/meaning, then the four additive resilience keys
// (failureReason, heartbeatAt, retryOf, reclaimedAt), then the one additive
// partition-provenance key (node, defaulting null).
const FROZEN_KEYS = ["runId", "itemRef", "state", "attempt", "outcome", "sessionId", "brief", "createdAt", "updatedAt", "failureReason", "heartbeatAt", "retryOf", "reclaimedAt", "node", "resumeAfter"];

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const RUNID_RE = /^(\d{8}T\d{9}Z)-(\d{4})$/;

// --- fixture builders --------------------------------------------------------

async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-runstore-rec-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(workDir, { recursive: true });
  return { repo, workDir };
}

// A milestone item shaped like the row findWork/listItems produce: the store only
// needs item.dir (to build runs/ paths) and item.ref (to stamp itemRef).
async function milestoneItem(workDir, { number = "19", slug = "work-run-lifecycle" } = {}) {
  const dir = path.join(workDir, `${number}_milestone_${slug}`);
  await mkdir(dir, { recursive: true });
  return { ref: number, dir };
}

async function storyItem(workDir, { milestoneSlug = "work-run-lifecycle", mNumber = "19", number = "00", slug = "run-store" } = {}) {
  const dir = path.join(workDir, `${mNumber}_milestone_${milestoneSlug}`, "stories", `${number}_story_${slug}`);
  await mkdir(dir, { recursive: true });
  return { ref: `${mNumber}/${number}`, dir };
}

async function runFiles(item) {
  try {
    return (await readdir(path.join(item.dir, "runs"))).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
}

export const runStoreRecordTests = [
  {
    name: "run-store/00 starting a run persists exactly one JSON file under the item's runs/ directory",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { startRun } = await import("../src/run-store.mjs");
        const item = await milestoneItem(workDir);
        // no runs/ directory yet
        assert.equal(existsSync(path.join(item.dir, "runs")), false, "no runs/ dir before the first start");

        const record = await startRun(item);
        const files = await runFiles(item);
        assert.equal(files.length, 1, "the runs/ dir contains exactly one file");
        assert.equal(files[0], `${record.runId}.json`, "the file is named <runId>.json for the new run");

        const parsed = JSON.parse(await readFile(path.join(item.dir, "runs", files[0]), "utf8"));
        assert.equal(parsed.runId, record.runId, "the file parses as JSON carrying the run record");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "run-store/00 a new run record carries the complete frozen schema in its initial running shape",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { startRun } = await import("../src/run-store.mjs");
        const item = await milestoneItem(workDir);

        const record = await startRun(item, { sessionId: "sess-abc" });
        assert.equal(typeof record.runId, "string", "runId is a string");
        assert.ok(record.runId.length > 0, "runId is non-empty");
        assert.equal(record.itemRef, "19", "itemRef is 19");
        assert.equal(record.state, "running", "state is running");
        assert.equal(record.attempt, 1, "attempt is 1");
        assert.equal(record.outcome, null, "outcome is null (not yet terminal)");
        assert.equal(record.sessionId, "sess-abc", "sessionId is the supplied value");
        assert.equal(typeof record.brief, "object", "brief is an object");
        assert.ok(record.brief !== null, "brief is a non-null object");
        assert.match(record.createdAt, ISO_RE, "createdAt is an ISO-8601 instant");
        assert.match(record.updatedAt, ISO_RE, "updatedAt is an ISO-8601 instant");
        assert.equal(record.createdAt, record.updatedAt, "createdAt and updatedAt are equal at start");
        // carries no field outside the frozen schema — exactly the fourteen keys, in order
        assert.deepEqual(Object.keys(record), FROZEN_KEYS, "carries exactly the fourteen frozen schema keys in order");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "run-store/00 the runId encodes the createdAt instant and a zero-padded per-item sequence",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { startRun } = await import("../src/run-store.mjs");
        const item = await milestoneItem(workDir);

        const record = await startRun(item);
        const match = record.runId.match(RUNID_RE);
        assert.ok(match, `runId "${record.runId}" matches the form <createdAt-compact>-<seq>`);
        const [, compact, seq] = match;
        assert.equal(seq, "0000", "the <seq> segment is 0000 for the item's first run");
        // <createdAt-compact> equals the run's createdAt with punctuation stripped
        const expectedCompact = record.createdAt.replace(/[-:.]/g, "");
        assert.equal(compact, expectedCompact, "the <createdAt-compact> segment equals createdAt with punctuation stripped");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "run-store/00 runIds started in sequence are distinct and sort lexically into creation order",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        // 20/ADR-006 dedup forbids two non-terminal runs per item, so each run is
        // completed before the next is started — they are still distinct, sortable
        // runs over the item's lifetime (the seq counts terminal files too).
        const { startRun, completeRun } = await import("../src/run-store.mjs");
        const item = await milestoneItem(workDir);

        const created = [];
        for (let i = 0; i < 3; i += 1) {
          created.push((await startRun(item)).runId);
          await completeRun(item, { outcome: "done" });
        }
        assert.equal(new Set(created).size, 3, "the 3 run records have 3 distinct runIds");
        const sorted = [...created].sort();
        assert.deepEqual(sorted, created, "sorting the runIds lexically yields them in creation order");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "run-store/00 two runs created at the same instant get distinct runIds via the sequence segment",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { startRun, completeRun } = await import("../src/run-store.mjs");
        const item = await milestoneItem(workDir);

        // the SAME injected createdAt for both — only the seq segment disambiguates.
        // The first is completed before the second is minted (20/ADR-006 dedup), so
        // the second's seq seeds from the one existing (terminal) file → 0001.
        const now = "2026-06-29T17:30:45.123Z";
        const first = await startRun(item, { now });
        await completeRun(item, { outcome: "done" });
        const second = await startRun(item, { now });

        assert.notEqual(first.runId, second.runId, "the two runIds are distinct");
        const [, c1, s1] = first.runId.match(RUNID_RE);
        const [, c2, s2] = second.runId.match(RUNID_RE);
        assert.equal(c1, c2, "the two runIds share an identical <createdAt-compact> segment");
        assert.equal(s1, "0000", "the first <seq> is 0000");
        assert.equal(s2, "0001", "the second <seq> is 0001");
        assert.deepEqual([first.runId, second.runId].sort(), [first.runId, second.runId], "sorting lexically yields them in creation order");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "run-store/00 a flat structured brief is persisted opaque and round-trips unchanged",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { startRun, readRuns } = await import("../src/run-store.mjs");
        const item = await milestoneItem(workDir);

        const brief = { workspace: "/w/space", initiator: "operator", resources: ["a", "b"] };
        await startRun(item, { brief });
        const [reloaded] = await readRuns(item);
        assert.deepEqual(reloaded.brief, brief, "the brief round-trips byte-equivalent");
        // byte-equivalent: identical JSON serialization
        assert.equal(JSON.stringify(reloaded.brief), JSON.stringify(brief), "the brief serializes identically");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "run-store/00 a deeply nested brief round-trips byte-equivalent through persistence",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { startRun, readRuns } = await import("../src/run-store.mjs");
        const item = await milestoneItem(workDir);

        // nested object + array of objects + mixed scalar types at depth 3
        const brief = {
          workspace: "ws-1",
          resources: {
            inputs: [
              { name: "a", count: 3, active: true, note: null },
              { name: "b", count: 0, active: false, note: "x" },
            ],
            nested: { level2: { level3: { flag: true, n: 42, s: "deep", nothing: null } } },
          },
        };
        await startRun(item, { brief });
        const [reloaded] = await readRuns(item);
        assert.deepEqual(reloaded.brief, brief, "the deeply nested brief round-trips byte-equivalent");
        // key-order preserved through the JSON round-trip (byte-equivalent serialization)
        assert.equal(JSON.stringify(reloaded.brief), JSON.stringify(brief), "nested keys appear in the same order they were passed");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "run-store/00 sessionId is recorded when supplied and null when omitted (Scenario Outline)",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { startRun } = await import("../src/run-store.mjs");

        // Examples: with sessionId "sess-xyz" → "sess-xyz" ; with no sessionId → null
        const rows = [
          { args: { sessionId: "sess-xyz" }, recorded: "sess-xyz" },
          { args: {}, recorded: null },
        ];
        for (const { args, recorded } of rows) {
          const item = await milestoneItem(workDir, { slug: `s-${recorded ?? "none"}` });
          const record = await startRun(item, args);
          assert.equal(record.sessionId, recorded, `sessionId is ${JSON.stringify(recorded)}`);
          assert.ok("sessionId" in record, "the record always has a sessionId key present");
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "run-store/00 reading an item's runs returns every persisted run for that item",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { startRun, readRuns, completeRun } = await import("../src/run-store.mjs");
        const item = await milestoneItem(workDir);

        // 20/ADR-006 dedup: complete the first before starting the second.
        await startRun(item);
        await completeRun(item, { outcome: "done" });
        await startRun(item);
        const runs = await readRuns(item);
        assert.equal(runs.length, 2, "I get 2 run records");
        assert.ok(runs.every((run) => run.itemRef === "19"), "every record's itemRef is 19");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "run-store/00 a persisted run reloads from disk with its frozen schema intact",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { startRun } = await import("../src/run-store.mjs");
        const item = await milestoneItem(workDir);

        const brief = { resources: { nested: { k: "v" } } };
        await startRun(item, { sessionId: "sess-load", brief });

        // a FRESH store load (a re-import is the in-process analogue of a fresh process)
        const fresh = await import("../src/run-store.mjs?fresh-record");
        const runs = await fresh.readRuns(item);
        assert.equal(runs.length, 1, "I get 1 run record");
        const [record] = runs;
        assert.equal(record.sessionId, "sess-load", "the record's sessionId survives the round-trip");
        assert.deepEqual(record.brief, brief, "the record's brief equals the persisted object byte-equivalent");
        assert.deepEqual(Object.keys(record), FROZEN_KEYS, "the record carries all fourteen frozen schema fields");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "run-store/00 a story's runs live under the story folder's own runs/, not the milestone's",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const { startRun } = await import("../src/run-store.mjs");
        const milestone = await milestoneItem(workDir);
        const story = await storyItem(workDir);

        const record = await startRun(story);
        // the run file is written under the STORY folder's runs/ dir
        const storyRunPath = path.join(story.dir, "runs", `${record.runId}.json`);
        assert.ok(existsSync(storyRunPath), "the run file is under the story 19/00 folder's runs/ dir");
        assert.equal(record.itemRef, "19/00", "the run record itemRef is 19/00");
        // the milestone's runs/ dir does NOT contain that run
        const milestoneRuns = await runFiles(milestone);
        assert.equal(milestoneRuns.includes(`${record.runId}.json`), false, "the milestone 19 runs/ dir does not contain that run");
        assert.equal(existsSync(path.join(milestone.dir, "runs")), false, "the milestone has no runs/ dir at all");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];
