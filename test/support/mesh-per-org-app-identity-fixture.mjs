// test/support/mesh-per-org-app-identity-fixture.mjs — shared fixture builder for
// milestone 38 / story 03 (per-org credential-provider scoping, ADR-011) task
// traceability modules (tasks 00, 01). Builds a HERMETIC multi-workspace control-node
// harness: a LAUNCH workspace repo + N "other" workspace repos, each with its OWN
// committed `aof.config.json` (own `cloneUrl`, own OPTIONAL
// `mesh.repo.credential.githubApp.*`), and a temp `AOF_GLOBAL_HOME`
// `global_workspace_descriptors` row per "other" workspace — the ADR-003 descriptor
// seam `createResolveWorkspaceAppIdentity`/`createResolveWorkspaceCloneUrl`
// (src/mesh-launcher.mjs, exported) reads FOR REAL through this fixture; no hand-built
// stand-in for either resolver (ADR-008).
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { loadWorkspace } from "../../src/work.mjs";
import { openGlobalWorkProjectionStore } from "../../src/global-work-store.mjs";

// generateThrowawayPrivateKeyPem() — a LOCAL, test-only RSA private key (PEM, PKCS#1
// — GitHub's own App-key download format), never a real GitHub App's registered key.
export function generateThrowawayPrivateKeyPem() {
  return generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
  }).privateKey;
}

async function writeConfig(repoDir, config) {
  await mkdir(path.join(repoDir, ".aof"), { recursive: true });
  await writeFile(path.join(repoDir, ".aof", "aof.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

async function seedMinimalWorkTree(repoDir) {
  const milestoneDir = path.join(repoDir, "wiki", "work", "38_milestone_demo");
  await mkdir(milestoneDir, { recursive: true });
  await writeFile(
    path.join(milestoneDir, "SPEC.md"),
    "---\ntype: milestone\nnumber: 38\nslug: demo\nstatus: in-progress\ntitle: Demo\n---\n",
    "utf8",
  );
}

// withPerOrgAppIdentityFixture(fn, { launch, others }) —
//   launch: { workspaceId, credential, cloneUrl } — the CONTROL node's OWN launch
//     workspace. `credential` is the raw `mesh.repo.credential` object (e.g.
//     `{ provider: "github-app", githubApp: { appId, privateKeyPath } }`); absent ->
//     no credential block at all.
//   others: [{ workspaceId, credential, cloneUrl }] — each an INDEPENDENT repo with
//     its OWN committed config, registered into `global_workspace_descriptors` so
//     `resolveWorkspaceProjectRoot` can find it — the REAL ADR-003 descriptor seam,
//     never a hand-rolled stand-in.
//
// `fn` receives { home, env, ws, tmp, writeKeyFile } — `writeKeyFile(name, pem)`
// writes a REAL throwaway key file under the fixture's temp dir and returns its
// absolute path (for a `privateKeyPath` config value).
export async function withPerOrgAppIdentityFixture(fn, { launch = {}, others = [] } = {}) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-app-identity-"));
  const home = path.join(tmp, "home");
  const launchRepo = path.join(tmp, "repo-launch");
  try {
    await seedMinimalWorkTree(launchRepo);
    const launchConfig = {
      name: "launch",
      work: { dir: "./wiki/work" },
      mesh: {
        nodeId: "control-a",
        fabric: "tailscale",
        relay: { controlNode: "control-a" },
        ...(launch.workspaceId ? { workspaceId: launch.workspaceId } : {}),
        repo: {
          cloneUrl: launch.cloneUrl ?? "https://github.com/launch-org/launch-repo.git",
          ...(launch.credential !== undefined ? { credential: launch.credential } : {}),
        },
      },
    };
    await writeConfig(launchRepo, launchConfig);

    const env = { AOF_GLOBAL_HOME: home };
    const ws = await loadWorkspace(launchRepo, undefined, { env });

    const store = await openGlobalWorkProjectionStore({ env });
    try {
      for (const other of others) {
        const repoDir = path.join(tmp, `repo-${other.workspaceId}`);
        await seedMinimalWorkTree(repoDir);
        const cloneUrl = other.cloneUrl ?? `https://github.com/${other.workspaceId}-org/repo.git`;
        const otherConfig = {
          name: other.workspaceId,
          work: { dir: "./wiki/work" },
          mesh: {
            workspaceId: other.workspaceId,
            repo: {
              cloneUrl,
              ...(other.credential !== undefined ? { credential: other.credential } : {}),
            },
          },
        };
        await writeConfig(repoDir, otherConfig);
        store.db.prepare(`
          INSERT OR REPLACE INTO global_workspace_descriptors
            (workspace_id, project_root, work_dir, name, mesh_enabled, member_node_ids_json, published_at, descriptor_path, clone_url)
          VALUES (?, ?, ?, ?, 0, '[]', ?, ?, ?)
        `).run(
          other.workspaceId,
          repoDir,
          path.join(repoDir, "wiki", "work"),
          other.workspaceId,
          "2026-07-18T00:00:00.000Z",
          `descriptor-${other.workspaceId}.json`,
          cloneUrl,
        );
      }
    } finally {
      store.close();
    }

    const writeKeyFile = async (name, pem) => {
      const keyPath = path.join(tmp, "keys", `${name}.pem`);
      await mkdir(path.dirname(keyPath), { recursive: true });
      await writeFile(keyPath, pem, "utf8");
      return keyPath;
    };

    return await fn({ tmp, home, env, ws, writeKeyFile });
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
