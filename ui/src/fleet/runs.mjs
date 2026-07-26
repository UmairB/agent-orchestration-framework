// The pure session/run current-work-line projection (milestone 38 / story 00 /
// task 04; ARCHITECTURE ADR-004; DESIGN.md §Surface 1 state table). A
// framework-free ESM module — no React, no DOM, no I/O, no clock — the
// fleet-model SIBLING of ui/src/fleet/assignments.mjs / ui/src/board/runs.mjs: it
// projects a presence record's `{ activeRuns, sessions }` (the ADR-001 additive
// shape) down to the NodeCard's row-3 "current-work" line set, so BOTH the desktop
// (36) and web (25) views render byte-identically from the SAME helper (the
// single-data-path discipline, ADR-004's "no divergent collapse rules").
//
// REVIEW FIX (F1, MAJOR): this helper does NOT — and structurally CANNOT — perform
// run→workspace attribution. `activeRuns` on the wire is the FROZEN m23 `string[]`
// of bare run ids (23/ADR-002, `ui/src/fleet/api.ts`'s `PresenceRecord.activeRuns`;
// `readActiveRuns` emits `run.runId` strings) — it carries NO workspace id. The
// per-workspace attribution the ADR-004 "run subsumes a same-workspace session"
// rule needs DOES exist, but only in `assembleCurrentPresenceRecord`
// (src/mesh-launcher.mjs), which loops per-workspace and therefore knows which
// workspace each run came from. That assembler now performs the subsumption
// BEFORE publishing: a live session whose workspaceId already has a running run is
// dropped from `sessions[]` on the wire. So by the time THIS helper sees the
// presence record, `sessions[]` is ALREADY pre-subsumed — it needs no run-id
// attribution of its own, and correctly cannot invent one from a bare string array.
//
// Rendering rule (node-level, ADR-004 applied upstream):
//   - `activeRuns` non-empty ⇒ the aggregate `running N runs` line (N =
//     activeRuns.length, the verbatim m23 baseline reading — ONE line for the
//     whole node, since the wire carries no per-workspace run breakdown).
//   - every session in the (already-subsumed) `sessions[]` contributes its repo to
//     ONE shared fallback line: `working · <repo>[, <repo>…] (session)` — DESIGN's
//     "two repos show BOTH, comma-joined under one `working ·` prefix, one
//     trailing `(session)`" reading. The repo list is sorted alphabetically
//     (ascending, plain codepoint order) before joining (DESIGN §Surface 1 S6) —
//     deterministic across polls, and matched byte-for-byte by the Rust
//     `session_repos()`/`current_work()` projection.
//   - a run line AND a session-fallback line can both be present (a run in one
//     workspace + a live session in ANOTHER, unsubsumed, workspace — SPEC's "a
//     node working two repos shows both").
//   - neither anywhere ⇒ the single line `idle`.
// PURE over `{ activeRuns, sessions }` — it re-reads nothing, introduces no third
// signal, and never recomputes session liveness/subsumption itself (both are
// already-applied facts on the record it is handed).

function plural(n, word) {
  return n === 1 ? word : `${word}s`;
}

// fleetCurrentWorkLines(presence) — the ONE pure projection both the desktop and
// web views call. Returns `{ lines: string[], token: "primary"|"muted", state:
// "working"|"idle" }`:
//   - `lines` — the exact rendered text set, in order: the `running N runs` line
//     first (when `activeRuns` is non-empty), THEN, if any (already-subsumed) live
//     session remains, ONE trailing fallback line `working ·
//     <repo>[, <repo>…] (session)` naming every such session's repo, comma-joined;
//     or the single line `idle` when neither exists.
//   - `token` — "primary" when ANY line is active work, else "muted" for the
//     single `idle` line (colour+label always travel together — DESIGN).
//   - `state` — the node's overall liveness: "working" iff activeRuns is non-empty
//     OR sessions is non-empty, else "idle" (self-expiring via the TTL upstream).
export function fleetCurrentWorkLines(presence) {
  const activeRuns = Array.isArray(presence?.activeRuns) ? presence.activeRuns : [];
  const sessions = Array.isArray(presence?.sessions) ? presence.sessions : [];

  const lines = [];
  if (activeRuns.length > 0) {
    lines.push(`running ${activeRuns.length} ${plural(activeRuns.length, "run")}`);
  }

  // Every LIVE session that reached this helper is, by construction (the assembler
  // subsumes a same-workspace session before publishing), one the run set has NOT
  // already accounted for — so every session here contributes to the fallback line.
  // DESIGN.md §Surface 1 S6: the repo list is ordered deterministically —
  // alphabetical (ascending) by repo short name, a plain locale-independent
  // codepoint comparison (never a locale-sensitive collation, which could
  // disagree with the Rust surface's byte-wise `sort()`). Sorted AFTER
  // filtering so both projections agree on the exact same list.
  const repos = sessions
    .map((session) => session?.repo)
    .filter((repo) => typeof repo === "string" && repo.length > 0)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (repos.length > 0) {
    lines.push(`working · ${repos.join(", ")} (session)`);
  }

  const state = lines.length > 0 ? "working" : "idle";
  return {
    lines: lines.length > 0 ? lines : ["idle"],
    token: state === "working" ? "primary" : "muted",
    state,
  };
}
