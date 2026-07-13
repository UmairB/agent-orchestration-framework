// Fitness function: acd-assignment-repo-availability-loud (milestone 35 / ADR-004 /
// 34-ADR-008, fitness #7 — WORKER half) — "the worker execution path checks repo
// availability BEFORE creating a worktree, and on a miss emits a coded
// assignment-repo-unavailable failed up the channel; the guard precedes the git
// worktree add call site and the coded literal is emitted on the miss branch."
// (The control-side assign-time gate half is Story 00 — already armed by that
// story's own suite; this file is the WORKER-side re-check Story 02 owns.)
//
// This is the ARCHITECTURE-named half of a single invariant shared with SECURITY's F3
// (acd-unpublished-repo-directive-refused, T3a) — the SECURITY sibling file
// enumerates/references THIS file's assertions rather than duplicating the assertion
// body (the repo's "enumerate the re-armed X" house style).
//
// Proofs:
//  1. Structural — the worker execution handler's repo-guard branch (workerHasRepo)
//     sits BEFORE the addWorktree( call site in source order, and the miss branch
//     emits the literal "assignment-repo-unavailable" code.
//  2. Behavioural — an assignment for an unpublished/unmapped repo streams a failed
//     frame carrying that code, and creates no worktree.
//  Self-check (m03 non-vacuous): a planted worktree-create-before-guard ordering (or a
//  miss branch with no coded literal) fails the SAME detector the real (guarded)
//  source passes.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkspace } from "../../src/work.mjs";
import { createMeshWorkerExecutionHandler } from "../../src/mesh-worker-execution.mjs";
import { listWorktrees } from "../../src/mesh-worktree.mjs";
import { withMeshWorkerExecFixture, createStatusRecorder, scriptedSpawnRuntime } from "../support/mesh-worker-exec-fixture.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const executionSourcePath = path.join(repoRoot, "src", "mesh-worker-execution.mjs");

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// The guard-precedes-worktree ordering + the coded-literal-on-miss checks, over the
// handler body only (the segment between "return async function handleDirective" and
// the function's closing brace region containing both the guard and the add call).
function assertStructural(code) {
  const problems = [];
  const guardOffset = code.search(/workerHasRepo\s*\(/);
  const addOffset = code.search(/addWorktree\s*\(/);
  if (guardOffset === -1) problems.push("no workerHasRepo( guard call found");
  if (addOffset === -1) problems.push("no addWorktree( call found");
  if (guardOffset !== -1 && addOffset !== -1 && !(guardOffset < addOffset)) {
    problems.push("the repo guard does not precede the addWorktree( call site");
  }
  if (!/assignment-repo-unavailable/.test(code)) {
    problems.push('no "assignment-repo-unavailable" coded literal found on the miss branch');
  }
  // The miss branch must emit the code (not just define the string as dead text) —
  // require the literal to appear inside a sendAssignmentStatus(...) call.
  if (!/sendAssignmentStatus\??\.\([^)]*code:\s*["']assignment-repo-unavailable["']/.test(code)) {
    problems.push('the "assignment-repo-unavailable" code is not emitted via sendAssignmentStatus on the miss branch');
  }
  return problems;
}

export const archTests = [
  {
    name: "arch/35 ADR-004 / 34-ADR-008 (acd-assignment-repo-availability-loud, worker half): the repo guard precedes the git worktree add call site and the coded literal is emitted on the miss branch (structural)",
    run: async () => {
      const code = stripComments(await readFile(executionSourcePath, "utf8"));
      const problems = assertStructural(code);
      assert.deepEqual(problems, [], `structural problems: ${JSON.stringify(problems)}`);
    },
  },
  {
    name: "arch/35 ADR-004 / 34-ADR-008 (acd-assignment-repo-availability-loud, worker half): an assignment for an absent repo streams failed coded assignment-repo-unavailable, no worktree created (behavioural)",
    run: async () => withMeshWorkerExecFixture(async (fx) => {
      const ws = await loadWorkspace(fx.root, undefined, { env: fx.env });
      const recorder = createStatusRecorder();
      const handler = createMeshWorkerExecutionHandler({
        loadWs: () => Promise.resolve(ws),
        nodeId: "worker-a",
        sendAssignmentStatus: recorder.sendAssignmentStatus,
        spawnRuntime: scriptedSpawnRuntime("done"),
        now: () => "2026-07-09T10:00:00.000Z",
        globalWorkStoreOptions: { env: fx.env },
      });
      await handler({ kind: "directive", to: "worker-a", assignmentId: "arch-f7-miss", itemRef: fx.itemRef, workspaceId: fx.workspaceId, at: "2026-07-09T10:00:00.000Z" });

      assert.equal(recorder.frames.length, 1);
      assert.equal(recorder.frames[0].state, "failed");
      assert.equal(recorder.frames[0].code, "assignment-repo-unavailable");
      const entries = await listWorktrees(fx.root);
      assert.equal(entries.length, 1, "only the primary checkout is registered — no worktree created");
    }),
  },
  {
    name: "arch/35 ADR-004 / 34-ADR-008 (acd-assignment-repo-availability-loud, worker half): self-check — a planted worktree-before-guard ordering trips the detector; the real (guard-first) source passes",
    run: async () => {
      const code = stripComments(await readFile(executionSourcePath, "utf8"));
      assert.deepEqual(assertStructural(code), [], "the real source is clean");

      const plantedOrdering = "await addWorktree(ws.projectRoot, assignmentId, commitish);\nconst hasRepo = await workerHasRepo(ws, workspaceId, nodeId);\nsendAssignmentStatus(assignmentId, 'failed', { code: 'assignment-repo-unavailable' });";
      assert.ok(assertStructural(plantedOrdering).length > 0, "a planted worktree-before-guard ordering trips the detector");

      const plantedNoCode = "const hasRepo = await workerHasRepo(ws, workspaceId, nodeId);\nif (!hasRepo) { sendAssignmentStatus(assignmentId, 'failed', {}); return; }\nawait addWorktree(ws.projectRoot, assignmentId, commitish);";
      assert.ok(assertStructural(plantedNoCode).length > 0, "a miss branch with no coded literal trips the detector");
    },
  },
];
