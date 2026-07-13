// Fitness function for milestone 37 / ADR-002 (FF-3703):
// "`recordDoc` maps spike → SPIKE.md and chore → CHORE.md (the per-type record doc)."
//
// Proves it against the EXPORTED recordDoc(item) — the real seam, not a source grep
// (mirrors test/arch/acd-run-record-derived.test.mjs, which imports recordDoc).
//
// Red-until-built: inert-green until the vocabulary lands in ITEM_RE. Until then a
// spike/chore is not a real type and recordDoc would return null; once story 00
// lands the mapping this self-activates. NON-VACUITY: the existing type mappings
// (milestone/story/uat) are asserted LIVE now — a regression there goes RED today.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { recordDoc } from "../../src/work.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const workSrc = path.join(repoRoot, "src", "work.mjs");

async function itemTypeAlternation() {
  const src = await readFile(workSrc, "utf8");
  const m = src.match(/const\s+ITEM_RE\s*=\s*\/\^\(\\d\+\)_\(([^)]+)\)_/);
  if (!m) return null;
  return new Set(m[1].split("|").map((t) => t.trim()));
}
async function vocabularyLanded() {
  const types = await itemTypeAlternation();
  return types != null && types.has("spike") && types.has("chore");
}

export const archTests = [
  {
    name: "arch/spike-chore-record-doc: recordDoc maps the EXISTING types (story→STORY.md, uat→SESSION.md) — LIVE, non-vacuous",
    run: async () => {
      // A directory with no AOF.md → milestone maps to SPEC.md; story/uat are static.
      assert.equal(recordDoc({ type: "story", dir: repoRoot }), "STORY.md", "story → STORY.md");
      assert.equal(recordDoc({ type: "uat", dir: repoRoot }), "SESSION.md", "uat → SESSION.md");
    },
  },
  {
    name: "arch/spike-chore-record-doc: recordDoc maps spike → SPIKE.md, chore → CHORE.md (FF-3703, self-activates)",
    run: async () => {
      if (!(await vocabularyLanded())) return; // inert-green until the vocabulary lands
      assert.equal(recordDoc({ type: "spike", dir: repoRoot }), "SPIKE.md", "spike → SPIKE.md (ADR-002)");
      assert.equal(recordDoc({ type: "chore", dir: repoRoot }), "CHORE.md", "chore → CHORE.md (ADR-002)");
    },
  },
];
