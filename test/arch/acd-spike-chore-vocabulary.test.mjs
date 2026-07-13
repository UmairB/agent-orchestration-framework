// Fitness function for milestone 37 / ADR-001 (FF-3701):
// "`ITEM_RE` — the closed item-type vocabulary in src/work.mjs — admits `spike` and
//  `chore`, and STILL admits the original four (milestone|story|task|uat)."
//
// Red-until-built: the vocabulary does not exist yet. The "original four still
// admitted" assert is LIVE now (non-vacuity: if a future edit dropped `uat`, this
// goes RED today). The "spike & chore admitted" assert SELF-ACTIVATES the moment
// story 00 adds the two types to ITEM_RE — until then it is inert-green. Gated on
// the ITEM_RE alternation, mirroring the m06 headroom red-until-built idiom.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const workSrc = path.join(repoRoot, "src", "work.mjs");

// Extract the alternation `(milestone|story|task|uat|...)` from the ITEM_RE literal
// in source. Returns the set of admitted type tokens (or null if ITEM_RE not found).
async function itemTypeAlternation() {
  const src = await readFile(workSrc, "utf8");
  const m = src.match(/const\s+ITEM_RE\s*=\s*\/\^\(\\d\+\)_\(([^)]+)\)_/);
  if (!m) return null;
  return new Set(m[1].split("|").map((t) => t.trim()));
}

// The shared red-until-built gate: has the spike/chore vocabulary landed yet?
async function vocabularyLanded() {
  const types = await itemTypeAlternation();
  return types != null && types.has("spike") && types.has("chore");
}

export const archTests = [
  {
    name: "arch/spike-chore-vocabulary: ITEM_RE still admits the original four (milestone|story|task|uat) — LIVE, non-vacuous",
    run: async () => {
      const types = await itemTypeAlternation();
      assert.ok(types, "ITEM_RE alternation is parseable from src/work.mjs");
      for (const t of ["milestone", "story", "task", "uat"]) {
        assert.ok(types.has(t), `ITEM_RE admits the original type "${t}" (dropping it is a RED regression)`);
      }
    },
  },
  {
    name: "arch/spike-chore-vocabulary: ITEM_RE admits `spike` and `chore` (FF-3701, self-activates when the vocabulary lands)",
    run: async () => {
      if (!(await vocabularyLanded())) return; // inert-green until story 00 lands the vocabulary
      const types = await itemTypeAlternation();
      assert.ok(types.has("spike"), "ITEM_RE admits `spike` (ADR-001)");
      assert.ok(types.has("chore"), "ITEM_RE admits `chore` (ADR-001)");
    },
  },
];
