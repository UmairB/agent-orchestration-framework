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
  scriptedPushExec,
  scriptedSpawnRuntime,
} from "./support/mesh-worker-clone-fixture.mjs";
import { openGlobalWorkProjectionStore } from "../src/global-work-store.mjs";
import { resolveWorkspaceCloneUrl } from "../src/mesh-presence.mjs";

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
        pushExec: scriptedPushExec(),
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
            pushExec: scriptedPushExec(),
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
        pushExec: scriptedPushExec(),
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
  // ══ ADR-010 Gap A, EXTENDED (review fix, live soak 2026-07-17) — a worker's own
  //    launch-workspace config can NEVER carry config.mesh.repo.cloneUrl for a
  //    DIFFERENT workspace it has never checked out (that is precisely what makes
  //    it clone-on-miss). resolveWorkspaceCloneUrl (mesh-presence.mjs) closes the
  //    gap by reading the value the TARGET workspace's own `aof mesh repo publish`
  //    already synced into the global registry (global-node-registry.mjs) —
  //    mirroring resolveWorkspaceProjectRoot's existing seam exactly. ══════════════
  {
    name: "task00/38 worker-repo-checkout (Gap A extended): resolveWorkspaceCloneUrl reads the clone_url a workspace's own registry publish wrote",
    run: async () => withMeshCloneFixture(async ({ workspaceId, env }) => {
      assert.equal(await resolveWorkspaceCloneUrl(workspaceId, { globalWorkStoreOptions: { env } }), null, "an unpublished workspace resolves to null, never a throw");

      const store = await openGlobalWorkProjectionStore({ env });
      try {
        store.db.prepare(`
          INSERT INTO global_workspace_descriptors (workspace_id, project_root, work_dir, name, mesh_enabled, control_node, member_node_ids_json, published_at, descriptor_path, clone_url)
          VALUES (?, '/synced/root', '/synced/root/wiki/work', 'synced', 1, 'control-a', '[]', '2026-07-17T00:00:00.000Z', '/synced/descriptor.json', ?)
        `).run(workspaceId, "https://git.example.com/acme/synced.git");
      } finally {
        store.close();
      }

      assert.equal(
        await resolveWorkspaceCloneUrl(workspaceId, { globalWorkStoreOptions: { env } }),
        "https://git.example.com/acme/synced.git",
        "the published clone_url resolves once the registry carries it",
      );
    }, { cloneUrl: undefined }),
  },
  {
    name: "task00/38 worker-repo-checkout (Gap A extended): a workspace with NO local cloneUrl still clones, falling back to the SYNCED global registry's clone_url",
    run: async () => withMeshCloneFixture(async ({ workspace, workspaceId, itemRef, env }) => {
      assert.equal(resolveCloneUrl(workspace), null, "no local cloneUrl is configured for this workspace (the launch-workspace read alone would refuse)");

      // Seed the registry exactly as a REAL `aof mesh repo publish`, run on the
      // workspace's OWN checkout (e.g. the control node), would have via
      // global-node-registry.mjs's upsertGlobalRegistryRows.
      const store = await openGlobalWorkProjectionStore({ env });
      try {
        store.db.prepare(`
          INSERT INTO global_workspace_descriptors (workspace_id, project_root, work_dir, name, mesh_enabled, control_node, member_node_ids_json, published_at, descriptor_path, clone_url)
          VALUES (?, '/synced/root', '/synced/root/wiki/work', 'synced', 1, 'control-a', '[]', '2026-07-17T00:00:00.000Z', '/synced/descriptor.json', ?)
        `).run(workspaceId, "https://git.example.com/acme/synced.git");
      } finally {
        store.close();
      }

      const status = createStatusRecorder();
      const cloneExec = createRecordingCloneExec();
      const handler = createMeshWorkerExecutionHandler({
        pushExec: scriptedPushExec(),
        loadWs: () => Promise.resolve(workspace),
        nodeId: "worker-a",
        sendAssignmentStatus: status.sendAssignmentStatus,
        cloneExec: cloneExec.exec,
        globalWorkStoreOptions: { env },
        // milestone 38 / story 05 (ADR-013) — this scenario's clone SUCCEEDS (a
        // scripted-success cloneExec), so the handler proceeds past the repo guard
        // into the REAL addWorktree + driver step; a scripted spawnRuntime here is
        // required so this clone-resolution test never reaches the REAL interactive
        // claude driver (which would spawn a genuine, un-terminating PTY session on
        // any machine with `claude` on PATH — the SAME "@executable always injects a
        // scripted spawnRuntime" discipline this suite already keeps everywhere else).
        spawnRuntime: scriptedSpawnRuntime("done"),
      });
      await handler({ assignmentId: "asg-00-gap-a-fallback", itemRef, workspaceId });

      assert.equal(cloneExec.calls.length, 1, "a clone IS attempted, using the registry-resolved URL — the worker is no longer stuck refusing a workspace it has never seen");
      assert.equal(cloneExec.calls[0].args[3], "https://git.example.com/acme/synced.git", "the clone spawn's argv carries the registry-resolved cloneUrl, never the absent local one");
    }, { cloneUrl: undefined }),
  },
  {
    name: "task00/38 worker-repo-checkout (Gap A extended): a LOCAL cloneUrl still wins over the registry's — the fallback is additive, never a silent override",
    run: async () => withMeshCloneFixture(async ({ workspace, workspaceId, itemRef, env }) => {
      assert.equal(resolveCloneUrl(workspace), "https://git.example.com/acme/local.git");

      const store = await openGlobalWorkProjectionStore({ env });
      try {
        store.db.prepare(`
          INSERT INTO global_workspace_descriptors (workspace_id, project_root, work_dir, name, mesh_enabled, control_node, member_node_ids_json, published_at, descriptor_path, clone_url)
          VALUES (?, '/synced/root', '/synced/root/wiki/work', 'synced', 1, 'control-a', '[]', '2026-07-17T00:00:00.000Z', '/synced/descriptor.json', ?)
        `).run(workspaceId, "https://git.example.com/acme/should-not-be-used.git");
      } finally {
        store.close();
      }

      const status = createStatusRecorder();
      const cloneExec = createRecordingCloneExec();
      const handler = createMeshWorkerExecutionHandler({
        pushExec: scriptedPushExec(),
        loadWs: () => Promise.resolve(workspace),
        nodeId: "worker-a",
        sendAssignmentStatus: status.sendAssignmentStatus,
        cloneExec: cloneExec.exec,
        globalWorkStoreOptions: { env },
        // milestone 38 / story 05 (ADR-013) — SAME reasoning as the fallback scenario
        // above: this clone also SUCCEEDS, so a scripted spawnRuntime is required to
        // keep this test off the REAL interactive claude driver.
        spawnRuntime: scriptedSpawnRuntime("done"),
      });
      await handler({ assignmentId: "asg-00-gap-a-local-wins", itemRef, workspaceId });

      assert.equal(cloneExec.calls[0].args[3], "https://git.example.com/acme/local.git", "the worker's OWN local cloneUrl is used; the registry is never consulted when a local value already resolves");
    }, { cloneUrl: "https://git.example.com/acme/local.git" }),
  },
];
