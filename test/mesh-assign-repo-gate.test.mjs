// task 03 — the control-side assign gate refuses a target that lacks the repo, loudly
// and with a code (milestone 35 / story 00, ADR-001 / 34-ADR-008 / SECURITY T3).
// Hermetic over AOF_GLOBAL_HOME opening a v3 store seeded with global_node_workspaces
// rows + the workspace publish echo (the m34 repo-publish fixture shape).
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assignWork } from "../src/mesh-assignment.mjs";
import { withMeshAssignFixture, seedTargetNode, seedAssignment, readAssignmentRows } from "./support/mesh-assign-fixture.mjs";
import { spawnCliSync } from "./support/cli-spawn.mjs";

const NOW = "2026-07-08T12:00:00.000Z";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "bin", "aof.mjs");

export const meshAssignRepoGateTests = [
  {
    name: "mesh-assign-repo-gate/00 assigning to a node that holds the repo and has mesh.repo.published succeeds",
    run: async () => withMeshAssignFixture(async ({ workspace, workspaceId, ctx, home, root, workDir }) => {
      await seedTargetNode({ home }, { nodeId: "worker-a", workspaceId, member: true, published: true, projectRoot: root, workDir });
      const result = await assignWork(workspace, "35/00", "worker-a", { ...ctx, now: NOW });
      assert.equal(result.ok, true);
      assert.equal(result.state, "assigned");
      assert.equal(result.targetNodeId, "worker-a");
    }),
  },
  {
    name: "mesh-assign-repo-gate/01 a known node that does not hold the published repo is refused with assignment-repo-unavailable, minting nothing",
    run: async () => withMeshAssignFixture(async ({ workspace, workspaceId, ctx, home, root, workDir }) => {
      // worker-b is KNOWN (a global_nodes row exists) but is NOT linked to this
      // workspace (never held/published this repo).
      await seedTargetNode({ home }, { nodeId: "worker-b", workspaceId, member: false, published: false, projectRoot: root, workDir });
      const result = await assignWork(workspace, "35/00", "worker-b", { ...ctx, now: NOW });
      assert.equal(result.ok, false);
      assert.equal(result.code, "assignment-repo-unavailable");
      const rows = await readAssignmentRows({ home }, workspaceId, "35/00");
      assert.equal(rows.length, 0, "minting nothing");
    }),
  },
  {
    name: "mesh-assign-repo-gate/02 assigning to an unknown, never-seen nodeId is a coded unknown-target refusal, minting nothing",
    run: async () => withMeshAssignFixture(async ({ workspace, workspaceId, ctx }) => {
      const result = await assignWork(workspace, "35/00", "ghost-node", { ...ctx, now: NOW });
      assert.equal(result.ok, false);
      assert.ok(typeof result.code === "string" && result.code.length > 0, "the operation fails with a coded unknown-target refusal");
      assert.match(result.code, /unknown/i);
      assert.match(result.error, /ghost-node/, 'the error names the unknown target "ghost-node"');
    }),
  },
  {
    name: "mesh-assign-repo-gate/03 a repo-availability miss surfaces a loud coded refusal over the real CLI, never a silent success",
    run: async () => withMeshAssignFixture(async ({ home, root, workspaceId, workDir }) => {
      await seedTargetNode({ home }, { nodeId: "worker-b", workspaceId, member: false, published: false, projectRoot: root, workDir });

      const result = spawnCliSync(process.execPath, [cliPath, "mesh", "assign", "35/00", "--to", "worker-b", "--json"], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, NODE_NO_WARNINGS: "1", AOF_GLOBAL_HOME: home },
      });
      assert.notEqual(result.status, 0, "the command exits non-zero");
      let parsed;
      assert.doesNotThrow(() => { parsed = JSON.parse(result.stdout); }, `stdout is parseable JSON (got: ${result.stdout})`);
      assert.equal(parsed.ok, false, "the JSON envelope is ok:false");
      assert.equal(parsed.code, "assignment-repo-unavailable");
      assert.ok(typeof parsed.error === "string" && parsed.error.length > 0);

      const rows = await readAssignmentRows({ home }, workspaceId, "35/00");
      assert.equal(rows.length, 0, "no assignment row exists for that item");
    }),
  },
  {
    // QA advisory A4 (review fix, 2026-07-09): real-CLI-binary coverage for
    // ref-not-found — previously only assignment-repo-unavailable was proven through
    // the spawned binary; the coded --json envelope must hold for every miss code,
    // not just the one already exercised.
    name: "mesh-assign-repo-gate/04 an unresolvable ref surfaces a loud coded ref-not-found refusal over the real CLI, never a silent success",
    run: async () => withMeshAssignFixture(async ({ home, root, workspaceId, workDir }) => {
      await seedTargetNode({ home }, { nodeId: "worker-a", workspaceId, member: true, published: true, projectRoot: root, workDir });

      const result = spawnCliSync(process.execPath, [cliPath, "mesh", "assign", "35/99", "--to", "worker-a", "--json"], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, NODE_NO_WARNINGS: "1", AOF_GLOBAL_HOME: home },
      });
      assert.notEqual(result.status, 0, "the command exits non-zero");
      let parsed;
      assert.doesNotThrow(() => { parsed = JSON.parse(result.stdout); }, `stdout is parseable JSON (got: ${result.stdout})`);
      assert.equal(parsed.ok, false, "the JSON envelope is ok:false");
      assert.equal(parsed.code, "ref-not-found");
      assert.ok(typeof parsed.error === "string" && parsed.error.length > 0);

      const rows = await readAssignmentRows({ home }, workspaceId, "35/99");
      assert.equal(rows.length, 0, "no assignment row exists for the unresolvable ref");
    }),
  },
  {
    // QA advisory A4 — real-CLI-binary coverage for assignment-already-active.
    name: "mesh-assign-repo-gate/05 a second assign while one is ACTIVE surfaces a loud coded assignment-already-active refusal over the real CLI, minting nothing",
    run: async () => withMeshAssignFixture(async ({ home, root, workspaceId, workDir }) => {
      await seedTargetNode({ home }, { nodeId: "worker-a", workspaceId, member: true, published: true, projectRoot: root, workDir });
      await seedTargetNode({ home }, { nodeId: "worker-b", workspaceId, member: true, published: true, projectRoot: root, workDir });
      await seedAssignment({ home }, {
        assignmentId: "active-1",
        itemRef: "35/00",
        workspaceId,
        targetNodeId: "worker-a",
        issuer: "control-a",
        state: "running",
        assignedAt: "2026-07-08T11:00:00.000Z",
      });

      const result = spawnCliSync(process.execPath, [cliPath, "mesh", "assign", "35/00", "--to", "worker-b", "--json"], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, NODE_NO_WARNINGS: "1", AOF_GLOBAL_HOME: home },
      });
      assert.notEqual(result.status, 0, "the command exits non-zero");
      let parsed;
      assert.doesNotThrow(() => { parsed = JSON.parse(result.stdout); }, `stdout is parseable JSON (got: ${result.stdout})`);
      assert.equal(parsed.ok, false, "the JSON envelope is ok:false");
      assert.equal(parsed.code, "assignment-already-active");
      assert.ok(typeof parsed.error === "string" && parsed.error.length > 0);

      const rows = await readAssignmentRows({ home }, workspaceId, "35/00");
      assert.equal(rows.length, 1, "the row count for that item is unchanged — nothing minted for worker-b");
      assert.ok(rows.every((row) => row.target_node_id !== "worker-b"), "no assignment targeting worker-b was minted");
    }),
  },
];
