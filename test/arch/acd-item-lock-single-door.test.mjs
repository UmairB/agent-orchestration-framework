// Fitness function: acd-item-lock-single-door (milestone 43 / ADR-003) —
//
//   "The item lock is scoped by ONE `executionScopeRef` rule, which lives in a pure
//    LEAF; the single enforcement door is inside `transitionRunStart`; no command
//    module re-derives an active-assignment query for lock purposes; and the run STORE
//    stays mesh-blind."
//
// WHY structural. STATE measured two holes at HEAD: (1) `findActiveAssignment`
// (assignment-record.mjs:203) matches item_ref EXACTLY while execution is
// milestone-scoped — the read side already owns the scope rule
// (board-mesh-execution.mjs:117-136, whose own comment says "This is the ONE home for
// the scope rule"), the write side does not use it; (2) nothing local honours the lock
// — run-start never queries global_assignments and `work next` hands out a held item.
// ADR-003 puts the guard INSIDE the mint seam (effects/run-transitions.mjs:39 — reached
// from exactly five call sites in three modules and from nowhere else), mirroring
// effects/assignment-transitions.mjs's discipline: "the rules live ONCE, in front of the
// write, and no writer can reach the fact without them." The PLACEMENT is the invariant;
// the refusal itself (`item-locked-by-assignment`) is behavioural and belongs in a
// scenario.
//
// The layering clause is load-bearing: `board-mesh-execution.mjs` is a FACE module
// (imported by continue/list/run-status, imports 6). The spine must not import it — which
// is why ADR-003 moves `executionScopeRef` DOWN into `assignment-record.mjs` (imported by
// 6, IMPORTS 0 — a pure leaf). This guard asserts the rule has ONE definition wherever it
// lives, so the move cannot leave a second copy behind.
//
// Proofs:
//  1. GREEN — `executionScopeRef` is DEFINED in exactly one module in src/ (today
//     board-mesh-execution.mjs; after the story, assignment-record.mjs). A second copy
//     is the "one fact, many derivations" disease (TECH_DEBT item 0).
//  2. GREEN — src/run-store.mjs imports no assignment/lock/mesh module: the lock must not
//     leak into the mesh-blind store (re-arms acd-run-store-mesh-free's subject from this
//     milestone's angle; its own assertions are not duplicated here).
//  3. ARMED — once the lock predicate module exists, `effects/run-transitions.mjs` imports
//     it (the mint door is guarded at the seam), and no command module calls
//     `findActiveAssignment` directly for the check (that would be the rule living at
//     whichever call site needed it first).
//  Self-check (m03 non-vacuous): planted second definitions and planted store/command
//  imports trip the SAME detectors.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = path.join(repoRoot, "src");
const RUN_STORE = path.join(repoRoot, "src", "run-store.mjs");
const MINT_SEAM = path.join(repoRoot, "src", "effects", "run-transitions.mjs");
const COMMANDS = path.join(repoRoot, "src", "commands");

// Candidate homes for the ADR-003 lock predicate (a near-leaf beside the record).
const LOCK_MODULE_CANDIDATES = [
  path.join(repoRoot, "src", "item-lock.mjs"),
  path.join(repoRoot, "src", "assignment-item-lock.mjs"),
];

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function importSpecifiers(commentStrippedSource) {
  const specs = [];
  const re = /\bfrom\s+["']([^"']+)["']|\bimport\s+["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(commentStrippedSource)) !== null) specs.push(m[1] ?? m[2]);
  return specs;
}

// A DEFINITION of executionScopeRef (not a call, not an import, not a re-export).
const DEFINITION = /(?:export\s+)?(?:async\s+)?function\s+executionScopeRef\s*\(|(?:export\s+)?const\s+executionScopeRef\s*=\s*(?:\(|function|async)/;

async function mjsFilesUnder(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await mjsFilesUnder(full)));
    else if (entry.name.endsWith(".mjs")) out.push(full);
  }
  return out;
}

const FORBIDDEN_IN_RUN_STORE = /(^|\/)(mesh-[^/]+|assignment-record|item-lock|assignment-item-lock)\.mjs$/;

export const archTests = [
  {
    name: "arch/43 ADR-003 (acd-item-lock-single-door): `executionScopeRef` is DEFINED in exactly ONE module in src/ — one scope rule, never a second derivation",
    run: async () => {
      const files = await mjsFilesUnder(SRC);
      const definers = [];
      for (const file of files) {
        if (DEFINITION.test(stripComments(await readFile(file, "utf8")))) definers.push(path.relative(repoRoot, file));
      }
      assert.equal(
        definers.length,
        1,
        `executionScopeRef must be defined exactly once (the scope rule's ONE home) — found in: ${definers.join(", ") || "(nowhere)"}`,
      );
    },
  },
  {
    name: "arch/43 ADR-003 (acd-item-lock-single-door): src/run-store.mjs imports no mesh/assignment/lock module — the lock lives in the SEAM, never in the mesh-blind store",
    run: async () => {
      const specs = importSpecifiers(stripComments(await readFile(RUN_STORE, "utf8")));
      const leaked = specs.filter((s) => FORBIDDEN_IN_RUN_STORE.test(s));
      assert.deepEqual(leaked, [], `src/run-store.mjs must stay mesh-blind (m26/ADR-001) — leaked imports: ${leaked.join(", ")}`);
    },
  },
  {
    name: "arch/43 ADR-003 (acd-item-lock-single-door): ARMED — once the lock predicate module exists, the mint seam imports it and no command module re-derives the active-assignment check",
    run: async () => {
      const lockModule = LOCK_MODULE_CANDIDATES.find((candidate) => existsSync(candidate));
      if (lockModule == null) return; // not-yet-built: a clean skip that arms the moment the lock lands

      const base = path.basename(lockModule);
      const seamSpecs = importSpecifiers(stripComments(await readFile(MINT_SEAM, "utf8")));
      assert.ok(
        seamSpecs.some((s) => s.endsWith(`/${base}`) || s.endsWith(base)),
        `src/effects/run-transitions.mjs must import ${base} — the ONE lock door sits inside the mint seam, not at its five call sites (imports: ${seamSpecs.join(", ")})`,
      );

      // ADR-010/R1.1 narrows this clause. The EXACT-REF primitive stays sanctioned where
      // it is (mesh-assignment.mjs:122 — its one caller in src/ — refusing the pinned,
      // HTTP-409-mapped `assignment-already-active` that an m38 feature asserts). What no
      // command module may do is compute the SCOPE-lock decision itself: neither by
      // calling the new scope predicate directly, nor by hand-rolling an active-state
      // query against global_assignments. (Existing command queries by session_id /
      // assignment_id are untouched — they are not lock decisions.)
      const offenders = [];
      for (const file of await mjsFilesUnder(COMMANDS)) {
        const code = stripComments(await readFile(file, "utf8"));
        const rel = path.relative(repoRoot, file);
        if (/\bfindActiveAssignmentForScope\s*\(/.test(code)) offenders.push(`${rel} (calls the scope predicate directly)`);
        if (/global_assignments[\s\S]{0,160}?\bstate\s+IN\s*\(/i.test(code)) offenders.push(`${rel} (hand-rolls an active-state assignment query)`);
      }
      assert.deepEqual(
        offenders,
        [],
        `no command module may decide the SCOPE lock itself — it asks the lock predicate (offenders: ${offenders.join(", ")})`,
      );
    },
  },
  {
    name: "arch/43 ADR-003 (acd-item-lock-single-door): self-check — planted second definitions and a planted store leak trip the SAME detectors",
    run: async () => {
      assert.ok(DEFINITION.test("export function executionScopeRef(ref) {"), "the detector recognises the real definition form");
      assert.ok(DEFINITION.test("const executionScopeRef = (ref) => ref;"), "the detector recognises an arrow-const definition");
      assert.ok(!DEFINITION.test("const scope = executionScopeRef(ref);"), "the detector does NOT flag a call site");
      assert.ok(!DEFINITION.test('export { executionScopeRef } from "./assignment-record.mjs";'), "the detector does NOT flag a re-export");

      assert.ok(FORBIDDEN_IN_RUN_STORE.test("./mesh-store.mjs"), "the leak detector catches a mesh import");
      assert.ok(FORBIDDEN_IN_RUN_STORE.test("./assignment-record.mjs"), "the leak detector catches an assignment-record import");
      assert.ok(FORBIDDEN_IN_RUN_STORE.test("../item-lock.mjs"), "the leak detector catches a lock import");
      assert.ok(!FORBIDDEN_IN_RUN_STORE.test("./fs.mjs"), "the leak detector does NOT flag the store's legitimate dependency");
    },
  },
];
