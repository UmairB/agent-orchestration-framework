// work:doctor — milestone 33 / story 00: the MESH-IDENTITY-COMMITTED warn group
// (ADR-004.4, F-3203). A single PURE `(snapshot, ctx) => Finding[]` function APPENDED
// to the engine's CHECK_GROUPS registry (work-doctor.mjs) — it edits no existing group
// and no spine control flow.
//
// THE LOAD-BEARING WIRING GAP (developer-amigo RESOLVED flag, task 02): this group
// must NOT read `ctx.config` for its decision — that object is `loadWorkspace`'s
// HYDRATED workspace config (milestone 33 / story 00's own task 01), which, on a
// correctly-migrated repo, still carries `mesh.nodeId`/`mesh.salt` sourced from the
// sidecar overlay. A naive read of `ctx.config.mesh` would false-positive forever on
// every correctly-migrated repo. The fix: read `ctx.rawCommittedMesh` — the mesh block
// of the COMMITTED config on disk, read INDEPENDENTLY at the impure edge
// (`commands/doctor.mjs`, mirroring where `Date.now()` already lives, ADR-003 step 4)
// and handed in here as plain data (work-doctor.mjs's `doctorWork` options), never a
// second read performed by this module or the engine.
//
// Code + severity (ADR-004.4, fixed in the task .feature Examples):
//   mesh-identity-committed (warn) — fired iff the COMMITTED config's mesh block
//   carries `nodeId` OR `salt` (regardless of whether a sidecar ALSO exists — the warn
//   is about the committed artifact carrying per-install identity, the F-3203 smell).
//   Anchored at the committed config path; the message names the sidecar target
//   (.aof/mesh/identity.json) and the F-3203 migration.
export function meshIdentityCommittedGroup(snapshot, ctx) {
  const findings = [];

  const mesh = ctx?.rawCommittedMesh ?? {};
  const hasCommittedIdentity = "nodeId" in mesh || "salt" in mesh;
  if (hasCommittedIdentity) {
    findings.push({
      code: "mesh-identity-committed",
      severity: "warn",
      path: ctx?.committedConfigPath ?? snapshot.workDir,
      message:
        "per-install identity is in committed config — migrate it to the machine-wide identity in the global AOF home (F-3203 / 34-05)",
    });
  }

  // milestone 34 / story 00 — a LEGACY per-workspace identity sidecar
  // (.aof/mesh/identity.json under this project's aofDir) is per-PROJECT, but identity is
  // now machine-wide (one nodeId per machine, in the global AOF home). Warn so the
  // operator migrates it up (migrateIdentityToGlobal) rather than carrying a per-project id.
  if (ctx?.legacyIdentitySidecarPresent === true) {
    findings.push({
      code: "mesh-identity-workspace-local",
      severity: "warn",
      path: ctx?.legacyIdentitySidecarPath ?? snapshot.workDir,
      message:
        "node identity is stored per-workspace — migrate it to the machine-wide global AOF home so every workspace shares one node id (34-05)",
    });
  }

  return findings;
}
