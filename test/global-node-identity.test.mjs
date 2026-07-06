// Milestone 34 / story 00 — the node identity is MACHINE-WIDE (global), not per-workspace.
// These are the checks that were MISSING at the first (wrong) accept: they prove one node
// id per machine, initialized once in the global AOF home, hydrated into every workspace,
// and clone-safe (nothing identity-bearing left in the repo). A revert to the per-workspace
// sidecar makes them fail.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadWorkspace } from "../src/work.mjs";
import { globalMeshPaths } from "../src/workspace.mjs";
import { meshIdentityCommand } from "../src/commands/mesh-identity.mjs";
import { migrateIdentityToGlobal, sidecarPathFor } from "../src/node-identity.mjs";

async function withTemp(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-global-identity-"));
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function makeWorkspace(root, name) {
  const dir = path.join(root, name);
  await mkdir(path.join(dir, "wiki", "work"), { recursive: true });
  await mkdir(path.join(dir, ".aof"), { recursive: true });
  await writeFile(
    path.join(dir, ".aof", "aof.config.json"),
    `${JSON.stringify({ name, work: { dir: "./wiki/work" }, mesh: { enabled: true } }, null, 2)}\n`,
    "utf8",
  );
  return dir;
}

// Mint this machine's identity by running mesh:identity against a workspace loaded with
// the given AOF_GLOBAL_HOME (so the mint target — ws.identityPath — is the temp global home).
async function mintIdentity(repoDir, env) {
  const workspace = await loadWorkspace(repoDir, undefined, { env });
  const record = await meshIdentityCommand.run({}, { workspace });
  return { workspace, record };
}

export const globalNodeIdentityTests = [
  {
    name: "global-node-identity/00 one machine → one node id shared by every workspace (init-once in the global home)",
    run: async () => withTemp(async (tmp) => {
      const home = path.join(tmp, "home");
      const env = { AOF_GLOBAL_HOME: home };
      const repoA = await makeWorkspace(tmp, "alpha");
      const repoB = await makeWorkspace(tmp, "beta");

      // Mint in workspace A.
      const { record } = await mintIdentity(repoA, env);
      assert.ok(record.nodeId && record.nodeId.length > 0, "an id was minted");

      // The identity file lives in the GLOBAL home, NOT in either project's .aof.
      const globalIdentityPath = globalMeshPaths({ env }).identityPath;
      assert.ok(existsSync(globalIdentityPath), "the identity is written to the global AOF home");
      assert.ok(!existsSync(sidecarPathFor(path.join(repoA, ".aof"))), "NO per-workspace identity sidecar in project A (clone-safe)");
      assert.ok(!existsSync(sidecarPathFor(path.join(repoB, ".aof"))), "NO per-workspace identity sidecar in project B");

      // Workspace B, loaded on the SAME machine (same AOF_GLOBAL_HOME), hydrates the SAME id.
      const wsB = await loadWorkspace(repoB, undefined, { env });
      assert.equal(wsB.config.mesh.nodeId, record.nodeId, "workspace B resolves the SAME machine node id");

      // And the global identity carries the salt too (so the install-hash is machine-stable).
      const identity = JSON.parse(await readFile(globalIdentityPath, "utf8"));
      assert.equal(identity.nodeId, record.nodeId);
      assert.ok(typeof identity.salt === "string" && identity.salt.length > 0, "salt persisted to the global home");
    }),
  },
  {
    name: "global-node-identity/00 two machines (distinct AOF_GLOBAL_HOME) keep SEPARATE identities — a clone never inherits one",
    run: async () => withTemp(async (tmp) => {
      const repo = await makeWorkspace(tmp, "shared-repo");
      const homeM1 = path.join(tmp, "machine-1");
      const homeM2 = path.join(tmp, "machine-2");

      // The SAME repo, opened under two different machines' global homes, mints into each
      // machine's OWN global home — never into the repo. Cloning the repo carries nothing.
      await mintIdentity(repo, { AOF_GLOBAL_HOME: homeM1 });
      assert.ok(existsSync(globalMeshPaths({ env: { AOF_GLOBAL_HOME: homeM1 } }).identityPath), "machine 1 identity in machine 1's home");
      assert.ok(!existsSync(sidecarPathFor(path.join(repo, ".aof"))), "the repo carries NO identity — a git clone inherits none (F-3203, strengthened)");

      // A second machine opening the same repo has an EMPTY identity home until it mints its own.
      const wsM2Before = await loadWorkspace(repo, undefined, { env: { AOF_GLOBAL_HOME: homeM2 } });
      assert.ok(!(wsM2Before.config.mesh && wsM2Before.config.mesh.nodeId), "machine 2 does not inherit machine 1's id");
    }),
  },
  {
    name: "global-node-identity/00 a legacy per-workspace sidecar is honored as a fallback, then migrated up to the global home",
    run: async () => withTemp(async (tmp) => {
      const home = path.join(tmp, "home");
      const env = { AOF_GLOBAL_HOME: home };
      const repo = await makeWorkspace(tmp, "legacy");
      const legacyPath = sidecarPathFor(path.join(repo, ".aof"));

      // Seed a LEGACY per-workspace sidecar (the pre-34-05 world) and NO global identity.
      // A PINNED id (operator-set) — never touched by the self-heal — is the clean "this
      // machine's legacy identity" case; a hostname-derived legacy id would (correctly)
      // self-heal to the current machine, which is a different scenario.
      await mkdir(path.dirname(legacyPath), { recursive: true });
      await writeFile(legacyPath, `${JSON.stringify({ nodeId: "legacy-node", salt: "s-123", pinned: true }, null, 2)}\n`, "utf8");

      // loadWorkspace falls back to the legacy sidecar (global absent) — back-compat.
      const ws = await loadWorkspace(repo, undefined, { env });
      assert.equal(ws.config.mesh.nodeId, "legacy-node", "legacy per-workspace identity is honored when no global one exists");

      // Migrate it up to the global home.
      const globalIdentityPath = globalMeshPaths({ env }).identityPath;
      const result = await migrateIdentityToGlobal(legacyPath, globalIdentityPath);
      assert.equal(result.migrated, true);
      assert.ok(existsSync(globalIdentityPath), "identity now lives in the global home");
      assert.ok(!existsSync(legacyPath), "the per-workspace sidecar is removed after migration");

      // A fresh load now resolves the SAME id from the global home.
      const ws2 = await loadWorkspace(repo, undefined, { env });
      assert.equal(ws2.config.mesh.nodeId, "legacy-node", "the migrated id resolves from the global home");

      // Migrate is idempotent (a second run is a clean no-op).
      const again = await migrateIdentityToGlobal(legacyPath, globalIdentityPath);
      assert.equal(again.migrated, false, "no legacy sidecar left → clean no-op");
    }),
  },
];
