// Traceability wiring for milestone 43 / story 02 (the authority cut), task
//   .../02_story_cache-authority/tasks/07_own-disk-read-primitive-unchanged.feature
//
// The REGRESSION GUARDS this story owes, stated positively rather than left alone
// (ADR-005's discipline: a negative-only guard cannot catch a well-meaning "finish the
// migration"). The read primitive is NOT the disease — the wholesale delete-and-rebuild
// wrapped around it was — so `readWorkspaceProjectionItems` must come out of this story
// doing exactly what it did going in: reading the CALLING node's own disk to report its
// own state, which is also how the WORKER builds the frame it streams. And no reader
// migrates here: moving readers onto the cache is 43/06, wave 3, deliberately last.
//
// THE LITMUS: outsider channels only — the rows the read returns compared against a
// fresh `aof work list --json` over the SAME work dir (both are disk reads of the same
// stream), the values that reach the control's cached rows after a worker reports, and
// the shape of the rows the fleet payload / board overlay still render.
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readWorkspaceProjectionItems } from "../src/global-work-store.mjs";
import { queryGlobalMeshStatus } from "../src/global-mesh-query.mjs";
import { readWorkerItems } from "../src/board-worker-stream.mjs";
import { invoke } from "../src/command-core.mjs";
import { spawnCliSync } from "./support/cli-spawn.mjs";
import {
  withCacheFixture,
  tick,
  stream,
  rows,
  itemRow,
  writeItem,
  breakItem,
  workerWorktree,
  WORKER_A,
} from "./support/cache-authority-fixture.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "bin", "aof.mjs");
const STREAM = [{ number: "43", stories: ["01", "02", "03"] }];
const ROW_SHAPE = ["ref", "type", "slug", "status", "title", "parent", "sourcePath"];

// Background: the control's disk carries 43/01, 43/02 and 43/03; worker-a's own worktree
// carries 43/02 as in-progress.
const withFixture = (body) => () => withCacheFixture(body, { stream: STREAM });

function listJson(fx) {
  const result = spawnCliSync(process.execPath, [cliPath, "work", "list", "--json"], {
    cwd: fx.root,
    encoding: "utf8",
    env: { ...process.env, AOF_GLOBAL_HOME: fx.home, NODE_NO_WARNINGS: "1" },
  });
  assert.equal(result.status, 0, `work list --json exits 0 (stderr: ${result.stderr})`);
  return JSON.parse(result.stdout);
}

export const cacheAuthorityOwnDiskReadTests = [
  // ==========================================================================
  // Scenario: the own-disk read returns this node's disk rows in the unchanged row
  // shape
  // ==========================================================================
  {
    name: "cache-authority/07 the own-disk read takes ONE argument and returns this node's disk rows in the unchanged shape, with an unparseable record doc reported among its errors rather than as a row",
    run: withFixture(async (fx) => {
      assert.equal(readWorkspaceProjectionItems.length, 1, "the signature is unchanged — one argument");

      await breakItem(fx, "43/03");
      const read = await readWorkspaceProjectionItems(fx.workspace);

      for (const row of read.rows) {
        assert.deepEqual(Object.keys(row).sort(), [...ROW_SHAPE].sort(), `${row.ref} carries a ref, type, slug, status, title, parent and source path`);
      }

      // The same stream read by an outsider door over the same work dir.
      const listed = listJson(fx).filter((item) => item.ref !== "43/03");
      assert.deepEqual(
        read.rows.map((row) => ({ ref: row.ref, status: row.status })).sort((a, b) => a.ref.localeCompare(b.ref)),
        listed.map((item) => ({ ref: item.ref, status: item.status })).sort((a, b) => a.ref.localeCompare(b.ref)),
        "the returned refs and statuses match a fresh `aof work list --json` over the same work dir",
      );

      assert.equal(read.rows.some((row) => row.ref === "43/03"), false, "the unparseable item is not a row");
      assert.equal(read.errors.length, 1, "…it is reported among the read's errors");
      assert.match(read.errors[0].sourcePath, /03_story_s43-03\/STORY\.md$/);
    }),
  },

  // ==========================================================================
  // Scenario: the own-disk read reports the caller's disk even when the cache says
  // something different
  // ==========================================================================
  {
    name: "cache-authority/07 the own-disk read answers from DISK even when the cache disagrees — worker-a's in-progress row does not change what the control reads about its own checkout",
    run: withFixture(async (fx) => {
      await tick(fx);
      await stream(fx, WORKER_A, [itemRow("43/02", { status: "in-progress", title: "worker 43/02" })]);
      assert.equal((await rows(fx)).get("43/02").status, "in-progress", "the cached row disagrees with the control's disk (non-vacuous)");

      const read = await readWorkspaceProjectionItems(fx.workspace);
      const row = read.rows.find((entry) => entry.ref === "43/02");
      assert.equal(row.status, "not-started", "it reports the status on the control's OWN disk, not the cached status");
    }),
  },

  // ==========================================================================
  // Scenario: the worker's frame-building read still reads the worker's own
  // worktree
  // ==========================================================================
  {
    name: "cache-authority/07 the worker's frame is built from the WORKER's OWN worktree — a different directory entirely — and those values reach the cache while the control's own disk says something else throughout",
    run: withFixture(async (fx) => {
      await tick(fx);

      // A SECOND work dir, not the control's. Reading the control's own directory and
      // calling it "the worker's worktree" would prove a temporal ordering and nothing
      // about SOURCE — the two must be able to disagree at every instant of this test.
      const worktree = await workerWorktree(fx, ["43", "43/02"]);
      assert.notEqual(worktree.workDir, fx.workDir, "the worker reads a different directory (the whole point)");
      await writeItem(fx, "43/02", { workDir: worktree.workDir, status: "in-progress", title: "as the worker's worktree has it" });

      // …and the control's disk says something ELSE about the same ref, BEFORE the
      // worker reads, so no ordering can explain the outcome.
      await writeItem(fx, "43/02", { status: "blocked", title: "the control's stale opinion" });

      const built = await readWorkspaceProjectionItems(worktree.workspace);
      const carried = built.rows.filter((row) => row.ref === "43/02");
      assert.equal(carried.length, 1, "the worker built a row for the ref it is working (non-vacuous)");
      assert.equal(carried[0].title, "as the worker's worktree has it", "…from its own worktree, not the control's disk");

      await stream(fx, WORKER_A, carried);

      const cached = (await rows(fx)).get("43/02");
      assert.equal(cached.status, "in-progress", "the cached row carries the status on the worker's own worktree");
      assert.equal(cached.title, "as the worker's worktree has it");

      // The control's disk keeps saying something else, and keeps not mattering.
      await writeItem(fx, "43/02", { status: "done", title: "the control's second stale opinion" });
      await tick(fx);
      const still = (await rows(fx)).get("43/02");
      assert.equal(still.title, "as the worker's worktree has it", "unaffected by what the control's disk says, on this tick and the next");
      const controlDisk = (await readWorkspaceProjectionItems(fx.workspace)).rows.find((row) => row.ref === "43/02");
      assert.equal(controlDisk.title, "the control's second stale opinion", "…while the control's own disk read still reports the control's own disk");
    }),
  },

  // ==========================================================================
  // Scenario: the cached-row read surface keeps its shape, so the board overlay and
  // the fleet payload still answer
  // ==========================================================================
  {
    name: "cache-authority/07 the cached-row read surface keeps its shape — the fleet status payload renders those rows as its items and the board's mesh overlay resolves 43/02 from them",
    run: withFixture(async (fx) => {
      await tick(fx);
      await stream(fx, WORKER_A, [itemRow("43/02", { status: "in-progress", title: "worker 43/02" })]);

      for (const [ref, row] of await rows(fx)) {
        assert.deepEqual(Object.keys(row).sort(), [...ROW_SHAPE].sort(), `${ref} keeps the row shape across the cut`);
      }

      const status = await queryGlobalMeshStatus(fx.workspace, { globalWorkStoreOptions: { env: fx.env } });
      const item = status.items.find((entry) => entry.ref === "43/02");
      assert.ok(item != null, "the fleet status payload renders those rows as its items");
      assert.equal(item.status, "in-progress", "…carrying the worker's reported value");

      const overlay = await readWorkerItems(fx.workspace, { refs: ["43/02"], globalWorkStoreOptions: { env: fx.env } });
      assert.equal(overlay.get("43/02")?.status, "in-progress", "the board's mesh overlay resolves 43/02 from them");
      assert.deepEqual(Object.keys(overlay.get("43/02")).sort(), [...ROW_SHAPE].sort(), "…in the same row shape it always rendered");
    }),
  },

  // ==========================================================================
  // Scenario: the disk-based read commands are unchanged by this story
  //
  // AMENDED at 43/06 (ADR-005; ADR-014/E1's enumerate-and-amend rule). This scenario pinned
  // 43/02's SCOPE — "the authority cut moves the WRITE side; no reader migrates HERE" — and
  // 43/06 is, by name and by ADR, the story that migrates them. The claim it made about THIS
  // story is unchanged and is still asserted: 43/02 changed no reader, and work.mjs's disk
  // readers still answer from the control's own disk. What it can no longer assert is the
  // state of the COMMANDS after the reader story, so their new answer is asserted alongside
  // it — the pair is the point, and this file records the supersession rather than quietly
  // losing a scenario.
  // ==========================================================================
  {
    name: "cache-authority/07 this story moves the WRITE side only — the cached row carries the worker's value, work.mjs's disk readers still see the control's own disk, and the commands that migrate onto the cache at 43/06 report it as a cache answer",
    run: withFixture(async (fx) => {
      await tick(fx);
      await stream(fx, WORKER_A, [itemRow("43/02", { status: "in-progress", title: "worker 43/02" })]);
      assert.equal((await rows(fx)).get("43/02").status, "in-progress", "the cached row disagrees with the control's disk (non-vacuous)");

      // 43/02's own deliverable, unchanged: work.mjs's disk readers — the ones this story
      // never touched, and which 43/06 pins to disk positively — still say not-started.
      const { findWork, listStream } = await import("../src/work.mjs");
      assert.equal((await findWork(fx.workDir, "43/02"))[0].status, "not-started", "the control's own disk still reads not-started");
      assert.equal((await listStream(fx.workDir)).find((row) => row.ref === "43/02").status, "not-started", "…and the disk reader reports it");

      // …and from 43/06 the COMMANDS answer from the cache, saying which side answered —
      // EXCEPT on this one CLI face (m43 / ADR-016/G1). `aof work list --json` is m03/ADR-002's
      // frozen seven-field array, and the milestone's review ruled the answering-side stamp a
      // FACE concern that rides `/api/work/list`, `work find --json` and `work next --json`
      // rather than widening a machine contract. So the migration is asserted here by the
      // VALUE and by the shape, and the stamp is asserted immediately below on `work find`,
      // which keeps it. Both halves; neither dropped.
      const listed = listJson(fx).find((item) => item.ref === "43/02");
      assert.equal(listed.status, "in-progress", "`work list --json` reports the worker's value (43/06)");
      assert.deepEqual(
        Object.keys(listed).sort(),
        ["dir", "parent", "ref", "slug", "status", "title", "type"],
        "…in m03/ADR-002's seven frozen fields EXACTLY — the answering-side stamp never reaches this array",
      );

      const found = await invoke("work:find", { query: "43/02" }, fx.ctx);
      const hit = found.rows.find((row) => row.ref === "43/02");
      assert.ok(hit != null, "`work find 43/02 --json` resolves the item");
      assert.equal(hit.status, "in-progress", "…with the worker's value");
      assert.equal(hit.answeredFrom, "cache", "…reported as a cache answer");
    }),
  },
];
