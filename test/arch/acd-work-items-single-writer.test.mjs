// Fitness function: acd-work-items-single-writer (milestone 43 / ADR-004) —
//
//   "`work_items` stops being a disk-rebuilt projection and becomes a
//    provenance-stamped, row-upserted FACT written through ONE seam that both the
//    control node and every worker use. The effects/stores.mjs RECLASSIFICATION is the
//    enforcement: once `work_items` is classified `fact`, `wholesaleDelete` throws for
//    it, so the rebuild cannot survive the reclassification even by accident."
//
// THE DISEASE (measured; SPEC's line citations corrected by RESEARCH and re-verified
// here): `publishWorkspaceSnapshot` (global-work-store.mjs:436-504) calls
// `wholesaleDelete(db, "work_items", workspaceId)` at :459-460 — NOT SPEC.md's :431/:417
// — and re-INSERTs every row from the CALLING node's own disk slice. The control
// launcher runs this on a cadence (mesh-launcher.mjs:732); the worker's delta is merged
// by applyDeltaFrame (control-stream-server.mjs:177-202) and re-published through the
// same wholesale seam. The two writers alternate and the last tick wins; after settle the
// worker stops ticking and the control's stale disk wins permanently.
//
// WHY the reclassification is the whole enforcement: `wholesaleDelete`
// (global-work-store.mjs:45-61) looks up tableClass(table) and THROWS before running if
// the class is not "projection" — schema-level gating, not a comment. So ADR-004 needs no
// new mechanism; it needs the registry m42 built for exactly this to say the true thing.
//
// Proofs:
//  1. GREEN — every INSERT/UPDATE/DELETE statement naming `work_items` in src/ lives in
//     exactly ONE module. True at HEAD (global-work-store.mjs:463 is the only one), and it
//     is precisely the property the shared upsert seam must preserve as it gains a second
//     caller (applyDeltaFrame).
//  2. GREEN — `work_item_docs` and `work_item_runs` are still classified "fact": the m42
//     leg d5 decision that is the reason streamed content survives worktree cleanup, and
//     the shape `work_items` is being migrated ONTO. A silent reclassification back to
//     "projection" would re-open the sweep on them.
//  3. ARMED AT THE CUT — read the live classification: IF `work_items` is classified
//     "fact", THEN no `wholesaleDelete(..., "work_items", ...)` call may exist anywhere in
//     src/. A clean skip while it is still "projection".
//  Self-check (m03 non-vacuous): a planted second writer module and a planted sweep call
//  trip the SAME detectors.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
// The screen's OWN field lists and predicate — read from the module under test, never
// re-spelled here (a second copy would make the coverage ratchet agree with itself).
import { REQUIRED_ITEM_FIELDS, OPTIONAL_ITEM_FIELDS, itemRowFault } from "../../src/global-work-store.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = path.join(repoRoot, "src");
const STORES = path.join(repoRoot, "src", "effects", "stores.mjs");

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// DML against work_items: the write surface whose single-module confinement is the
// invariant. (`wholesaleDelete` is parameterised, so it is detected separately below.)
const WORK_ITEMS_DML = /\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE|DELETE\s+FROM)\s+work_items\b/i;
const WHOLESALE_WORK_ITEMS = /wholesaleDelete\s*\([^)]*["']work_items["']/;

async function mjsFilesUnder(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await mjsFilesUnder(full)));
    else if (entry.name.endsWith(".mjs")) out.push(full);
  }
  return out;
}

// The live classification, read from the registry rather than assumed.
function classOf(storesSource, table) {
  const re = new RegExp(`\\b${table}\\s*:\\s*Object\\.freeze\\(\\{[^}]*class\\s*:\\s*["']([a-z]+)["']`);
  return storesSource.match(re)?.[1] ?? null;
}

export const archTests = [
  {
    name: "arch/43 ADR-004 (acd-work-items-single-writer): every work_items INSERT/UPDATE/DELETE in src/ lives in exactly ONE module — the shared upsert seam has one implementation, two callers",
    run: async () => {
      const writers = [];
      for (const file of await mjsFilesUnder(SRC)) {
        if (WORK_ITEMS_DML.test(stripComments(await readFile(file, "utf8")))) writers.push(path.relative(repoRoot, file));
      }
      assert.equal(
        writers.length,
        1,
        `work_items must have exactly one writer MODULE (ADR-004's shared seam) — found: ${writers.join(", ") || "(none)"}`,
      );
    },
  },
  {
    name: "arch/43 ADR-004 (acd-work-items-single-writer): work_item_docs and work_item_runs are still classified \"fact\" — the shape work_items migrates onto, and the reason streamed content survives worktree cleanup",
    run: async () => {
      const stores = stripComments(await readFile(STORES, "utf8"));
      for (const table of ["work_item_docs", "work_item_runs"]) {
        assert.equal(
          classOf(stores, table),
          "fact",
          `${table} must stay classified "fact" (m42 leg d5) — a reclassification re-opens wholesaleDelete on the mesh's only readable copy`,
        );
      }
    },
  },
  {
    name: "arch/43 ADR-004 (acd-work-items-single-writer): ARMED AT THE CUT — once work_items is classified \"fact\", NO wholesaleDelete(..., \"work_items\", ...) call may exist in src/",
    run: async () => {
      const stores = stripComments(await readFile(STORES, "utf8"));
      const cls = classOf(stores, "work_items");
      assert.ok(cls != null, "work_items must be classified in effects/stores.mjs (the registry is the gate)");
      if (cls !== "fact") return; // pre-cut: a clean skip that arms the moment ADR-004's reclassification lands

      const sweepers = [];
      for (const file of await mjsFilesUnder(SRC)) {
        if (WHOLESALE_WORK_ITEMS.test(stripComments(await readFile(file, "utf8")))) sweepers.push(path.relative(repoRoot, file));
      }
      assert.deepEqual(
        sweepers,
        [],
        `work_items is classified "fact" but is still wholesale-swept (the alternation defect) — offenders: ${sweepers.join(", ")}`,
      );
    },
  },
  {
    // ADDED at 43/02's structural review (ADR-012/B4) — the RATCHET the codebase-health
    // rule owes after the second consecutive measurement of the same shape.
    //
    // MEASURED. `src/global-work-store.mjs` is the single declared writer of four fact
    // tables and a 17-dependent fan-in node (`aof graph impact`, 2026-08-02: 17 in, 8
    // out — the third-widest blast radius in `src/`). It went 885 -> 1,233 lines in ONE
    // story (+39%), and ADR-009 routes MORE into it: 43/04's storage->wire mapper, the
    // staleness predicate and the Resync door all read this table. Left alone it is the
    // next `mesh-worker-execution.mjs` (TECH_DEBT item 10), which grew 47% the same way,
    // one justified block at a time, with no single diff ever looking wrong.
    //
    // The ceiling is deliberately NOT a repo-wide file-size rule (a limit imposed by one
    // milestone on everyone else's files is exactly what ADR's health section rejected).
    // It is scoped to the ONE module this milestone keeps enlarging, set just above its
    // post-43/02 size, and its escape hatch is the outcome we want: put the next block in
    // its own module (ADR-005 already creates `src/work-read.mjs` for precisely the read
    // seam 43/04 needs) and call it from here. Raising this number is a decision that
    // needs an ADR, not a diff.
    name: "arch/43 ADR-012/B4 (acd-work-items-single-writer): the single-writer module does not become the next god-file — src/global-work-store.mjs stays under its ratchet",
    run: async () => {
      const CEILING = 1280;
      const source = await readFile(path.join(SRC, "global-work-store.mjs"), "utf8");
      const lines = source.split(/\r?\n/).length;
      assert.ok(
        lines <= CEILING,
        `src/global-work-store.mjs is ${lines} lines, over the ${CEILING}-line ratchet (ADR-012/B4). It is the declared single writer of four fact tables and a 17-dependent node; the next block belongs in its own module (e.g. ADR-005's src/work-read.mjs), called from here. Raising the ceiling needs an ADR.`,
      );
      // Non-vacuous: the file exists and is substantial, so a rename/move cannot turn
      // this into a silent pass on an empty read.
      assert.ok(lines > 400, "the measured module was actually read (non-vacuous)");
    },
  },
  {
    // ADDED at 43/02's REVIEW-FIX round, closing ADR-012/B5's defect at the RULE rather
    // than at the symptom. The measured bug was that the row screen checked the four NOT
    // NULL columns while the statement bound EIGHT row-derived values, so a
    // `title: ["alpha","beta"]` — ordinary operator input, since `parseFrontmatter`
    // parses an inline list — threw out of the batch and landed zero rows.
    //
    // Screening the three missing columns fixes today. THIS fixes tomorrow: the next
    // column added to the upsert is red until it is screened too. Deliberately chosen
    // over a defensive try/catch around the write, which was measured to ABSORB the
    // symptom — with it in place, four of the five tests that exist to catch an unscreened
    // value passed with the screen disabled.
    name: "arch/43 ADR-012/B5 (acd-work-items-single-writer): every row-derived value the work_items upsert BINDS is covered by the row screen — the next column cannot ship unscreened",
    run: async () => {
      const source = stripComments(await readFile(path.join(SRC, "global-work-store.mjs"), "utf8"));
      const call = source.slice(source.indexOf("upsert.run("), source.indexOf(");", source.indexOf("upsert.run(")));
      assert.ok(call.length > 40, "the upsert's bind list was located (non-vacuous)");

      const bound = [...new Set([...call.matchAll(/\brow\.(\w+)\b/g)].map((match) => match[1]))].sort();
      assert.ok(bound.length >= 4, `the bind list carries row-derived values (found: ${bound.join(", ")})`);

      const screened = [...new Set([...REQUIRED_ITEM_FIELDS, ...OPTIONAL_ITEM_FIELDS])].sort();
      const unscreened = bound.filter((field) => !screened.includes(field));
      assert.deepEqual(
        unscreened,
        [],
        `every value the upsert binds must be screened before it runs, or one bad row aborts the batch and silently drops every other item in it (unscreened: ${unscreened.join(", ")})`,
      );

      // The screen is real, not a name: it rejects each unbindable shape and admits the
      // bindable ones (numbers included — a `title: 2026` has always stored 2026).
      for (const field of OPTIONAL_ITEM_FIELDS) {
        const base = { ref: "43/02", type: "story", slug: "s", sourcePath: "/x/A.md" };
        assert.equal(itemRowFault({ ...base, [field]: ["a"] })?.column, field, `an array ${field} is refused by the screen`);
        assert.equal(itemRowFault({ ...base, [field]: { a: 1 } })?.column, field, `an object ${field} is refused`);
        assert.equal(itemRowFault({ ...base, [field]: true })?.column, field, `a boolean ${field} is refused`);
        assert.equal(itemRowFault({ ...base, [field]: "ok" }), null, `a string ${field} is admitted`);
        assert.equal(itemRowFault({ ...base, [field]: 2026 }), null, `a number ${field} is still admitted`);
      }

      // Self-check: a planted extra binding trips the coverage rule.
      const planted = [...new Set([...'upsert.run(workspaceId, row.ref, row.type, row.slug, row.owner, at)'.matchAll(/\brow\.(\w+)\b/g)].map((m) => m[1]))];
      assert.ok(planted.filter((field) => !screened.includes(field)).length > 0, "a planted unscreened binding trips the detector");
    },
  },
  {
    // ADDED at 43/02's structural review (ADR-012/B3). `wholesaleDelete` was module-
    // private and became EXPORTED at the cut, for a good reason: after the
    // reclassification nothing sweeps `work_items`, so "the sweep is refused" is only
    // provable from outside by calling the guard BY NAME. The class gate really is
    // inside it (verified behaviourally in acd-fact-projection-split), so a fact table
    // is safe — but the export also opened every PROJECTION table in the shared store
    // to a wholesale sweep from any module, which the private function never did. A
    // widened surface with no named caller set is how a one-off becomes a habit.
    name: "arch/43 ADR-012/B3 (acd-work-items-single-writer): the newly-exported wholesaleDelete keeps a NAMED caller set in src/ — the projection sweep is not an open door",
    run: async () => {
      const SANCTIONED = ["src/global-work-store.mjs"];
      const callers = [];
      for (const file of await mjsFilesUnder(SRC)) {
        const code = stripComments(await readFile(file, "utf8"));
        // The call form, not the export/import lines that merely name it.
        if (/wholesaleDelete\s*\(\s*\w/.test(code)) callers.push(path.relative(repoRoot, file).replace(/\\/g, "/"));
      }
      assert.deepEqual(
        callers.sort(),
        SANCTIONED,
        `wholesaleDelete may be CALLED only from its sanctioned module(s) — a new caller is a new projection-sweep door and needs an ADR, not an import (found: ${callers.join(", ")})`,
      );
      // Non-vacuous: the detector fires on a real call, and on a call planted in a
      // module that is NOT sanctioned (which is the case it exists to catch).
      assert.ok(/wholesaleDelete\s*\(\s*\w/.test('wholesaleDelete(db, "projection_errors", workspaceId);'), "the caller detector fires on a real call");
      assert.ok(/wholesaleDelete\s*\(\s*\w/.test('  await wholesaleDelete(store.db, "workspaces", id);'), "…and on an awaited one");
      assert.ok(!/wholesaleDelete\s*\(\s*\w/.test('import { wholesaleDelete } from "./global-work-store.mjs";'), "…and NOT on a bare import that never calls it");
    },
  },
  {
    name: "arch/43 ADR-004 (acd-work-items-single-writer): self-check — planted DML, a planted sweep call and a planted reclassification all trip the SAME detectors",
    run: async () => {
      assert.ok(WORK_ITEMS_DML.test('INSERT INTO work_items (workspace_id, ref) VALUES (?, ?)'), "the DML detector catches an INSERT");
      assert.ok(WORK_ITEMS_DML.test("DELETE FROM work_items WHERE workspace_id = ?"), "the DML detector catches a DELETE");
      assert.ok(WORK_ITEMS_DML.test("UPDATE work_items SET status = ?"), "the DML detector catches an UPDATE");
      assert.ok(!WORK_ITEMS_DML.test("SELECT * FROM work_items WHERE workspace_id = ?"), "the DML detector does NOT flag a plain read");
      assert.ok(!WORK_ITEMS_DML.test("INSERT INTO work_item_docs (workspace_id, ref) VALUES (?, ?)"), "the DML detector does not confuse the content table");

      assert.ok(WHOLESALE_WORK_ITEMS.test('wholesaleDelete(db, "work_items", workspaceId);'), "the sweep detector catches the real call form");
      assert.ok(!WHOLESALE_WORK_ITEMS.test('wholesaleDelete(db, "projection_errors", workspaceId);'), "the sweep detector does not flag the projection_errors sweep");

      const planted = 'work_items: Object.freeze({ class: "fact", writtenBy: "upsertWorkItems" }),';
      assert.equal(classOf(planted, "work_items"), "fact", "the classification reader sees a planted reclassification (the arming condition)");
      assert.equal(
        classOf('work_items: Object.freeze({ class: "projection", rebuiltBy: "publishWorkspaceSnapshot" }),', "work_items"),
        "projection",
        "the classification reader sees today's real classification",
      );
    },
  },
];
