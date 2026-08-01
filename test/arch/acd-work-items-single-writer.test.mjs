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
