// Traceability wiring for milestone 38 / story 00
// tasks/04_fleet-session-render.feature — "the fleet NodeCard renders the
// live-session state, with the run winning the primary line".
//
// REVIEW FIX (F1): this render helper (ui/src/fleet/runs.mjs's fleetCurrentWorkLines)
// is fed the REAL production wire shape — `activeRuns: string[]` (bare run ids,
// 23/ADR-002; no workspace attribution) and a `sessions[]` that is ALREADY
// pre-subsumed by the assembler (src/mesh-launcher.mjs's
// assembleCurrentPresenceRecord — see test/mesh-presence-aggregate-workspaces.test.mjs
// for the "run AND session on the SAME workspace ⇒ the session is dropped before
// publish" assertion, which is where that reconciliation genuinely happens). This
// file exercises ONLY the render helper's own rule: activeRuns non-empty ⇒ the
// aggregate `running N runs` line; every session remaining in the (pre-subsumed)
// `sessions[]` contributes to ONE shared `working · <repo>[, <repo>…] (session)`
// fallback line; neither ⇒ `idle`. node:assert/strict.
import assert from "node:assert/strict";
import { fleetCurrentWorkLines } from "../ui/src/fleet/runs.mjs";

function session(workspaceId, repo) {
  return { workspaceId, repo, assistant: "claude-code", lastPingAt: "2026-07-10T12:00:00.000Z" };
}

export const meshFleetSessionRenderTests = [
  // ══ Scenario Outline: the per-workspace reconciliation collapses runs and sessions into the fleet lines ══
  {
    name: "mesh-fleet-session-render/04 the per-workspace reconciliation collapses runs and sessions into the fleet lines (Examples)",
    async run() {
      const rows = [
        { activeRuns: [], sessions: [], lines: ["idle"], token: "muted", state: "idle" },
        { activeRuns: ["run-1"], sessions: [], lines: ["running 1 run"], token: "primary", state: "working" },
        { activeRuns: ["run-1", "run-2", "run-3"], sessions: [], lines: ["running 3 runs"], token: "primary", state: "working" },
        { activeRuns: [], sessions: [session("ws-A", "alpha")], lines: ["working · alpha (session)"], token: "primary", state: "working" },
        // "a run AND a live session, both in ws-A" — the SUBSUMPTION already happened
        // upstream (the assembler never publishes a same-workspace session), so this
        // helper simply never sees ws-A's session — it is handed an EMPTY sessions[].
        { activeRuns: ["run-1"], sessions: [], lines: ["running 1 run"], token: "primary", state: "working" },
        // "a run in ws-A, a live session in ws-B" — an UNSUBSUMED session (different
        // workspace) legitimately reaches this helper alongside the run.
        { activeRuns: ["run-1"], sessions: [session("ws-B", "beta")], lines: ["running 1 run", "working · beta (session)"], token: "primary", state: "working" },
        { activeRuns: [], sessions: [session("ws-A", "alpha"), session("ws-B", "beta")], lines: ["working · alpha, beta (session)"], token: "primary", state: "working" },
        { activeRuns: [], sessions: [], lines: ["idle"], token: "muted", state: "idle" }, // "the ws-A session had expired" — modelled as absent from sessions[].
      ];
      for (const row of rows) {
        const result = fleetCurrentWorkLines({ activeRuns: row.activeRuns, sessions: row.sessions });
        assert.deepEqual(result.lines, row.lines, `lines for ${JSON.stringify(row)}`);
        assert.equal(result.token, row.token, `token for ${JSON.stringify(row)}`);
        assert.equal(result.state, row.state, `state for ${JSON.stringify(row)}`);
      }
    },
  },

  // ══ Scenario: the run wins the primary line and subsumes a same-workspace session — ONE line, not two ══
  {
    name: "mesh-fleet-session-render/04 the run wins the primary line and subsumes a same-workspace session — ONE line, not two (render side: the helper is handed an already-subsumed sessions[])",
    async run() {
      // By the time a presence record reaches this render helper, ws-A's session
      // has ALREADY been dropped by the assembler (test/mesh-presence-aggregate-
      // workspaces.test.mjs asserts THAT reconciliation directly) — so the helper
      // sees only the run.
      const result = fleetCurrentWorkLines({ activeRuns: ["run-1"], sessions: [] });
      assert.equal(result.lines.length, 1, "ws-A contributes exactly one line");
      assert.equal(result.lines[0], "running 1 run", "that line is the run's `running N runs` line");
      assert.ok(!result.lines.some((line) => line.includes("(session)")), "no (session) line is emitted for ws-A");
    },
  },

  // ══ Scenario: a node working two repos shows both lines — one per workspace ══
  {
    name: "mesh-fleet-session-render/04 a node working two repos shows both lines — one per workspace (SPEC acceptance line)",
    async run() {
      const result = fleetCurrentWorkLines({ activeRuns: ["run-1"], sessions: [session("ws-B", "beta")] });
      assert.equal(result.lines.length, 2, "there are exactly two current-work lines");
      assert.ok(result.lines.includes("running 1 run"), "one line is the running N runs line");
      assert.ok(result.lines.includes("working · beta (session)"), "the other line is working · beta (session)");
    },
  },

  // ══ Scenario: the repo list on the session line is sorted deterministically — alphabetical, order-independent (DESIGN.md §Surface 1 S6 / DG-2) ══
  {
    name: "mesh-fleet-session-render/04 the repo list on the session line is sorted alphabetically, regardless of input order (DG-2)",
    async run() {
      // Two repos fed in a deliberately NON-alphabetical order (pay-guard-portal
      // before aof — the exact order observed live in the design-gap report).
      const nonAlpha = fleetCurrentWorkLines({
        activeRuns: [],
        sessions: [session("ws-A", "pay-guard-portal"), session("ws-B", "aof")],
      });
      assert.deepEqual(nonAlpha.lines, ["working · aof, pay-guard-portal (session)"]);

      // The reverse input order renders the IDENTICAL string — the line must not
      // reshuffle between polls just because the underlying map/insertion order
      // differs.
      const reversed = fleetCurrentWorkLines({
        activeRuns: [],
        sessions: [session("ws-B", "aof"), session("ws-A", "pay-guard-portal")],
      });
      assert.equal(reversed.lines[0], nonAlpha.lines[0], "same repo set, different input order ⇒ identical rendered line");

      // A three-repo case, also fed non-alphabetically.
      const three = fleetCurrentWorkLines({
        activeRuns: [],
        sessions: [session("ws-C", "zeta"), session("ws-A", "alpha"), session("ws-B", "mid")],
      });
      assert.deepEqual(three.lines, ["working · alpha, mid, zeta (session)"]);
    },
  },

  // ══ Scenario: the desktop (36) and web (25) views consume the SAME projection — no divergent collapse ══
  {
    name: "mesh-fleet-session-render/04 the desktop (36) and web (25) views consume the SAME projection — no divergent collapse",
    async run() {
      const presence = { activeRuns: ["run-1"], sessions: [session("ws-B", "beta")] };
      // Both "views" call the identical exported helper — there is no second
      // collapse rule anywhere in this codebase to diverge from (the single-
      // data-path discipline this fitness function/task pins).
      const desktopView = fleetCurrentWorkLines(presence);
      const webView = fleetCurrentWorkLines(presence);
      assert.deepEqual(desktopView, webView, "the two line sets (and token/state) are identical");
    },
  },
];
