// The pure run-observability helpers (milestone 21 — DESIGN surfaces 1/2/3;
// ARCHITECTURE 21/ADR-001/002). One framework-free ESM module the node tests and
// the React DetailPanel/BoardLanes both import — no React, no DOM, no IO, no
// clock of its own (every `now` is passed in) — so the @executable scenarios
// (relative-time formatting, current-run selection, the chip ramp, the rerun
// verb, the in-flight predicate) run HEADLESSLY, matching the action.mjs /
// dock-state.mjs / status.tsx "one source, pure mapping" convention.
//
// The board RENDERS the milestone-19 frozen run-record schema; it WRITES none of
// it. `runId`/`itemRef`/`updatedAt` are available but unshown; `brief` is OPAQUE
// and never read here (19/ADR-003; 21/ADR-001).

// ----------------------------------------------------- relative time ----------

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Render an elapsed span (createdAt → now) as a terse human relative label, the
// same formatter the history rows AND the "⟳ refreshed Ns ago" poll affordance
// use (DESIGN surfaces 1/2). PURE over (fromIso, nowIso): no clock is read. The
// ramp — Ns / Nm / Nh (floored), a single day reads "yesterday", ≥2 days reads
// "Nd ago". A barely-elapsed span reads "just now". A future/equal instant
// clamps to 0 (never a negative span). The exact thresholds are the
// implementer's; the feature rows are representative.
export function relativeTime(fromIso, nowIso) {
  const fromMs = Date.parse(fromIso);
  const nowMs = nowIso === undefined || nowIso === null ? Date.now() : Date.parse(nowIso);
  if (Number.isNaN(fromMs) || Number.isNaN(nowMs)) return "";
  const seconds = Math.max(0, Math.floor((nowMs - fromMs) / 1000));

  if (seconds < 5) return "just now";
  if (seconds < MINUTE) return `${seconds}s ago`;
  if (seconds < HOUR) return `${Math.floor(seconds / MINUTE)}m ago`;
  if (seconds < DAY) return `${Math.floor(seconds / HOUR)}h ago`;
  const days = Math.floor(seconds / DAY);
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

// The poll affordance's freshness label (DESIGN surface 2): the SAME relativeTime
// ramp behind the "⟳ refreshed …" prefix, so freshness reads in one vocabulary.
export function refreshedLabel(lastFetchedIso, nowIso) {
  return `⟳ refreshed ${relativeTime(lastFetchedIso, nowIso)}`;
}

// ----------------------------------------------- current-run selection --------

// The run lifecycle states (19/ADR-001). queued is reserved for m20's scheduler;
// it renders quietly when present. running is the single in-flight state today.
const NON_TERMINAL = new Set(["queued", "running"]);

// The CURRENT run for the pinned strip (ARCHITECTURE 21/ADR-001): NOT a second
// fetch — the latest / in-flight element of the SAME runs[] the RUNS view read.
// The in-flight `running` run wins (the single live run); else the most recent by
// createdAt. PURE over the array; returns null for an empty history (the strip
// degrades to surface 1's empty-state card). Newest-by-createdAt, tie-broken by
// runId so the order is total and deterministic.
export function selectCurrentRun(runs) {
  if (!Array.isArray(runs) || runs.length === 0) return null;
  const running = runs.filter((run) => run.state === "running");
  const pool = running.length > 0 ? running : runs;
  return pool.reduce((latest, run) => (isNewer(run, latest) ? run : latest));
}

function isNewer(a, b) {
  const aMs = Date.parse(a.createdAt);
  const bMs = Date.parse(b.createdAt);
  if (aMs !== bMs) return aMs > bMs;
  // Equal/unparseable createdAt → fall back to the lexically-sortable runId.
  return String(a.runId) > String(b.runId);
}

// History is rendered NEWEST-FIRST (DESIGN surface 1). A pure, non-mutating sort
// over a copy (the read-model is shared — never sort it in place).
export function historyOrder(runs) {
  if (!Array.isArray(runs)) return [];
  return [...runs].sort((a, b) => (isNewer(a, b) ? -1 : isNewer(b, a) ? 1 : 0));
}

// --------------------------------------------------- the run-state chip -------

// The fixed run-state ramp (DESIGN surface 2 / documented-default 1) — colour AND
// label always travel together, a pulse for `running`, a ✓ for `done`. One source
// emits this for BOTH the current-run strip and the history rows (the status.tsx
// one-source pattern). `token` names a THEME token (muted/primary/destructive/
// secondary — ui/src/index.css), never a hex; `mark` is the chip's distinguishing
// motion/glyph. Deliberately a DIFFERENT primitive (dot+label) from the
// item-status glyph-ring, so the two ramps are never confusable.
const CHIP_RAMP = {
  queued: { label: "queued", token: "muted", mark: "none" },
  running: { label: "running", token: "primary", mark: "a pulsing dot" },
  done: { label: "done", token: "primary", mark: "a ✓" },
  failed: { label: "failed", token: "destructive", mark: "none" },
  cancelled: { label: "cancelled", token: "secondary", mark: "none" },
};

const UNKNOWN_CHIP = { label: "unknown", token: "muted", mark: "none" };

// The chip descriptor for a run state. An unknown/absent state falls back to the
// quiet muted form (never throws — a forward-compatible read of a future state).
export function runStateChip(state) {
  return CHIP_RAMP[state] ?? UNKNOWN_CHIP;
}

// ----------------------------------------------------- the rerun verb ---------

// The rerun's verb resolution (ARCHITECTURE 21/ADR-002): m21 ships the FRESH path
// — the affordance resolves, for the selected ref, to a fresh `work:run-start`
// run. PURE (ref in, descriptor out). m20's resume verb is a later additive delta
// that slots into the same affordance (mode would become "resume") with no change
// to this resolver's shape or the launch mechanism. Note: this resolves the VERB;
// the launch reaches the agent as typed PTY input via the existing runAgent →
// TerminalDock path (the board writes nothing, shells out nothing).
export function rerunVerb(ref) {
  return { command: "work:run-start", ref, mode: "fresh" };
}

// ----------------------------------------------- the disabled predicate -------

// The rerun is disabled exactly when the item has a run IN FLIGHT — a
// non-terminal (queued|running) run exists (DESIGN surface 3). This is the UI
// making the run-store's own "one run at a time" dedup guard visible from the
// read-model (a second non-terminal mint is rejected duplicate-run, 20/ADR-006).
// queued is reserved for m20 but the predicate covers it forward-stably. PURE
// over the runs array.
export function isInFlight(runs) {
  return Array.isArray(runs) && runs.some((run) => NON_TERMINAL.has(run.state));
}
