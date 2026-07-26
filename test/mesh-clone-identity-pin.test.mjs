// m42 wave (b) / TECH_DEBT item 4 — the CLONE-TIME IDENTITY PIN. A scoped checkout's
// identity used to be re-derived from ITS OWN path on each machine (a different id
// per machine for the same repo): the Mac's checkout of let-shield answered
// 14d86b2b… while the fleet's canonical id was 1f164bd0… — the worker's
// launch-workspace frames were refused and workspace-workdir-unresolvable spammed
// every 5s, forever. The id the assignment arrived under is pinned into the fresh
// checkout's own config at clone time, so resolveWorkspaceId answers the SAME id on
// every machine from then on.
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { cloneRepoForWorkspace } from "../src/mesh-worker-execution.mjs";
import { resolveWorkspaceId } from "../src/workspace-identity.mjs";
import { loadWorkspace } from "../src/work.mjs";
import { withMeshWorkerExecFixture } from "./support/mesh-worker-exec-fixture.mjs";

const NOW = "2026-07-26T12:00:00.000Z";
const CANONICAL_ID = "1f164bd03ea535da";

// A clone fake that materialises a plausible cloned repo: the target dir with a
// COMMITTED .aof/aof.config.json carrying the repo's own keys (but NO pinned id —
// the pre-fix reality for every real workspace).
function fakeCloneExec({ committedConfig } = {}) {
  const calls = [];
  return {
    calls,
    exec: async (args) => {
      calls.push(args);
      const target = args[args.length - 1];
      await mkdir(path.join(target, ".aof"), { recursive: true });
      if (committedConfig !== null) {
        await writeFile(
          path.join(target, ".aof", "aof.config.json"),
          `${JSON.stringify(committedConfig ?? { name: "let-shield-portal", work: { dir: "./wiki/work" } }, null, 2)}\n`,
          "utf8",
        );
      }
      return { status: 0, stdout: "", stderr: "" };
    },
  };
}

export const meshCloneIdentityPinTests = [
  {
    name: "clone-identity-pin/item-4 a fresh checkout is pinned with the ASSIGNMENT's workspaceId — resolveWorkspaceId answers the canonical id, and the committed config's own keys survive the merge",
    async run() {
      await withMeshWorkerExecFixture(async (fx) => {
        const clone = fakeCloneExec();
        const checkoutPath = await cloneRepoForWorkspace(fx.workspace, {
          workspaceId: CANONICAL_ID,
          nodeId: "worker-a",
          assignmentId: "asg-pin-1",
          cloneUrl: "https://example.com/let-shield-portal.git",
          now: NOW,
          options: { cloneExec: clone.exec, globalWorkStoreOptions: fx.ctx.globalWorkStoreOptions },
        });

        const config = JSON.parse(await readFile(path.join(checkoutPath, ".aof", "aof.config.json"), "utf8"));
        assert.equal(config.mesh.workspaceId, CANONICAL_ID, "the assignment's id is pinned into the checkout's own config");
        assert.equal(config.name, "let-shield-portal", "the committed config's own keys survive the merge");

        // THE point, end-to-end: a workspace loaded from this checkout resolves the
        // CANONICAL id — never this machine's path derivation.
        const checkoutWs = await loadWorkspace(checkoutPath, undefined, { env: fx.env });
        assert.equal(resolveWorkspaceId(checkoutWs), CANONICAL_ID, "resolveWorkspaceId answers the fleet's id on THIS machine");
      });
    },
  },
  {
    name: "clone-identity-pin/item-4 a repo with NO committed aof config still gets pinned (fresh { mesh } config) — the pin is the fact that matters",
    async run() {
      await withMeshWorkerExecFixture(async (fx) => {
        const clone = fakeCloneExec({ committedConfig: null });
        const checkoutPath = await cloneRepoForWorkspace(fx.workspace, {
          workspaceId: CANONICAL_ID,
          nodeId: "worker-a",
          assignmentId: "asg-pin-2",
          cloneUrl: "https://example.com/bare-repo.git",
          now: NOW,
          options: { cloneExec: clone.exec, globalWorkStoreOptions: fx.ctx.globalWorkStoreOptions },
        });
        const config = JSON.parse(await readFile(path.join(checkoutPath, ".aof", "aof.config.json"), "utf8"));
        assert.equal(config.mesh.workspaceId, CANONICAL_ID);
      });
    },
  },
];
