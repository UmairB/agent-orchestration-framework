// Fitness function: acd-cache-staleness-single-predicate (milestone 43 / ADR-006) —
//
//   "The staleness predicate is the shared strict-`>` isStale, with exactly ONE
//    client-side evaluator and NO threshold literal in ui/. And the TTL NEVER EVICTS —
//    no deletion, anywhere, may be predicated on time."
//
// TWO invariants, one file, because they are the same decision seen from two sides.
//
// (1) ONE PREDICATE. DESIGN states it as a defect, not a preference: "Two staleness
// predicates that can disagree about the same instant is a defect, not a variant." The
// mesh already shares ONE definition — isStale (run-store.mjs), re-exposed as isNodeStale
// (mesh-presence.mjs:398-408), strict `>`, injected clock — and 35/ADR-005 + 38/ADR-002
// already bind the run layer, the node layer and session TTL to it. This milestone adds
// the CACHE layer, and adds a genuinely new wrinkle: DESIGN requires the badge to be
// computed against a live 1-second clock tick in the BROWSER (the board only re-polls
// while something is executing, so a settled stale item would otherwise never grow its
// badge). So the rule really is evaluated on two sides of the wire — which is safe only
// if the THRESHOLD travels on the envelope and ui/ carries no default and no literal.
//
// (2) NEVER EVICT. STATE, settled by the operator: "a TTL that evicts would destroy the
// mesh's only readable copy: after settle the artifacts exist in exactly two places, the
// pushed branch and the control's cache, and this milestone deliberately does not read
// git." A time-predicated DELETE is therefore not a tuning choice — it is the one change
// that would lose data irrecoverably. This is the ratchet.
//
// Proofs:
//  1. GREEN, behavioural — the shared predicate is strict `>`: a record AT the threshold
//     is still FRESH. Both sides of the wire must agree at that instant.
//  2. GREEN, the never-evict ratchet — no DELETE against work_items / work_item_docs /
//     work_item_runs anywhere in src/ carries a time-column predicate.
//  3. GREEN — ui/ carries at most ONE module that evaluates freshness, and NO hard-coded
//     staleness threshold (the window arrives on the wire).
//  4. ARMED — once ui/src/board/freshness.mjs exists it takes `now` as a parameter, reads
//     no clock of its own, and uses strict `>` (never `>=`).
//  Self-check (m03 non-vacuous): a planted time-predicated DELETE, a planted ui threshold
//  literal and a `>=` predicate all trip the SAME detectors.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isNodeStale } from "../../src/mesh-presence.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = path.join(repoRoot, "src");
const UI_SRC = path.join(repoRoot, "ui", "src");
const FRESHNESS = path.join(repoRoot, "ui", "src", "board", "freshness.mjs");

const CACHE_TABLES = ["work_items", "work_item_docs", "work_item_runs"];
const TIME_COLUMNS = ["updated_at", "synced_at", "last_published_at", "reported_at"];

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

async function filesUnder(dir, exts) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await filesUnder(full, exts)));
    else if (exts.some((ext) => entry.name.endsWith(ext))) out.push(full);
  }
  return out;
}

// A DELETE against a cache table whose predicate mentions a time column — the one
// operation the settled never-evict rule forbids outright.
function timePredicatedDeletes(code) {
  const found = [];
  for (const table of CACHE_TABLES) {
    const re = new RegExp(`DELETE\\s+FROM\\s+${table}\\b([\\s\\S]{0,240})`, "gi");
    let m;
    while ((m = re.exec(code)) !== null) {
      // Bound the scan to this statement: stop at the closing backtick/quote or a `;`.
      const tail = m[1].split(/[;`]/)[0];
      if (TIME_COLUMNS.some((col) => new RegExp(`\\b${col}\\b`).test(tail))) {
        found.push(`${table}: ${tail.trim().slice(0, 80)}`);
      }
    }
  }
  return found;
}

export const archTests = [
  {
    name: "arch/43 ADR-006 (acd-cache-staleness-single-predicate): the shared predicate is strict `>` — a record AT the staleness window is still FRESH (the instant both sides of the wire must agree on)",
    run: async () => {
      const now = Date.parse("2026-08-01T12:00:00.000Z");
      const windowMs = 90_000;
      assert.equal(
        isNodeStale({ heartbeatAt: new Date(now - windowMs).toISOString() }, now, windowMs),
        false,
        "a record exactly AT the window must still be fresh (strict >)",
      );
      assert.equal(
        isNodeStale({ heartbeatAt: new Date(now - windowMs - 1).toISOString() }, now, windowMs),
        true,
        "a record one millisecond past the window must be stale",
      );
    },
  },
  {
    name: "arch/43 ADR-006 (acd-cache-staleness-single-predicate): NEVER EVICT — no DELETE against work_items / work_item_docs / work_item_runs in src/ is predicated on a time column",
    run: async () => {
      const offenders = [];
      for (const file of await filesUnder(SRC, [".mjs"])) {
        const found = timePredicatedDeletes(stripComments(await readFile(file, "utf8")));
        for (const hit of found) offenders.push(`${path.relative(repoRoot, file)} — ${hit}`);
      }
      assert.deepEqual(
        offenders,
        [],
        `a time-predicated DELETE would destroy the mesh's ONLY readable copy of settled work (STATE, settled 2026-08-01) — offenders: ${JSON.stringify(offenders)}`,
      );
    },
  },
  {
    name: "arch/43 ADR-006 (acd-cache-staleness-single-predicate): ui/ carries at most ONE freshness evaluator and NO hard-coded staleness threshold — the window arrives on the wire",
    run: async () => {
      const files = await filesUnder(UI_SRC, [".ts", ".tsx", ".mjs", ".js"]);
      assert.ok(files.length > 0, "ui/src has source files (non-vacuous)");
      const evaluators = [];
      const literals = [];
      for (const file of files) {
        const code = stripComments(await readFile(file, "utf8"));
        if (/\bstalenessSeconds\b/.test(code)) {
          const rel = path.relative(repoRoot, file);
          evaluators.push(rel);
          // A DEFAULTED or literal threshold in the client is the "two predicates" defect
          // in its most common form: `stalenessSeconds = 120`, `?? 120`, `|| 120`.
          if (/\bstalenessSeconds\b\s*(?:=|\?\?|\|\|)\s*\d/.test(code)) literals.push(rel);
        }
      }
      assert.deepEqual(literals, [], `ui/ must carry no staleness threshold literal — it arrives on the envelope (offenders: ${literals.join(", ")})`);
      assert.ok(
        evaluators.length <= 1,
        `at most ONE ui module may evaluate freshness (DESIGN: one headless ramp module, board and fleet import the same one) — found: ${evaluators.join(", ")}`,
      );
    },
  },
  {
    name: "arch/43 ADR-006 (acd-cache-staleness-single-predicate): ARMED — once ui/src/board/freshness.mjs exists it takes `now` as a parameter, reads no clock of its own, and uses strict `>` (never `>=`)",
    run: async () => {
      if (!existsSync(FRESHNESS)) return; // not-yet-built: a clean skip that arms the moment the ramp lands
      const code = stripComments(await readFile(FRESHNESS, "utf8"));
      const problems = [];
      if (!/\bnow\b/.test(code)) problems.push("freshness.mjs does not take `now` — the runs.mjs contract is `now` passed in");
      if (/\bDate\.now\s*\(/.test(code)) problems.push("freshness.mjs reads its own clock (Date.now) — `now` must be injected");
      if (/>=\s*(?:stalenessSeconds|threshold|windowMs)/.test(code)) {
        problems.push("freshness.mjs uses `>=` — the shared predicate is strict `>`, and disagreeing at the threshold is the defect");
      }
      assert.deepEqual(problems, [], `freshness ramp problems: ${JSON.stringify(problems)}`);
    },
  },
  {
    name: "arch/43 ADR-006 (acd-cache-staleness-single-predicate): self-check — a planted time-predicated DELETE, a planted ui threshold literal and a `>=` predicate all trip the detectors",
    run: async () => {
      assert.deepEqual(timePredicatedDeletes('db.prepare("DELETE FROM work_items WHERE workspace_id = ?")'), [], "an authorship-scoped retraction is NOT an eviction and passes");
      assert.ok(
        timePredicatedDeletes('db.prepare("DELETE FROM work_item_docs WHERE updated_at < ?")').length > 0,
        "a planted time-predicated DELETE trips the detector",
      );
      assert.ok(
        timePredicatedDeletes("db.prepare(`DELETE FROM work_items WHERE synced_at < ?`)").length > 0,
        "the detector catches the synced_at form too",
      );
      assert.ok(
        timePredicatedDeletes('db.prepare("DELETE FROM node_logs WHERE at < ?")').length === 0,
        "the detector is scoped to the three CACHE tables (node_logs is a ring buffer and may age out)",
      );

      assert.ok(/\bstalenessSeconds\b\s*(?:=|\?\?|\|\|)\s*\d/.test("const w = stalenessSeconds ?? 120;"), "the ui literal detector catches a defaulted threshold");
      assert.ok(!/\bstalenessSeconds\b\s*(?:=|\?\?|\|\|)\s*\d/.test("const w = envelope.stalenessSeconds;"), "the ui literal detector does not flag a wire-sourced threshold");

      const now = Date.parse("2026-08-01T12:00:00.000Z");
      const windowMs = 90_000;
      const atThreshold = { heartbeatAt: new Date(now - windowMs).toISOString() };
      const forbiddenGte = (r, n, t) => n - Date.parse(r.heartbeatAt) >= t;
      assert.notEqual(
        isNodeStale(atThreshold, now, windowMs),
        forbiddenGte(atThreshold, now, windowMs),
        "the real strict-> predicate disagrees with the forbidden >= form at the threshold instant",
      );
    },
  },
];
