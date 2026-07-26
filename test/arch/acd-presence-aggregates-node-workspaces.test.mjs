// Fitness function: acd-presence-aggregates-node-workspaces (milestone 38 / ADR-003) —
// "the presence assembly reads the node-workspaces registry (global_node_workspaces),
// NOT a single launch-cwd workspace; presence is unioned across ALL of a node's
// registered workspaces."
//
// THE BUG (m36 UAT, STATE.md): assembleCurrentPresenceRecord (mesh-launcher.mjs:71)
// reads `listItems(ws.workDir)` for ONE workspace — the daemon's launch cwd — so a tray
// app launched from its install dir reads an empty workspace and is permanently `idle`.
// ADR-003 replaces that single read with a read of `global_node_workspaces WHERE
// node_id = ?` and a union of active runs + live sessions across every workspace.
//
// This is a CORRECTNESS invariant on the launcher's presence assembly. The detector
// forbids the launcher's presence path from resting SOLELY on a single-cwd
// `listItems(ws.workDir)` read — once the aggregation lands, the launcher must consult
// `global_node_workspaces` (directly or via a named aggregation seam that does).
//
// STATE OF BUILD: today the launcher still reads the single cwd (the bug). So this test
// is written to PASS today by pinning the SHAPE of the fix's presence in source, in a
// mode that does not go red before the story lands: it asserts EITHER the aggregation is
// present (global_node_workspaces consulted from the presence path) OR a `todo` marker
// records the pending fix — and it ALWAYS runs the self-check that would catch a
// regression away from the aggregation once it exists. A story that lands the fix
// without wiring the registry read trips the detector.
//
// Proofs:
//  1. The launcher's presence assembly, once it aggregates, references
//     `global_node_workspaces` (the registry table) — never resting on a lone
//     `listItems(ws.workDir)` as its only item source.
//  2. Pending-tolerance: while unbuilt, the single-cwd read is recorded as a KNOWN
//     pending gap (a `todo`-style acknowledgement in ARCHITECTURE ADR-003), not a
//     silent green — the test asserts the ADR names the seam so the fix is not
//     forgotten.
//  Self-check (m03 non-vacuous): a source that aggregates but drops the registry read
//  trips the detector.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const launcherSourcePath = path.join(repoRoot, "src", "mesh-launcher.mjs");
const adrPath = path.join(repoRoot, "wiki", "work", "38_milestone_cross-machine-worker-execution", "ARCHITECTURE.md");

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// The invariant, evaluated against the launcher's presence-assembly source: EITHER the
// aggregation consults global_node_workspaces (built), OR the single-cwd read is still
// the only source (pending — acknowledged by ADR-003). A source that has MOVED OFF the
// single cwd but does NOT consult the registry is the failure this catches.
function presenceAggregationState(code) {
  const consultsRegistry = /global_node_workspaces/.test(code) || /resolveNodeWorkspaces\s*\(/.test(code);
  const singleCwdRead = /listItems\s*\(\s*ws\.workDir\s*\)/.test(code);
  if (consultsRegistry) return "aggregated";
  if (singleCwdRead) return "pending-single-cwd";
  return "regressed"; // moved off the single cwd but never consults the registry
}

export const archTests = [
  {
    name: "arch/38 ADR-003 (acd-presence-aggregates-node-workspaces): the launcher presence assembly consults global_node_workspaces (aggregated) OR still reads the single launch cwd (pending) — never a state that dropped BOTH",
    run: async () => {
      const code = stripComments(await readFile(launcherSourcePath, "utf8"));
      const state = presenceAggregationState(code);
      assert.notEqual(state, "regressed", "the presence assembly moved off the single launch-cwd read WITHOUT consulting global_node_workspaces — the aggregation invariant is violated");
      assert.ok(state === "aggregated" || state === "pending-single-cwd", `unexpected presence-assembly state: ${state}`);
    },
  },
  {
    name: "arch/38 ADR-003 (acd-presence-aggregates-node-workspaces): while pending, ADR-003 names the global_node_workspaces aggregation seam so the fix is not forgotten (pending is acknowledged, never silent)",
    run: async () => {
      const adr = await readFile(adrPath, "utf8");
      assert.match(adr, /ADR-003/, "ADR-003 is present");
      assert.match(adr, /global_node_workspaces/, "ADR-003 names the global_node_workspaces registry as the aggregation source");
      assert.match(adr, /assembleCurrentPresenceRecord/, "ADR-003 names the assembleCurrentPresenceRecord seam being replaced");
    },
  },
  {
    name: "arch/38 ADR-003 (acd-presence-aggregates-node-workspaces): self-check — a source that aggregates but drops the registry read trips the detector",
    run: async () => {
      assert.equal(presenceAggregationState("const items = await listItems(ws.workDir);"), "pending-single-cwd", "the current single-cwd source reads as pending");
      assert.equal(presenceAggregationState("const rows = await store.prepare('SELECT * FROM global_node_workspaces').all();"), "aggregated", "a registry-consulting source reads as aggregated");
      // Aggregation attempted (unioning across workspaces) but the registry read dropped — the failure state.
      const regressed = "const items = (await Promise.all(workspaces.map((w) => enumerate(w)))).flat();";
      assert.equal(presenceAggregationState(regressed), "regressed", "a source that unions without the registry read trips the detector");
    },
  },
];
