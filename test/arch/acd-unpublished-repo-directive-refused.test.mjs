// Security fitness function: acd-unpublished-repo-directive-refused (F3, T3a) — "a
// directive for a repo NOT mesh.repo.published on the worker is refused with a clear
// coded miss (a structured { ok:false, code:"…" } — here, a structured failed
// assignment-status frame carrying a stable code), never an opaque throw or silent
// no-op."
//
// This is EXACTLY the invariant ARCHITECTURE's #7 (acd-assignment-repo-availability-
// loud, worker half) already proves — this file does NOT duplicate that assertion
// body; it enumerates/references that sibling file's registration (the repo's
// "enumerate the re-armed X" house style) and adds the ONE genuinely-additional
// SECURITY-flavoured proof #7 does not itself assert: the code is STABLE/non-empty
// (the ADR-008 loud-miss discipline) and the SAME directive for a published repo is
// accepted (the have/lack CONTRAST, not just the lack branch).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkspace } from "../../src/work.mjs";
import { createMeshWorkerExecutionHandler } from "../../src/mesh-worker-execution.mjs";
import { withMeshWorkerExecFixture, markRepoPublished, seedNodeWorkspaceMembership, createStatusRecorder, scriptedSpawnRuntime } from "../support/mesh-worker-exec-fixture.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const testSuitePath = path.join(repoRoot, "scripts", "test.mjs");
const NODE_ID = "worker-a";
const NOW = "2026-07-09T10:00:00.000Z";

async function drive(fx, ws, assignmentId) {
  const recorder = createStatusRecorder();
  const handler = createMeshWorkerExecutionHandler({
    loadWs: () => Promise.resolve(ws),
    nodeId: NODE_ID,
    sendAssignmentStatus: recorder.sendAssignmentStatus,
    spawnRuntime: scriptedSpawnRuntime("done"),
    now: () => NOW,
    globalWorkStoreOptions: { env: fx.env },
  });
  await handler({ kind: "directive", to: NODE_ID, assignmentId, itemRef: fx.itemRef, workspaceId: fx.workspaceId, at: NOW });
  return recorder;
}

export const archTests = [
  {
    name: "arch/35 SECURITY F3 (acd-unpublished-repo-directive-refused): the ARCHITECTURE #7 sibling (acd-assignment-repo-availability-loud) is registered — re-armed, not duplicated",
    run: async () => {
      const suite = await readFile(testSuitePath, "utf8");
      assert.ok(
        suite.includes("test/arch/acd-assignment-repo-availability-loud.test.mjs"),
        "acd-assignment-repo-availability-loud is imported into the registered suite (the worker-side coded-miss half F3 shares with ARCHITECTURE #7)",
      );
    },
  },
  {
    name: "arch/35 SECURITY F3 / T3a (acd-unpublished-repo-directive-refused): the code is a non-empty, stable string, distinct from an opaque throw — and the SAME directive for a published repo is accepted (the contrast)",
    run: async () => withMeshWorkerExecFixture(async (fx) => {
      const wsUnpublished = await loadWorkspace(fx.root, undefined, { env: fx.env });
      const miss = await drive(fx, wsUnpublished, "f3-unpublished");
      assert.equal(miss.frames.length, 1);
      const code = miss.frames[0].code;
      assert.equal(typeof code, "string");
      assert.ok(code.length > 0, "the code is a non-empty, stable string (never opaque)");
      assert.equal(code, "assignment-repo-unavailable");

      await markRepoPublished(fx.root, { workspaceId: fx.workspaceId });
      await seedNodeWorkspaceMembership({ home: fx.home }, { nodeId: NODE_ID, workspaceId: fx.workspaceId });
      const wsPublished = await loadWorkspace(fx.root, undefined, { env: fx.env });
      const accept = await drive(fx, wsPublished, "f3-published");
      assert.ok(accept.frames.some((f) => f.state === "accepted"), "the SAME directive for a published repo is accepted");
      assert.ok(!accept.frames.some((f) => f.code === "assignment-repo-unavailable"), "no coded miss on the have path");
    }),
  },
];
