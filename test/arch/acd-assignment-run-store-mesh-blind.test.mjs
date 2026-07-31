// Fitness function: acd-assignment-run-store-mesh-blind (milestone 35 / ADR-004,
// fitness #12) — "the run-store stays mesh-blind — the assignment execution reuses
// startRun/completeRun/heartbeat with the node id passed as DATA; the store imports
// no mesh/assignment module." Re-arms the existing acd-run-store-mesh-free (m26) —
// this file does NOT duplicate its assertion body; it enumerates/references its
// registration (the repo's "enumerate the re-armed X" house style) and adds the ONE
// genuinely-new assertion this milestone introduces: the WORKER EXECUTION module
// (Story 02's new code) calls startRun(item, { node }) with the node id as an option,
// never rewriting run-store's signature or importing a mesh module INTO run-store.
//
// BUILD-TIME FINDING (flagged, not silently fixed — see STORE.md Feedback notes): the
// SIBLING m26 fitness `acd-fleet-reclaim-guarded` (which #12 was ALSO asked to
// re-arm) is imported into scripts/test.mjs but was NEVER spread into the assembled
// `tests` array — a genuine pre-existing registration gap spanning ~34 arch-test
// bindings across milestones 22-26 (verified by diffing every imported binding
// against every `...binding` spread in the array). Running it standalone shows 3 of
// its 4 proofs pass; the 4th ("the run-complete lease release sits inside the
// config.mesh-gated branch") is now STALE — `src/commands/run-complete.mjs` no
// longer imports `releaseLease`/`meshNodeIdOf` at all (the whole git-bus lease
// mechanism it asserts was retired by the m33/m34 "global mesh only" correction /
// ADR-003's no-git-bus-return). Registering that file as-is would land a KNOWN-RED,
// pre-existing, out-of-milestone test — outside this story's ownership to rewrite.
// This story registers ONLY the sibling that is genuinely green
// (acd-run-store-mesh-free) and leaves acd-fleet-reclaim-guarded's registration +
// stale 4th proof as a flagged finding for the architect/PO to triage.
//
// Proofs:
//  1. Re-arm — acd-run-store-mesh-free is registered in the suite (its own
//     assertions already prove run-store.mjs imports no mesh-* module).
//  2. Structural — src/mesh-worker-execution.mjs calls startRun(item, { ...,
//     node: nodeId, ... }) — the node id travels as a DATA option, never a run-store
//     rewrite (no new positional parameter, no mesh import added to run-store.mjs).
//  3. Behavioural — a driven assignment's minted run carries the worker's node id
//     while run-store.mjs itself imports no mesh module.
//  Self-check (m03 non-vacuous): a planted `import ... from "./mesh-store.mjs"` in
//  run-store.mjs fails the SAME detector the real (mesh-blind) source passes.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkspace, findWork } from "../../src/work.mjs";
import { createMeshWorkerExecutionHandler } from "../../src/mesh-worker-execution.mjs";
import { readRuns } from "../../src/run-store.mjs";
import { withMeshWorkerExecFixture, markRepoPublished, seedNodeWorkspaceMembership, createStatusRecorder, scriptedSpawnRuntime, scriptedPushExec } from "../support/mesh-worker-exec-fixture.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const runStoreSourcePath = path.join(repoRoot, "src", "run-store.mjs");
const executionSourcePath = path.join(repoRoot, "src", "mesh-worker-execution.mjs");
const testSuitePath = path.join(repoRoot, "scripts", "test.mjs");

function stripCommentsAndStrings(source) {
  let out = "";
  let i = 0;
  const n = source.length;
  let state = "code";
  while (i < n) {
    const c = source[i];
    const c2 = source[i + 1];
    if (state === "code") {
      if (c === "/" && c2 === "/") { state = "line"; i += 2; continue; }
      if (c === "/" && c2 === "*") { state = "block"; i += 2; continue; }
      if (c === "'") { state = "sq"; i += 1; out += " "; continue; }
      if (c === '"') { state = "dq"; i += 1; out += " "; continue; }
      if (c === "`") { state = "tpl"; i += 1; out += " "; continue; }
      out += c; i += 1; continue;
    }
    if (state === "line") { if (c === "\n") { state = "code"; out += "\n"; } i += 1; continue; }
    if (state === "block") { if (c === "*" && c2 === "/") { state = "code"; i += 2; continue; } if (c === "\n") out += "\n"; i += 1; continue; }
    if (c === "\\") { i += 2; continue; }
    if ((state === "sq" && c === "'") || (state === "dq" && c === '"') || (state === "tpl" && c === "`")) { state = "code"; i += 1; continue; }
    if (c === "\n") out += "\n";
    i += 1; continue;
  }
  return out;
}

function assertRunStoreMeshBlind(code) {
  const problems = [];
  const re = /\bfrom\s+["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    if (/mesh-/.test(m[1]) || /assignment/.test(m[1])) {
      problems.push(`run-store.mjs imports a mesh/assignment module: ${m[1]}`);
    }
  }
  return problems;
}

function assertNodeAsData(code) {
  const problems = [];
  if (!/startRun\s*\(\s*item\s*,\s*\{[^}]*node\s*:\s*nodeId/.test(code)) {
    problems.push("startRun is not called with node: nodeId as an option");
  }
  return problems;
}

export const archTests = [
  {
    name: "arch/35 ADR-004 (acd-assignment-run-store-mesh-blind): the existing acd-run-store-mesh-free gate re-arms over the unchanged store (enumerated — its suite registration is asserted; acd-fleet-reclaim-guarded's registration gap is a flagged pre-existing finding, not silently fixed here — see this file's header comment)",
    run: async () => {
      const suite = await readFile(testSuitePath, "utf8");
      assert.ok(
        suite.includes("test/arch/acd-run-store-mesh-free.test.mjs") && suite.includes("...acdRunStoreMeshFreeTests"),
        "acd-run-store-mesh-free is imported and spread into the registered suite",
      );
    },
  },
  {
    name: "arch/35 ADR-004 (acd-assignment-run-store-mesh-blind): run-store.mjs imports no mesh/assignment module, and the worker execution module calls startRun(item, { node: nodeId }) — node id as DATA (structural)",
    run: async () => {
      const runStoreCode = stripCommentsAndStrings(await readFile(runStoreSourcePath, "utf8"));
      const executionCode = stripCommentsAndStrings(await readFile(executionSourcePath, "utf8"));
      assert.deepEqual(assertRunStoreMeshBlind(runStoreCode), [], "run-store.mjs stays mesh-blind");
      assert.deepEqual(assertNodeAsData(executionCode), [], "the worker execution module passes the node id as a startRun option");
    },
  },
  {
    name: "arch/35 ADR-004 (acd-assignment-run-store-mesh-blind): a driven assignment's minted run carries the worker's node id (behavioural)",
    run: async () => withMeshWorkerExecFixture(async (fx) => {
      const NODE_ID = "node-mesh-blind";
      await markRepoPublished(fx.root, { workspaceId: fx.workspaceId });
      await seedNodeWorkspaceMembership({ home: fx.home }, { nodeId: NODE_ID, workspaceId: fx.workspaceId });
      const ws = await loadWorkspace(fx.root, undefined, { env: fx.env });
      const recorder = createStatusRecorder();
      const handler = createMeshWorkerExecutionHandler({
        pushExec: scriptedPushExec(),
        loadWs: () => Promise.resolve(ws),
        nodeId: NODE_ID,
        sendAssignmentStatus: recorder.sendAssignmentStatus,
    sendEffectStep: recorder.sendEffectStep,
        spawnRuntime: scriptedSpawnRuntime("done"),
        now: () => "2026-07-09T10:00:00.000Z",
        globalWorkStoreOptions: { env: fx.env },
      });
      await handler({ kind: "directive", to: NODE_ID, assignmentId: "arch-12-blind", itemRef: fx.itemRef, workspaceId: fx.workspaceId, at: "2026-07-09T10:00:00.000Z" });

      const matches = await findWork(fx.workDir, fx.itemRef);
      const runs = await readRuns(matches[0]);
      assert.equal(runs[0].node, NODE_ID, "the minted run carries the worker's node id");
    }),
  },
  {
    name: "arch/35 ADR-004 (acd-assignment-run-store-mesh-blind): self-check — a planted mesh-store import in run-store.mjs trips the detector; the real (blind) source passes",
    run: async () => {
      const runStoreCode = stripCommentsAndStrings(await readFile(runStoreSourcePath, "utf8"));
      assert.deepEqual(assertRunStoreMeshBlind(runStoreCode), [], "the real source is clean");

      const planted = `${runStoreCode}\nimport { publishNodeRecord } from "./mesh-store.mjs";\n`;
      assert.ok(assertRunStoreMeshBlind(planted).length > 0, "a planted mesh-store.mjs import trips the detector");
    },
  },
];
