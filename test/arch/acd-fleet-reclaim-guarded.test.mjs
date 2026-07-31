// Fitness function: acd-fleet-reclaim-guarded (milestone 26, ADR-006 / fitness #12) —
// "fleet reclaim is guarded orchestration."
//
//   "In src/commands/run-start.mjs the fleet item set is built ONLY inside the
//    mesh-configured branch and filtered through the presence predicate (isNodeStale)
//    BEFORE reclaimStaleRuns is called; the store's reclaimStaleRuns keeps its
//    items-as-argument signature and mesh-blindness (the scan is never rewritten);
//    status rollback still routes through work.mjs's rollbackItemStatus over the
//    returned entries (20/ADR-005 ownership verbatim). PLUS the boundary half folded in
//    at Contract (the resolved QA flag): the releaseLease reference in
//    src/commands/run-complete.mjs sits inside a config.mesh-gated branch. The EXISTING
//    acd-run-reclaim-stale-only + acd-status-rollback-bounded gates re-arm GREEN over
//    the unchanged store/rollback — enumerated here (their suite registration is
//    asserted, not duplicated)."
//
// Each proof carries the m03 non-vacuous planted-violation self-check.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const RUN_START = path.join(repoRoot, "src", "commands", "run-start.mjs");
const RUN_STORE = path.join(repoRoot, "src", "run-store.mjs");
const MESH_GATE = path.join(repoRoot, "src", "commands", "mesh-gate.mjs");
// m42 wave (d) leg d4 (port 2) — the reclaim's status rollback is now DECLARED here
// rather than looped at the command's call site.
const EFFECTS_TABLE = path.join(repoRoot, "src", "effects", "table.mjs");
const TEST_SUITE = path.join(repoRoot, "scripts", "test.mjs");

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// Return the index of the `}` that closes the `{` whose body starts at `start`, or -1.
function matchBrace(code, start) {
  let depth = 0;
  for (let i = start; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      if (depth === 0) return i;
      depth -= 1;
    }
  }
  return -1;
}

// Every `if (…) { … }` whose CONDITION contains `condToken` AND is NOT negated, as
// { cond, body, start, end } (start/end are the body's source offsets — used for the
// "inside a gated block" checks). THE POLARITY RULE: a condition starting with `!`
// (`if (!meshNodeId)` — the unconfigured FLOOR) is NOT a mesh gate, so a lease/fleet
// call placed inside the floor FAILS the inside-a-gate check.
function gatedBlocks(code, condToken) {
  const blocks = [];
  const ifRe = /\bif\s*\(/g;
  let match;
  while ((match = ifRe.exec(code))) {
    const condStart = match.index + match[0].length;
    let depth = 0;
    let condEnd = -1;
    for (let i = condStart; i < code.length; i += 1) {
      const ch = code[i];
      if (ch === "(") depth += 1;
      else if (ch === ")") {
        if (depth === 0) {
          condEnd = i;
          break;
        }
        depth -= 1;
      }
    }
    if (condEnd === -1) continue;
    const cond = code.slice(condStart, condEnd).trim();
    if (!cond.includes(condToken)) continue;
    if (cond.startsWith("!")) continue; // a NEGATED gate is the unconfigured floor, not a mesh gate
    const braceStart = code.indexOf("{", condEnd);
    if (braceStart === -1) continue;
    const braceEnd = matchBrace(code, braceStart + 1);
    if (braceEnd === -1) continue;
    blocks.push({ cond, body: code.slice(braceStart + 1, braceEnd), start: braceStart + 1, end: braceEnd });
  }
  return blocks;
}

// Every source offset of `re` matches (a global regex) in `code`.
function offsetsOf(code, re) {
  const out = [];
  let m;
  while ((m = re.exec(code))) out.push(m.index);
  return out;
}

const inside = (blocks, offset) => blocks.some((b) => offset >= b.start && offset < b.end);

export const archTests = [
  {
    name: "arch/fleet-reclaim-guarded: the fleet item set is built ONLY inside the config.mesh gate — isNodeStale filters BEFORE reclaimStaleRuns, and the fleet enumeration (listItems) never escapes the gate",
    async run() {
      const code = stripComments(await readFile(RUN_START, "utf8"));
      // The gate variable derives from config.mesh through the ONE shared predicate
      // (mesh-gate.mjs — the craft extraction, so the gate can never drift between
      // the run-* commands), and the helper itself reads config?.mesh?.nodeId.
      assert.ok(/meshNodeId\s*=\s*meshNodeIdOf\s*\(/.test(code), "run-start derives its gate (meshNodeId) via the shared meshNodeIdOf helper");
      const helper = stripComments(await readFile(MESH_GATE, "utf8"));
      assert.ok(/config\?\.mesh\?\.nodeId/.test(helper), "the shared helper reads config?.mesh?.nodeId (the gate's one source)");
      const gates = gatedBlocks(code, "meshNodeId");
      assert.ok(gates.length >= 1, "a meshNodeId-gated branch exists");
      // The presence prefilter (isNodeStale) sits INSIDE a gated block…
      const prefilterGate = gates.find((b) => /\bisNodeStale\s*\(/.test(b.body));
      assert.ok(prefilterGate != null, "the isNodeStale presence prefilter sits INSIDE the mesh-configured branch");
      // …and BEFORE the (single, shared) reclaim scan call. m42 wave (d) leg d4
      // (port 2) moved that call onto the transition seam — both reclaim halves now
      // settle through one edge — so the ORDERING invariant this proof exists for is
      // unchanged and follows the shape: the prefilter still decides the scan set
      // before any run is force-failed.
      const scanOffsets = offsetsOf(code, /\btransitionStaleRunsReclaimed\s*\(/g);
      assert.ok(scanOffsets.length >= 1, "run-start reclaims through the transition seam");
      const prefilterOffset = prefilterGate.start + prefilterGate.body.search(/\bisNodeStale\s*\(/);
      for (const scanOffset of scanOffsets) {
        assert.ok(prefilterOffset < scanOffset, "the presence prefilter runs BEFORE the reclaim scan call");
      }
      // The fleet enumeration (every listItems CALL) sits inside the gate — the
      // unconfigured floor never walks the fleet.
      for (const offset of offsetsOf(code, /\blistItems\s*\(/g)) {
        assert.ok(inside(gates, offset), "every listItems( call sits inside the meshNodeId-gated branch (the fleet set is built ONLY under mesh)");
      }
      // Self-check (non-vacuous): the gate detector finds a planted gated prefilter and
      // the inside-check flags a planted UNgated fleet walk.
      const planted = gatedBlocks("if (meshNodeId) { const s = isNodeStale(p, n, t); }", "meshNodeId");
      assert.ok(planted.some((b) => /isNodeStale/.test(b.body)), "the detector finds a gated prefilter");
      const violation = "const all = await listItems(ws.workDir);";
      assert.ok(
        offsetsOf(violation, /\blistItems\s*\(/g).every((o) => !inside(gatedBlocks(violation, "meshNodeId"), o)),
        "the detector flags an ungated fleet enumeration"
      );
      // Self-check (the POLARITY rule): a fleet walk inside the NEGATED gate — the
      // unconfigured floor — is NOT inside a mesh gate; the detector must flag it.
      const negated = "if (!meshNodeId) { const all = await listItems(ws.workDir); }";
      assert.equal(gatedBlocks(negated, "meshNodeId").length, 0, "a negated condition (if (!meshNodeId)) is never a mesh gate");
      assert.ok(
        offsetsOf(negated, /\blistItems\s*\(/g).every((o) => !inside(gatedBlocks(negated, "meshNodeId"), o)),
        "the detector flags a fleet enumeration inside the unconfigured floor"
      );
    },
  },
  {
    name: "arch/fleet-reclaim-guarded: the store's scan is unchanged (items-as-argument, mesh-blind) and status rollback still routes through rollbackItemStatus — now as the reclaim's DECLARED cascade, not an inline loop",
    async run() {
      // The store half: reclaimStaleRuns keeps the m20 items-list signature and the
      // store imports no mesh module (the fleet knowledge lives in the COMMAND layer).
      const store = stripComments(await readFile(RUN_STORE, "utf8"));
      assert.ok(
        /function\s+reclaimStaleRuns\s*\(\s*items\b/.test(store),
        "reclaimStaleRuns keeps its items-as-argument signature (the 26 → 20 seam, no rewrite)"
      );
      assert.ok(
        !/from\s+["'][^"']*mesh-[^"']*["']/.test(store),
        "run-store.mjs imports no mesh module — the store stays fleet-blind (the prefilter is orchestration)"
      );
      // The rollback half: 20/ADR-005 ownership is UNCHANGED — the reclaim's status
      // rollback still routes through the work.mjs writer and nowhere else — but it
      // is now the DECLARED consequence of the `run.completed` a reclaim raises
      // (effects/table.mjs's rollback-status reactor) instead of a loop the command
      // remembered. That is m42 wave (d) leg d4 port 2's whole point: the control
      // tick's reclaim never had that loop, so the two halves disagreed. The command
      // must therefore carry NO rollback of its own.
      const code = stripComments(await readFile(RUN_START, "utf8"));
      assert.ok(
        !/rollbackItemStatus\s*\(/.test(code),
        "run-start owns no inline status rollback — the reclaim's cascade is declared, not remembered"
      );
      const table = stripComments(await readFile(EFFECTS_TABLE, "utf8"));
      assert.ok(
        /rollbackItemStatus\s*\(\s*\{[^}]*\}\s*,\s*["']not-started["']\s*\)/.test(table),
        "the rollback-status reactor routes through rollbackItemStatus(…, 'not-started')"
      );
      assert.ok(
        /key:\s*["']rollback-status["']/.test(table),
        "…and it is declared as a reactor on the completion event a reclaim raises"
      );
      // Self-check (non-vacuous): the signature detector fires on a rewritten scan.
      assert.ok(
        !/function\s+reclaimStaleRuns\s*\(\s*items\b/.test("async function reclaimStaleRuns(workspace, options) {}"),
        "the detector catches a rewritten scan signature"
      );
    },
  },
  // milestone 42 (item 5): the run-complete LEASE-release test is RETIRED — the lease
  // era (releaseLease/meshNodeIdOf in run-complete.mjs) was superseded by m35's
  // assignment record; no release call site remains, so the guard's subject is gone.
  // If run-complete ever regrows a mesh-gated boundary, it needs a NEW guard against
  // the design of that day, not this one resurrected.
  {
    name: "arch/fleet-reclaim-guarded: the existing acd-run-reclaim-stale-only + acd-status-rollback-bounded gates re-arm over the unchanged store/rollback (enumerated — their suite registration is asserted)",
    async run() {
      const suite = await readFile(TEST_SUITE, "utf8");
      assert.ok(
        suite.includes("test/arch/acd-run-reclaim-stale-only.test.mjs") && suite.includes("...acdRunReclaimStaleOnlyTests"),
        "acd-run-reclaim-stale-only is imported and spread into the registered suite (re-armed over the unchanged scan)"
      );
      assert.ok(
        suite.includes("test/arch/acd-status-rollback-bounded.test.mjs") && suite.includes("...acdStatusRollbackBoundedTests"),
        "acd-status-rollback-bounded is imported and spread into the registered suite (re-armed over the unchanged rollback writer)"
      );
    },
  },
];
