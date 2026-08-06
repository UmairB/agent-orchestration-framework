// src/mesh-sync-cadence.mjs — the ONE home of the mesh SYNC cadence policy
// (`config.mesh.sync.cadenceSeconds`, m22/ADR-004's documented 15s default).
//
// WHY IT IS ITS OWN MODULE, and why now (m43 / story 04, ADR-014/E5). The policy used to be
// private to `mesh-launcher.mjs`, which is the only module that STARTS a tick on it. Story
// 04 added a second, genuinely different consumer: `commands/resync.mjs` WAITS on that tick,
// and its bounded poll must therefore outlast the cadence the drain actually runs at. E5
// measured what happens when it does not — a 10s literal against a 15s tick reported
// "no answer" for roughly one healthy request in three, "measuring the clock, not the world"
// — and ruled that the bound must be DERIVED from "the same `mesh.sync.cadenceSeconds` the
// tick reads". Derived means one resolver, not a second copy of the default: a copied `15`
// would be right today and silently wrong the first time an operator slows the tick down.
//
// This is `mesh-role.mjs`'s reason verbatim ("rather than let the launcher and the new
// worker-stream client each privately re-derive that comparison from config.mesh, this
// module is the single place it lives") and `mesh-presence-loop.mjs`'s SHAPE verbatim
// (`DEFAULT_*_CADENCE_SECONDS` + `resolve*CadenceSeconds(value)` + `*CadenceFromConfig(ws)`,
// with the same malformed matrix). A pure leaf: no imports, no clock, no fs, no config
// editor — a command module can reach it without dragging the launcher's 30-module closure
// behind it, which is what makes the derivation affordable at the door that needs it.

// The DOCUMENTED default control cadence, in SECONDS (m22/ADR-004, taken under the same
// autonomy rule as every other documented default and reversible by a config edit). The
// SINGLE source both the tick and anything that waits on the tick read.
export const DEFAULT_SYNC_CADENCE_SECONDS = 15;

// resolveSyncCadenceSeconds(value) — the cadence policy over a raw config value. A VALID
// positive INTEGER is used verbatim; ANY malformed value falls back to the documented
// default without crashing. Malformed = absent/null/undefined, any non-number type
// (including the numeric-looking STRING "15" — no silent string→number coercion — and a
// boolean), 0, negative, and a non-integer float. NaN/Infinity are caught by the
// finite+integer checks. Byte-for-byte the matrix `resolvePresenceCadenceSeconds` keeps for
// the presence cadence, because two cadences that disagree about what "5.5" means is the
// same class of defect as two staleness predicates that disagree about an instant.
export function resolveSyncCadenceSeconds(value) {
  if (typeof value !== "number") return DEFAULT_SYNC_CADENCE_SECONDS;
  if (!Number.isFinite(value)) return DEFAULT_SYNC_CADENCE_SECONDS;
  if (!Number.isInteger(value)) return DEFAULT_SYNC_CADENCE_SECONDS;
  if (value <= 0) return DEFAULT_SYNC_CADENCE_SECONDS;
  return value;
}

// syncCadenceFromConfig(workspace) — the cadence for a workspace, read off
// `workspace.config.mesh.sync.cadenceSeconds` through the raw optional-chain idiom (never
// the config editor, whose whitelist would drop an unknown mesh block on rewrite — the m22
// story-01 lesson). Tolerant of a missing config/mesh/sync subtree.
export function syncCadenceFromConfig(workspace) {
  return resolveSyncCadenceSeconds(workspace?.config?.mesh?.sync?.cadenceSeconds);
}
