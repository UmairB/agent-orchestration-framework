// The pure assignment-chip helper (milestone 35 / story 03 / task 01;
// DESIGN.md §4 — the assignment lifecycle ramp table). A framework-free ESM
// module — no React, no DOM, no I/O, no clock — the assignment-family SIBLING
// of ui/src/board/runs.mjs's `runStateChip`/`CHIP_RAMP` (runs.mjs:90-104): it
// maps an assignment row's `state` to a FIXED chip descriptor
// `{ label, token, mark, motion }`, mirroring the run-state ramp so the fleet
// speaks ONE chip vocabulary. `token` names a THEME token (muted/secondary/
// primary/destructive — ui/src/index.css), resolved through the SAME
// `runChipClasses(token)` map the board uses (Fleet.tsx) — never a hex, never a
// fleet-local palette.
//
// SEAM SPLIT — this module is the PURE mapping only. WHERE the chip renders
// (attention row / node row) and that it LOOKS right is the @uat visual review
// (task 03, deferred to aof:verify). The read SHAPE that feeds this helper is
// task 00 (src/global-mesh-query.mjs's `shapeGlobalStatus`, the `assignment`/
// `assignments` field it attaches to item/node rows). The no-write posture is
// task 02.
//
// Prior-lesson discipline honoured here (from work memory recall at build
// time): 34/ADR-008 "degraded states must stay visible" — a reclaimed/stale
// assignment MUST render as failed + a `· reclaimed` note, never vanish or
// silently revert to "assigned"; R4/m21 "a pure read-model helper needs
// explicit headless coverage of unknown-state forward-compat, not just the
// happy path" — the unknown/absent-state fallback below is asserted directly
// by the sibling test file (never throws, degrades to the quiet muted chip).

// The fixed assignment ramp (DESIGN §4) — colour AND label ALWAYS travel
// together; ONLY `running` carries motion (`animate-pulse` on the chip dot).
// The progression assigned -> accepted -> running climbs the SAME brightness
// ramp the run chip uses (muted -> secondary -> teal/primary); `done` reuses
// teal + a ✓ byte-for-byte from the run chip's `done`; `failed` reuses
// `destructive` byte-for-byte and uses a `!` mark (not a bare dot) so it is
// distinguishable at a glance while still travelling with its red token and
// its `failed` label.
const ASSIGNMENT_CHIP_RAMP = {
  assigned: { label: "assigned", token: "muted", mark: "a hollow dot", motion: "none" },
  accepted: { label: "accepted", token: "secondary", mark: "a filled dot", motion: "none" },
  running: { label: "running", token: "primary", mark: "a pulsing dot", motion: "pulse" },
  done: { label: "done", token: "primary", mark: "a ✓", motion: "none" },
  failed: { label: "failed", token: "destructive", mark: "a !", motion: "none" },
};

// A withdrawn assignment is terminal and operator-created (ADR-001) — NOT a
// reclaim. It reads with the SAME failed token/label (a stopped dispatch reads
// as not-succeeded) but carries no trailing "reclaimed" note.
const WITHDRAWN_CHIP = { label: "failed", token: "destructive", mark: "a !", motion: "none" };

// The reclaimed/stale degraded chip (DESIGN §4 note) — NOT a sixth colour: it
// is the SAME `failed` chip (destructive `!` + `failed` label) plus a trailing
// mono `· reclaimed` note, so a worker that dropped an assignment mid-flight
// surfaces as a red, labelled, NOTED failure — never a silent reversion to
// "assigned" and never a vanished chip.
const RECLAIMED_NOTE = "reclaimed";

// An unknown/absent/future state falls back to the quiet muted form (never
// throws — a forward-compatible read of a state the render layer has not
// learned yet), mirroring runStateChip's UNKNOWN_CHIP fallback verbatim.
const UNKNOWN_CHIP = { label: "unknown", token: "muted", mark: "none", motion: "none" };

// assignmentChip(row) — the pure state -> chip descriptor mapping. `row` is
// whatever assignment object the read shape attached (task 00's `assignment`/
// `assignments[i]` field) — this helper reads ONLY `.state` and `.reclaimedAt`
// off it and never mutates it. PURE over the row it is given: a keep-last-good
// caller (a silent poll error handing this the last-good row) gets back the
// SAME descriptor every time — there is no internal "loading"/"error" branch
// here at all, so a silent poll can never produce a torn/empty chip.
export function assignmentChip(row) {
  const state = row?.state;
  const reclaimedAt = row?.reclaimedAt ?? null;

  // A reclaimed OR stale state (with reclaimedAt set) degrades-visibly to the
  // failed chip plus the trailing "reclaimed" note — checked BEFORE the ramp
  // lookup so it can never be shadowed by a coincidental ramp entry.
  if ((state === "reclaimed" || state === "stale") && reclaimedAt) {
    return { label: "failed", token: "destructive", mark: "a !", motion: "none", note: RECLAIMED_NOTE };
  }

  if (state === "withdrawn") {
    return { ...WITHDRAWN_CHIP };
  }

  const ramp = ASSIGNMENT_CHIP_RAMP[state];
  if (!ramp) return { ...UNKNOWN_CHIP };
  return { ...ramp };
}

// assignmentSummary(rows) — the SECONDARY node-side projection (DESIGN §2b): a
// compact per-state tally of the assignments a node HOLDS, e.g.
// `[{ state: "running", count: 2 }, { state: "failed", count: 1 }]`. Reclaimed/
// stale rows fold into the "failed" bucket (the SAME degrade-visibly rule the
// chip applies) so a degraded dispatch is visible in the worker's tally too,
// never a silent seventh bucket. PURE, non-mutating; an empty/absent `rows`
// yields an empty array — the caller (NodeCard) OMITS the summary line
// entirely on an empty result ("absent, not false" — never "0 assignments").
const SUMMARY_STATE_ORDER = ["running", "accepted", "assigned", "done", "failed"];

export function assignmentSummary(rows) {
  const counts = new Map();
  for (const row of rows ?? []) {
    const chip = assignmentChip(row);
    const bucket = chip.label;
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  const ordered = [];
  for (const state of SUMMARY_STATE_ORDER) {
    if (counts.has(state)) {
      ordered.push({ state, count: counts.get(state) });
      counts.delete(state);
    }
  }
  // Any bucket outside the known order (forward-compat "unknown") still
  // surfaces, appended after the known ramp — never silently dropped.
  for (const [state, count] of counts) ordered.push({ state, count });
  return ordered;
}
