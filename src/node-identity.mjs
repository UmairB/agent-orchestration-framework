// src/node-identity.mjs — deterministic node-id derivation + capability-descriptor
// assembly (milestone 22 / story 01 / ADR-003; PERSIST TARGET RE-POINTED milestone 33
// / story 00 / ADR-004, F-3203).
//
// A node advertises WHO it is and WHAT it can run as a DERIVED, REBUILDABLE record:
// a projection of the install's config + environment, regenerable at any time (the
// 10/13 rebuildable-index discipline). This module owns two pure-ish mechanics:
//
//   deriveNodeId    — the documented-default id derivation (ADR-003): an operator /
//                     previously-persisted mesh.nodeId wins verbatim; else the
//                     sanitized hostname; an empty sanitized stem falls back to a
//                     deterministic node-<install-hash>; a collision against another
//                     install's id appends a stable per-install hash suffix. The
//                     resolved id is PERSISTED — as of ADR-004, to the git-ignored
//                     PER-INSTALL SIDECAR `.aof/mesh/identity.json`, NEVER the
//                     committed config — on first derivation, so it is stable across
//                     publishes (a hostname rename never churns the id) and
//                     operator-overridable (a sidecar-pinned id, set directly, wins
//                     verbatim and is never auto-healed — node-identity.mjs:74-78).
//
//   assembleDescriptor — assembles the frozen 7-key capability descriptor. It READS
//                     config + environment and NEVER writes (only deriveNodeId's
//                     first-publish persist writes). Empty runtimes/skills assemble
//                     as [] (an honest minimal install), never absent / a crash.
//
// White-box / INJECTABLE: hostname + salt are passed in so the sanitization matrix +
// the collision-suffix scenarios are testable without touching the real machine (the
// Build-notes injectability requirement). The id stays deterministic and [a-z0-9-]-only.
//
// Persisting the sidecar routes through the ONE sidecar read-merge-write
// (writeSidecarPatch, below — 22/R2: one writer per config subtree), re-pointed from
// the committed config and widened to the { nodeId, salt, derivedFrom, pinned }
// schema (the task-03 self-heal discriminator): readSidecar → shallow-merge a patch →
// writeText (2-space + trailing \n), idempotent (a no-op patch never rewrites). Every
// sidecar writer (persistNodeId, migrateIdentity, commands/mesh-identity.mjs's
// resolveInstallSalt) shares this ONE function. The committed config is never touched
// by the sidecar persist (ADR-004.2/.3) — a fresh derive leaves it byte-unchanged.
import path from "node:path";
import crypto from "node:crypto";
import { readJson, writeText } from "./fs.mjs";

// The ONE sidecar-path builder (ADR-004.1): `.aof/mesh/identity.json`, anchored on
// the ALREADY-computed `aofDir` (work.mjs:57) — never a hard-coded machine path.
// Every caller that needs the sidecar location (loadWorkspace's hydration, the
// mesh:identity / mesh:heartbeat commands, the doctor migrate action) derives it
// from `aofDir` through this ONE function, so the path is never duplicated/drifted.
export function sidecarPathFor(aofDir) {
  return path.join(aofDir, "mesh", "identity.json");
}

// The ONE sidecar read (22/R2 — one read-merge-write helper per config subtree,
// applied to the sidecar too): tolerant, degrading a torn/absent/malformed sidecar to
// {} rather than throwing. Every reader of the sidecar (persistNodeId, migrateIdentity,
// resolveInstallSalt in commands/mesh-identity.mjs, loadWorkspace's hydration) goes
// through this SAME function — no second hand-rolled readJson/catch idiom.
export async function readSidecar(sidecarPath) {
  try {
    return await readJson(sidecarPath);
  } catch {
    return {};
  }
}

// The ONE sidecar read-merge-write (22/R2): reads the current sidecar, shallow-merges
// `patch` over it (a `undefined`-valued patch key DELETES that key — so a caller can
// retire e.g. `pinned` on a re-derive, mirroring persistNodeId's own `delete
// next.pinned`), and writes back ONLY if the resulting bytes actually differ
// (idempotent — a no-op patch never rewrites the file, the SAME guarantee every
// sidecar writer already promised individually). Returns the resulting (possibly
// unwritten) sidecar object either way, so a caller can read the merged state without
// a second disk round-trip. `persistNodeId`, `migrateIdentity`, and
// `resolveInstallSalt` (commands/mesh-identity.mjs) all route through this ONE
// function — a config subtree gets exactly one writer (22/R2 / 06/R2).
export async function writeSidecarPatch(sidecarPath, patch) {
  const sidecar = await readSidecar(sidecarPath);
  const next = { ...sidecar };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete next[key];
    } else {
      next[key] = value;
    }
  }
  const keys = new Set([...Object.keys(sidecar), ...Object.keys(next)]);
  let unchanged = true;
  for (const key of keys) {
    if (sidecar[key] !== next[key]) {
      unchanged = false;
      break;
    }
  }
  if (unchanged) return sidecar; // already matches — no rewrite.
  await writeText(sidecarPath, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

// Sanitize a raw hostname to a path-safe, human-readable stem (ADR-003): lowercase,
// collapse every RUN of non-[a-z0-9-] characters to a SINGLE "-", trim leading /
// trailing "-". An all-illegal hostname sanitizes to "" — the caller falls back to the
// install-hash form (the resolved empty-stem mis-spec). digits + hyphens are preserved.
export function sanitizeHostname(hostname) {
  return String(hostname ?? "")
    .toLowerCase()
    // Each run of illegal chars → a single "-"…
    .replace(/[^a-z0-9-]+/g, "-")
    // …then collapse any run of "-" (including pre-existing hyphens that now abut the
    // substituted ones, e.g. "--__--" → "-") to ONE "-", so a separator RUN is a
    // single "-" (the feature example `umair--__--desktop` → `umair-desktop`).
    .replace(/-+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

// A short, STABLE per-install hash, derived deterministically from the install-local
// salt. The SAME hash serves both the empty-stem fallback (node-<hash>) and the
// collision suffix (<stem>-<hash>), so two installs with the same host but distinct
// salts differ, and a given install's id is stable across re-derivation. 4 hex chars
// is ample disambiguation for a small fleet and keeps the id legible.
export function installHash(salt) {
  return crypto.createHash("sha256").update(String(salt ?? "")).digest("hex").slice(0, 4);
}

// Derive THIS node's id under the ADR-003 documented-default rules, in precedence:
//   1. An operator-set / previously-persisted config.mesh.nodeId wins VERBATIM —
//      never re-derived, never overwritten (the derivation is a default, not a mandate;
//      persistence is what makes the id stable across a hostname rename). Post-ADR-004
//      this pin is read off `config.mesh.nodeId` exactly as before — the CALLER
//      (loadWorkspace's hydration) is what changes WHERE that value comes from (the
//      sidecar overlay, not the committed file); deriveNodeId's own precedence chain
//      is unchanged.
//   2. Else the sanitized hostname stem.
//   3. An empty sanitized stem → node-<install-hash> (the empty-stem fallback).
//   4. A collision (the stem is already taken by a DIFFERENT install — supplied via
//      takenIds) → <stem>-<install-hash>. Deterministic from salt, so it is stable.
//   5. The resolved id is persisted to the git-ignored PER-INSTALL SIDECAR (ADR-004.2),
//      NEVER the committed config, when a sidecarPath is supplied AND no id was already
//      pinned — so later derivations reuse it. (Persistence is skipped when no
//      sidecarPath is given — the in-memory derive.) The sidecar also records the
//      hostname the id was DERIVED from (derivedFrom) — the task-03 self-heal
//      discriminator that distinguishes a derived id from an operator-pinned one.
//
// opts: { config, hostname, salt, takenIds?, sidecarPath? }. Returns the resolved id.
export async function deriveNodeId({ config = {}, hostname, salt, takenIds = [], sidecarPath } = {}) {
  // (1) A pinned id (operator-set or previously persisted) wins verbatim.
  const pinned = config?.mesh?.nodeId;
  if (typeof pinned === "string" && pinned.length > 0) {
    return pinned;
  }

  // (2)/(3) Sanitize the hostname; an empty stem falls back to node-<install-hash>.
  const stem = sanitizeHostname(hostname);
  let id;
  if (stem.length === 0) {
    id = `node-${installHash(salt)}`;
  } else {
    id = stem;
    // (4) Collision: the stem is already taken by a different install → append the
    // stable per-install hash. The suffix is deterministic from salt, so two same-host
    // installs differ and each id is stable across re-derivation.
    const taken = new Set(takenIds);
    if (taken.has(stem)) {
      id = `${stem}-${installHash(salt)}`;
    }
  }

  // (5) Persist to the sidecar on first derivation so the id is stable across
  // publishes (a later hostname rename never churns it — the self-heal in task 03 is
  // the DELIBERATE exception, gated on a mismatch, not every load). Read-merge-write
  // the WHOLE sidecar object (the headroom idiom, re-pointed) — the committed config
  // is never touched here.
  if (sidecarPath) {
    await persistNodeId(sidecarPath, id, salt, { derivedFrom: hostname });
  }
  return id;
}

// Persist the resolved id + salt to the git-ignored sidecar via the ONE sidecar
// read-merge-write (writeSidecarPatch, ADR-004.1/.2 — re-pointed from the committed
// config, 22/R2 — one writer per subtree): mutates ONLY { nodeId, salt, derivedFrom }
// (preserving no unrelated sibling — the sidecar carries ONLY per-install identity,
// unlike the committed config's mesh subtree which also carries fleet-shared keys),
// re-serialised in the project's 2-space + trailing-newline style. Idempotent (via
// writeSidecarPatch): an already-matching { nodeId, salt, derivedFrom } is left
// untouched (so a re-derivation does not rewrite the sidecar). `derivedFrom` records
// the hostname FED to sanitizeHostname (not the resolved id) — task 03's self-heal
// discriminator; when supplied, it also RETIRES a stale `pinned` flag (undefined
// deletes the key via writeSidecarPatch) — a caller that pins an id directly (never
// through this fn) is unaffected when derivedFrom is omitted. Exported for white-box
// reuse / tests (mirrors persistNodeId's original injected-path precedent).
export async function persistNodeId(sidecarPath, id, salt, { derivedFrom } = {}) {
  await writeSidecarPatch(sidecarPath, {
    nodeId: id,
    salt,
    ...(typeof derivedFrom === "string" ? { derivedFrom, pinned: undefined } : {}),
  });
}

// migrateIdentity(configPath, sidecarPath) — milestone 33 / story 00 (ADR-004.4,
// F-3203's Definition-of-Done). Moves a LEGACY committed mesh.nodeId/mesh.salt to the
// git-ignored sidecar and STRIPS both keys from the committed config, turning the
// acd-mesh-identity-not-committed fitness green. A plain exported unit taking BOTH
// paths as injected args (mirrors persistNodeId's own injected-path precedent) — no
// prompt dependency, hermetic, callable directly by a test or a thin `work doctor
// --fix`-style CLI wrapper.
//
//   - COMMITTED-PRESENT (mesh.nodeId and/or mesh.salt on disk): merge them into the
//     sidecar (read-merge-write, preserving any sidecar sibling — derivedFrom/pinned
//     survive a migrate exactly as persistNodeId's read-merge-write would), then
//     STRIP only nodeId/salt from the committed config's mesh block — every FLEET-
//     SHARED sibling key (relay.controlNode, fabric, …) is preserved byte-equivalent
//     (the config-editor-whitelist hazard this story flags).
//   - ALREADY-MIGRATED (no committed identity, a sidecar already present) or ABSENT
//     (neither committed identity nor a sidecar): a clean, byte-level NO-OP — neither
//     file is rewritten (persistNodeId-style idempotence: only write when the
//     resulting bytes actually change).
//
// Returns { migrated: boolean } — true iff a rewrite actually happened (so a caller,
// e.g. a future `--fix` face, can report whether anything moved).
export async function migrateIdentity(configPath, sidecarPath) {
  let config = {};
  try {
    config = await readJson(configPath);
  } catch {
    config = {};
  }
  const mesh = config.mesh && typeof config.mesh === "object" ? config.mesh : {};
  const hasCommittedIdentity = "nodeId" in mesh || "salt" in mesh;
  if (!hasCommittedIdentity) {
    return { migrated: false }; // absence-tolerant: nothing to migrate, no-op.
  }

  // Merge the committed identity into the sidecar via the ONE sidecar read-merge-write
  // (writeSidecarPatch, 22/R2) — preserves any sidecar sibling (derivedFrom/pinned)
  // already present; only the keys the committed config actually carries are patched.
  const patch = {};
  if ("nodeId" in mesh) patch.nodeId = mesh.nodeId;
  if ("salt" in mesh) patch.salt = mesh.salt;
  await writeSidecarPatch(sidecarPath, patch);

  // Strip ONLY nodeId/salt from the committed config's mesh block — every fleet-
  // shared sibling key survives byte-equivalent.
  const { nodeId: _nodeId, salt: _salt, ...remainingMesh } = mesh;
  const nextConfig = { ...config, mesh: remainingMesh };
  await writeText(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`);
  return { migrated: true };
}

// Assemble this node's capability descriptor — the frozen 7-key schema (ADR-003), in
// order: nodeId, host, os, runtimes, skills, aofVersion, publishedAt. A REBUILDABLE
// projection: it READS config + environment and writes NOTHING. Empty runtimes/skills
// assemble as [] (honest minimal install), never absent / a crash. publishedAt is an
// ISO-8601 UTC trailing-Z instant (now ?? new Date().toISOString()).
//
// The id is taken AS-GIVEN (the caller derives it via deriveNodeId first, which owns
// the first-publish persist) so assembly stays a pure projection with no write.
export function assembleDescriptor({ nodeId, hostname, platform, runtimes, skills, aofVersion, now } = {}) {
  return {
    nodeId: String(nodeId ?? ""),
    host: String(hostname ?? ""),
    os: String(platform ?? ""),
    runtimes: Array.isArray(runtimes) ? [...runtimes] : [],
    skills: Array.isArray(skills) ? [...skills] : [],
    aofVersion: String(aofVersion ?? ""),
    publishedAt: now ?? new Date().toISOString(),
  };
}
