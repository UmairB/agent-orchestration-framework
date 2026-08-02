// Fitness functions for m42 wave (d) leg d5 (PRD-command-spine-effects-ledger,
// "fact-projection-split"): the store epistemology is EXECUTABLE, and the last
// two crash windows the arc named are closed.
//
//   (1) TOTALITY (two-way ratchet): every table any src/ module CREATEs is
//       classified fact | projection | meta in effects/stores.mjs, and every
//       classified table is actually created somewhere. A new table cannot ship
//       unclassified; a renamed table cannot leave a stale row behind.
//   (2) WHOLESALE DELETES ARE CLASS-GATED: the row publisher's sweep routes
//       through the one guard that refuses anything but a projection table —
//       schema-level gating where a "MUST NEVER touch" comment used to stand.
//   (3) FACT WRITERS ARE ISOLATED: SQL that mutates a fact table lives only in
//       that table's declared writer module(s).
//   (4) THE REF-REMAP SPLIT (behavioural, through the real seam): the streamed
//       mirrors rewrite at `local` in the CLI's own drain; the dispatch facts
//       wait for the control-store drain (the tick's loci) and are event-id
//       deduped on their OWN watermark; a solo (non-mesh) workspace owes no
//       fact-remap step at all (the port-4 applicability machinery, reused).
//   (5) THE RECONCILER + THE DOCTOR DOORS (behavioural): a crash between the
//       run-record write and its event append is healed by `work:doctor
//       --converge` — the record's event is re-derived, the cascade pays, the
//       rollback lands. Bounded honestly: only each item's LATEST record, and
//       nothing from before the ledger's birth, is ever re-announced.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TABLE_CLASSIFICATION, tableClass, refRemapTables } from "../../src/effects/stores.mjs";
import { EFFECTS } from "../../src/effects/table.mjs";
import { transitionStreamReindexed } from "../../src/effects/stream-transitions.mjs";
import { transitionRunStart } from "../../src/effects/run-transitions.mjs";
import { reconcileRunRecords } from "../../src/effects/reconcile.mjs";
import { openEffectsJournal, readEvents, readEventSteps } from "../../src/effects/journal.mjs";
import { drainEffects, CONTROL_LOCI } from "../../src/effects/dispatch.mjs";
import {
  openGlobalWorkProjectionStore,
  remapWorkspaceFactRefs,
  wholesaleDelete,
} from "../../src/global-work-store.mjs";
import { setItemBranch, readItemBranch } from "../../src/mesh-assignment-directive.mjs";
import { resolveWorkspaceId } from "../../src/workspace-identity.mjs";
import { loadWorkspace } from "../../src/work.mjs";
import { startRun, completeRun } from "../../src/run-store.mjs";
import { invoke } from "../../src/command-core.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC_DIR = path.join(repoRoot, "src");

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

async function listSourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listSourceFiles(full)));
    else if (entry.isFile() && entry.name.endsWith(".mjs")) files.push(full);
  }
  return files;
}

function fm(fields) {
  return `---\n${Object.entries(fields).map(([key, value]) => `${key}: ${value}`).join("\n")}\n---\n\n`;
}

// Two milestones, the second with a story — the port-3 shape (an insert at 1
// shifts 01→02 and 02→03, story cascade included). `mesh` opts the workspace in.
async function buildStream({ mesh = false } = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-fact-split-"));
  const workDir = path.join(repo, "wiki", "work");
  const one = path.join(workDir, "01_milestone_first");
  const two = path.join(workDir, "02_milestone_second");
  const story = path.join(two, "stories", "01_story_inner");
  await mkdir(one, { recursive: true });
  await mkdir(story, { recursive: true });
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  await writeFile(path.join(one, "SPEC.md"), fm({ type: "milestone", number: "01", slug: "first", status: "in-progress" }), "utf8");
  await writeFile(path.join(two, "SPEC.md"), fm({ type: "milestone", number: "02", slug: "second", status: "in-progress" }), "utf8");
  await writeFile(path.join(story, "STORY.md"), fm({ type: "story", number: "01", slug: "inner", parent: "02", status: "in-progress" }), "utf8");
  const config = { name: "fact-split-fixture", work: { dir: "./wiki/work" } };
  if (mesh) config.mesh = { enabled: true };
  await writeFile(path.join(repo, ".aof", "aof.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return { repo, workDir, storyDir: story };
}

// Scope AOF_GLOBAL_HOME for a lane: the reactors' default store/journal opens
// resolve through the environment, exactly as they do in production.
async function withGlobalHome(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aof-fact-split-gh-"));
  const previous = process.env.AOF_GLOBAL_HOME;
  process.env.AOF_GLOBAL_HOME = dir;
  try {
    return await fn(dir);
  } finally {
    if (previous === undefined) delete process.env.AOF_GLOBAL_HOME;
    else process.env.AOF_GLOBAL_HOME = previous;
    await rm(dir, { recursive: true, force: true });
  }
}

export const archTests = [
  {
    name: "arch/m42-d5: the classification is TOTAL over the real schema — every created table classified, every classified table created (two-way ratchet)",
    run: async () => {
      const created = new Set();
      for (const file of await listSourceFiles(SRC_DIR)) {
        const code = await readFile(file, "utf8");
        for (const match of code.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)) created.add(match[1]);
      }
      const classified = new Set(Object.keys(TABLE_CLASSIFICATION));
      const unclassified = [...created].filter((table) => !classified.has(table)).sort();
      const stale = [...classified].filter((table) => !created.has(table)).sort();
      assert.deepEqual(unclassified, [], `every table src/ creates is classified (missing: ${unclassified.join(", ")})`);
      assert.deepEqual(stale, [], `every classified table exists in the schema (stale: ${stale.join(", ")})`);
      // The classes themselves are a closed vocabulary.
      for (const [table, entry] of Object.entries(TABLE_CLASSIFICATION)) {
        assert.ok(["fact", "projection", "meta"].includes(entry.class), `${table} carries a known class (got "${entry.class}")`);
        if (entry.class === "fact") {
          assert.ok(Array.isArray(entry.writers) && entry.writers.length > 0, `fact table ${table} declares its writer(s)`);
        }
      }
    },
  },

  {
    // AMENDED BY m43 / ADR-004 (story 43/02, the authority cut) — the three clauses
    // this test used to make about `work_items` said the OPPOSITE of the invariant now
    // in force, and were named in that story's contract as owed amendments:
    //
    //   was: `tableClass("work_items") === "projection"`
    //   now: === "fact". The table is no longer derived from one node's disk; it holds
    //        durable REPORTS from whichever node authored each row, and no local
    //        rebuild reconstructs another node's report.
    //
    //   was: the publisher's `wholesaleDelete(db, "work_items", …)` sweep MUST EXIST.
    //   now: it must NOT exist ANYWHERE in src/, and the guard must actually THROW for
    //        it — asserted behaviourally below, not by the presence of a string. That
    //        is strictly stronger: the old clause proved a call site was spelled a
    //        certain way; this proves the gate refuses the act.
    //
    //   was: NO raw `DELETE FROM <t> WHERE workspace_id = ?` may appear at all.
    //   now: the same rule, with the two named doors the cut created enumerated and
    //        each held to a HARDER standard than "absent" — an author retraction must
    //        carry the `node_id = ?` predicate that makes it a retraction rather than a
    //        sweep, and an unqualified whole-workspace DELETE of a cache table may
    //        exist ONLY inside `removeWorkspaceFromCache`, the one explicitly named,
    //        operator-initiated removal path. A publish tick reaching either is exactly
    //        what this now catches.
    name: "arch/m42-d5 (+m43 ADR-004): wholesale deletes are class-gated — work_items is a FACT the guard refuses, projection_errors is still swept through it, and the only raw cache-table DELETEs are the named retraction and the named removal path",
    run: async () => {
      const source = await readFile(path.join(SRC_DIR, "global-work-store.mjs"), "utf8");
      const code = stripComments(source);
      assert.ok(/function wholesaleDelete\s*\(/.test(code), "the one guard exists");
      assert.ok(/tableClass\(table\)/.test(code), "…and consults the classification");
      assert.ok(/fact-table-wholesale-delete/.test(code), "…refusing with the coded error before the statement runs");

      // (1) THE CUT: no wholesale sweep of work_items survives anywhere in src/.
      const sweepers = [];
      for (const file of await listSourceFiles(SRC_DIR)) {
        if (/wholesaleDelete\s*\([^)]*["']work_items["']/.test(stripComments(await readFile(file, "utf8")))) {
          sweepers.push(path.relative(repoRoot, file));
        }
      }
      assert.deepEqual(sweepers, [], `work_items is a fact — nothing may wholesale-sweep it (offenders: ${sweepers.join(", ")})`);
      assert.ok(/wholesaleDelete\(db, "projection_errors"/.test(code), "the publisher's projection_errors sweep still routes through the guard");

      // (2) THE RAW-SWEEP RULE, with its two named doors. Every raw workspace-scoped
      // DELETE is located, attributed to the function it sits in, and judged there.
      const removalStart = code.indexOf("export function removeWorkspaceFromCache");
      assert.ok(removalStart > 0, "the named removal path exists (the sweep it replaces is gone, so this door must be there)");
      const removalEnd = code.indexOf("\nexport ", removalStart + 1);
      const removalBody = code.slice(removalStart, removalEnd === -1 ? undefined : removalEnd);
      const guardStart = code.indexOf("export function wholesaleDelete");
      const guardBody = code.slice(guardStart, code.indexOf("\n}", guardStart));

      const offenders = [];
      for (const match of code.matchAll(/DELETE FROM (\w+) WHERE workspace_id = \?([^"'`]*)/g)) {
        const [statement, table, tail] = match;
        const inGuard = guardStart >= 0 && match.index >= guardStart && match.index < guardStart + guardBody.length;
        const inRemoval = removalEnd === -1 ? match.index >= removalStart : match.index >= removalStart && match.index < removalEnd;
        if (inGuard) continue; // the guard's own class-gated template — the ONE sanctioned sweep spelling
        if (inRemoval) continue; // the explicitly named, operator-initiated removal door
        // Anywhere else, a DELETE against a cache table must be AUTHORSHIP-SCOPED:
        // bound to the recorded author of the row it removes. Without the node_id
        // predicate it is a sweep wearing a retraction's name. `IS` as well as `=`,
        // because the operator door (ADR-010/D1) removes a row by ITS OWN author —
        // which may be the pre-v8 NULL that `=` can never match.
        if (!/\bnode_id (?:=|IS) \?/.test(tail)) {
          offenders.push(`${table}: ${statement.trim().slice(0, 90)}`);
        }
      }
      assert.deepEqual(
        offenders,
        [],
        `a workspace-scoped DELETE outside the guard and outside removeWorkspaceFromCache must carry the node_id authorship predicate (offenders: ${offenders.join("; ")})`,
      );
      // …and the retraction really is spelled that way, so the clause above is not
      // passing over an absence.
      assert.ok(
        /DELETE FROM work_items WHERE workspace_id = \? AND ref = \? AND node_id IS \?/.test(code),
        "the retraction is scoped by the row's own recorded author — never an unqualified sweep",
      );

      // (3) Self-checks (non-vacuous): the matcher still fires on the retired form, and
      // the authorship predicate is what distinguishes it from a retraction.
      const scan = (text) => [...text.matchAll(/DELETE FROM (\w+) WHERE workspace_id = \?([^"'`]*)/g)]
        .filter(([, , tail]) => !/\bnode_id (?:=|IS) \?/.test(tail));
      assert.equal(scan('db.prepare("DELETE FROM work_items WHERE workspace_id = ?")').length, 1, "the raw-sweep matcher fires on the retired wholesale delete");
      assert.equal(scan('db.prepare("DELETE FROM work_items WHERE workspace_id = ? AND node_id = ? AND ref = ?")').length, 0, "…and does NOT fire on an author-scoped retraction");
      assert.equal(scan('db.prepare("DELETE FROM work_items WHERE workspace_id = ? AND ref = ? AND node_id IS ?")').length, 0, "…nor on the NULL-safe form the operator door needs");

      // (4) The classification answers the way the guard depends on.
      assert.equal(tableClass("work_items"), "fact", "m43/ADR-004: the reclassification IS the enforcement");
      assert.equal(tableClass("projection_errors"), "projection", "…and it is scoped to ONE table: the error list is still rebuilt");
      assert.equal(tableClass("global_assignments"), "fact");
      assert.equal(tableClass("nonexistent_table"), null);

      // (5) BEHAVIOURAL: the gate actually refuses the act, and actually performs the
      // sanctioned one. A string assertion could never tell these two apart.
      await withGlobalHome(async () => {
        const store = await openGlobalWorkProjectionStore({});
        try {
          store.db.prepare("INSERT INTO work_items (workspace_id, ref, type, slug, status, title, parent, source_path, node_id, updated_at) VALUES ('ws-1','01','milestone','m','not-started','M',NULL,'/x/SPEC.md','node-a','2026-08-02T10:00:00.000Z')").run();
          store.db.prepare("INSERT INTO projection_errors (workspace_id, source_path, message, code, occurred_at) VALUES ('ws-1','/x/BROKEN.md','bad','frontmatter-unparseable','2026-08-02T10:00:00.000Z')").run();

          assert.throws(
            () => wholesaleDelete(store.db, "work_items", "ws-1"),
            (error) => error.code === "fact-table-wholesale-delete",
            "the guard refuses a fact table with the coded error",
          );
          assert.equal(
            store.db.prepare("SELECT COUNT(*) AS n FROM work_items WHERE workspace_id = 'ws-1'").get().n,
            1,
            "…and the refusal deleted nothing (a guard that had already swept would be worse than none)",
          );

          wholesaleDelete(store.db, "projection_errors", "ws-1");
          assert.equal(
            store.db.prepare("SELECT COUNT(*) AS n FROM projection_errors WHERE workspace_id = 'ws-1'").get().n,
            0,
            "a projection table is still swept and rebuilt",
          );
        } finally {
          store.close?.();
        }
      });
    },
  },

  {
    name: "arch/m42-d5: SQL that mutates a fact table lives only in that table's declared writer module(s)",
    run: async () => {
      const files = await listSourceFiles(SRC_DIR);
      const sources = new Map();
      for (const file of files) {
        sources.set(path.relative(repoRoot, file).replaceAll("\\", "/"), stripComments(await readFile(file, "utf8")));
      }
      const offenders = [];
      for (const [table, entry] of Object.entries(TABLE_CLASSIFICATION)) {
        if (entry.class !== "fact") continue;
        const writers = new Set(entry.writers);
        const mutation = new RegExp(`\\b(?:INSERT\\s+INTO|INSERT\\s+OR\\s+\\w+\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+${table}\\b`, "i");
        for (const [rel, code] of sources) {
          if (writers.has(rel)) continue;
          if (mutation.test(code)) offenders.push(`${rel} mutates ${table}`);
        }
      }
      assert.deepEqual(offenders, [], `fact-table SQL stays with its declared writers (offenders: ${offenders.join("; ")})`);
      // Non-vacuous: the matcher fires on a planted mutation.
      assert.ok(
        /\b(?:INSERT\s+INTO|INSERT\s+OR\s+\w+\s+INTO|UPDATE|DELETE\s+FROM)\s+global_assignments\b/i.test(
          'db.exec("UPDATE global_assignments SET state = ?")',
        ),
        "the mutation matcher fires on a planted UPDATE",
      );
    },
  },

  {
    name: "arch/m42-d5: the ref-remap split — mirrors rewrite locally, dispatch facts wait for the control-store drain, deduped on their own watermark; a solo workspace owes no fact step (behavioural)",
    run: async () => {
      // The derivation is the classification's, not a re-spelled list.
      assert.deepEqual(
        refRemapTables("local").map((entry) => entry.table).sort(),
        ["work_item_docs", "work_item_runs"],
        "the local half is the streamed mirrors",
      );
      assert.deepEqual(
        refRemapTables("control-store").map((entry) => entry.table).sort(),
        ["global_assignments", "global_item_branches"],
        "the control-store half is the dispatch facts",
      );

      await withGlobalHome(async () => {
        const { repo } = await buildStream({ mesh: true });
        try {
          const workspace = await loadWorkspace(repo);
          const workspaceId = resolveWorkspaceId(workspace);
          const store = await openGlobalWorkProjectionStore({});
          try {
            // Seed one row per half, keyed by the ref the insert will shift (02 → 03).
            store.db
              .prepare("INSERT INTO work_item_runs (workspace_id, ref, run_id, record_json, node_id, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
              .run(workspaceId, "02", "run-1", "{}", null, "2026-01-01T00:00:00Z");
            // The row's STATE is incidental to this proof — the fact remap is a plain
            // UPDATE by ref and never reads it — but it can no longer be an ACTIVE
            // one: m43/ADR-003's item lock refuses a control-side insert that would
            // renumber a ref whose execution scope an active assignment holds, which
            // is exactly what this fixture would be doing. A settled (terminal) row is
            // the same fixture at a gate, and every assertion below is unchanged.
            // (m20/R1: a guard added to a shared spine seam invalidates the PRIOR
            // milestone's tests of that seam — enumerated here rather than discovered.)
            store.db
              .prepare(
                "INSERT INTO global_assignments (assignment_id, item_ref, workspace_id, target_node_id, issuer, state, assigned_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
              )
              .run("asg-1", "02", workspaceId, "node-a", "operator", "done", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z");
            setItemBranch(store, workspaceId, "02", "aof/mesh/02");

            // The seam, end-to-end: the CLI's own drain (LOCAL_LOCI) pays the
            // mirrors and DEFERS the facts.
            const result = await transitionStreamReindexed(workspace, { at: 1, space: "top-level" }, {});
            const byKey = new Map(result.effects.map((outcome) => [outcome.key, outcome.status]));
            assert.equal(byKey.get("remap-projection"), "done", "the mirror half pays in the CLI's own drain");
            assert.equal(byKey.get("remap-control-facts"), "deferred", "the fact half waits for the control-store drain");
            assert.equal(
              store.db.prepare("SELECT ref FROM work_item_runs WHERE run_id = 'run-1'").get().ref,
              "03",
              "the streamed run row followed the shift locally",
            );
            assert.equal(
              store.db.prepare("SELECT item_ref FROM global_assignments WHERE assignment_id = 'asg-1'").get().item_ref,
              "02",
              "the dispatch fact is untouched until its own locus drains",
            );

            // The control drain (the tick's loci) pays the fact half.
            const journal = await openEffectsJournal({});
            try {
              const outcomes = await drainEffects({ journal, loci: CONTROL_LOCI, ctx: { store } });
              const facts = outcomes.find((outcome) => outcome.key === "remap-control-facts");
              assert.equal(facts?.status, "done", "the control-store drain pays the fact half");
            } finally {
              journal.close();
            }
            assert.equal(
              store.db.prepare("SELECT item_ref FROM global_assignments WHERE assignment_id = 'asg-1'").get().item_ref,
              "03",
              "the assignment row followed the shift",
            );
            assert.equal(readItemBranch(store, workspaceId, "03"), "aof/mesh/02", "the branch record keys by the NEW ref");

            // Redelivery: the fact half is deduped on its OWN watermark.
            const again = remapWorkspaceFactRefs(store, workspaceId, [{ from: "02", to: "03" }], { eventId: result.eventId });
            assert.equal(again.skipped, true, "a redelivered fact remap is a no-op");
            assert.equal(again.reason, "already-applied");
          } finally {
            store.close?.();
          }
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      });

      // The solo (non-mesh) workspace: the predicate says the fact half can
      // never apply, so it is NOT OWED — no step in the journal at all.
      await withGlobalHome(async () => {
        const { repo } = await buildStream({ mesh: false });
        try {
          const workspace = await loadWorkspace(repo);
          const result = await transitionStreamReindexed(workspace, { at: 1, space: "top-level" }, {});
          const journal = await openEffectsJournal({});
          try {
            const steps = readEventSteps(journal, result.eventId);
            assert.ok(steps.length >= 1, "the reindex journaled its cascade");
            assert.equal(
              steps.find((step) => step.key === "remap-control-facts"),
              undefined,
              "a solo workspace owes no control-store fact remap",
            );
          } finally {
            journal.close();
          }
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      });
    },
  },

  {
    name: "arch/m42-d5: the reconciler + doctor --converge close the write-vs-append window — the eaten event is re-derived and its cascade pays; --explain renders the declared cascade (behavioural)",
    run: async () => {
      await withGlobalHome(async (globalHome) => {
        const { repo, storyDir } = await buildStream();
        try {
          const workspace = await loadWorkspace(repo);
          const item = { ref: "02/01", dir: storyDir, type: "story" };
          const env = { ...process.env, AOF_GLOBAL_HOME: globalHome };
          const ctx = { workspace, effectsJournalOptions: { env }, globalWorkStoreOptions: { env } };

          // THE CRASH: the mint went through the seam (its event exists), the
          // completion hit the raw store and the process died before the append.
          const started = await transitionRunStart(item, {}, { workspace, journalOptions: { env } });
          await completeRun(item, { runId: started.record.runId, outcome: "failed", failureReason: "timeout" });

          const converge = await invoke("work:doctor", { converge: true }, ctx);
          assert.equal(converge.converge.reconciled.length, 1, "the eaten run.completed is re-derived");
          assert.equal(converge.converge.reconciled[0].event, "run.completed");
          assert.equal(converge.converge.reconciled[0].runId, started.record.runId);
          const rollback = converge.converge.drained.find((outcome) => outcome.key === "rollback-status");
          assert.equal(rollback?.status, "done", "the cascade paid on the drain");
          const story = await readFile(path.join(storyDir, "STORY.md"), "utf8");
          assert.match(story, /status: not-started/, "the rollback consequence actually landed");

          // Convergence is idempotent: a second pass finds nothing owed.
          const second = await invoke("work:doctor", { converge: true }, ctx);
          assert.equal(second.converge.reconciled.length, 0, "nothing left to reconcile");
          assert.equal(second.converge.drained.length, 0, "nothing left to drain");

          // --explain renders the declared cascade with its loci + predicates.
          const explain = await invoke("work:doctor", { explain: "run.completed" }, ctx);
          assert.deepEqual(
            explain.explain.reactors,
            EFFECTS["run.completed"].map((reactor) => ({
              key: reactor.key,
              locus: reactor.locus,
              predicated: typeof reactor.applies === "function",
            })),
            "the explain envelope IS the declared table entry",
          );
          assert.equal(explain.explain.journal.present, true);
          await assert.rejects(
            invoke("work:doctor", { explain: "bogus.event" }, ctx),
            (error) => error.code === "unknown-event",
            "an unknown event is refused naming the vocabulary",
          );
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      });
    },
  },

  {
    name: "arch/m42-d5: the reconciler's honest bounds — nothing from before the ledger's birth, and only each item's LATEST record, is ever re-announced",
    run: async () => {
      await withGlobalHome(async (globalHome) => {
        const { repo, storyDir } = await buildStream();
        try {
          const workspace = await loadWorkspace(repo);
          const item = { ref: "02/01", dir: storyDir, type: "story" };
          const env = { ...process.env, AOF_GLOBAL_HOME: globalHome };

          // Birth the ledger FIRST (empty journal file → its birthtime is the floor).
          (await openEffectsJournal({ env })).close();

          // A record wholly BEFORE the floor: terminal, eventless — and history.
          const ancient = await startRun(item, { now: "2020-01-01T00:00:00.000Z" });
          await completeRun(item, { runId: ancient.runId, outcome: "failed", now: "2020-01-01T00:01:00.000Z" });
          const first = await reconcileRunRecords(workspace, { journalOptions: { env } });
          assert.equal(first.scanned, 1, "the record was scanned");
          assert.deepEqual(first.appended, [], "…but a record older than the ledger is never re-announced");

          // A NEWER running record (raw mint, eventless): the reconciler appends
          // ITS run.started — and still nothing for the superseded failure, whose
          // late run.completed would roll back an item legitimately in progress.
          const future = new Date(Date.now() + 60_000).toISOString();
          const running = await startRun(item, { now: future });
          const second = await reconcileRunRecords(workspace, { journalOptions: { env } });
          assert.equal(second.appended.length, 1, "exactly one event is re-derived");
          assert.equal(second.appended[0].event, "run.started", "…the LATEST record's, not the superseded failure's");
          assert.equal(second.appended[0].runId, running.runId);

          const journal = await openEffectsJournal({ env });
          try {
            assert.equal(readEvents(journal, { name: "run.completed" }).length, 0, "no completed event was invented for the old failure");
          } finally {
            journal.close();
          }
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      });
    },
  },
];
