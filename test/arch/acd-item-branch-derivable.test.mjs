// Fitness functions for the m42 brittleness cure (2026-07-31; STATE §Residual
// defects — "THE structural debt"): ONE DERIVABLE BRANCH PER ITEM.
//
// THE DEFECT THIS CLOSES. Work lived on per-assignment branches
// (`aof/mesh/<ref>-<assignmentId>`) that ONLY the `global_item_branches` side
// table remembered — every consumer had to remember the lookup, and forgetting
// it was the measured wrong-base dispatch (2026-07-27: milestone 18's autonomous
// continue built from main with none of its refined stories). The cure: the
// branch is DERIVABLE from the ref alone (`meshItemBranchName` → `aof/mesh/<ref>`),
// so a forgetful consumer CONVERGES on the item's own line instead of forking;
// the side table survives as a CACHE that wins when present (continuity for
// pre-cure suffixed branches and reindexed items).
//
//   (1) THE PER-ASSIGNMENT MINT IS RETIRED (ratchet): `meshWorkerBranchName`
//       exists nowhere in src/ — its collision-freedom was the disease's carrier.
//   (2) ONE MINT, KNOWN CALLERS: `meshItemBranchName` is defined once and called
//       only by the worker's dispatch fallback and the recovery-push module.
//   (3) THE WORKER'S FALLBACK CONVERGES: the branch is `baseBranch ?? derivation`,
//       and an already-existing derived branch takes the REUSE door (source
//       order: the existence check precedes the worktree add).
//   (4) THE CACHE'S PLACE IS PINNED: the control dispatch tick is CACHE-ONLY
//       (deriving there would fail the reuse door for a never-pushed item — the
//       worker owns the fallback); the recovery-push tick is CACHE-FIRST (a
//       pre-cure stranded worktree sits on a name only the cache knows).
//   (5) THE DERIVATION IS PURE AND STABLE: same ref → same valid `aof/mesh/`
//       ref, no assignment id anywhere in it.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { meshItemBranchName } from "../../src/mesh-worktree.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC_DIR = path.join(repoRoot, "src");

const MINT_ALLOWED = new Set([
  "src/mesh-worktree.mjs",
  "src/mesh-worker-execution.mjs",
  "src/mesh-recovery-push.mjs",
]);

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

async function listSourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listSourceFiles(full)));
    else if (entry.isFile() && entry.name.endsWith(".mjs")) files.push(full);
  }
  return files;
}

export const archTests = [
  {
    name: "arch/m42-branch-cure: the per-assignment mint is retired (ratchet) and the one derivable mint has exactly its known callers",
    run: async () => {
      const files = await listSourceFiles(SRC_DIR);
      const retired = [];
      const minters = [];
      for (const file of files) {
        const rel = path.relative(repoRoot, file).replaceAll("\\", "/");
        const code = stripComments(await readFile(file, "utf8"));
        if (/meshWorkerBranchName/.test(code)) retired.push(rel);
        if (/\bmeshItemBranchName\s*\(/.test(code) && !MINT_ALLOWED.has(rel)) minters.push(rel);
      }
      assert.deepEqual(retired, [], `the per-assignment mint exists nowhere in src/ (offenders: ${retired.join(", ")})`);
      assert.deepEqual(minters, [], `meshItemBranchName is called only by its known callers (offenders: ${minters.join(", ")})`);
    },
  },
  {
    name: "arch/m42-branch-cure: the worker's fallback converges — baseBranch ?? derivation, with the existence check ahead of the worktree add (reuse, never a fork)",
    run: async () => {
      const code = stripComments(await readFile(path.join(SRC_DIR, "mesh-worker-execution.mjs"), "utf8"));
      assert.ok(
        /const branch = baseBranch \?\? meshItemBranchName\(itemRef\)/.test(code),
        "the dispatch branch is the cache-resolved base, else the item's own derivable name",
      );
      const existsCheck = code.indexOf("localBranchExists(ws.projectRoot, branch");
      const worktreeAdd = code.indexOf("await addWorktree(ws.projectRoot, assignmentId");
      assert.ok(existsCheck !== -1 && worktreeAdd !== -1, "both the existence check and the add exist");
      assert.ok(existsCheck < worktreeAdd, "an existing derived branch is detected BEFORE the add — the reuse door, so a re-dispatch continues the item's line");
    },
  },
  {
    name: "arch/m42-branch-cure: the cache's place is pinned — the dispatch tick is cache-only, the recovery tick cache-first",
    run: async () => {
      // The control dispatch tick must NOT derive: a derived-but-never-pushed
      // baseBranch would fail the worker's reuse door. Cache miss ⇒ no baseBranch
      // ⇒ the worker's own converging fallback.
      const reclaim = stripComments(await readFile(path.join(SRC_DIR, "mesh-assignment-reclaim.mjs"), "utf8"));
      assert.ok(/readItemBranch\s*\(/.test(reclaim), "the dispatch tick consults the cache");
      assert.ok(!/meshItemBranchName/.test(reclaim), "…and NEVER derives (the worker owns the fallback)");

      // The recovery-push tick derives ONLY behind a cache miss — a pre-cure
      // stranded worktree sits on a suffixed name only the cache still knows.
      const recovery = stripComments(await readFile(path.join(SRC_DIR, "mesh-recovery-push.mjs"), "utf8"));
      assert.ok(
        /readItemBranch\(store, request\.workspaceId, request\.itemRef\) \?\? meshItemBranchName\(request\.itemRef\)/.test(recovery),
        "the recovery dispatch resolves cache-first, derivation as the fallback",
      );
    },
  },
  {
    name: "arch/m42-branch-cure: the base-commit pin — the dispatch stamps the assigning HEAD, the frame carries it, and the worker verifies availability BEFORE any worktree add",
    run: async () => {
      // The control side: the tick resolves the assigning checkout's HEAD (the
      // injectable seam defaults to the real headCommit) and the frame builder
      // carries it conditionally — never a fabricated value.
      const reclaim = stripComments(await readFile(path.join(SRC_DIR, "mesh-assignment-reclaim.mjs"), "utf8"));
      assert.ok(/resolveDispatchCommit/.test(reclaim), "the tick resolves the assigning commit through its injectable seam");
      assert.ok(/headCommit\s*\(/.test(reclaim), "…defaulting to the checkout's real HEAD");
      const server = stripComments(await readFile(path.join(SRC_DIR, "control-stream-server.mjs"), "utf8"));
      assert.ok(
        /if \(typeof commit === "string" && commit\.length > 0\) frame\.commit = commit;/.test(server),
        "the directive frame carries the commit conditionally",
      );

      // The worker side: availability is verified (fetch-once-on-miss) BEFORE the
      // worktree add, and the miss is the coded refusal — never a silent build
      // from this clone's stale HEAD.
      const worker = stripComments(await readFile(path.join(SRC_DIR, "mesh-worker-execution.mjs"), "utf8"));
      const ensure = worker.indexOf("ensureCommitAvailable(ws.projectRoot, directive.commit");
      const add = worker.indexOf("await addWorktree(ws.projectRoot, assignmentId");
      assert.ok(ensure !== -1 && add !== -1, "the availability check and the add both exist");
      assert.ok(ensure < add, "availability is decided BEFORE the worktree materializes");
      assert.ok(/assignment-base-commit-unavailable/.test(worker), "an unbuildable base refuses with its own code");
    },
  },
  {
    name: "arch/m42-branch-cure: the derivation is pure, stable, prefix-pinned, and carries no assignment identity",
    run: () => {
      assert.equal(meshItemBranchName("18/02"), "aof/mesh/18-02", "the documented example derives byte-stably");
      assert.equal(meshItemBranchName("18/02"), meshItemBranchName("18/02"), "same ref, same branch — no per-call variance");
      assert.notEqual(meshItemBranchName("18/02"), meshItemBranchName("18/03"), "distinct items keep distinct lines");
      assert.equal(meshItemBranchName.length, 1, "the mint takes the REF ALONE — an assignment id cannot re-enter the name");
    },
  },
];
