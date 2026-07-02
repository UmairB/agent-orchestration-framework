---
doc: retrospective
milestone: "20"
slug: autonomous-run-resilience
created: 2026-06-30
---
<!--
  Milestone RETROSPECTIVE.md — answers ONE question: what did HOW we executed teach us?
  Distilled at Accept (aof:verify) / backfilled by aof:retrospective. One R<n> per lesson, APPEND-only —
  never renumber. References VERIFICATION @finding-<id> / ADR / commit; never restates them.
  Lessons graduate into memory (aof work memory ingest) so the next milestone's refine/continue recall them.
-->
# 20 · Autonomous Run Resilience — Retrospective

## R1 — Adding a guard to a shared spine seam silently invalidates the PRIOR-milestone tests of that seam — enumerate them in the ADR's consequences, the same way `19/R1` enumerated registry gates

- **Kind:** near-miss · **Area:** architecture · **Stage:** build · **Owner:** architect · **Raised by:** developer (build)
- **What happened.** ADR-006's dedup guard ("no duplicate non-terminal run per item") makes the store
  reject a second `startRun` while a run is in flight. That tightened the mint contract and broke several
  **milestone-19** tests that minted multiple CONCURRENT running runs on one item — the derived-log `startN`
  helper, `run-store-record`, the CLI-face + `run-commands` ambiguous-run / run-status cases, and the two
  m19 arch-tests `acd-run-partition-ready` / `acd-run-record-derived`. The architecture cited `19/R2b` but
  did not flag that *landing* the dedup guard requires reworking those existing m19 tests.
- **Why.** A new store guard that tightens a mint/transition contract on a shared spine seam silently
  invalidates prior-milestone tests that exercised the *looser* contract. The ADR reasoned about the new
  behaviour and missed the existing tests of the same seam — the mirror image of `19/R1`, where the gap was
  the registry gates a new command *arms* rather than the tests a new guard *breaks*.
- **Lesson.** When an ADR adds a guard to a shared spine seam (`run-store.mjs`, `work.mjs`, the command
  core), enumerate the EXISTING tests of that seam — across milestones — as part of the ADR's consequences,
  exactly as `19/R1` enumerated the registry-derived gates. Resolved cleanly in the build by terminal-izing
  between mints (so "many runs per item" is now over the item's lifetime, not concurrent) and writing the
  genuinely-multiple-running-run fixtures (the defensive `ambiguous-run` guard) directly as records.
- **Refs:** STATE §Feedback (dedup cross-milestone test cost); ADR-006; `19/R2b`; `acd-run-partition-ready`
  / `acd-run-record-derived`; [[aof-acd-project]].

## R2 — An ADR that freezes a state-carrying key AND classifies it must also name the PRODUCER that SETS it — a frozen+classified key with no writer is a contract hole the Three Amigos catch late

- **Kind:** near-miss · **Area:** architecture (contract) · **Stage:** refine · **Owner:** architect · **Raised by:** developer (Three-Amigos feasibility, Contract stage)
- **What happened.** ADR-001 froze `failureReason` as a run-record key and ADR-002 built the closed
  classification table over it, but **no ADR named who SETS** `timeout` / `agent_error` on a failed run
  (ADR-004 named only the reclaim path's `runtime_offline`). Five task features depend on a failed run
  carrying a reason. The gap surfaced only at the Three-Amigos feasibility check, after the contracts were
  otherwise authored.
- **Why.** Freezing a key and classifying its values *reads* as complete — but a control field the store
  branches on is only complete when its full lifecycle is specified: who writes it, where, and on which
  transition. The producer is the easiest half to assume "obvious" and the easiest to leave unwritten.
- **Lesson.** When an ADR freezes a key the store reads/branches on AND defines its value space, name its
  PRODUCER in the same (or a paired) ADR — the write path and the transition that sets it — not just its
  shape and its classification. Taken in-build as a documented, reversible default (the producer split:
  store half `completeRun`/`applyTransition` writes it on `→ failed`; command half `work:run-complete
  --reason`). It proved durable — shipped and verified green — and is now ratified as **ADR-009**.
- **Refs:** STATE §Notes (the `failureReason`-producer DEFAULT DECISION); ADR-001 / ADR-002 / ADR-004 /
  ADR-009; `04_run-complete-reason.feature`.

## Carried (deferred, non-blocking) — for the backlog, not lessons in HOW we executed

The three MINOR review findings (VERIFICATION `@finding-F-20-01/02/03`) are deferred enhancements, each
low-severity and non-blocking — they did not change how this milestone executed and are routed to the
backlog: a registry-wide "only `rollbackItemStatus` writes a record-doc status" guard (broadening the
family-grep beyond `work.mjs` + `run-*`, F-20-01); an `@executable` scenario pinning the no-`--reason`
preserves-prior-`failureReason` branch (F-20-02); and a one-line state guard on `heartbeat` so a terminal
run cannot be beaten (F-20-03). None is a design-gap; none blocks acceptance.
