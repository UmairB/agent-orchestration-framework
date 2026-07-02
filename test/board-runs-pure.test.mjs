// Traceability wiring for milestone 21 — the PURE run-observability helpers
// (ui/src/board/runs.mjs). Covers every HEADLESS @executable scenario across the
// two stories' task features, imported the same way the React DetailPanel imports
// the module (Node ≥20, no type-stripping — the action.mjs / dock-state.mjs
// convention), so the formatter / selection / chip ramp / verb / predicate are
// asserted with no browser. node:assert/strict.
//
//   story 00 / 00_runs-render        — a run's createdAt renders as a relative timestamp
//   story 00 / 01_current-run        — current-run selection + the run-state chip ramp
//   story 00 / 02_runs-poll-refresh  — the "refreshed Ns ago" freshness label
//   story 01 / 00_rerun-launches     — the rerun resolves to a fresh work:run-start verb
//   story 01 / 01_rerun-disabled     — the rerun is disabled exactly when a run is in flight
import assert from "node:assert/strict";
import {
  relativeTime,
  refreshedLabel,
  selectCurrentRun,
  historyOrder,
  runStateChip,
  rerunVerb,
  isInFlight,
} from "../ui/src/board/runs.mjs";

const NOW = "2026-06-30T12:00:00.000Z";
const nowMs = Date.parse(NOW);
const ago = (ms) => new Date(nowMs - ms).toISOString();
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// A minimal run record — the pure helpers read only state/createdAt/runId.
const run = (state, createdAt, runId = createdAt) => ({ state, createdAt, runId });

export const boardRunsPureTests = [
  // ===== story 00 / 00 — createdAt → human relative timestamp =====
  {
    name: "board-runs/00 a run's createdAt renders as a human relative timestamp (outline)",
    async run() {
      const rows = [
        [12 * MINUTE, "12m ago"],
        [90 * MINUTE, "1h ago"],
        [1 * DAY, "yesterday"],
        [2 * DAY, "2d ago"],
      ];
      for (const [span, label] of rows) {
        assert.equal(relativeTime(ago(span), NOW), label, `${span}ms ago → "${label}"`);
      }
    },
  },

  // ===== story 00 / 02 — the "refreshed Ns ago" freshness label =====
  {
    name: "board-runs/02 the 'refreshed Ns ago' label renders the time since the last fetch (outline)",
    async run() {
      const rows = [
        [8 * SECOND, "⟳ refreshed 8s ago"],
        [90 * SECOND, "⟳ refreshed 1m ago"],
      ];
      for (const [span, label] of rows) {
        assert.equal(refreshedLabel(ago(span), NOW), label, `${span}ms ago → "${label}"`);
      }
    },
  },

  // ===== story 00 / 01 — the current run is the single in-flight running run =====
  {
    name: "board-runs/01 the current run is the single in-flight running run (wins over recency)",
    async run() {
      // A `running` run that is NOT the most recent by createdAt, among terminals.
      const runs = [
        run("done", "2026-06-30T00:00:01.000Z", "r1"),
        run("running", "2026-06-30T00:00:02.000Z", "r2"),
        run("done", "2026-06-30T00:00:09.000Z", "r9"), // later, but terminal
      ];
      const current = selectCurrentRun(runs);
      assert.equal(current.runId, "r2", "the current run selected for the strip is the running run");
      assert.equal(current.state, "running");
    },
  },
  {
    name: "board-runs/01 with no in-flight run the current run is the most recent by createdAt",
    async run() {
      const runs = [
        run("done", "2026-06-30T00:00:01.000Z", "r1"),
        run("failed", "2026-06-30T00:00:09.000Z", "r9"), // most recent
        run("cancelled", "2026-06-30T00:00:05.000Z", "r5"),
      ];
      const current = selectCurrentRun(runs);
      assert.equal(current.runId, "r9", "the most recently created run is selected");
    },
  },
  {
    name: "board-runs/01 an empty history selects no current run (the strip degrades to the empty card)",
    async run() {
      assert.equal(selectCurrentRun([]), null, "no runs ⇒ no current run");
    },
  },
  {
    name: "board-runs/01 current-run selection breaks a createdAt tie deterministically by runId",
    async run() {
      // Two terminal runs created at the SAME instant — the order must be total
      // and deterministic (the higher runId wins), never order-dependent.
      const at = "2026-06-30T00:00:05.000Z";
      const a = selectCurrentRun([run("done", at, "r-a"), run("failed", at, "r-b")]);
      const b = selectCurrentRun([run("failed", at, "r-b"), run("done", at, "r-a")]);
      assert.equal(a.runId, "r-b", "the higher runId wins the tie");
      assert.equal(b.runId, "r-b", "and the result is independent of input order");
    },
  },

  // ===== story 00 / 00 — the history renders newest-first, non-mutating =====
  {
    name: "board-runs/00 the run history is ordered newest-first without mutating the shared read-model",
    async run() {
      const shared = [
        run("done", "2026-06-30T00:00:01.000Z", "r1"),
        run("done", "2026-06-30T00:00:03.000Z", "r3"),
        run("done", "2026-06-30T00:00:02.000Z", "r2"),
      ];
      const ordered = historyOrder(shared);
      assert.deepEqual(ordered.map((r) => r.runId), ["r3", "r2", "r1"], "newest run first");
      assert.notEqual(ordered, shared, "a fresh array is returned");
      assert.deepEqual(shared.map((r) => r.runId), ["r1", "r3", "r2"], "the shared read-model is NOT mutated");
      assert.deepEqual(historyOrder([]), [], "an empty history orders to []");
    },
  },

  // ===== story 00 / 01 — each run state maps to its designed dot+label chip =====
  {
    name: "board-runs/01 each run state maps to its designed dot+label chip (outline)",
    async run() {
      const rows = [
        ["queued", "queued", "muted", "none"],
        ["running", "running", "primary", "a pulsing dot"],
        ["done", "done", "primary", "a ✓"],
        ["failed", "failed", "destructive", "none"],
        ["cancelled", "cancelled", "secondary", "none"],
      ];
      for (const [state, label, token, mark] of rows) {
        const chip = runStateChip(state);
        assert.equal(chip.label, label, `${state} → label "${label}"`);
        assert.equal(chip.token, token, `${state} → token "${token}"`);
        assert.equal(chip.mark, mark, `${state} → mark "${mark}"`);
      }
    },
  },
  {
    name: "board-runs/01 an unknown run state falls back to the quiet muted chip and is not in flight (forward-compatible)",
    async run() {
      // A future/unknown state must never throw and must read quietly — the
      // module's documented forward-compatibility promise.
      const chip = runStateChip("zombie");
      assert.deepEqual(chip, { label: "unknown", token: "muted", mark: "none" }, "unknown → quiet muted chip");
      assert.equal(isInFlight([run("zombie", "t1")]), false, "an unknown state is NOT treated as in-flight");
    },
  },

  // ===== story 01 / 00 — the rerun resolves to a fresh run-start verb =====
  {
    name: "board-runs/01-rerun the rerun resolves to a fresh work:run-start verb for the selected ref (outline)",
    async run() {
      for (const ref of ["21/00", "21"]) {
        const verb = rerunVerb(ref);
        assert.equal(verb.command, "work:run-start", `${ref} → a fresh work:run-start`);
        assert.equal(verb.ref, ref, `${ref} → resolved on the selected ref`);
        assert.equal(verb.mode, "fresh", `${ref} → the m21 fresh path (m20 resume is a later additive delta)`);
      }
    },
  },

  // ===== story 01 / 01 — the rerun is disabled exactly when a run is in flight =====
  {
    name: "board-runs/01-rerun the rerun is disabled exactly when a run is in flight (outline)",
    async run() {
      const cases = [
        [[run("running", "t1")], true, "one running"],
        [[run("queued", "t1")], true, "one queued"],
        [[run("done", "t1"), run("failed", "t2")], false, "all terminal (done/failed)"],
        [[], false, "no runs at all"],
      ];
      for (const [runs, expected, label] of cases) {
        assert.equal(isInFlight(runs), expected, `${label} → in-flight=${expected} (disabled=${expected})`);
      }
    },
  },
];
