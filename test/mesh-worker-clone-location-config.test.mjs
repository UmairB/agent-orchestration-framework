// test/mesh-worker-clone-location-config.test.mjs — traceability for milestone 38 /
// story 01 task 00 (00_clone-location-config.feature). Every @executable scenario +
// Examples row wired to the real engine surface: resolveCloneUrl / isWellFormedCloneUrl
// (src/mesh-worker-execution.mjs) and createMeshWorkerExecutionHandler's clone-on-miss
// prefix.
import assert from "node:assert/strict";
import {
  resolveCloneUrl,
  isWellFormedCloneUrl,
  createMeshWorkerExecutionHandler,
} from "../src/mesh-worker-execution.mjs";
import {
  withMeshCloneFixture,
  createStatusRecorder,
  createRecordingCloneExec,
} from "./support/mesh-worker-clone-fixture.mjs";

export const meshWorkerCloneLocationConfigTests = [
  // Scenario: a resolvable cloneUrl is used as the clone source
  {
    name: "task00/38 worker-repo-checkout: a resolvable config.mesh.repo.cloneUrl resolves as the clone source",
    run: async () => withMeshCloneFixture(async ({ workspace }) => {
      const resolved = resolveCloneUrl(workspace);
      assert.equal(resolved, "https://git.example.com/acme/secret.git");
    }, { cloneUrl: "https://git.example.com/acme/secret.git" }),
  },
  // Scenario: a missing cloneUrl keeps the loud coded refusal, cloning nothing
  {
    name: "task00/38 worker-repo-checkout: a missing config.mesh.repo.cloneUrl keeps the loud coded assignment-repo-unavailable failed, cloning nothing",
    run: async () => withMeshCloneFixture(async ({ workspace, workspaceId, itemRef }) => {
      assert.equal(resolveCloneUrl(workspace), null);

      const status = createStatusRecorder();
      const cloneExec = createRecordingCloneExec();
      const handler = createMeshWorkerExecutionHandler({
        loadWs: () => Promise.resolve(workspace),
        nodeId: "worker-a",
        sendAssignmentStatus: status.sendAssignmentStatus,
        cloneExec: cloneExec.exec,
      });
      await handler({ assignmentId: "asg-00-missing", itemRef, workspaceId });

      assert.deepEqual(status.frames, [{ assignmentId: "asg-00-missing", state: "failed", code: "assignment-repo-unavailable" }]);
      assert.equal(cloneExec.calls.length, 0, "no clone spawn is attempted");
    }, { cloneUrl: undefined }),
  },
  // Scenario Outline: the clone source resolves only from a well-formed cloneUrl
  {
    name: "task00/38 worker-repo-checkout: Examples — the clone source resolves only from a well-formed cloneUrl (isWellFormedCloneUrl)",
    run: async () => {
      const wellFormed = [
        "https://git.example.com/acme/secret.git",
        "git@git.example.com:acme/secret.git",
        "ssh://git@host.tailnet/acme/secret.git",
      ];
      for (const url of wellFormed) {
        assert.ok(isWellFormedCloneUrl(url), `[${url}] resolves as a well-formed clone source`);
      }

      const malformedOrAbsent = [undefined, "", "   ", "not-a-url", "file:///", 42, null, {}];
      for (const value of malformedOrAbsent) {
        assert.ok(!isWellFormedCloneUrl(value), `[${JSON.stringify(value)}] is NOT a well-formed clone source`);
      }
    },
  },
  {
    name: "task00/38 worker-repo-checkout: Examples — each malformed/absent/wrong-type cloneUrl streams the loud coded failed, cloning nothing, no git spawn",
    run: async () => {
      const examples = [
        { cloneUrl: undefined, label: "absent" },
        { cloneUrl: "", label: "empty string" },
        { cloneUrl: "   ", label: "whitespace only" },
        { cloneUrl: "not-a-url", label: "malformed (not-a-url)" },
        { cloneUrl: "file:///", label: "malformed (file:/// no path)" },
        { cloneUrl: 42, label: "wrong type (number)" },
      ];
      for (const { cloneUrl, label } of examples) {
        await withMeshCloneFixture(async ({ workspace, workspaceId, itemRef }) => {
          const status = createStatusRecorder();
          const cloneExec = createRecordingCloneExec();
          const handler = createMeshWorkerExecutionHandler({
            loadWs: () => Promise.resolve(workspace),
            nodeId: "worker-a",
            sendAssignmentStatus: status.sendAssignmentStatus,
            cloneExec: cloneExec.exec,
          });
          await handler({ assignmentId: `asg-00-${label}`, itemRef, workspaceId });

          assert.equal(status.frames.length, 1, `[${label}] exactly one frame is streamed`);
          assert.equal(status.frames[0].state, "failed", `[${label}] the frame is failed`);
          assert.equal(status.frames[0].code, "assignment-repo-unavailable", `[${label}] the code is assignment-repo-unavailable`);
          assert.equal(cloneExec.calls.length, 0, `[${label}] no git spawn is attempted`);
        }, { cloneUrl });
      }
    },
  },
  // Scenario: a workspace with no resolvable cloneUrl streams the loud coded failed, never hanging
  {
    name: "task00/38 worker-repo-checkout: a workspace with no resolvable cloneUrl streams a structured coded miss, never an opaque throw, never a hang",
    run: async () => withMeshCloneFixture(async ({ workspace, workspaceId, itemRef }) => {
      const status = createStatusRecorder();
      const cloneExec = createRecordingCloneExec();
      const handler = createMeshWorkerExecutionHandler({
        loadWs: () => Promise.resolve(workspace),
        nodeId: "worker-a",
        sendAssignmentStatus: status.sendAssignmentStatus,
        cloneExec: cloneExec.exec,
      });
      // The handler returns (never hangs, never throws) even with no repo and no cloneUrl.
      await handler({ assignmentId: "asg-00-noloop", itemRef, workspaceId });

      assert.equal(status.frames.length, 1);
      assert.equal(status.frames[0].state, "failed");
      assert.equal(status.frames[0].code, "assignment-repo-unavailable");
      assert.equal(cloneExec.calls.length, 0);
    }, { cloneUrl: undefined }),
  },
  // Scenario: resolving cloneUrl reads the raw config and never drops an unknown sibling mesh key
  {
    name: "task00/38 worker-repo-checkout: resolving cloneUrl reads the RAW config.mesh.repo (optional-chain) and never drops an unknown sibling key",
    run: async () => {
      const ws = {
        config: {
          mesh: {
            repo: {
              cloneUrl: "https://git.example.com/acme/secret.git",
              someNewMarker: "untouched-value",
            },
          },
        },
      };
      const resolved = resolveCloneUrl(ws);
      assert.equal(resolved, "https://git.example.com/acme/secret.git");
      // The sibling key must still be present, byte-identical, on the SAME object —
      // resolveCloneUrl never rewrites/round-trips config.mesh.repo through anything.
      assert.equal(ws.config.mesh.repo.someNewMarker, "untouched-value");
    },
  },
];
