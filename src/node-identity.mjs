// src/node-identity.mjs — deterministic node-id derivation + capability-descriptor
// assembly (milestone 22 / story 01 / ADR-003).
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
//                     resolved id is PERSISTED to config.mesh.nodeId on first
//                     derivation so it is stable across publishes (a hostname rename
//                     never churns the id) and operator-overridable.
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
// Persisting mesh.nodeId uses the headroom read-merge-write idiom (work-headroom.mjs):
// readJson(configPath) → mutate ONLY the mesh subtree → writeText (2-space + trailing
// \n). It deliberately does NOT route through config-editor.mjs's baseConfig() /
// saveEditableSections — that whitelist would DROP the unknown `mesh` block on rewrite
// (the Build-notes hard constraint).
import crypto from "node:crypto";
import { readJson, writeText } from "./fs.mjs";

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
//      persistence is what makes the id stable across a hostname rename).
//   2. Else the sanitized hostname stem.
//   3. An empty sanitized stem → node-<install-hash> (the empty-stem fallback).
//   4. A collision (the stem is already taken by a DIFFERENT install — supplied via
//      takenIds) → <stem>-<install-hash>. Deterministic from salt, so it is stable.
//   5. The resolved id is persisted to config.mesh.nodeId (read-merge-write) when a
//      configPath is supplied AND no id was already pinned — so later derivations reuse
//      it. (Persistence is skipped when no configPath is given — the in-memory derive.)
//
// opts: { config, hostname, salt, takenIds?, configPath? }. Returns the resolved id.
export async function deriveNodeId({ config = {}, hostname, salt, takenIds = [], configPath } = {}) {
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

  // (5) Persist on first derivation so the id is stable across publishes (a later
  // hostname rename never churns it). Read-merge-write ONLY the mesh subtree (the
  // headroom idiom) — never config-editor.mjs's whitelist (it would drop `mesh`).
  if (configPath) {
    await persistNodeId(configPath, id);
  }
  return id;
}

// Persist the resolved id to config.mesh.nodeId via the headroom read-merge-write
// idiom: read the current config off disk, mutate ONLY the mesh subtree (preserving
// every sibling key/value — the read-merge-write re-serialises the file in the
// project's 2-space + trailing-newline style, so it preserves keys/values, NOT the
// original file's byte formatting — the documented headroom idiom). Idempotent: an
// already-pinned id is left untouched (so a re-derivation does not rewrite it).
// Exported for white-box reuse / tests.
export async function persistNodeId(configPath, id) {
  let config = {};
  try {
    config = await readJson(configPath);
  } catch {
    config = {};
  }
  if (!config.mesh || typeof config.mesh !== "object") {
    config.mesh = {};
  }
  if (config.mesh.nodeId === id) return; // already pinned — no rewrite.
  config.mesh.nodeId = id;
  await writeText(configPath, `${JSON.stringify(config, null, 2)}\n`);
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
