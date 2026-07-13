// test/mesh-worker-clone-scoped-checkout.test.mjs — traceability for milestone 38 /
// story 01 task 01 (01_clone-into-scoped-checkout.feature). Every @executable scenario
// + Examples row wired to the real engine surface: meshCheckoutPath /
// isUnderMeshCheckoutsRoot / cloneRepoForWorkspace (src/mesh-worker-execution.mjs).
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import {
  meshCheckoutPath,
  meshCheckoutsRoot,
  isUnderMeshCheckoutsRoot,
  cloneRepoForWorkspace,
} from "../src/mesh-worker-execution.mjs";
import { globalMeshPaths } from "../src/workspace.mjs";
import { withMeshCloneFixture, createRecordingCloneExec } from "./support/mesh-worker-clone-fixture.mjs";

export const meshWorkerCloneScopedCheckoutTests = [
  // Scenario: the clone target is the scoped meshCheckoutPath under the global mesh home
  {
    name: "task01/38 worker-repo-checkout: the clone target is the scoped meshCheckoutPath under <meshRoot>/checkouts/<workspaceId>/",
    run: async () => withMeshCloneFixture(async ({ workspace, workspaceId, home, env }) => {
      const cloneExec = createRecordingCloneExec();
      const checkoutPath = await cloneRepoForWorkspace(workspace, {
        workspaceId: "ws-1",
        nodeId: "worker-a",
        cloneUrl: "https://git.example.com/acme/secret.git",
        now: "2026-07-10T09:00:00.000Z",
        options: { cloneExec: cloneExec.exec, globalWorkStoreOptions: { env } },
      });
      const expected = path.join(globalMeshPaths({ env }).meshRoot, "checkouts", "ws-1");
      assert.equal(checkoutPath, expected);
      assert.equal(checkoutPath, meshCheckoutPath("ws-1", { env }));
    }, { cloneUrl: "https://git.example.com/acme/secret.git" }),
  },
  // Scenario Outline: a workspaceId that would traverse escapes nothing
  {
    name: "task01/38 worker-repo-checkout: Examples — a traversal/absolute/..-laden workspaceId either normalizes under the checkouts root, or the clone is refused (no escaping path is ever cloned into)",
    run: async () => withMeshCloneFixture(async ({ workspace, env }) => {
      const ids = ["ws-1", "ws-2-abc123", "../etc", "../../secrets", "/abs/outside", "ws-1/../../x", "..", "C:\\Windows"];
      for (const id of ids) {
        const constructed = meshCheckoutPath(id, { env });
        const underRoot = isUnderMeshCheckoutsRoot(constructed, { env });
        if (underRoot) {
          // Normalizes under the root — a real clone into it is fine.
          const cloneExec = createRecordingCloneExec();
          const cloned = await cloneRepoForWorkspace(workspace, {
            workspaceId: id,
            nodeId: "worker-a",
            cloneUrl: "https://git.example.com/acme/secret.git",
            now: "2026-07-10T09:00:00.000Z",
            options: { cloneExec: cloneExec.exec, globalWorkStoreOptions: { env } },
          });
          assert.ok(isUnderMeshCheckoutsRoot(cloned, { env }), `[id=${id}] the resolved clone path stays under the checkouts root`);
        } else {
          // Escapes the root as constructed — cloneRepoForWorkspace REFUSES: no clone
          // spawn, no directory created outside the root.
          const cloneExec = createRecordingCloneExec();
          await assert.rejects(
            () => cloneRepoForWorkspace(workspace, {
              workspaceId: id,
              nodeId: "worker-a",
              cloneUrl: "https://git.example.com/acme/secret.git",
              now: "2026-07-10T09:00:00.000Z",
              options: { cloneExec: cloneExec.exec, globalWorkStoreOptions: { env } },
            }),
            /outside the dedicated checkouts root|assignment-repo-unavailable/,
            `[id=${id}] a traversal id that would escape the root is refused, no clone`,
          );
          assert.equal(cloneExec.calls.length, 0, `[id=${id}] no git spawn is attempted for an escaping id`);
        }
      }
    }, { cloneUrl: "https://git.example.com/acme/secret.git" }),
  },
  // Scenario: the clone target is never os.tmpdir() and never a hand-built path outside the checkouts root
  {
    name: "task01/38 worker-repo-checkout: the clone target is never os.tmpdir(), always a prefix-child of <meshRoot>/checkouts/, composed from workspaceId only",
    run: async () => withMeshCloneFixture(async ({ workspace, env }) => {
      const cloneExec = createRecordingCloneExec();
      const checkoutPath = await cloneRepoForWorkspace(workspace, {
        workspaceId: "ws-1",
        nodeId: "worker-a",
        cloneUrl: "https://git.example.com/acme/secret.git",
        now: "2026-07-10T09:00:00.000Z",
        options: { cloneExec: cloneExec.exec, globalWorkStoreOptions: { env } },
      });
      assert.ok(isUnderMeshCheckoutsRoot(checkoutPath, { env }));
      // The checkout root must never BE (or be built by directly joining) the
      // machine-global os.tmpdir() — it is always the dedicated <meshRoot>/checkouts/
      // root (which the fixture's own hermetic AOF_GLOBAL_HOME happens to live under a
      // temp dir for test isolation — that is the FIXTURE's storage choice, not the
      // module's; the module itself never calls os.tmpdir()). The real structural
      // invariant (no os.tmpdir() call anywhere in the module) is separately pinned by
      // the acd-worker-clone-target-scoped fitness function's source-analysis.
      assert.notEqual(path.resolve(meshCheckoutsRoot({ env })), path.resolve(os.tmpdir()), "the checkouts root is never os.tmpdir() itself");
      assert.equal(checkoutPath, path.join(meshCheckoutsRoot({ env }), "ws-1"));
    }, { cloneUrl: "https://git.example.com/acme/secret.git" }),
  },
  // Scenario: the git clone is spawned argv-form with no shell
  {
    name: "task01/38 worker-repo-checkout: the git clone is spawned as an argv array (execFile), never a shell command string; the target path is one argv element",
    run: async () => withMeshCloneFixture(async ({ workspace, env }) => {
      const cloneExec = createRecordingCloneExec();
      const checkoutPath = await cloneRepoForWorkspace(workspace, {
        workspaceId: "ws-1",
        nodeId: "worker-a",
        cloneUrl: "https://git.example.com/acme/secret.git",
        now: "2026-07-10T09:00:00.000Z",
        options: { cloneExec: cloneExec.exec, globalWorkStoreOptions: { env } },
      });
      assert.equal(cloneExec.calls.length, 1);
      const call = cloneExec.calls[0];
      assert.ok(Array.isArray(call.args), "the clone exec receives an argv ARRAY, not a shell string");
      // milestone 38 / story 01 task 05 (ADR-009, SECURITY T7 / finding F14) — every
      // scoped clone leads with `-c credential.helper=` (resets git's ambient helper
      // chain so GIT_ASKPASS stays authoritative and nothing is persisted to the OS
      // keychain on success) before the `clone` subcommand itself.
      assert.deepEqual(call.args, ["-c", "credential.helper=", "clone", "https://git.example.com/acme/secret.git", checkoutPath]);
      assert.equal(call.args.at(-1), checkoutPath, "the target path is one argv element");
      assert.ok(!call.args.some((a) => typeof a === "string" && a.includes(" clone ")), "no argv element is a composed shell string");
    }, { cloneUrl: "https://git.example.com/acme/secret.git" }),
  },
  // Scenario: two concurrent clones for distinct workspaceIds land at distinct, non-colliding paths
  {
    name: "task01/38 worker-repo-checkout: two concurrent clones for distinct workspaceIds land at distinct, non-colliding paths",
    run: async () => withMeshCloneFixture(async ({ workspace, env }) => {
      const cloneExec1 = createRecordingCloneExec();
      const cloneExec2 = createRecordingCloneExec();
      const [path1, path2] = await Promise.all([
        cloneRepoForWorkspace(workspace, {
          workspaceId: "ws-1",
          nodeId: "worker-a",
          cloneUrl: "https://git.example.com/acme/one.git",
          now: "2026-07-10T09:00:00.000Z",
          options: { cloneExec: cloneExec1.exec, globalWorkStoreOptions: { env } },
        }),
        cloneRepoForWorkspace(workspace, {
          workspaceId: "ws-2",
          nodeId: "worker-a",
          cloneUrl: "https://git.example.com/acme/two.git",
          now: "2026-07-10T09:00:00.000Z",
          options: { cloneExec: cloneExec2.exec, globalWorkStoreOptions: { env } },
        }),
      ]);
      assert.equal(path1, path.join(meshCheckoutsRoot({ env }), "ws-1"));
      assert.equal(path2, path.join(meshCheckoutsRoot({ env }), "ws-2"));
      assert.notEqual(path1, path2);
      assert.ok(!path2.startsWith(path1 + path.sep), "ws-2 is not written inside ws-1's checkout");
      assert.ok(!path1.startsWith(path2 + path.sep), "ws-1 is not written inside ws-2's checkout");
    }, { cloneUrl: "https://git.example.com/acme/one.git" }),
  },
  // Scenario: the checkout path is a stable pure function of the workspaceId and global home
  {
    name: "task01/38 worker-repo-checkout: the checkout path is a stable pure function of workspaceId + global home (idempotent re-resolution)",
    run: async () => {
      const env = { AOF_GLOBAL_HOME: path.join(os.tmpdir(), "aof-clone-idempotent-fixture") };
      const first = meshCheckoutPath("ws-1", { env });
      const second = meshCheckoutPath("ws-1", { env });
      assert.equal(first, second);
      assert.equal(first, path.join(globalMeshPaths({ env }).meshRoot, "checkouts", "ws-1"));
    },
  },
];
