// task 00 — an accepted directive materializes a dedicated git worktree, keyed by
// assignmentId under the ONE mesh worktrees root, that the ref cannot escape
// (milestone 35 / story 02, ADR-004, SECURITY T4/F4/T3b). Exercised over a REAL `git
// worktree add` in a disposable temp fixture repo (RESEARCH.md §4/§5).
import assert from "node:assert/strict";
import path from "node:path";
import { loadWorkspace } from "../src/work.mjs";
import { addWorktree, meshWorktreePath, meshWorktreesRoot, isUnderMeshWorktreesRoot, listWorktrees, removeWorktree } from "../src/mesh-worktree.mjs";
import { resolveRefInWorktree } from "../src/mesh-worker-execution.mjs";
import { withMeshWorkerExecFixture } from "./support/mesh-worker-exec-fixture.mjs";

export const meshWorktreeMaterializeTests = [
  {
    name: "worktree-materialize/00 an accepted directive materializes a dedicated git worktree at the mesh worktrees root, distinct from the primary checkout, detached at the target commit",
    run: async () => withMeshWorkerExecFixture(async ({ root, headSha }) => {
      const assignmentId = "asg-materialize-00";
      const worktreePath = await addWorktree(root, assignmentId, headSha);

      assert.equal(worktreePath, path.join(root, ".aof", "mesh", "worktrees", assignmentId), 'the worktree lands at ".aof/mesh/worktrees/<assignmentId>/" under the repo');

      const entries = await listWorktrees(root);
      const primary = entries.find((e) => path.resolve(e.path) === path.resolve(root));
      const materialized = entries.find((e) => path.resolve(e.path) === path.resolve(worktreePath));
      assert.ok(primary, "the primary working copy is still registered");
      assert.ok(materialized, "the materialized worktree is a distinct, separately-registered checkout");
      assert.notEqual(path.resolve(materialized.path), path.resolve(primary.path), "the worktree is a distinct checkout, not the worker's primary working copy");
      assert.equal(materialized.detached, true, "the worktree is detached at the target commit");
      assert.equal(materialized.branch, null, "holding no branch name");

      await removeWorktree(root, assignmentId);
    }),
  },
  {
    name: "worktree-materialize/00 two concurrent assignments materialize two distinct, non-colliding worktrees, neither visible inside the other",
    run: async () => withMeshWorkerExecFixture(async ({ root, workDir, headSha }) => {
      const [pathA, pathB] = await Promise.all([
        addWorktree(root, "asg-concurrent-a", headSha),
        addWorktree(root, "asg-concurrent-b", headSha),
      ]);

      assert.equal(pathA, meshWorktreePath(root, "asg-concurrent-a"));
      assert.equal(pathB, meshWorktreePath(root, "asg-concurrent-b"));
      assert.notEqual(pathA, pathB, "the two worktree paths are distinct, keyed by their respective assignmentIds");

      const entries = await listWorktrees(root);
      assert.ok(entries.some((e) => path.resolve(e.path) === path.resolve(pathA)));
      assert.ok(entries.some((e) => path.resolve(e.path) === path.resolve(pathB)));

      // Neither worktree's checkout is visible inside the other: writing a marker file
      // into A's checkout must not appear under B's.
      const { writeFile } = await import("node:fs/promises");
      const { existsSync } = await import("node:fs");
      await writeFile(path.join(pathA, "MARKER-A.txt"), "a", "utf8");
      assert.equal(existsSync(path.join(pathB, "MARKER-A.txt")), false, "A's marker is not visible inside B's checkout");

      await removeWorktree(root, "asg-concurrent-a", { force: true });
      await removeWorktree(root, "asg-concurrent-b");
    }),
  },
  {
    name: "worktree-materialize/00 the materialized worktree path is always a prefix-child of the dedicated mesh worktrees root, never a machine-global temp directory",
    run: async () => withMeshWorkerExecFixture(async ({ root, headSha }) => {
      const assignmentId = "asg-scoped-00";
      const worktreePath = await addWorktree(root, assignmentId, headSha);
      assert.ok(isUnderMeshWorktreesRoot(root, worktreePath), "the normalized worktree path is a prefix-child of .aof/mesh/worktrees/ under the repo");
      // "No machine-global temp directory" means: never a SIBLING of the repo under
      // the OS temp root (a bare os.tmpdir() join) — the worktree fixture repo itself
      // is disposable-under-temp for test hygiene, but the worktree path must still be
      // NESTED inside the repo's own .aof/, not a second top-level temp entry.
      const os = await import("node:os");
      const siblingOfRepoUnderTemp = path.join(os.tmpdir(), path.basename(worktreePath));
      assert.notEqual(path.resolve(worktreePath), path.resolve(siblingOfRepoUnderTemp), "the worktree is not a bare os.tmpdir()-joined sibling path");
      assert.ok(path.resolve(worktreePath).startsWith(path.resolve(root) + path.sep), "the worktree path is nested inside the repo, not a second top-level temp entry");
      assert.equal(path.resolve(meshWorktreePath(root, assignmentId)), path.resolve(worktreePath));
      assert.equal(meshWorktreesRoot(root), path.join(root, ".aof", "mesh", "worktrees"));
      await removeWorktree(root, assignmentId);
    }),
  },
  {
    name: "worktree-materialize/00 a traversal ref resolves to no item and never escapes the worktree checkout — Scenario Outline (5 rows)",
    run: async () => withMeshWorkerExecFixture(async ({ root, workDir, headSha }) => {
      const rows = [
        { ref: "00", expectMatch: false }, // this fixture's item is at 35/00 — a bare "00" selects nothing at the top level
        { ref: "35/00", expectMatch: true },
        { ref: "../../etc", expectMatch: false },
        { ref: "/abs/outside", expectMatch: false },
        { ref: "00/../../..", expectMatch: false },
      ];
      const assignmentId = "asg-traversal-00";
      const worktreePath = await addWorktree(root, assignmentId, headSha);
      const ws = await loadWorkspace(root);
      try {
        for (const row of rows) {
          const item = await resolveRefInWorktree(root, ws.workDir, worktreePath, row.ref);
          if (row.expectMatch) {
            assert.ok(item != null, `[ref=${row.ref}] selects the enumerated item under ITEM_RE`);
            assert.ok(
              path.resolve(item.dir).startsWith(path.resolve(worktreePath) + path.sep),
              `[ref=${row.ref}] the resolved item.dir sits inside the worktree checkout, never the primary working copy`,
            );
          } else {
            assert.equal(item, null, `[ref=${row.ref}] yields no item (matches nothing)`);
          }
        }
      } finally {
        await removeWorktree(root, assignmentId, { force: true });
      }
    }),
  },
  {
    name: "worktree-materialize/00 a bare numeric ref selects the enumerated milestone/story under ITEM_RE inside the worktree",
    run: async () => withMeshWorkerExecFixture(async ({ root, headSha }) => {
      const assignmentId = "asg-bare-ref-00";
      const worktreePath = await addWorktree(root, assignmentId, headSha);
      const ws = await loadWorkspace(root);
      try {
        const milestone = await resolveRefInWorktree(root, ws.workDir, worktreePath, "35");
        assert.equal(milestone?.ref, "35", "a bare number selects the enumerated milestone under ITEM_RE");
        const story = await resolveRefInWorktree(root, ws.workDir, worktreePath, "35/00");
        assert.equal(story?.ref, "35/00", "a NN/SS pair selects the enumerated story under ITEM_RE");
      } finally {
        await removeWorktree(root, assignmentId, { force: true });
      }
    }),
  },
];
