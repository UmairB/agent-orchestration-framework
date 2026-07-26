// Fitness (milestone 34 / story 05): the node identity is resolved from the MACHINE-WIDE
// global AOF home, never a per-workspace aofDir. This is the structural guard that was
// MISSING at the first accept — a global work store keyed on nodeId is only coherent if
// the nodeId is one machine fact. A revert of the identity read/mint back to the
// per-workspace sidecar as its PRIMARY source makes this fail.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { globalMeshPaths } from "../../src/workspace.mjs";
import { loadWorkspace } from "../../src/work.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const stripComments = (s) => s.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

export const archTests = [
  {
    name: "arch/34 ADR-05: globalMeshPaths.identityPath is under AOF_GLOBAL_HOME (identity is machine-wide, never per-workspace)",
    run: async () => {
      const home = path.join(repoRoot, ".tmp-aof-identity-home");
      assert.equal(globalMeshPaths({ env: { AOF_GLOBAL_HOME: home } }).identityPath, path.join(home, "mesh", "identity.json"));
    },
  },
  {
    name: "arch/34 ADR-05: loadWorkspace exposes the GLOBAL identity path as ws.identityPath (the mint target every caller shares)",
    run: async () => {
      const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-identity-fitness-"));
      try {
        const home = path.join(tmp, "home");
        const repo = path.join(tmp, "repo");
        await mkdir(path.join(repo, ".aof"), { recursive: true });
        await mkdir(path.join(repo, "wiki", "work"), { recursive: true });
        await writeFile(path.join(repo, ".aof", "aof.config.json"), `${JSON.stringify({ name: "x", work: { dir: "./wiki/work" }, mesh: { enabled: true } })}\n`, "utf8");
        const ws = await loadWorkspace(repo, undefined, { env: { AOF_GLOBAL_HOME: home } });
        assert.equal(ws.identityPath, globalMeshPaths({ env: { AOF_GLOBAL_HOME: home } }).identityPath, "ws.identityPath is the global home path");
        assert.ok(ws.identityPath.startsWith(path.resolve(home)), "the identity write target is INSIDE the global home, never the project");
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    },
  },
  {
    name: "arch/34 ADR-05: loadWorkspace reads identity from globalMeshPaths, and the minting callers write to ws.identityPath (not the per-workspace sidecar as primary)",
    run: async () => {
      const work = stripComments(await readFile(path.join(repoRoot, "src", "work.mjs"), "utf8"));
      // The PRIMARY identity read in loadWorkspace routes through the global home.
      assert.ok(/const\s+globalMesh\s*=\s*globalMeshPaths\(\s*\{\s*env\s*\}\s*\)/.test(work), "loadWorkspace resolves global mesh paths via globalMeshPaths({ env })");
      assert.ok(/const\s+globalIdentityPath\s*=\s*globalMesh\.identityPath/.test(work), "loadWorkspace reads identityPath from the resolved global mesh paths");
      assert.ok(/identityPath:\s*globalIdentityPath/.test(work), "loadWorkspace exposes ws.identityPath = the global path");

      for (const file of ["commands/mesh-identity.mjs", "commands/mesh-heartbeat.mjs", "mesh-launcher.mjs"]) {
        const src = stripComments(await readFile(path.join(repoRoot, "src", file), "utf8"));
        assert.ok(/ws\.identityPath/.test(src), `${file} mints/reads identity via ws.identityPath (the global home), not the per-workspace sidecar as primary`);
      }
    },
  },
];
