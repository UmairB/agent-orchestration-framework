// Traceability wiring for milestone 43 / story 06 (the readers migrate), task
//   .../06_story_cache-read-surface/tasks/03_worker-and-structural-readers-stay-on-disk.feature
//
// ADR-005 STAGE 3: the boundary is locked in BOTH directions. The NON-migration is a
// first-class coverage obligation, not an omission.
//
// WHY THIS NEEDS SCENARIOS AND NOT JUST A GUARD: a later well-meaning "finish the migration"
// that moved a worker onto the control's cache would make A WORKER READ SOMEONE ELSE'S
// OPINION OF ITS OWN CHECKOUT — a closed loop in which the control's copy of the worker's
// state becomes the worker's own input, and the value becomes self-reinforcing rather than
// observed. A structural operation moved onto the cache would rename, renumber or rewrite
// against a set that is not the set on disk. Both are behavioural failures with behavioural
// symptoms; both are below.
//
// THE SOURCE-LEVEL POSITIVE ASSERTION IS NOT HERE — "these modules still import work.mjs's
// disk readers" lives in `acd-cache-read-surface-boundary`. What is here is the BEHAVIOUR
// that assertion protects.
//
// NON-VACUITY IS THE WHOLE RISK IN THIS FILE, and it is designed for explicitly. An assertion
// that a reader did NOT migrate can pass because nothing migrated, because the fixture never
// made the two sides disagree, or because the cache was empty. Every scenario below therefore
// (a) makes the two sides disagree DELIBERATELY and asserts that the disagreement is visible
// from the OTHER side too, so a fixture in which the cache says nothing would fail its own
// precondition, and (b) where a positive/negative pair exists, asserts BOTH — the cache-only
// ref draws nothing AND the on-disk fact still draws its finding. The suite was additionally
// verified by MUTATION: pointing each pinned reader at the seam turns the matching scenarios
// red (recorded in the story's build report).
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { readdir, writeFile } from "node:fs/promises";
import {
  withCacheReadFixture, plantCacheRow, streamDoc, runCommand, writeItem, writeDoc,
  itemDirOf, workerTree, tick, rows, authorOf, withStore,
  CONTROL_NODE, WORKER_NODE, SYNCED_AT,
} from "./support/cache-read-fixture.mjs";
import { loadWorkspace, invoke } from "../src/command-core.mjs";
import { listItems, findWork, listStream, nextWork } from "../src/work.mjs";
import { readWorkspaceProjectionItems } from "../src/global-work-store.mjs";
import { publishGlobalWorkSnapshot } from "../src/global-work-publisher.mjs";

// The Background stream: this node's disk holds 00 through 05, the control's own work.
const DISK_STREAM = Array.from({ length: 6 }, (_, i) => ({ number: String(i).padStart(2, "0"), stories: [] }));

export const cacheReadBoundaryHoldsTests = [
  // ==========================================================================
  // THE ECHO-CHAMBER TEST — the decisive worker-side scenario
  // ==========================================================================
  {
    name: "cache-read/03 a worker reports its own worktree's state, never the control's copy of it — the cache holds a status a DIFFERENT node authored, and the worker's own tree wins",
    run: () => withCacheReadFixture(async (fx) => {
      // "the control node's cache holds 07/01 at status in-progress, last reported by a
      // DIFFERENT node" — and the worker's own worktree holds it at `done`, which it authored.
      await plantCacheRow(fx, "07", { status: "in-progress", slug: "m07", node: "some-other-node", at: SYNCED_AT });
      await plantCacheRow(fx, "07/01", { status: "in-progress", slug: "s07-01", parent: "07", node: "some-other-node", at: SYNCED_AT });

      const worker = await workerTree(fx, ["07", "07/01"], "worker-tree");
      await writeItem(fx, "07/01", { status: "done", workDir: worker.workDir });

      // PRECONDITION, asserted rather than assumed: the two sides genuinely disagree. A
      // fixture where the cache says nothing would make every Then below vacuous.
      assert.equal((await rows(fx)).get("07/01").status, "in-progress", "the cache genuinely holds the OTHER node's in-progress");

      // "When the worker's next stream tick reports its active worktree state" — the frame a
      // worker actually streams is built by reading ITS OWN checkout through
      // readWorkspaceProjectionItems, which is exactly the read ADR-005 pins to disk.
      const frame = await readWorkspaceProjectionItems(worker.workspace);
      const reported = frame.rows.find((row) => row.ref === "07/01");
      assert.equal(reported.status, "done", "the state the worker reports for 07/01 is DONE — its own, not the control's copy");

      // …and the same is true of the COMMANDS run INSIDE the worker's worktree. This is the
      // door the boundary nearly lost: those commands are migrated control-side leaves, and a
      // per-assignment worktree reports under the SAME workspace id as the control — so
      // without the worktree check in the seam, `work find` here answered with the OTHER
      // node's `in-progress` over the worktree's own freshly-authored `done`. Asserted through
      // `invoke`, not through `work.mjs` directly, because the direct call cannot see it.
      const workerCtx = { workspace: worker.workspace, globalWorkStoreOptions: { env: fx.env } };
      const insideFind = await invoke("work:find", { query: "07/01" }, workerCtx);
      assert.equal(insideFind.rows[0].status, "done", "`work find 07/01` INSIDE the worker's worktree reports done — its own value");
      assert.equal(insideFind.rows[0].answeredFrom, "disk", "…answered from the checkout in front of it");
      const insideList = await invoke("work:list", {}, workerCtx);
      assert.equal(insideList.find((row) => row.ref === "07/01").status, "done", "`work list` inside the worktree reports the worktree's own rows, not the control's");
      for (const row of insideList) {
        assert.equal(row.answeredFrom, "disk", `${row.ref}: every row inside a worktree is answered from its own disk`);
      }

      // NON-VACUITY, and the control of this whole scenario: the SAME cache, read from the
      // CONTROL node, does answer `in-progress`. So the worktree's `done` is the boundary
      // holding, not the cache being empty.
      const onControl = await runCommand(fx, "work:find", { query: "07/01" });
      assert.equal(onControl.rows[0].status, "in-progress", "the control node reads the cache's in-progress for the same ref");
      assert.equal(onControl.rows[0].answeredFrom, "cache", "…from the cache");

      // …and the disk readers the worker's EXECUTION path uses are untouched either way.
      assert.equal((await findWork(worker.workDir, "07/01"))[0].status, "done", "work.mjs's own findWork reads the worktree's disk");
      for (const row of await listStream(worker.workDir)) {
        assert.ok(!("answeredFrom" in row), `${row.ref}: a disk-reader row carries no answering-side stamp — it never consulted a cache`);
      }
    }, { stream: DISK_STREAM }),
  },

  // ==========================================================================
  // The worker's CONTENT read: the bodies it streams are its own bytes
  // ==========================================================================
  {
    name: "cache-read/03 the artifact bodies a worker streams are its own worktree's bytes — a newer body replaces the cache's older copy, and repeating the tick does not revert it",
    run: () => withCacheReadFixture(async (fx) => {
      const OLD = "# the OLD body the control cached\n";
      const NEW = "# the NEWER body the worker just wrote\n";
      await plantCacheRow(fx, "07", { status: "in-progress", slug: "m07", node: WORKER_NODE, at: SYNCED_AT });
      await plantCacheRow(fx, "07/01", { status: "in-progress", slug: "s07-01", parent: "07", node: WORKER_NODE, at: SYNCED_AT });
      await streamDoc(fx, { ref: "07/01", doc: "STORY", body: OLD });
      assert.equal((await runCommand(fx, "work:doc", { ref: "07/01", doc: "STORY" })).body, OLD, "the control's cache genuinely holds the OLD body (the precondition)");

      // The worker's worktree holds a NEWER body, which it just wrote.
      const worker = await workerTree(fx, ["07", "07/01"], "worker-tree");
      const storyPath = path.join(worker.workDir, "07_milestone_m07", "stories", "01_story_s07-01", "STORY.md");
      await writeFile(storyPath, NEW, "utf8");

      // The worker's content read is the store's own WORKER-side reader — the one
      // `acd-cache-read-surface-boundary` pins positively — and it reads the bytes in front
      // of it. Streaming those bytes up is what makes the control's copy converge.
      // NOTE (flagged to the architect, not fixed here): ADR-005 pins "the WORKER-side content
      // read" as `global-work-store:601` and `acd-cache-read-surface-boundary` pins
      // `global-work-store.mjs`'s `listItems` import for it — but `readWorkspaceContentRecords`
      // has since MOVED to `src/work-content-read.mjs`. The arch test is green on a DIFFERENT
      // `listItems` caller in that file (`readWorkspaceProjectionItems`, the dual-use read
      // ADR-005 says is not a reader that must migrate), so the source-level pin no longer
      // covers the function it was written to protect. This behavioural proof does.
      const { readWorkspaceContentRecords } = await import("../src/work-content-read.mjs");
      const streamed = await readWorkspaceContentRecords(worker.workspace);
      const doc = streamed.docs.find((entry) => entry.ref === "07/01" && entry.doc === "STORY");
      assert.ok(doc != null, "the worker's content read produced its STORY body");
      assert.equal(doc.body, NEW, "…and it is the worker's NEWER bytes, not the cache's older copy");

      // Apply it exactly as the control's frame door does, then read back on the CONTROL.
      await streamDoc(fx, { ref: "07/01", doc: "STORY", body: doc.body, at: "2026-08-04T10:00:00.000Z" });
      assert.equal((await runCommand(fx, "work:doc", { ref: "07/01", doc: "STORY" })).body, NEW, "a fresh `work doc` on the CONTROL returns the worker's newer body");

      // "repeating the tick with no further edit leaves that body unchanged rather than
      // reverting it" — the echo-chamber symptom would be the OLD body coming back.
      const again = await readWorkspaceContentRecords(worker.workspace);
      const doc2 = again.docs.find((entry) => entry.ref === "07/01" && entry.doc === "STORY");
      assert.equal(doc2.body, NEW, "the second tick reads the same bytes — never the control's copy of them");
      await streamDoc(fx, { ref: "07/01", doc: "STORY", body: doc2.body, at: "2026-08-04T10:01:00.000Z" });
      assert.equal((await runCommand(fx, "work:doc", { ref: "07/01", doc: "STORY" })).body, NEW, "…and the control still reads the newer body");
    }, { stream: DISK_STREAM }),
  },

  // ==========================================================================
  // A worker resolving the ref it is EXECUTING resolves against its own checkout
  // ==========================================================================
  {
    name: "cache-read/03 a worker resolves the ref it is executing against its OWN materialised worktree, never against a dir derived from the control's view",
    run: () => withCacheReadFixture(async (fx) => {
      const worker = await workerTree(fx, ["07", "07/01"], "worker-tree");
      // The control's cache holds a `dir` (its `source_path`) that reflects the CONTROL's
      // paths — the value a migrated worker would resolve against.
      const controlPath = `${fx.workDir.replaceAll("\\", "/")}/07_milestone_m07/stories/01_story_s07-01/STORY.md`;
      await plantCacheRow(fx, "07", { status: "in-progress", slug: "m07", node: CONTROL_NODE, at: SYNCED_AT });
      await plantCacheRow(fx, "07/01", { status: "in-progress", slug: "s07-01", parent: "07", sourcePath: controlPath, node: CONTROL_NODE, at: SYNCED_AT });

      // The WORKER's own resolution — `findWork` against its materialised worktree, which is
      // the read `mesh-worker-execution` performs to point an agent at a directory.
      const resolved = (await findWork(worker.workDir, "07/01"))[0];
      assert.ok(resolved != null, "the worker resolves the ref it is executing");
      assert.ok(
        resolved.dir.replaceAll("\\", "/").startsWith(worker.workDir.replaceAll("\\", "/")),
        `the resolved directory is inside the WORKER's own worktree (got ${resolved.dir})`,
      );
      assert.ok(
        !resolved.dir.replaceAll("\\", "/").startsWith(fx.workDir.replaceAll("\\", "/")),
        "…and NOT under the control node's paths, which is what the cache would have handed it",
      );
      assert.ok(existsSync(resolved.dir), "the agent would be started against a directory that exists on this machine");
    }, { stream: DISK_STREAM }),
  },

  // ==========================================================================
  // QA case matrix — the STRUCTURAL operations act on the folders on disk
  // ==========================================================================
  ...[
    {
      label: "work-reindex (via insert)",
      id: "work:insert-milestone",
      input: { slug: "widget-support", at: 3, yes: true },
      observable: async (fx, result) => {
        // "it reports shifting exactly the 3 on-disk items numbered 3 and above" — the
        // number a cache-derived count would get wrong.
        assert.equal(result.shifted, 3, `the insert reports shifting exactly the on-disk items numbered 3 and above (got ${result.shifted})`);
        const names = (await readdir(fx.workDir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
        assert.ok(names.some((name) => name.startsWith("03_milestone_widget-support")), "the new folder landed at 03");
        assert.equal(names.length, 7, "…and the stream is the six on-disk items plus the new one — the cache-only ref added nothing");
      },
    },
    {
      label: "insert-shared (nested)",
      id: "work:insert-story",
      input: { slug: "auth-guard", at: 1, under: "05", yes: true },
      observable: async (fx, result) => {
        assert.equal(result.shifted, 1, `the nested insert reports shifting exactly the on-disk sibling stories numbered 1 and above (got ${result.shifted})`);
        const stories = (await readdir(path.join(itemDirOf(fx, "05"), "stories"), { withFileTypes: true }))
          .filter((e) => e.isDirectory()).map((e) => e.name).sort();
        assert.deepEqual(stories, ["00_story_s05-00", "01_story_auth-guard", "02_story_s05-01"], "the on-disk siblings renumbered around the insert");
      },
    },
    {
      label: "work-upgrade:106",
      id: "work:upgrade",
      input: { dryRun: true },
      observable: async (fx, result) => {
        const planned = JSON.stringify(result);
        assert.ok(!planned.includes("07"), `the planned rewrites name exactly the on-disk items' record docs, never the cache-only ref (plan: ${planned.slice(0, 400)})`);
      },
    },
  ].map(({ label, id, input, observable }) => ({
    name: `cache-read/03 the structural operation \`${label}\` acts on the folders on disk, never on a cache-only ref`,
    run: () => withCacheReadFixture(async (fx) => {
      // "the cache additionally holds a row for 07 that has no folder on this disk".
      await plantCacheRow(fx, "07", { status: "done", slug: "m07", node: WORKER_NODE, at: SYNCED_AT });
      // PRECONDITION, asserted: the cache really does know a ref the disk does not, so a
      // structural read that HAD migrated would genuinely see a different set.
      const workspace = await loadWorkspace(fx.root, undefined, { env: fx.env });
      const { listItemsCacheFirst } = await import("../src/work-read.mjs");
      const seamRefs = (await listItemsCacheFirst(workspace, { globalWorkStoreOptions: { env: fx.env } })).map((row) => row.ref);
      assert.ok(seamRefs.includes("07"), "the CACHE-first view genuinely includes 07 (so a migrated structural read would see 7 top-level items, not 6)");
      assert.ok(!(await listItems(fx.workDir)).some((item) => item.ref === "07"), "…while the DISK view does not");

      const result = await runCommand(fx, id, input);
      await observable(fx, result);

      assert.ok(!existsSync(itemDirOf(fx, "07")), "no folder is created, renamed or removed for the cache-only ref 07");
      const validate = await runCommand(fx, "work:validate", {});
      assert.deepEqual(validate.findings, [], `a fresh validate over the whole stream reports zero findings (got ${JSON.stringify(validate.findings)})`);
    }, { stream: [...DISK_STREAM.slice(0, 5), { number: "05", stories: ["00", "01"] }] }),
  })),

  // ==========================================================================
  // The reindex REACTORS: this node's run records follow this node's folders
  // ==========================================================================
  {
    name: "cache-read/03 after a renumber, this node's run records are remapped against this node's OWN folders, and nothing is remapped for a cache-only ref",
    run: () => withCacheReadFixture(async (fx) => {
      await plantCacheRow(fx, "07", { status: "done", slug: "m07", node: WORKER_NODE, at: SYNCED_AT });
      const record = await runCommand(fx, "work:run-start", { ref: "05" });
      assert.ok(record?.runId, "the control disk holds 05 with a run record");

      await runCommand(fx, "work:insert-milestone", { slug: "widget-support", at: 5, yes: true });

      // The run recorded against 05 follows the FOLDER to its new number.
      const moved = await runCommand(fx, "work:run-status", { ref: "06" });
      assert.deepEqual(moved.runs.map((run) => run.runId), [record.runId], "run-status 06 reports the run that was recorded against 05");

      // …and nothing was created or remapped for the cache-only ref.
      assert.ok(!existsSync(itemDirOf(fx, "07")), "no folder exists for the cache-only ref 07");
      const validate = await runCommand(fx, "work:validate", {});
      assert.deepEqual(validate.findings, [], "a fresh validate reports zero findings");
    }, { stream: DISK_STREAM }),
  },

  // ==========================================================================
  // REGRESSION GUARD (rule 8): validate stays a folder-versus-frontmatter check
  // ==========================================================================
  {
    name: "cache-read/03 validate stays a folder-versus-frontmatter check, unmoved by anything the cache believes — a genuine mismatch is reported, a cache-only ref is not, and a cache/disk status disagreement is not",
    run: () => withCacheReadFixture(async (fx) => {
      // (a) the cache holds a status for 05 that DIFFERS from the disk's frontmatter…
      await plantCacheRow(fx, "05", { status: "done", slug: "m05", node: WORKER_NODE, at: SYNCED_AT });
      // (b) …and a row for 07 with no folder here…
      await plantCacheRow(fx, "07", { status: "done", slug: "m07", node: WORKER_NODE, at: SYNCED_AT });
      // (c) …and the disk holds an item whose folder number and frontmatter `number`
      // genuinely disagree — the real defect validate exists to find.
      await writeDoc(fx, "04", "SPEC.md", "---\ntype: milestone\nnumber: 99\nslug: m04\nstatus: not-started\ntitle: Milestone 04\ncreated: 2026-08-01\nupdated: 2026-08-01\nschema: 1\n---\n");

      // Non-vacuity: the disagreement in (a) is real and visible from the migrated surface.
      assert.equal(rowFor((await runCommand(fx, "work:find", { query: "05" })).rows, "05").status, "done", "the cache-answered read says done");
      assert.equal((await findWork(fx.workDir, "05"))[0].status, "not-started", "…while the disk says not-started");

      const { findings } = await runCommand(fx, "work:validate", {});
      const problems = findings.map((finding) => `${finding.path}: ${finding.problem}`);
      assert.ok(problems.some((line) => /number/i.test(line) && line.includes("04_milestone_m04")), `the genuine folder-versus-frontmatter mismatch is reported (got ${JSON.stringify(problems)})`);
      assert.ok(!problems.some((line) => line.includes("07")), "no finding is reported for the cache-only ref 07");
      assert.ok(!problems.some((line) => line.includes("05")), "no finding is reported merely because the cache's status for 05 differs from disk");
    }, { stream: DISK_STREAM }),
  },

  // ==========================================================================
  // REGRESSION GUARD (rule 8): readWorkspaceProjectionItems is DUAL-USE
  // ==========================================================================
  {
    name: "cache-read/03 a node publishing its own state publishes its own disk and never re-stamps another node's row — the remote row survives with its author and instant unchanged",
    run: () => withCacheReadFixture(async (fx) => {
      await plantCacheRow(fx, "07", { status: "done", slug: "m07", node: WORKER_NODE, at: SYNCED_AT });
      await plantCacheRow(fx, "07/01", { status: "done", slug: "cache-read-surface", parent: "07", node: WORKER_NODE, at: SYNCED_AT });

      const workspace = await loadWorkspace(fx.root, undefined, { env: fx.env });
      await publishGlobalWorkSnapshot(workspace, { globalWorkStoreOptions: { env: fx.env }, effectsJournalOptions: { env: fx.env } });

      const cached = await rows(fx);
      for (const ref of ["04", "05"]) {
        assert.ok(cached.has(ref), `the cache's row for ${ref} is present`);
        assert.equal(await authorOf(fx, ref), CONTROL_NODE, `…reported by the control node`);
        assert.equal(cached.get(ref).status, (await findWork(fx.workDir, ref))[0].status, "…and matches its disk");
      }
      assert.equal(await authorOf(fx, "07/01"), WORKER_NODE, "the cache's row for 07/01 is STILL reported by aof-wsl");
      const stored = await withStore(fx, (store) => store.db.prepare("SELECT updated_at FROM work_items WHERE workspace_id = ? AND ref = ?").get(fx.workspaceId, "07/01"));
      assert.equal(stored.updated_at, SYNCED_AT, "…with its syncedAt unchanged — the publish did not re-author it");

      const found = rowFor((await runCommand(fx, "work:find", { query: "07/01" })).rows, "07/01");
      assert.equal(found.status, "done", "a fresh find still reports status done");
      assert.equal(found.reportedBy, WORKER_NODE, "…and reportedBy aof-wsl");
    }, { stream: DISK_STREAM }),
  },

  // ==========================================================================
  // REGRESSION GUARD (rule 8): work.mjs gains nothing
  // ==========================================================================
  {
    name: "cache-read/03 work.mjs's four disk readers keep their exact return shape, so the 37 unmigrated importers are untouched — the disk's items, no provenance field, and the DISK's status",
    run: () => withCacheReadFixture(async (fx) => {
      // The cache holds rows the disk does not, and a status for 05 that differs from disk.
      await plantCacheRow(fx, "07", { status: "done", slug: "m07", node: WORKER_NODE, at: SYNCED_AT });
      await plantCacheRow(fx, "05", { status: "done", slug: "m05", node: WORKER_NODE, at: SYNCED_AT });
      // Non-vacuity: the disagreement is real and the migrated surface sees it.
      assert.equal(rowFor((await runCommand(fx, "work:find", { query: "05" })).rows, "05").status, "done", "the migrated reader answers done from the cache");

      const CONTRACT = ["ref", "type", "slug", "status", "title", "parent", "dir"];
      const PROVENANCE = ["answeredFrom", "reportedBy", "syncedAt"];

      const items = await listItems(fx.workDir);
      assert.deepEqual(items.map((item) => item.ref).sort(), DISK_STREAM.map((d) => d.number).sort(), "listItems returns exactly the disk's items");
      for (const item of items) for (const key of PROVENANCE) assert.ok(!(key in item), `listItems row ${item.ref} carries no ${key}`);

      for (const row of await listStream(fx.workDir)) {
        assert.deepEqual(Object.keys(row).sort(), [...CONTRACT].sort(), `listStream row ${row.ref} keeps its exact seven-field shape`);
      }

      const found = await findWork(fx.workDir, "05");
      assert.deepEqual(Object.keys(found[0]).sort(), [...CONTRACT].sort(), "findWork keeps its exact shape");
      assert.equal(found[0].status, "not-started", "findWork for 05 reports the DISK's status, not the cache's");
      assert.deepEqual(await findWork(fx.workDir, "07"), [], "…and the cache-only ref is invisible to it");

      const next = await nextWork(fx.workDir, "05");
      for (const key of PROVENANCE) assert.ok(!(key in next), `nextWork carries no ${key}`);
      assert.equal(next.status, "not-started", "nextWork reads the DISK's status too");
    }, { stream: DISK_STREAM }),
  },
];

const rowFor = (rowList, ref) => rowList.find((row) => row.ref === ref) ?? null;

void tick; void streamDoc;
