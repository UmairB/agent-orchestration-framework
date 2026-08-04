// Traceability wiring for milestone 43 / story 06 (the readers migrate), task
//   .../06_story_cache-read-surface/tasks/00_seam-answers-cache-first-with-reported-fallback.feature
//
// ADR-005 STAGE 0: the cache-first read seam EXISTS and is proven against a fixture. It
// exposes cache-first equivalents of `work.mjs`'s four disk readers, each returning rows
// stamped with provenance, each falling back to disk EXPLICITLY when the cache cannot answer.
//
// THE LITMUS, as the task's header sets it: every Then is confirmable from (a) the seam
// call's own returned rows — their `answeredFrom` / `reportedBy` / `syncedAt` — or (b) the
// durable degrade sink's coded entries, an artefact the system WROTE. No source is read.
//
// ONE DEVIATION, DECLARED RATHER THAN HIDDEN. Two Thens in this feature are conditioned on
// the build being AT stage 0 — "a fresh `aof work find 02 --json` still resolves nothing (no
// call site has moved at stage 0)" and the whole zero-blast-radius scenario. This story
// delivers stages 0 THROUGH 3 in one build, so at HEAD those call sites HAVE moved and the
// CLI answers from the cache by design (task 02 requires exactly that of the same commands).
// The two claims are therefore asserted here in the form that is TRUE of the delivered
// build and that carries the same guarantee — the seam is purely ADDITIVE: `work.mjs`'s
// four disk readers, called directly, still see the disk and only the disk, cache or no
// cache. Flagged to the PO, not papered over.
//
// THE ORDERING HALF IS PROVED BY MUTATION, AND THE MUTATION IS RE-RUNNABLE (m43/ADR-016/G9 —
// "a mutation nobody can re-run is an assertion"). The harness is checked in, names its two
// mutations, aborts if either target has moved, and restores the source byte-for-byte with a
// sha256 check:
//
//     node wiki/work/43_milestone_mesh-artifact-authority/reference/staging-mutations.mjs
//
// It reverts ONE migrated call site at a time and prints the mutant's answers beside the
// unmutated baseline's. Measured 2026-08-04, from the repo root:
//
//     BASELINE (stage 3)          work find 02 → 1 row | work list holds 02: true  | work doc 02: present
//     MUTANT stage0-leaf-find     work find 02 → 0 rows| work list holds 02: true  | work doc 02: present
//     MUTANT stage1-leaves-unmoved work find 02 → 1 row| work list holds 02: FALSE | work doc 02: present
//
// Row 2 is task 00's staging Then ("no call site has moved at stage 0" ⇒ `work find 02`
// resolves nothing); row 3 is task 01's ("at stage 1 the leaves have not moved" ⇒ the leaf
// misses 02 while the CHOKEPOINT already answers for it). Neither state can coexist with
// stage 3 in one tree, which is why they are here rather than in a lane below.
import assert from "node:assert/strict";
import {
  withCacheReadFixture, withDegradeCapture, plantCacheRow, runCommand,
  removeStore, tearStore, writeItem,
  CONTROL_NODE, WORKER_NODE, SYNCED_AT,
} from "./support/cache-read-fixture.mjs";
import { loadWorkspace } from "../src/command-core.mjs";
import {
  listItemsCacheFirst, findWorkCacheFirst, listStreamCacheFirst, nextWorkCacheFirst,
  DEGRADE_CACHE_MISS, DEGRADE_CACHE_UNAVAILABLE,
} from "../src/work-read.mjs";
import { listItems, findWork, listStream, nextWork } from "../src/work.mjs";

// The Background's stream: this node's own disk holds milestones "00" and "01" ONLY.
const DISK_STREAM = [{ number: "00", stories: [] }, { number: "01", stories: [] }];

// The seam takes a workspace + the fixture's hermetic store options.
async function seamCtx(fx) {
  return {
    workspace: await loadWorkspace(fx.root, undefined, { env: fx.env }),
    options: { globalWorkStoreOptions: { env: fx.env } },
  };
}

// The Background, once: disk 00/01; the cache holds "02" reported by the REMOTE node and
// "01" reported by this control node.
async function background(fx) {
  await plantCacheRow(fx, "02", { status: "in-progress", title: "Remote milestone", node: WORKER_NODE, at: SYNCED_AT });
  // "…the cache also holds a row for 01 last reported by this control node, MATCHING ITS
  // DISK" — the title/status are the disk's own, which is what makes a later assertion that
  // the two answers differ only by the stamp a real assertion rather than a coincidence.
  await plantCacheRow(fx, "01", { status: "not-started", title: "Milestone 01", node: CONTROL_NODE, at: SYNCED_AT });
}

const rowFor = (rows, ref) => rows.find((row) => row.ref === ref) ?? null;

export const cacheReadSeamTests = [
  // ==========================================================================
  // HEADLINE, Scenario Outline ×4: each seam reader answers a cache-known ref
  // this node's disk has NEVER seen, stamped with its author
  // ==========================================================================
  ...[
    {
      reader: "listItems-equivalent",
      call: async (ws, options) => listItemsCacheFirst(ws, options),
      pick: (result) => rowFor(result, "02"),
    },
    {
      reader: "findWork-equivalent",
      call: async (ws, options) => findWorkCacheFirst(ws, "02", options),
      pick: (result) => rowFor(result, "02"),
    },
    {
      // `nextWork` answers with ONE item, so the ref is reached by SCOPING the walk to
      // driver 02 — the reader's own scope argument, not a fixture contrivance.
      reader: "nextWork-equivalent",
      call: async (ws, options) => nextWorkCacheFirst(ws, "02", options),
      pick: (result) => (result?.ref === "02" ? result : null),
    },
    {
      reader: "listStream-equivalent",
      call: async (ws, options) => listStreamCacheFirst(ws, options),
      pick: (result) => rowFor(result, "02"),
    },
  ].map(({ reader, call, pick }) => ({
    name: `cache-read/00 the seam's ${reader} answers a cache-known ref the control's disk has never seen, stamped with its author`,
    run: () => withCacheReadFixture(async (fx) => {
      await background(fx);
      const { workspace, options } = await seamCtx(fx);

      const row = pick(await call(workspace, options));
      assert.ok(row != null, `the ${reader} result includes a row for ref "02"`);
      assert.equal(row.answeredFrom, "cache", "that row reports answeredFrom cache");
      assert.equal(row.reportedBy, WORKER_NODE, "that row reports reportedBy aof-wsl");
      assert.equal(row.syncedAt, SYNCED_AT, "that row carries the syncedAt the cache holds for it, UNMODIFIED");

      // The zero-blast-radius half, in the form that is true of the delivered build (see the
      // header): the DISK reader this seam is built on still resolves nothing for "02" — the
      // seam added a capability beside work.mjs and changed nothing inside it.
      assert.deepEqual(await findWork(fx.workDir, "02"), [], "work.mjs's own findWork still resolves nothing for a cache-only ref");
    }, { stream: DISK_STREAM }),
  })),

  // ==========================================================================
  // Cache-FIRST, not cache-only: a ref held by BOTH sides is answered from the
  // cache, and the row still says so
  // ==========================================================================
  {
    name: "cache-read/00 a ref held by both sides is answered from the cache, and says so — the two sides never blend",
    run: () => withCacheReadFixture(async (fx) => {
      await background(fx);
      // The cache's row for "01" reads `done` while this node's disk frontmatter reads
      // `in-progress` — a genuine disagreement, which is the only way to tell which side won.
      await writeItem(fx, "01", { status: "in-progress" });
      await plantCacheRow(fx, "01", { status: "done", title: "Item 01", node: CONTROL_NODE, at: SYNCED_AT });
      const { workspace, options } = await seamCtx(fx);

      const row = rowFor(await findWorkCacheFirst(workspace, "01", options), "01");
      assert.ok(row != null, "the seam resolves 01");
      assert.equal(row.status, "done", "the returned row reports the CACHE's status");
      assert.equal(row.answeredFrom, "cache", "…and reports that the cache answered it");
      assert.equal(row.reportedBy, CONTROL_NODE, "…and names this control node as the reporter");
      // Non-vacuity: the disk really does say something else, so "done" cannot have come from it.
      assert.equal((await findWork(fx.workDir, "01"))[0].status, "in-progress", "the DISK says in-progress — the two sides genuinely disagree");
    }, { stream: DISK_STREAM }),
  },

  // ==========================================================================
  // The FALLBACK is a designed path, proven in both directions
  // ==========================================================================
  {
    name: "cache-read/00 a ref the cache has no row for falls back to disk, reports the fallback, fabricates no syncedAt, and lands ONE coded entry naming the miss and the ref",
    run: () => withCacheReadFixture(async (fx) => {
      await background(fx); // the cache holds 01 and 02 — and NOT 00
      const { workspace, options } = await seamCtx(fx);

      await withDegradeCapture(async (sink) => {
        const row = rowFor(await findWorkCacheFirst(workspace, "00", options), "00");
        assert.ok(row != null, "the seam still answers for 00");
        // …and the row IS the control disk's row for 00.
        const disk = (await findWork(fx.workDir, "00"))[0];
        assert.equal(row.status, disk.status, "the returned row is the control disk's row for 00");
        assert.equal(row.dir, disk.dir, "…including its own real folder");
        assert.equal(row.answeredFrom, "disk", "the returned row reports answeredFrom disk");
        assert.ok(!("syncedAt" in row), "the returned row carries NO syncedAt — an unobserved freshness is never fabricated");
        assert.ok(!("reportedBy" in row), "…and no author either");

        const misses = sink.of(DEGRADE_CACHE_MISS);
        assert.equal(misses.length, 1, `the durable degrade sink gained ONE coded entry (got ${JSON.stringify(sink.codes())})`);
        assert.match(misses[0].message, /\b00\b/, "…and the entry NAMES the ref it degraded on");
      });
    }, { stream: DISK_STREAM }),
  },

  // ==========================================================================
  // QA case matrix: whatever state the cache is in, the seam still answers, and
  // always says which side answered
  // ==========================================================================
  ...[
    {
      state: "present, holding the \"02\" row",
      prepare: async (fx) => background(fx),
      expectRefs: ["00", "01", "02"],
      expectSide: (ref) => (ref === "00" ? "disk" : "cache"),
      expectCode: DEGRADE_CACHE_MISS,
    },
    {
      state: "absent — a fresh workspace that never published",
      prepare: async (fx) => { await background(fx); await removeStore(fx); },
      expectRefs: ["00", "01"],
      expectSide: () => "disk",
      expectCode: DEGRADE_CACHE_UNAVAILABLE,
    },
    {
      state: "present but holding no row for this workspace",
      prepare: async () => {}, // the store exists (the fixture registered a descriptor) and holds no work_items row
      expectRefs: ["00", "01"],
      expectSide: () => "disk",
      expectCode: DEGRADE_CACHE_UNAVAILABLE,
    },
    {
      state: "present but TORN / unreadable",
      prepare: async (fx) => { await background(fx); await tearStore(fx); },
      expectRefs: ["00", "01"],
      expectSide: () => "disk",
      expectCode: DEGRADE_CACHE_UNAVAILABLE,
    },
  ].map(({ state, prepare, expectRefs, expectSide, expectCode }) => ({
    name: `cache-read/00 whatever state the cache is in (${state}), the seam still answers and always says which side answered`,
    run: () => withCacheReadFixture(async (fx) => {
      await prepare(fx);
      const { workspace, options } = await seamCtx(fx);

      await withDegradeCapture(async (sink) => {
        // "the call succeeds" — a read seam that could refuse to answer would be strictly
        // worse than the disk reader it replaces, so a throw here is the failure.
        const rows = await listItemsCacheFirst(workspace, options);
        assert.deepEqual(rows.map((row) => row.ref).sort(), [...expectRefs].sort(), `the rows it returns are ${expectRefs.join("/")}`);
        for (const row of rows) {
          assert.equal(row.answeredFrom, expectSide(row.ref), `${row.ref} reports its own answering side`);
        }
        assert.ok(sink.of(expectCode).length >= 1, `the durable degrade sink has gained a ${expectCode} entry (got ${JSON.stringify(sink.codes())})`);
      });
    }, { stream: DISK_STREAM }),
  })),

  // ==========================================================================
  // The degrade is reported ONCE per class, not once per row
  // ==========================================================================
  {
    name: "cache-read/00 a read that falls back for many refs reports the degrade as ONE coded class, not once per row",
    run: () => withCacheReadFixture(async (fx) => {
      await removeStore(fx);
      const { workspace, options } = await seamCtx(fx);

      await withDegradeCapture(async (sink) => {
        const rows = await listStreamCacheFirst(workspace, options);
        assert.equal(rows.length, 12, "all twelve rows are returned");
        for (const row of rows) assert.equal(row.answeredFrom, "disk", `${row.ref} reports answeredFrom disk`);
        assert.equal(
          sink.entries.length, 1,
          `the sink holds ONE coded entry for that read, not twelve (got ${sink.entries.length}: ${JSON.stringify(sink.codes())})`,
        );
        assert.equal(sink.entries[0].code, DEGRADE_CACHE_UNAVAILABLE, "…and it names the unavailable cache");
      });
    }, { stream: Array.from({ length: 12 }, (_, i) => ({ number: String(i).padStart(2, "0"), stories: [] })) }),
  },

  // ==========================================================================
  // ZERO BLAST RADIUS — asserted in the form that is TRUE of the delivered
  // build (see this file's header): the seam is purely ADDITIVE
  // ==========================================================================
  {
    name: "cache-read/00 the seam is purely additive — work.mjs's own readers answer exactly as they did before it existed, and every migrated command's answer differs by the answering-side stamp alone",
    run: () => withCacheReadFixture(async (fx) => {
      await background(fx);
      const { workspace, options } = await seamCtx(fx);

      // (a) the disk readers, untouched — they see the disk's 00/01 and nothing else.
      const diskRows = await listStream(fx.workDir);
      assert.deepEqual(diskRows.map((row) => row.ref), ["00", "01"], "listStream is the control disk's 00 and 01 alone");
      for (const row of diskRows) {
        for (const key of ["answeredFrom", "reportedBy", "syncedAt"]) {
          assert.ok(!(key in row), `no disk-reader row carries ${key}`);
        }
      }

      // (b) the migrated command's rows are the SAME values plus the stamp — nothing renamed,
      // nothing dropped, nothing retyped. That is the guarantee "answers exactly as before"
      // encodes, held over the build that actually ships.
      const listed = await runCommand(fx, "work:list", {});
      const stripped = listed
        .filter((row) => row.ref !== "02")
        .map(({ answeredFrom, reportedBy, syncedAt, ...rest }) => { void answeredFrom; void reportedBy; void syncedAt; return rest; });
      assert.deepEqual(stripped, diskRows, "every disk-known row is byte-identical once the stamp is removed");

      // (c) …and calling the seam has NO side effect on the disk readers' later answers.
      await listStreamCacheFirst(workspace, options);
      assert.deepEqual(await listStream(fx.workDir), diskRows, "the disk readers answer identically after the seam has run");
    }, { stream: DISK_STREAM }),
  },

  // ==========================================================================
  // The dependency direction, in its only observable form
  // ==========================================================================
  {
    name: "cache-read/00 work.mjs's disk readers are unchanged — they see the disk only, cache or no cache, and no provenance field appears on a disk-reader row",
    run: () => withCacheReadFixture(async (fx) => {
      await background(fx);
      // The cache holds "02" (which the disk does not) and a status for "01" that DIFFERS.
      await plantCacheRow(fx, "01", { status: "done", node: CONTROL_NODE, at: SYNCED_AT });
      await writeItem(fx, "01", { status: "in-progress" });

      const items = await listItems(fx.workDir);
      assert.deepEqual(items.map((item) => item.ref).sort(), ["00", "01"], "listItems returns exactly the disk's 00 and 01");
      for (const item of items) {
        for (const key of ["answeredFrom", "reportedBy", "syncedAt"]) {
          assert.ok(!(key in item), `no returned item carries ${key}`);
        }
      }
      const found = await findWork(fx.workDir, "01");
      assert.equal(found[0].status, "in-progress", "findWork for 01 reports the DISK's status, not the cache's");
      assert.deepEqual(await findWork(fx.workDir, "02"), [], "…and the cache-only ref is invisible to it");
      // nextWork too — the fourth reader, and the one whose DECISION the cache would change.
      const next = await nextWork(fx.workDir, "01");
      assert.equal(next.state, "ready", "nextWork still offers 01 from disk");
      assert.equal(next.status, "in-progress", "…at the DISK's status");
      assert.ok(!("answeredFrom" in next), "…carrying no answering-side stamp");
    }, { stream: DISK_STREAM }),
  },
];
