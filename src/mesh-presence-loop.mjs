// src/mesh-presence-loop.mjs — the PRESENCE cadence loop (milestone 23 / story 02 /
// ADR-003). A thin background TIMER over the one-shot presence publish (the two-publish
// path in mesh-heartbeat.mjs) — it invokes the one-shot publish ONCE per tick and holds
// NO publish logic of its own (no git write, no relay push directly — task 01 asserts
// both). The intervalTicker / resolveCadenceSeconds / cadenceFromConfig
// split, applied to presence (the 22/ADR-004 runner shape — copied so the two loops share
// one shape).
//
// THE TWO CONFIG KEYS (coherent with m22's mesh.sync.* split):
//   - config.mesh.presence.cadenceSeconds — THIS module (the loop): how often THIS node
//     publishes. Read via resolvePresenceCadenceSeconds (a presence-local twin of m22's
//     resolveCadenceSeconds — byte-for-byte the same malformed matrix); a valid positive
//     INTEGER verbatim, anything malformed ⇒ DEFAULT_PRESENCE_CADENCE_SECONDS, no crash.
//   - config.mesh.presence.stalenessSeconds — STORY 00 (the staleness read): when a peer
//     reads as stale. A distinct sub-key under the same mesh.presence.* group. This
//     module does NOT touch it.
//
// The loop is given an INJECTABLE ticker so it is unit-testable with NO wall-clock wait
// (the manualTicker() pattern, the 22 task-01 shape). The cadence is READ AT START and
// STABLE for the run — a mid-run config edit does not retune a running loop.

// The DOCUMENTED default presence cadence (ADR-003 — taken under --autonomous; reversible
// by a config edit). A tight value within the ≤5s-liveness intent (PRD KR1: a peer's
// change reflected ≤5s over the relay), so the loop publishes at least that often even
// when cadenceSeconds is absent/malformed. The SINGLE source the "documented default"
// assertion reads.
export const DEFAULT_PRESENCE_CADENCE_SECONDS = 5;

// ----------------------------------------------------- the cadence reader ----

// Resolve the loop's tick interval (seconds) from a config value — a presence-local twin
// of m22's resolveCadenceSeconds (the SAME malformed matrix, byte-for-byte). A VALID
// positive INTEGER is used verbatim; ANY malformed value falls back to
// DEFAULT_PRESENCE_CADENCE_SECONDS without crashing. Malformed = absent/null/undefined,
// any non-number type (incl. the numeric-looking STRING "5" — no silent string→number
// coercion — and a boolean), 0, negative, and a non-integer float (5.5). NaN/Infinity are
// caught by the finite+integer checks (and are not JSON-representable anyway). This is the
// ONE place the presence-cadence policy lives.
export function resolvePresenceCadenceSeconds(value) {
  if (typeof value !== "number") return DEFAULT_PRESENCE_CADENCE_SECONDS;
  if (!Number.isFinite(value)) return DEFAULT_PRESENCE_CADENCE_SECONDS;
  if (!Number.isInteger(value)) return DEFAULT_PRESENCE_CADENCE_SECONDS;
  if (value <= 0) return DEFAULT_PRESENCE_CADENCE_SECONDS;
  return value;
}

// Read the presence cadence from a workspace's config
// (workspace.config.mesh.presence.cadenceSeconds) through resolvePresenceCadenceSeconds.
// Tolerant of a missing config/mesh/presence subtree.
export function presenceCadenceFromConfig(workspace) {
  const raw = workspace?.config?.mesh?.presence?.cadenceSeconds;
  return resolvePresenceCadenceSeconds(raw);
}

// ------------------------------------------------- the background-loop face ----

// startPresenceLoop — the THIN background-loop runner: a timer that invokes the one-shot
// presence publish once per tick and holds NO publish logic of its own (it never writes
// git, it never pushes the relay; it only calls publishOnce). The cadence is READ AT START
// and STABLE for the run — a mid-run config edit does not retune a running loop (the
// interval is captured here, once).
//
//   publishOnce    — the one-shot presence publish to invoke each tick (in production, a
//                    closure over invoke("mesh:heartbeat") / the two-publish path).
//   cadenceSeconds — the already-resolved tick interval (seconds), captured ONCE.
//   ticker         — an INJECTABLE clock: { start(intervalSeconds, onTick) -> handle,
//                    stop(handle) }. Tests pass a manual ticker so no wall-clock waits;
//                    production passes a real setInterval-backed ticker (intervalTicker).
//
// Returns a handle with { intervalSeconds, stop() } so a caller can read the fixed
// interval and tear the loop down.
export function startPresenceLoop({ publishOnce, cadenceSeconds, ticker } = {}) {
  // The interval is read at start and FIXED for the run (cadence read-at-start).
  const intervalSeconds = cadenceSeconds;
  const onTick = () => publishOnce();
  const handle = ticker.start(intervalSeconds, onTick);
  return {
    intervalSeconds,
    stop() {
      ticker.stop(handle);
    },
  };
}

// A real setInterval-backed ticker (production). Tests inject a manual ticker instead, so
// the loop never wall-clock-waits in CI. (Identical to the launcher intervalTicker shape —
// the two loops share the clock shape.)
export function intervalTicker() {
  return {
    start(intervalSeconds, onTick) {
      return setInterval(onTick, intervalSeconds * 1000);
    },
    stop(handle) {
      clearInterval(handle);
    },
  };
}
