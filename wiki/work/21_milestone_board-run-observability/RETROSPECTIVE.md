---
doc: retrospective
milestone: "21"
slug: board-run-observability
created: 2026-06-30
---
<!--
  Milestone RETROSPECTIVE.md — answers ONE question: what did HOW we executed teach us?
  Distilled at Accept (aof:verify) / backfilled by aof:retrospective. One R<n> per lesson, APPEND-only —
  never renumber. References VERIFICATION @finding-<id> / ADR / commit; never restates them.
  Lessons graduate into memory (aof work memory ingest) so the next milestone's refine/continue recall them.
-->
# 21 · Board Run Observability — Retrospective

A clean build (no blocker stop, no early halt) over an already-registered foundation. The recall→build loop
paid off explicitly: `19/R1` (a command surfacing trips EVERY registry-derived guard) was predicted in
ARCHITECTURE ADR-001 and honoured in the build — the `acd-work-command-route-coverage` carve-out dropped
`run-status` AS WELL AS the `acd-board-write-isolation` EXTEND, exactly as `19`'s retrospective foretold the
carve-out would "come out when milestone 21 wires the board routes." The lessons below are the residue worth
carrying forward.

## R1 — A DESIGN that promotes a foundation-schema field to a user-facing "ordinal" must confirm the foundation's semantics actually produce the ascending value the rationale assumes

- **Kind:** near-miss · **Area:** design · **Stage:** verify (rendered review) · **Owner:** designer · **Raised by:** verify (F1)
- **What happened.** DESIGN surface 1 leads each history row with `#attempt` and sells it as "the
  human-meaningful ordinal the operator counts by" (example `#5`), implying it ascends across an item's runs.
  But the m19/m20 schema defines `attempt` as **retry-lineage depth** — a fresh `work:run-start` is always
  `attempt: 1`, and only `work:run-retry` increments. m21's `↻ Rerun` resolves to a **fresh** start, so the
  board's own rerun workflow renders an all-`#1` history; the bold leading token never ascends until m20's
  resume verb lands.
- **Why.** The design borrowed a field from the consumed foundation and attached a UX rationale ("count by
  it") without re-deriving what the field's *producer* semantics actually emit on the path the milestone
  ships. The render is faithful; the rationale outran the data model.
- **Lesson.** When a DESIGN repurposes a foundation field as a user-facing ordinal/label, trace the
  producer: does the verb this milestone ships actually move that field the way the rationale claims? If not,
  either pick a field that does (a list position, the `sess·…` + time the row already carries), or scope the
  claim to the verb that increments it (here: "ascending attempts read once m20's resume lineage lands").
  Reconcile in `DESIGN.md` before the next render. Non-blocking — logged as F1, routed to `aof-designer`.
- **Refs:** VERIFICATION `@finding-F1`; DESIGN surface 1 + documented-default 6; `src/run-store.mjs`
  (`startRun` attempt 1 / `retryRun` attempt+1); `ui/src/board/runs.mjs` (`rerunVerb` mode `fresh`).

## R2 — A new live/polled signal added beside an existing sync-gated one must share the poll cadence, or the surface shows inconsistent freshness

- **Kind:** near-miss · **Area:** code · **Stage:** continue (craft review) · **Owner:** developer · **Raised by:** craft review
- **What happened.** The lane-card in-flight dot first rode the m03 sync-only board list (refreshed only on
  the board-list sync), while the RUNS tab polled `/api/work/run-status` every 5s — so the same active-run
  signal was live in the panel but stale on the lane card. Fixed by re-probing the dot on the same
  observability cadence (`Board.tsx` `RUNNING_PROBE_MS`), live everywhere without touching the read-mostly
  board-list refresh.
- **Why.** Reusing an existing render path (the sync-gated board list) for a *new* live signal silently
  inherits that path's refresh cadence — which was right for the read-mostly list and wrong for an
  active-run indicator. Two freshness models on one surface read as a bug even when each is internally
  correct.
- **Lesson.** When you add a "what's happening right now" signal, give it the cadence of the thing it
  reflects (the poll), not the cadence of the surface you hung it on. Probe the live signal on its own
  observability tick, scoped/read-only so it doesn't drag the read-mostly refresh with it.
- **Refs:** STATE §Feedback (craft-review observation); `ui/src/board/Board.tsx` (`RUNNING_PROBE_MS` probe);
  DESIGN documented-default 3 + surface 2b.

## R3 — A fixed-width panel has a cumulative width budget; adding a tab/element can clip an existing one — only the rendered design review catches it, never the @executable suite

- **Kind:** near-miss · **Area:** design · **Stage:** continue (rendered design review) · **Owner:** designer/developer · **Raised by:** design review (rendered)
- **What happened.** Adding the 5th milestone tab (RUNS) overflowed the fixed ~382px detail panel and
  clipped the trailing `Findings` tab. The `@executable` suite was fully green throughout — the clip is a
  pixel-budget fact invisible to headless tests. Fixed by tightening the tab row (`gap-2.5`, 11px, `px-3`)
  + `overflow-x-auto` so the row scrolls rather than hard-clips.
- **Why.** A green `@executable` suite proves behaviour, not layout fit; a new element in a fixed-width
  container competes for a finite width budget the litmus deliberately keeps out of the `.feature`. The
  rendered review is the only lane that measures it.
- **Lesson.** When a milestone adds to a fixed-width surface (a tab, a strip, a badge), treat the rendered
  design review as load-bearing, not a formality — it is the only gate that sees the width budget. Two
  residual cosmetics were *deliberately accepted*, not fixed: the Current-run strip's `⟳ refreshed`
  affordance wraps to its own line at 382px when the disabled hint is present (acceptable `flex-wrap`), and
  the `running`/lane-dot **pulse** is a motion state only judgeable live (rides the `@uat` visual review).
- **Refs:** STATE §Feedback (design-review finding, resolved); `ui/src/board/DetailPanel.tsx` (tab row);
  ARCHITECTURE — green @executable ≠ design fidelity (the verify litmus).

## R4 — Pure read-model helpers need explicit headless assertions for ordering, tie-breaks, non-mutation of the shared model, and unknown-state forward-compat — the happy path under-tests all four

- **Kind:** near-miss · **Area:** contract/test · **Stage:** continue (QA hardening) · **Owner:** QA · **Raised by:** QA
- **What happened.** The first cut of the pure `runs.mjs` helpers + their tests asserted the happy path; QA
  flagged four headless gaps and they were added: the newest-first `historyOrder` **and that it does not
  mutate the shared read-model** (sorts a copy), the `selectCurrentRun` `createdAt` tie-break (total order
  via `runId`), and the unknown-state forward-compat fallback for both the chip ramp and the in-flight
  predicate.
- **Why.** A pure mapping's "obvious" test is the in-vocabulary happy case; the load-bearing properties —
  stable ordering, a deterministic tie-break, not mutating a shared array, and tolerating a future state —
  are exactly the ones a happy-path example omits (the same shape as `19/R4`: assert the invariant that must
  NOT change, not only the targeted outcome).
- **Lesson.** For a pure read-model helper, make the test matrix pin: ordering + a tie-break for a total
  order, non-mutation of any shared input, and a forward-compatible fallback for an unknown/future enum
  value. Bake these as default rows when the helper feeds a render, don't wait for the QA pass to surface
  them.
- **Refs:** STATE §Feedback (QA-hardened the @executable suite); `ui/src/board/runs.mjs`
  (`historyOrder`/`selectCurrentRun`/`runStateChip`/`isInFlight`); `test` suite `board-runs/00`+`01`;
  cf. `19/R4`.
