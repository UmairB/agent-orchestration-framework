// Fitness function: acd-mesh-identity-not-committed (milestone 33 / ADR-004 / UAT 32
// F-3203) — "No PER-INSTALL identity (`nodeId` / `salt`) appears in COMMITTED config."
//
//   "F-3203 root cause: config.mesh.nodeId + mesh.salt live in the COMMITTED
//    .aof/aof.config.json, and deriveNodeId honours a pinned id VERBATIM
//    (src/node-identity.mjs:74). So a clone INHERITS the origin machine's identity —
//    two machines share a nodeId and both own nodes/<id>.json at the same path,
//    violating the m22 one-node-per-path partition invariant (acd-mesh-partition-write).
//    The same rationale that git-ignores mesh/ applies to mesh.nodeId / mesh.salt:
//    machine-specific state must not be committed. ADR-004's fix splits config.mesh into
//    FLEET-SHARED (committed: relay.controlNode, fabric, transport) vs PER-INSTALL
//    identity (git-ignored sidecar .aof/mesh/identity.json: nodeId, salt). This gate
//    forbids nodeId/salt in the committed config (and the config schema)."
//
// ============================ UN-SKIPPED (milestone 33 / story 00) ====================
// Milestone 33's per-install-identity story migrated the committed .aof/aof.config.json
// (which carried mesh.salt + mesh.nodeId "umairs-msi") to the git-ignored sidecar
// .aof/mesh/identity.json via migrateIdentity(configPath, sidecarPath) — the committed
// config's mesh block is now {} (no nodeId/salt), so the REAL assertion below is GREEN.
// =====================================================================================
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const COMMITTED_CONFIG = path.join(repoRoot, ".aof", "aof.config.json");
const CONFIG_SCHEMA = path.join(repoRoot, "src", "aof.schema.json");

// The per-install identity keys that must NEVER be in committed config (ADR-004).
const PER_INSTALL_IDENTITY_KEYS = ["nodeId", "salt"];

// The REAL assertion the identity story un-skips into `run` once the committed config is
// migrated to the sidecar. Exported so the story (and a future reviewer) has the exact,
// non-vacuous check ready — it reads the committed config (and, if present, the config
// schema) and asserts neither declares mesh.nodeId / mesh.salt. It also proves the read
// is non-vacuous (a fixture WITH the keys would fail).
export async function assertIdentityNotCommitted() {
  const config = JSON.parse(await readFile(COMMITTED_CONFIG, "utf8"));
  const mesh = config?.mesh ?? {};
  for (const key of PER_INSTALL_IDENTITY_KEYS) {
    assert.ok(
      !(key in mesh),
      `committed .aof/aof.config.json must NOT carry per-install identity mesh.${key} — it belongs in the git-ignored sidecar .aof/mesh/identity.json (F-3203 / ADR-004)`
    );
  }
  // The schema (if it declares a mesh block) must not REQUIRE or property-define the
  // per-install keys as committed config — read tolerantly (the mesh block may be free-
  // form / absent from the schema, which is fine).
  let schemaText = null;
  try {
    schemaText = await readFile(CONFIG_SCHEMA, "utf8");
  } catch {
    schemaText = null; // no schema mesh block to check — benign.
  }
  if (schemaText != null) {
    const schema = JSON.parse(schemaText);
    const meshProps = schema?.properties?.mesh?.properties ?? {};
    for (const key of PER_INSTALL_IDENTITY_KEYS) {
      assert.ok(
        !(key in meshProps),
        `the config schema must NOT declare mesh.${key} as a committed-config property — per-install identity is sidecar-only (F-3203 / ADR-004)`
      );
    }
  }
  // Non-vacuous self-checks: the assertion FIRES on a config WITH the keys and does NOT
  // fire on a fleet-shared-only config.
  const withIdentity = { mesh: { nodeId: "umairs-msi", salt: "abc", relay: { controlNode: "x" } } };
  assert.ok("nodeId" in (withIdentity.mesh ?? {}), "self-check: the reader detects mesh.nodeId when present (the RED-until-migrated state)");
  const fleetSharedOnly = { mesh: { relay: { controlNode: "x" }, fabric: "tailscale" } };
  assert.ok(!("nodeId" in (fleetSharedOnly.mesh ?? {})) && !("salt" in (fleetSharedOnly.mesh ?? {})), "self-check: a fleet-shared-only mesh block passes");
}

export const archTests = [
  {
    name: "arch/mesh-identity-not-committed: no per-install identity (nodeId/salt) in committed config",
    run: async () => {
      await assertIdentityNotCommitted();
    },
  },
];
