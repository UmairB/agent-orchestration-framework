---
type: story
number: 01
slug: rerun-affordance
title: "The rerun affordance — ↻ Rerun re-launches the agent terminal (m03 ADR-006), resolving to work:run-start; the board writes nothing"
parent: 21
status: done
owner: product-owner
created: 2026-06-30
updated: 2026-06-30
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH.
-->
# 01 · The rerun affordance — run it again, from the board

## User story

As the operator watching an item's runs on the board,
I want a quiet `↻ Rerun` affordance that re-launches the agent on the item — resolving to the same registered `work:run-*` command the CLI would invoke — without the board itself triggering or recording the run,
so that I can re-run a failed or stale item in one click while the board stays read-mostly, and watch the new run appear in its history.

<!-- The ACTION half of milestone 21: the ↻ Rerun affordance (DESIGN surface 3) that reuses the existing
     m03 ADR-006 runAgent → TerminalDock launch (ARCHITECTURE ADR-002). It adds NO new board write and NO
     command-CLI shell-out; the verb (fresh `work:run-start`) reaches the agent as typed PTY input, and the
     resulting run shows up via story 00's poll. m20's fresh-vs-resume is a later additive delta. -->

## Tasks

<!-- Contract authored via Three Amigos at `aof:refine 21` (autonomous, Contract stage). PO wrote the
     headline Scenarios; QA the Examples tables; the developer checked feasibility against the real seams
     (the existing runAgent(ref, command) → TerminalDock launch in Board.tsx, the pure action.mjs
     primaryAction verb-resolution convention, and the run-store dedup guard behind "one run at a time"). -->

Authored `2026-06-30`:

- [x] `tasks/00_rerun-launches-terminal.feature` — the pure rerun verb-resolution (a fresh `work:run-start` for the selected ref; m20 resume is a later additive delta); `↻ Rerun` spawns/reveals the bound agent terminal and delivers the run verb as typed PTY input (no inline edit), and the @uat that the resulting fresh run appears via the next `/api/work/run-status` poll (the decoupled observe). *(@executable green: `board-runs-pure` rerun-verb outline; @manual/@uat → verify.)*
- [x] `tasks/01_rerun-disabled-while-running.feature` — the pure disabled predicate (in flight ⇔ a `queued|running` run exists); while running, `↻ Rerun` is greyed with the "a run is in progress" hint and stays visible-not-hidden, re-enables once terminal, and renders subordinate to the header's primary `▸ Run agent`. *(@executable green: in-flight predicate + unknown-state; @manual → verify.)*
- [x] **Fitness `acd-board-write-isolation`** (EXTENDED — rerun half, ARCHITECTURE fitness #1) — the rerun launch wiring adds no new `writeFile`/`appendFile` call site and no `child_process`/`spawn`/`exec` of a command CLI to the board; the board's only write stays the feedback bullet. **Green.**

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) (ADR-002 the read-mostly rerun) and [DESIGN.md](../../DESIGN.md) (surface 3). This story **owns**: the `↻ Rerun` affordance in `ui/src/board/DetailPanel.tsx` (the Current-run strip's button, subordinate to the primary `▸ Run agent`), its rerun-verb resolution alongside the existing `primaryAction` derivation in `ui/src/board/action.mjs`, and its wiring to the existing `runAgent(ref, command)` → `TerminalDock` launch in `ui/src/board/Board.tsx` (a new **caller** of an existing launch path, NOT a new mechanism) — plus the rerun half of `acd-board-write-isolation`.

**Independent because** its launch is the **independent** m03 ADR-006 terminal mechanism on the disjoint `/ws/terminal` namespace (03/ADR-001) — it needs no board HTTP route to spawn, and reuses the `runAgent` path that already exists. It depends on story 00 only for the read-model it observes the reran run through (a one-directional, fixturable, post-launch read), not for the launch itself. m20's fresh-vs-resume verb choice slots into the same affordance as a pure additive delta (ARCHITECTURE ADR-002) — no rework.
