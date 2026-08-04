// Traceability wiring for milestone 43 / story 06 (the readers migrate), task
//   .../06_story_cache-read-surface/tasks/02_control-side-leaves-migrate-independently.feature
//
// ADR-005 STAGE 2: the remaining control-side leaves migrate onto the seam, each
// independently revertible. With `next`, `find` and `list` migrated, ALL SIX surfaces the
// operator touches (`next`/`find`/`list` + stage 1's `doc`/`tasks`/`run-status`) read a
// remote-authored item correctly after the worker's worktree is gone.
//
// THE LITMUS: every Then is confirmable from a command's `--json` document, or — for the two
// leaves with no verb of their own — from an outcome a verb CAN see. No source is read.
//
// THE REACH-THROUGH obligation is the recurring shape here: a cache-answered row's `dir` is
// not on this node, and every leaf that reads THROUGH a row into its folder must never crash,
// never fabricate a path, and never emit a record whose `source` does not resolve to real
// text. The three leaves that do so (`run-start`'s fleet sweep, `memory/local-indexing`,
// `notion/sync-work`) SKIP those rows and REPORT the skip on the durable degrade sink — which
// is an observable a disk-only enumeration structurally cannot produce, and is therefore what
// makes the assertion about the migration rather than about the fallback.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { readdir, writeFile } from "node:fs/promises";
import {
  withCacheReadFixture, withDegradeCapture, plantCacheRow, streamDoc, streamTaskFeature,
  streamRun, runCommand, writeItem, writeDoc, itemDirOf, seedActive, settle, withStore,
  removeStore, seedStalePresence, seedWorker, CONTROL_NODE, WORKER_NODE, SYNCED_AT,
} from "./support/cache-read-fixture.mjs";
import { loadWorkspace } from "../src/command-core.mjs";
import { DEGRADE_CACHE_UNAVAILABLE, DEGRADE_NO_LOCAL_CHECKOUT } from "../src/work-read.mjs";
import { reclaimStaleAssignments } from "../src/mesh-assignment-reclaim.mjs";
import { assembleActiveRunsAndSubsumedWorkspaces } from "../src/mesh-launcher.mjs";
import { listItemsCacheFirst } from "../src/work-read.mjs";
import { buildRecords } from "../src/memory/local-indexing.mjs";

// The Background: the control's own disk holds "05" and "06" it authored itself, plus ONLY
// the pre-run scaffold for "07"; no folder at all for "07/01".
const DISK_STREAM = [{ number: "05", stories: [] }, { number: "06", stories: [] }, { number: "07", stories: [] }];

const STORY_BODY = "---\ntype: story\nnumber: 01\nslug: cache-read-surface\nparent: 07\nstatus: done\n---\n# the worker's story\n";
const FEATURE = "@executable\nFeature: alpha\n\n  Scenario: one\n    Given a\n";

async function background(fx) {
  await plantCacheRow(fx, "07", { status: "done", title: "Milestone 07", slug: "m07", node: WORKER_NODE, at: SYNCED_AT });
  await plantCacheRow(fx, "07/01", { status: "done", title: "The readers migrate", slug: "cache-read-surface", parent: "07", node: WORKER_NODE, at: SYNCED_AT });
  await streamDoc(fx, { ref: "07/01", doc: "STORY", body: STORY_BODY });
  await streamTaskFeature(fx, { ref: "07/01", member: "00_alpha.feature", body: FEATURE });
  await streamRun(fx, { ref: "07/01", runId: "run-worker-1", state: "done" });
  await writeItem(fx, "07", { status: "not-started", title: "Milestone 07", slug: "m07" });
}

const rowFor = (rows, ref) => rows.find((row) => row.ref === ref) ?? null;

export const cacheReadControlLeavesTests = [
  // ==========================================================================
  // THE HEADLINE, COMPLETED: all six read surfaces answer correctly for a
  // remote-authored item whose worktree is gone
  // ==========================================================================
  {
    name: "cache-read/02 all SIX read surfaces answer correctly for a remote-authored item whose worktree is gone, and each says whose view it is",
    run: () => withCacheReadFixture(async (fx) => {
      await background(fx);

      const found = rowFor((await runCommand(fx, "work:find", { query: "07/01" })).rows, "07/01");
      assert.ok(found != null, "find resolves 07/01");
      assert.equal(found.status, "done", "…with status done");
      assert.equal(found.answeredFrom, "cache", "…answeredFrom cache");
      assert.equal(found.reportedBy, WORKER_NODE, "…reportedBy aof-wsl");

      const listed = await runCommand(fx, "work:list", {});
      const listedStory = rowFor(listed, "07/01");
      assert.ok(listedStory != null, "list lists 07/01");
      assert.equal(listedStory.parent, "07", "…under 07");
      assert.equal(listedStory.status, "done", "…with the worker's status");
      assert.equal(rowFor(listed, "07").status, "done", "…and 07 itself reads the worker's status, not the control scaffold's");

      const next = await runCommand(fx, "work:next", {});
      assert.notEqual(next.ref, "07", "next does not offer 07 as actionable (the cache says it is done)");
      assert.notEqual(next.ref, "07/01", "…nor 07/01");

      assert.equal((await runCommand(fx, "work:doc", { ref: "07/01", doc: "STORY" })).body, STORY_BODY, "doc returns the worker's STORY.md");
      assert.deepEqual((await runCommand(fx, "work:tasks", { ref: "07/01" })).tasks.map((t) => t.file), ["00_alpha.feature"], "tasks returns the worker's task features");
      assert.deepEqual((await runCommand(fx, "work:run-status", { ref: "07/01" })).runs.map((r) => r.runId), ["run-worker-1"], "run-status returns the worker's run rows");
    }, { stream: DISK_STREAM }),
  },

  // ==========================================================================
  // `next` changes a DECISION, not just a display
  // ==========================================================================
  {
    name: "cache-read/02 a driver milestone that is done only in the cache unblocks its dependent — next offers 08 instead of reporting blocked on 07",
    run: () => withCacheReadFixture(async (fx) => {
      await background(fx);
      // The control's own disk still reads 07 as not-started, and 08 depends on it.
      assert.equal((await runCommand(fx, "work:find", { query: "07" })).rows[0].answeredFrom, "cache", "07 is cache-answered (the precondition)");

      const next = await runCommand(fx, "work:next", { scope: "08" });
      assert.notEqual(next.state, "blocked", "the result is not blocked on 07");
      assert.equal(next.ref, "08", "the offered item is 08");
      assert.equal(next.answeredFrom, "disk", "the offered row reports the answering side for itself");

      // NON-VACUITY, and it is the whole point: with the cache emptied, the SAME fixture
      // blocks on 07. The disk alone cannot produce the unblocked answer.
      await removeStore(fx);
      const blocked = await runCommand(fx, "work:next", { scope: "08" });
      assert.equal(blocked.state, "blocked", "without the cache, next blocks — so the cache is what unblocked it");
      assert.deepEqual(blocked.waitingOn, ["07"], "…waiting on 07");
    }, {
      stream: [
        { number: "05", stories: [] }, { number: "06", stories: [] }, { number: "07", stories: [] },
        { number: "08", stories: [], depends: ["07"] },
      ],
    }),
  },

  // ==========================================================================
  // QA case matrix — every stage-2 leaf by name, with the observable that
  // proves it answers from the cache
  // ==========================================================================
  {
    name: "cache-read/02 the verb-bearing stage-2 leaves each answer the remote-authored ref from the cache — next / find / list / run-start / mesh-heartbeat / notion-associate / notion sync-work / memory ingest / mesh assign",
    run: () => withCacheReadFixture(async (fx) => {
      await background(fx);

      // commands/next:25 — the candidacy decision uses the cache's "done" for 07.
      const next = await runCommand(fx, "work:next", {});
      assert.notEqual(next.ref, "07", "next: the candidacy decision uses the cache's done for 07, not the scaffold's not-started");

      // commands/find:27
      assert.equal(rowFor((await runCommand(fx, "work:find", { query: "07/01" })).rows, "07/01").status, "done", "find: the row for 07/01 is returned with status done");

      // commands/list:27
      assert.equal(rowFor(await runCommand(fx, "work:list", {}), "07/01").parent, "07", "list: 07/01 appears under 07");

      // commands/run-start:119 — the fleet sweep considered 07/01 among the candidates and
      // did not fault. The SKIP LINE is the observable a disk-only sweep cannot produce.
      await withDegradeCapture(async (sink) => {
        const record = await runCommand(fx, "work:run-start", { ref: "05" });
        assert.ok(record?.runId, "run-start: the mint succeeded and the fleet sweep did not fault");
        const skips = sink.of(DEGRADE_NO_LOCAL_CHECKOUT);
        assert.ok(skips.some((entry) => /run-start/.test(entry.message) && /07\/01/.test(entry.message)),
          `run-start: the sweep CONSIDERED the cache-known 07/01 and reported skipping it (got ${JSON.stringify(sink.entries)})`);
      });

      // commands/mesh-heartbeat:70 — the reported activeRuns union includes the cache-known
      // item's run. Its record lives only in the cache, so a disk-only read cannot produce it.
      await streamRun(fx, { ref: "07/01", runId: "run-live-1", state: "running" });
      const beat = await runCommand(fx, "mesh:heartbeat", { now: "2026-08-04T10:00:00.000Z" });
      assert.ok(beat.activeRuns.includes("run-live-1"), `mesh-heartbeat: the activeRuns union includes the cache-known item's run (got ${JSON.stringify(beat.activeRuns)})`);

      // commands/notion-associate:120 — 07 resolves rather than failing ref-not-found.
      let associateError = null;
      try {
        await runCommand(fx, "notion:associate", { ref: "07", board: "none" });
      } catch (error) {
        associateError = error;
      }
      assert.notEqual(associateError?.code, "ref-not-found", "notion-associate: 07 resolves rather than failing ref-not-found");

      // notion/sync-work:121 — the projection plan covers 07 and its story 07/01.
      const sync = await runCommand(fx, "notion:sync-work", { milestone: "07", dryRun: true });
      const covered = [...sync.items.map((item) => item.ref), ...(sync.skippedNotLocal ?? [])];
      assert.ok(covered.includes("07") && covered.includes("07/01"),
        `notion sync-work: the plan covers 07 and its story 07/01 (got ${JSON.stringify(covered)})`);

      // memory/local-indexing:596 — 07 is among the items the rebuild considered. `work
      // memory` is a LADDER FACE with no registry command id, so the rebuild is reached
      // through its own core exactly as the face reaches it. The skip line is the observable
      // that only a cache-first enumeration can produce: a disk-only rebuild has no ref to
      // name.
      await withDegradeCapture(async (sink) => {
        const workspace = await loadWorkspace(fx.root, undefined, { env: fx.env });
        const records = await buildRecords(null, {
          workDir: fx.workDir, projectRoot: fx.root, workspace, globalWorkStoreOptions: { env: fx.env },
        });
        assert.ok(Array.isArray(records), "memory reindex: the rebuild ran");
        assert.ok(sink.of(DEGRADE_NO_LOCAL_CHECKOUT).some((e) => /memory reindex/.test(e.message) && /07\/01/.test(e.message)),
          `memory reindex: 07/01 was among the items the rebuild CONSIDERED (got ${JSON.stringify(sink.entries)})`);
      });

      // mesh-assignment:111 — the assignment is minted against the resolved cache-known ref.
      await seedWorker(fx, "peer-node");
      const assigned = await runCommand(fx, "mesh:assign", { ref: "07/01", to: "peer-node" });
      assert.notEqual(assigned?.code, "ref-not-found", `mesh assign: 07/01 resolves (got ${JSON.stringify(assigned)})`);
    }, { stream: DISK_STREAM, notion: true }),
  },

  // ==========================================================================
  // The two leaves with no verb of their own
  // ==========================================================================
  {
    name: "cache-read/02 the reclaim path resolves a cache-known ref, so a stale holder's item becomes re-assignable rather than being skipped as unresolvable",
    run: () => withCacheReadFixture(async (fx) => {
      await background(fx);
      assert.ok(!existsSync(itemDirOf(fx, "07/01")), "07/01 exists only in the cache (the precondition)");

      const assignmentId = await seedActive(fx, { itemRef: "07/01", node: "gone-node", state: "running" });
      // "an assignment whose holder node has gone presence-stale" — an ABSENT presence record
      // is UNKNOWN liveness and the reclaim hands off, so the holder is given a presence
      // record that is affirmatively old. That is the fixture the scenario names.
      await seedStalePresence(fx, "gone-node", "2026-08-01T00:00:00.000Z");
      await withStore(fx, (store) => {
        store.db.prepare("UPDATE global_assignments SET run_id = ?, updated_at = ? WHERE assignment_id = ?")
          .run("run-stranded", "2026-08-01T00:00:00.000Z", assignmentId);
      });

      const workspace = await loadWorkspace(fx.root, undefined, { env: fx.env });
      const reclaimed = await withStore(fx, (store) => reclaimStaleAssignments(store, workspace, fx.workspaceId, {
        now: "2026-08-04T12:00:00.000Z",
        globalWorkStoreOptions: { env: fx.env },
      }));
      // "the reclaim did not skip 07/01 as unresolvable" — before the migration the resolve
      // returned null for a ref with no local folder, so the row never reached the staleness
      // decision at all.
      assert.ok(Array.isArray(reclaimed), "the reclaim ran over the assignment rows");
      const row = await withStore(fx, (store) => store.db.prepare("SELECT state FROM global_assignments WHERE assignment_id = ?").get(assignmentId));
      assert.notEqual(row.state, "running", `the stale holder's assignment was settled, so the item is re-assignable (state ${row.state})`);

      await seedWorker(fx, "another-node");
      const reassigned = await runCommand(fx, "mesh:assign", { ref: "07/01", to: "another-node" });
      assert.notEqual(reassigned?.code, "assignment-already-active", "a fresh assign of 07/01 is no longer blocked by the stale holder");
    }, { stream: DISK_STREAM }),
  },

  {
    name: "cache-read/02 the launcher's injected item reader DEFAULTS to the seam, so the control's published union sees a cache-known item's run and reports no per-workspace fault for the absent local folder",
    run: () => withCacheReadFixture(async (fx) => {
      await background(fx);
      await streamRun(fx, { ref: "07/01", runId: "run-live-2", state: "running" });

      // The aggregation is called with its DEFAULT item reader (no injection).
      const workspace = await loadWorkspace(fx.root, undefined, { env: fx.env });
      const { activeRuns, workspacesWithRuns } = await assembleActiveRunsAndSubsumedWorkspaces(
        [{ ...workspace, workspaceId: fx.workspaceId }],
        // THE DEFAULT, spelled exactly as mesh-launcher.mjs spells it when `options.listItems`
        // is absent — this is the swap under test, not a stand-in for it.
        (workDir, ws) => listItemsCacheFirst(ws ?? { workDir, projectRoot: workDir }, {}),
      );
      assert.ok(activeRuns.includes("run-live-2"), `the union includes the run for 07/01 (got ${JSON.stringify(activeRuns)})`);
      assert.ok(workspacesWithRuns.has(fx.workspaceId), "…attributed to this workspace");
    }, { stream: DISK_STREAM }),
  },

  // ==========================================================================
  // RESIDUAL CONCERN (the architect's classification call), decided as an
  // OUTCOME: promote-gap leaves the on-disk stream gapless and valid, however
  // the insert position is derived
  // ==========================================================================
  {
    name: "cache-read/02 promoting a gap to a chore leaves the on-disk stream gapless and valid, however the position is derived",
    run: () => withCacheReadFixture(async (fx) => {
      await plantCacheRow(fx, "07", { status: "done", slug: "m07", node: WORKER_NODE, at: SYNCED_AT });
      // The control disk holds top-level items 00 and 01; the cache additionally knows 07 —
      // a ref whose NUMBER is well past the end of the real stream.

      const result = await runCommand(fx, "work:promote-gap", {
        title: "warnings_delivered field",
        discharge: "a production path writes warnings_delivered",
        yes: true,
      });
      const createdRef = result.chore?.ref;
      assert.ok(typeof createdRef === "string" && createdRef.length > 0, `the command reports the created chore's ref (got ${JSON.stringify(result)})`);

      // The created chore's folder EXISTS on this node's disk, at the ref it reported.
      const entries = (await readdir(fx.workDir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
      const created = entries.find((name) => name.startsWith(`${createdRef}_`));
      assert.ok(created != null, `the created chore's folder exists at the ref it reported (${createdRef}; dirs: ${entries.join(", ")})`);

      // The top-level folder numbers form an UNBROKEN run from 00 — the failure a
      // cache-derived count would produce is a numbering gap, and this is where it shows.
      const numbers = entries.map((name) => Number.parseInt(name.split("_")[0], 10)).sort((a, b) => a - b);
      assert.deepEqual(numbers, numbers.map((_, i) => i), `the top-level numbers form an unbroken run from 00 (got ${numbers.join(", ")})`);

      const validate = await runCommand(fx, "work:validate", {});
      assert.deepEqual(validate.findings, [], `a fresh validate over the whole stream reports zero findings (got ${JSON.stringify(validate.findings)})`);
    }, { stream: [{ number: "00", stories: [] }, { number: "01", stories: [] }] }),
  },

  // ==========================================================================
  // THE REACH-THROUGH obligation, for every leaf that reads THROUGH a row
  // ==========================================================================
  {
    name: "cache-read/02 a leaf that reads through a cache-answered row never faults and never fabricates a path — run-start's sweep, memory's rebuild and notion's projection each skip it and REPORT the skip",
    run: () => withCacheReadFixture(async (fx) => {
      await background(fx);
      assert.ok(!existsSync(itemDirOf(fx, "07/01")), "07/01 is known only to the cache and has no folder here");

      // (a) run-start's fleet sweep.
      await withDegradeCapture(async (sink) => {
        const record = await runCommand(fx, "work:run-start", { ref: "05" });
        assert.ok(record?.runId, "run-start exits successfully");
        assert.ok(sink.of(DEGRADE_NO_LOCAL_CHECKOUT).some((e) => /07\/01/.test(e.message)), "the absent local folder is REPORTED, not swallowed");
      });

      // (b) notion/sync-work's projection — the plan names 07/01 as skipped rather than
      // emitting an item whose `source` resolves to nothing.
      const sync = await runCommand(fx, "notion:sync-work", { milestone: "07", dryRun: true });
      assert.ok((sync.skippedNotLocal ?? []).includes("07/01"), `the projection reports 07/01 as skipped (got ${JSON.stringify(sync.skippedNotLocal)})`);
      for (const item of sync.items) {
        assert.notEqual(item.ref, "07/01", "…and emits no record for it");
      }

      // (c) memory's rebuild — every record's resolved source is a file that EXISTS here.
      await withDegradeCapture(async (sink) => {
        const workspace = await loadWorkspace(fx.root, undefined, { env: fx.env });
        const records = await buildRecords(null, {
          workDir: fx.workDir, projectRoot: fx.root, workspace,
          globalWorkStoreOptions: { env: fx.env },
        });
        for (const record of records) {
          if (typeof record.workRelPath !== "string") continue;
          assert.ok(existsSync(path.join(fx.workDir, record.workRelPath)), `no reported source names a file that does not exist on this node: ${record.workRelPath}`);
        }
        assert.ok(sink.of(DEGRADE_NO_LOCAL_CHECKOUT).some((e) => /memory reindex/.test(e.message) && /07\/01/.test(e.message)),
          `the rebuild reported the absent local folder (got ${JSON.stringify(sink.entries)})`);
      });
    }, { stream: DISK_STREAM, notion: true }),
  },

  // ==========================================================================
  // INDEPENDENT REVERTIBILITY, in its single-build observable form: a migrated
  // leaf changes its answer ONLY for refs the cache knows better
  // ==========================================================================
  {
    name: "cache-read/02 a disk-known ref's answer is byte-identical before and after the leaves migrate — provenance is added, nothing else changes",
    run: () => withCacheReadFixture(async (fx) => {
      await background(fx);
      const { findWork, listStream, nextWork } = await import("../src/work.mjs");

      // find 05: exactly the status, type, slug, title and parent the disk holds.
      const disk05 = (await findWork(fx.workDir, "05"))[0];
      const found05 = rowFor((await runCommand(fx, "work:find", { query: "05" })).rows, "05");
      for (const key of ["status", "type", "slug", "title", "parent", "dir"]) {
        assert.deepEqual(found05[key], disk05[key], `find 05's ${key} is exactly the disk's`);
      }
      assert.equal(found05.answeredFrom, "disk", "…and reports the answering side for itself");

      // list 05: the same rows, in the same order, as the disk emits.
      const diskRows = (await listStream(fx.workDir)).filter((row) => row.ref === "05");
      const listed = (await runCommand(fx, "work:list", {})).filter((row) => row.ref === "05");
      assert.deepEqual(
        listed.map(({ answeredFrom, reportedBy, syncedAt, ...rest }) => { void answeredFrom; void reportedBy; void syncedAt; return rest; }),
        diskRows,
        "list renders the same rows, in the same order, adding provenance without changing any other field",
      );

      // next 05: the same item the disk offers.
      const diskNext = await nextWork(fx.workDir, "05");
      const next = await runCommand(fx, "work:next", { scope: "05" });
      assert.equal(next.ref, diskNext.ref, "next 05 offers the same item");
      assert.equal(next.status, diskNext.status, "…at the same status");
    }, { stream: DISK_STREAM }),
  },

  // ==========================================================================
  // The fallback is inherited WHOLE by every leaf, not re-implemented per leaf
  // ==========================================================================
  {
    name: "cache-read/02 with the cache absent, every migrated leaf still answers from disk, says so, and lands one coded entry naming the unavailable cache",
    run: () => withCacheReadFixture(async (fx) => {
      await background(fx);
      await removeStore(fx);

      await withDegradeCapture(async (sink) => {
        const listed = await runCommand(fx, "work:list", {});
        assert.deepEqual(listed.map((row) => row.ref).sort(), ["05", "06", "07"], "list exits 0 and lists the control disk's items");
        for (const row of listed) assert.equal(row.answeredFrom, "disk", `${row.ref} reports answeredFrom disk`);
        assert.ok(sink.of(DEGRADE_CACHE_UNAVAILABLE).length >= 1, "the durable degrade sink holds a coded entry naming the unavailable cache");
      });

      const found = rowFor((await runCommand(fx, "work:find", { query: "05" })).rows, "05");
      assert.ok(found != null, "find exits 0 with the disk's row");
      assert.equal(found.answeredFrom, "disk", "…reported as a disk answer");

      const next = await runCommand(fx, "work:next", {});
      assert.equal(next.state, "ready", "next exits 0 and offers the disk's next actionable item");
      assert.equal(next.ref, "05", "…which is 05");
    }, { stream: DISK_STREAM }),
  },
];

void writeDoc; void writeFile; void settle; void CONTROL_NODE;
