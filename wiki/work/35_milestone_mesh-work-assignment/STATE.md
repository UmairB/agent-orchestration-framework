---
doc: state
---
<!--
  Milestone STATE.md — where are we, and what happened? Compacted at Accept: durable decisions
  graduated to the ADRs (ARCHITECTURE.md); the blow-by-blow + the retro Feedback notes archived
  (the lessons graduated to RETROSPECTIVE.md R1–R6). This is the closure record.
-->
# 35 · Mesh Work Assignment — State

## Status: DONE — accepted `2026-07-09` (`aof:verify 35`)

Delivered the **dispatch direction** of the control↔worker relationship (milestone 34 gave the observe
direction). An operator on the control node assigns a resolvable work ref to a named worker
(`aof mesh assign <ref> --to <nodeId>` / `--withdraw`), recorded as a first-class `global_assignments`
row in the milestone-34 store; the control launcher dispatches it as a targeted directive down the ONE
m34 WebSocket to the admitted peer; the worker auto-accepts within the tailnet boundary, materializes
the ref in a **dedicated git worktree** keyed by `assignmentId`, drives it through a node-partitioned
run, and streams `assigned → accepted → running → done/failed` back up; the read-only fleet UI renders
the lifecycle on the 5s poll. A dead worker's assignment is `reclaimed` under dual-staleness by the same
launcher tick. **No git-bus, no issuance-over-git** anywhere in the path — the retired m26/27 machinery
stayed retired (`acd-no-git-bus-return`).

## Closure record (compacted)

- **Framed** `2026-07-08` (operator order, immediately after m34 re-accept). **Refined + fully broken
  down** `2026-07-08` (`aof:refine --autonomous`) → ARCHITECTURE (ADR-001..007 + 12 fitness), SECURITY
  (RCE threat model + 5 security fitness), DESIGN (fleet binding checklist, no mock), RESEARCH
  (execution-driver + git-worktree reality); four independent stories (spine 00→01→02, UI 03 ∥ off 00).
- **Built + reviewed** `2026-07-09` (`aof:continue`). All four stories green. **Review caught the
  end-to-end blocker (B1+B2), found by BOTH architect and QA:** every seam was unit-proven but nothing on
  the control node invoked them — assign never called `dispatchDirective`, reclaim had no periodic caller.
  **Fix pass** authored **ADR-008** (the control-side dispatch/reclaim launcher tick, delegating the
  store-open to `runControlDispatchReclaimTick`) + **fitness #13** `acd-control-dispatch-reclaim-driver-wired`
  + two new `@executable` tasks (01/03, 02/06); also fixed the two Fleet.tsx design GAPs (re-judged
  CONFORMS). → the headline retro lesson **R1** (name the production driver, not just the seams).
- **Verified + accepted** `2026-07-09` (`aof:verify`): suite **2213/0**, all 13 milestone fitness
  functions green, `aof work validate 35` PASS; `@uat` design conformance **CONFORMS** (render + designer
  + operator sign-off) with the one design-gap **F-3501** (reclaimed-note-to-tooltip) **closed** by
  codifying the rule in DESIGN §2a/§4. The `@manual` two-machine soak (02/05) is a **deferred
  operator-run** environmental check (non-blocking, per the m34 precedent).

## Carried follow-ups (non-blocking)

- **Operator-run:** the `02/05` two-machine soak (Windows control ↔ macOS worker over Tailscale) — run
  the runbook, record the three latencies. See VERIFICATION `## Live / environmental checks`.
- **Recommended (backlog):** a 320px worst-case `@uat` scenario for the reclaimed chip (F-3501); an
  audit of the ~32 orphaned m22–26 arch-test bindings imported-but-never-spread in `scripts/test.mjs`
  (retro **R4**); a true per-node "holds this repo" store fact if a future story needs it (retro **R3**).

## Pointers

- Decisions → `ARCHITECTURE.md` (ADR-001..008), `SECURITY.md`, `DESIGN.md`, `RESEARCH.md`.
- Verify/accept + findings + sign-off → `VERIFICATION.md`. Process lessons → `RETROSPECTIVE.md` (R1–R6).

<!-- Archived at Accept: the refine/build blow-by-blow and the raw `## Feedback notes (for retro)`
     section — the lessons graduated to RETROSPECTIVE.md (R1–R6) and the decisions to the ADRs. -->
