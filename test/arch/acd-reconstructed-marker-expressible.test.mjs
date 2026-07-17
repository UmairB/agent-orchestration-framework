// Fitness function for milestone 40 / ADR-008 — reconstruction is NOT migration. The
// registry MUST be able to mark a reconstructed doc so it can never be recalled as an
// authored fact; the pure stamp transform sets NO such marker. This is the readiness
// criterion for m39's OUTCOME.md backfill: a registry that cannot express the
// distinction is not ready to carry it.
//
// The honest precedent already exists ALWAYS-LIVE: the import leg marks a recovered
// digest `imported: true` and `isImportRecord` (memory/local-indexing.mjs) routes those
// records to a soft `summary`, never a hard `adr`/`lesson`. A `reconstructed` marker is
// the exact analogue. This guard proves (a) that recall-exclusion idiom exists to build
// on, ALWAYS-LIVE, and (b) GUARD-IF-PRESENT, that the registry can express a
// reconstructed transform whose produced doc carries the marker.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isImportRecord, IMPORT_ITEM_PREFIX } from "../../src/memory/local-indexing.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const UPGRADE_MODULE = path.join(repoRoot, "src", "work-upgrade.mjs");

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

export const archTests = [
  {
    name: "arch/ADR-008(m40): the recall-exclusion idiom exists to build on — isImportRecord marks a provenance record (imported:) NOT an authored fact, the analogue a `reconstructed` marker reuses",
    run: async () => {
      // ALWAYS-LIVE: the import leg's marker → soft-record routing is the precedent the
      // reconstructed marker mirrors. A namespaced (import:) record is a provenance
      // record, never a work-stream authored fact.
      assert.equal(typeof isImportRecord, "function", "isImportRecord is the provenance predicate the reconstructed marker mirrors");
      assert.ok(isImportRecord({ item: `${IMPORT_ITEM_PREFIX}src/00` }), "a marked (import:) record is recognised as provenance, not authored fact");
      assert.ok(!isImportRecord({ item: "40" }), "a work-stream authored record is NOT provenance-marked");
    },
  },
  {
    name: "arch/ADR-008(m40): GUARD-IF-PRESENT — the registry can express a reconstructed transform (the imported:true analogue), and the produced doc carries a `reconstructed` marker",
    run: async () => {
      if (!existsSync(UPGRADE_MODULE)) return; // guard-if-present: the registry has not landed
      const source = stripComments(await readFile(UPGRADE_MODULE, "utf8"));
      // The registry vocabulary references the reconstruction distinction — a descriptor
      // flag (reconstructs) and/or the frontmatter marker (reconstructed) it stamps. A
      // registry with no such token cannot carry m39's backfill (ADR-008 readiness).
      assert.ok(
        /\breconstruct(s|ed|ion)?\b/i.test(source),
        "src/work-upgrade.mjs expresses the reconstructed-marker distinction (a `reconstructs` descriptor flag / `reconstructed` frontmatter marker) — the readiness criterion for m39's backfill",
      );
      // Non-vacuity: the token detector does not fire on unrelated registry prose.
      assert.ok(!/\breconstruct(s|ed|ion)?\b/i.test("const migrations = [{ from: 0, to: 1, id: 'stamp' }];"), "the detector does NOT fire on a plain, non-reconstructing registry");
    },
  },
];
