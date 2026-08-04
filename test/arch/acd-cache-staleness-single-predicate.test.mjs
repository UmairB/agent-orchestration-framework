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
// (3) ONE MAPPER — ADDED at 43/04's structural review (ADR-014/E4). ADR-006's third clause
// is the one this file did not carry: "the storage→wire mapping has ONE home — the row
// mapper — and is applied identically to rows and to artifacts." That was asserted
// BEHAVIOURALLY by the story (a row and an artifact produce the same key names), which can
// only ever prove that the mapper's OUTPUT agrees with itself at one call site — it cannot
// see a SECOND translation living somewhere else and quietly disagreeing. Measured at the
// review: one did (`mergeWorkerItems` set `reportedBy` from the ASSIGNMENT overlay's node —
// a different fact under the same wire key), and its correctness depended entirely on a
// later stamp overwriting it. That is a sameness property, so it is a ratchet, not a
// scenario.
//
// Proofs:
//  1. GREEN, behavioural — the shared predicate is strict `>`: a record AT the threshold
//     is still FRESH. Both sides of the wire must agree at that instant.
//  2. GREEN, the never-evict ratchet — no DELETE against work_items / work_item_docs /
//     work_item_runs anywhere in src/ carries a time-column predicate.
//  3. GREEN — ui/ carries at most ONE module that evaluates freshness, and NO hard-coded
//     staleness threshold (the window arrives on the wire).
//  3b. GREEN — the SUBJECT half of the same clause, added at 43/04's SECOND-PASS review
//     (ADR-015/F1). Proof 3 keys entirely on the identifier `stalenessSeconds`, so it holds
//     "only one module knows the window's WIRE NAME" and nothing more: a second evaluator
//     that takes the number as `windowSeconds` (which is exactly what every consumer in
//     ui/ already calls it) mentions `stalenessSeconds` nowhere and passes. MEASURED at the
//     review: a planted `now - Date.parse(row.syncedAt) > windowSeconds * 1000` in a .tsx
//     was invisible to every clause in this file. So the invariant is re-stated over the
//     one thing a second evaluator CANNOT avoid — reading the INSTANT: only freshness.mjs
//     may read `syncedAt` off a record. Passing the whole record to the ramp is not a read,
//     which is what every legitimate consumer does.
//  4. ARMED — once ui/src/board/freshness.mjs exists it takes `now` as a parameter, reads
//     no clock of its own, and uses strict `>` (never `>=`).
//  5. THE ONE-MAPPER RATCHET — no module in src/ other than cache-provenance.mjs may build
//     a `reportedBy`/`syncedAt` wire key out of a STORAGE spelling; one named baseline.
//  Self-check (m03 non-vacuous): a planted time-predicated DELETE, a planted ui threshold
//  literal, a `>=` predicate, a planted hand-rolled mapping AND a renamed second evaluator
//  all trip the SAME detectors.
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

// ADR-006's mapper home, and the only module allowed to translate between the two
// vocabularies.
const MAPPER_MODULE = "src/cache-provenance.mjs";
// The STORAGE spellings of the two provenance facts (the SQLite column names and the store
// accessors' camelCase view of them). Meeting one of these on the right-hand side of a WIRE
// key is, by definition, a translation.
const STORAGE_SPELLINGS = /\b(node_id|nodeId|updated_at|updatedAt)\b/;
// The ONE sanctioned exception, named rather than counted (m43/ADR-013 C5: a baseline is
// reviewed by re-measuring it, never by its rationale alone). `upsertWorkItems`' skip
// detail reports WHICH node already authored a row it stepped over — a diagnostic payload
// on the writer's own return value, not a row or an artifact on any wire, and 43/02's
// `authored-elsewhere` reason contract. It is listed here so a SECOND one cannot hide
// behind it.
const HAND_ROLLED_BASELINE = ["src/global-work-store.mjs — reportedBy: existing.node_id"];

// ADR-015/F1 — the SUBJECT of a freshness verdict. A module cannot judge how old a copy is
// without reading the copy's INSTANT, so "who reads `syncedAt`" is the rename-proof spelling
// of "who evaluates freshness". Two access shapes, both of them a read:
//   `row.syncedAt` / `row?.syncedAt` / `row["syncedAt"]`  — member access;
//   `const { syncedAt } = row`                            — destructuring.
// Handing the WHOLE record to the ramp (`freshnessOf(item)`, `freshness(record, …)`) is NOT
// a read and must stay legal — it is what every legitimate consumer does.
const UI_ONE_EVALUATOR = "ui/src/board/freshness.mjs";
// `.mts` is in the scan (it was not before ADR-015/F1): a declaration file is harmless, but
// an EVALUATOR written as a `.mts` would otherwise have been invisible to every clause here.
const UI_EXTS = [".ts", ".tsx", ".mts", ".mjs", ".js"];
const SYNCED_AT_MEMBER = /(?:\.|\?\.)\s*syncedAt\b|\[\s*["']syncedAt["']\s*\]/;
const SYNCED_AT_DESTRUCTURED = /\{[^{}]*\bsyncedAt\b[^{}]*\}\s*=[^=]/;

function readsTheInstant(code) {
  const hits = [];
  const member = code.match(SYNCED_AT_MEMBER);
  if (member) hits.push(`member access ${member[0].trim()}`);
  if (SYNCED_AT_DESTRUCTURED.test(code)) hits.push("destructured `syncedAt`");
  return hits;
}

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

// A `reportedBy:` / `syncedAt:` property whose VALUE reaches for a storage spelling — i.e.
// a storage→wire translation performed somewhere other than the mapper. Two shapes are
// deliberately NOT hits, because neither is a translation:
//   - `reportedBy: toWireProvenance(row).reportedBy` — it went THROUGH the mapper;
//   - `reportedBy: streamed.reportedBy` — wire to wire, a pass-through of an already
//     mapped value.
function handRolledProvenanceMappings(code) {
  const found = [];
  const re = /\b(reportedBy|syncedAt)\s*:\s*([^,\n}]+)/g;
  let match;
  while ((match = re.exec(code)) !== null) {
    const value = match[2];
    if (/toWireProvenance|withProvenance/.test(value)) continue;
    if (!STORAGE_SPELLINGS.test(value)) continue;
    found.push(`${match[1]}: ${value.trim()}`);
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
      const files = await filesUnder(UI_SRC, UI_EXTS);
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
    // ADDED at 43/04's SECOND-PASS structural review (ADR-015/F1). The clause above holds
    // the window's WIRE NAME to one reader — genuinely useful, and genuinely not the whole
    // invariant ADR-006 states. ADR-006's words are "exactly ONE module evaluates
    // freshness"; a detector that counts mentions of `stalenessSeconds` is satisfied by
    // renaming the parameter, which is what `ui/` already calls it everywhere downstream
    // (`windowSeconds`). This clause holds the same rule over the one thing a second
    // evaluator cannot rename away: the INSTANT it must read to have an opinion at all.
    name: "arch/43 ADR-015/F1 (acd-cache-staleness-single-predicate): only ui/src/board/freshness.mjs READS a record's `syncedAt` — the rename-proof half of ADR-006's one-evaluator clause",
    run: async () => {
      const offenders = [];
      for (const file of await filesUnder(UI_SRC, UI_EXTS)) {
        const rel = path.relative(repoRoot, file).replaceAll("\\", "/");
        if (rel === UI_ONE_EVALUATOR) continue;
        for (const hit of readsTheInstant(stripComments(await readFile(file, "utf8")))) {
          offenders.push(`${rel} — ${hit}`);
        }
      }
      assert.deepEqual(
        offenders,
        [],
        `only ${UI_ONE_EVALUATOR} may read a record's \`syncedAt\`: reading the instant IS evaluating freshness, and a second evaluator is DESIGN's named defect ("two staleness predicates that can disagree about the same instant is a defect, not a variant"). Pass the whole record to the ramp instead — \`freshnessOf(item)\` / \`freshness(record, { now, windowSeconds })\` — which is not a read and stays legal. Offenders: ${JSON.stringify(offenders)}`,
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
    // ADDED at 43/04's structural review (ADR-014/E4). The mapping is a SAMENESS property:
    // a scenario can prove the mapper's output is well-shaped, but only an absence check
    // can prove no second translation exists. Measured 2026-08-03, this found exactly one
    // real offender — `mergeWorkerItems` attributing an inserted child row from the
    // ASSIGNMENT overlay's node under the `reportedBy` key, a DIFFERENT fact ("which node
    // was this assigned to") wearing the wire name for "which node reported this row".
    name: "arch/43 ADR-006 (acd-cache-staleness-single-predicate): ONE MAPPER — only src/cache-provenance.mjs turns a STORAGE provenance spelling into a `reportedBy`/`syncedAt` wire key",
    run: async () => {
      const offenders = [];
      for (const file of await filesUnder(SRC, [".mjs"])) {
        const rel = path.relative(repoRoot, file).replaceAll("\\", "/");
        if (rel === MAPPER_MODULE) continue;
        for (const hit of handRolledProvenanceMappings(stripComments(await readFile(file, "utf8")))) {
          offenders.push(`${rel} — ${hit}`);
        }
      }
      assert.deepEqual(
        offenders.sort(),
        [...HAND_ROLLED_BASELINE].sort(),
        `the storage→wire provenance mapping has ONE home (${MAPPER_MODULE}) applied identically to rows and artifacts (ADR-006). A second translation is how two surfaces come to disagree about what an unknown looks like — or, measured at 43/04, about what the fact even IS. Offenders: ${JSON.stringify(offenders)}`,
      );
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

      // ADR-015/F1 — the RENAME the clause above cannot see, and the subject detector that
      // can. This pair is the whole argument for adding it: the first line is a complete
      // second evaluator and the `stalenessSeconds` detectors are blind to it.
      const renamedEvaluator = "const stale = now - Date.parse(row.syncedAt) > windowSeconds * 1000;";
      assert.ok(!/\bstalenessSeconds\b/.test(renamedEvaluator), "a second evaluator that renames the window is INVISIBLE to the wire-name clause — which is why F1 exists");
      assert.deepEqual(
        readsTheInstant(renamedEvaluator),
        ["member access .syncedAt"],
        "…and the subject detector catches it, because it must read the instant to have an opinion",
      );
      assert.deepEqual(
        readsTheInstant('const { syncedAt, reportedBy } = item;'),
        ["destructured `syncedAt`"],
        "…in the destructured spelling too",
      );
      assert.deepEqual(
        readsTheInstant('const age = item["syncedAt"];'),
        ['member access ["syncedAt"]'],
        "…and the bracket spelling",
      );
      assert.deepEqual(
        readsTheInstant("const view = freshnessOf(item);\nconst f = freshness(record, { now, windowSeconds });"),
        [],
        "handing the WHOLE record to the ramp is not a read — every legitimate consumer does exactly this",
      );
      assert.deepEqual(
        readsTheInstant("export type WorkItem = { reportedBy?: string | null; syncedAt?: string | null };"),
        [],
        "…and declaring the field in a wire TYPE is not a read either (api.ts must keep stating the wire shape)",
      );

      // The one-mapper detector: a hand-rolled translation trips it; going through the
      // mapper, and passing an already-mapped wire value along, do not.
      assert.deepEqual(
        handRolledProvenanceMappings("out.push({ ref, reportedBy: overlay.get(ref)?.nodeId ?? null });"),
        ["reportedBy: overlay.get(ref)?.nodeId ?? null"],
        "a hand-rolled storage→wire mapping trips the detector",
      );
      assert.deepEqual(
        handRolledProvenanceMappings("return { ref, syncedAt: row.updated_at };"),
        ["syncedAt: row.updated_at"],
        "…in the snake_case spelling too",
      );
      assert.deepEqual(
        handRolledProvenanceMappings("return { ref, ...toWireProvenance(row), reportedBy: toWireProvenance(row).reportedBy };"),
        [],
        "going THROUGH the mapper is not a translation",
      );
      assert.deepEqual(
        handRolledProvenanceMappings("return { ref, reportedBy: streamed.reportedBy, syncedAt: streamed.syncedAt };"),
        [],
        "a wire→wire pass-through of an already-mapped value is not a translation",
      );

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
