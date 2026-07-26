---
type: milestone
number: 42
slug: structural-overhaul
title: "Structural overhaul — one home, one door, no silence"
status: not-started
owner: product-owner
created: 2026-07-26
updated: 2026-07-26
schema: 1
aofVersion: 0.1.0
---
<!--
  Milestone SPEC.md — the record doc. Answers ONE question: why + scope of this milestone.
  Owner: product-owner. A milestone GROUPS stories and holds their shared context
  (ARCHITECTURE / DESIGN / RESEARCH / UAT live in this folder too, conditionally).
  Does NOT contain: a per-story user story (→ each STORY.md) or acceptance criteria (→ task .feature).
-->
# 42 · Structural overhaul — one home, one door, no silence

## Objective

Pay down [TECH_DEBT.md](../TECH_DEBT.md) in full — item 0 (the umbrella) and its symptoms 1–7 — by
**redesigning the subsystems that produce the defects, not by patching where they surface**. The
codebase grew by accretion: 41k lines across 147 files in which the same fact is derived in many
places (workspace identity: 17 call sites), the same act has several doors, failure is handled by
43 empty catches, and a third of the source is prose narrating past bugs that keep recurring anyway.
The operator's direction is explicit: a rewrite that yields a robust, stable product is preferred
over further adhoc fixes — adhoc fixes are what produced this state.

The stance, per subsystem touched: **rewrite it to a designed shape, then delete what the design
retires.** Deletion is a first-class deliverable — the re-derivations, the scar comments, the
redundant doors. The one constraint on ambition is the live two-machine soak: a single big-bang
rewrite cannot be verified against a running system, so the overhaul lands as ordered, individually
verifiable rewrites (sequencing below), each leaving the soak running.

An outsider can verify the milestone was met without reading any diff:

- **No silent failure.** Zero empty `catch` bodies in `src/`, enforced by an armed fitness function;
  every degrade path emits a coded event to a real sink (debt items 0, 3).
- **Daemons are observable.** Every long-running process writes rotating JSONL to
  `~/.aof/mesh/logs/`, and `aof mesh logs [--follow] [--node <id>]` reads it — including for a
  remote worker (item 2).
- **One home per fact.** Workspace identity is owned by one module with one rule; a repo has the
  same id on every machine; the projections carry a migration for the duplicate ids already stored
  (items 0, 4). The 17 independent `workspaceIdFor` derivations are deleted, not wrapped.
- **One door per act.** Continue / refine / verify / run each have exactly one issuance path with
  the routing decision inside it; board, fleet, and CLI are transports over that door
  (`work:continue` is the proven pattern) (item 0).
- **The build is honest.** A running daemon can state which build it is (`aof mesh status`); the
  soak-loop deploy is restart-not-rebuild (JS payload beside the launcher, SEA reserved for release
  artefacts); stale `.bak` binaries are pruned to the last N (item 1).
- **Green means green.** The arch suite runs at zero standing failures — dead tests repaired or
  deleted, derived counts instead of hard-coded ones — so it gates again (item 5).
- **The board only asserts what it can evidence.** Streamed items resolve their docs, runs, and a
  live console over the fabric — or the board states plainly that the content lives on the worker
  node; no dead-end resolution errors (item 6).
- **A restarted worker reclaims its own stranded runs** before accepting new work, and reports the
  reclaim (item 7).
- **The history lives in the design, not the margins.** A measured, substantial reduction of the
  1,670 scar markers and the 31% comment ratio: each retired workaround takes its narration with it
  (item 0).

## Scope

In scope:

- **Wave (a) — stop the bleeding** (debt items 2, 3, 5): a real log sink + `aof mesh logs`; the
  no-empty-catch fitness function and the sweep that makes it pass; the arch suite repaired to zero
  standing failures. Without these no later rewrite can be verified.
- **Wave (b) — one home, one door** (items 0, 4, 6, 7): a single workspace-identity module +
  cross-machine id unification with a projection migration; the one-door issuance seam extended from
  `work:continue` to refine/verify/run; the board's drill-downs (docs, runs, console) ride the
  worker projection or degrade honestly; worker startup run-reclaim.
- **Wave (c) — the honest build** (item 1): launcher/payload decoupling for the dev/soak loop,
  build id stamped and visible at runtime, `.bak` pruning; SEA kept only as the release artefact.
- **The deletion pass** (item 0): retire scar comments, dead fallbacks, and duplicate derivations
  made obsolete by the waves above — measured before/after.
- **Regression cover for every rewrite**: each rewritten seam lands with the fitness function that
  stops its defect class recurring, in the existing `test/arch/acd-*` convention.

Out of scope:

- **A big-bang from-scratch rewrite of the repo** — explicitly rejected: the system is a live
  two-machine soak and an unverifiable cut-over would recreate the flakiness this milestone exists
  to end. The rewrite is total in ambition, staged in execution.
- **New product features** — no new commands, surfaces, or capabilities beyond what the
  consolidation itself requires; feature work resumes on a stable base.
- **Release/distribution pipeline redesign** — the SEA remains the release artefact; only the
  dev/soak deploy loop changes (item 1's fix). Packaging, signing, auto-update: deferred.
- **Mac/Windows installer parity** — item 1 removes the *silent divergence* (a stale build must be
  visible); making the two platforms deploy identically is a separate effort.
- **Prose cross-reference rewriting in wiki docs** — the deletion pass targets `src/`; historical
  narrative in record docs stays (it is the record).

## Stories

<!-- The stories that compose this milestone. Each is its own NN_story_<slug> item with parent: 42.
     Populated at the Break-down stage (refine); "to be broken down" until then. The milestone is
     accepted when all its stories are. -->

To be broken down — `aof:refine 42`. Break-down guidance: partition along the waves above; wave (a)
stories are the verification substrate and must land first; waves (b) and (c) each contain
independently landable rewrites; every story leaves the two-machine soak running and
`aof work validate` green.

## Dependencies

- **[TECH_DEBT.md](../TECH_DEBT.md)** — the evidence base: each debt item carries the measurements
  (2026-07-26 soak) that define this milestone's before/after.
- **`work:continue` (m27, feat/issuance-routing branch)** — the proven one-door pattern that wave
  (b) generalises to refine/verify/run.
- **The live two-machine soak (m38, cross-machine worker execution)** — the acceptance environment;
  every stage is verified against it, and must not stop it.
- **`test/arch/acd-*` fitness convention** — the enforcement mechanism for the new invariants
  (no-empty-catch, one identity home, CLI↔bundle parity); requires wave (a)'s zero-failure baseline
  to gate anything.
