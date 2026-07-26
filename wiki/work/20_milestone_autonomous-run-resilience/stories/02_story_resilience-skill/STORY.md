---
type: story
number: 02
slug: resilience-skill
title: "The hardened autonomous loop — autonomous.md consumes the resilience commands"
parent: 20
status: done
owner: product-owner
created: 2026-06-30
updated: 2026-06-30
schema: 1
aofVersion: 0.1.0
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH.
-->
# 02 · The hardened autonomous loop — the skill consumes the resilience commands

## User story

As the operator running `aof:autonomous` unattended over a multi-hour cascade,
I want the loop to reclaim orphaned runs at restart, auto-retry-resume on an infra failure (and start fresh on a rejection), and skip self-triggering multi-agent hand-offs — all within the **unchanged** stop set,
so that a cascade that crashes, stalls, or wedges is detectable and self-healing rather than silently stuck, while still handing back only on a genuine human gate.

<!-- This story makes aof:autonomous CONSUME story 01's commands: it adds the resilience calls (reclaim at
     restart, retry-resume on infra failure, the anti-loop guidance) within the EXISTING loop and the
     EXISTING stop set (ADR-008 — no new stop). It is skill-layer (markdown) judgment — the 11 prompt-wiring
     altitude — so it owns NO fitness function; it is asserted by review + a story .feature. -->

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 20 --autonomous`, Contract stage, 2026-06-30 — PO
     headline scenarios inline, `aof-qa` case-matrix audit + `aof-developer` feasibility check). The
     behaviours are `@manual` (skill-prose wiring is judgment, the 11-altitude); this story owns NO fitness
     function (ADR-006/008), so it has no arch-test in its list — asserted by review + agent-observed
     evidence in VERIFICATION.md. -->

Authored task `.feature`s (all `@manual` — agent-observed: read `autonomous.md` + drive a fixture):

- [ ] **[00 · retry-resume-and-reclaim](tasks/00_retry-resume-and-reclaim.feature)** (ADR-003/004/006) — the loop reclaims orphaned runs at restart, resumes-on-infra via `work:run-retry`, starts-fresh-on-rejection via `work:run-start`, and asks the store which path (never re-derives the table); the wiring lands in the bundle source.
- [ ] **[01 · ceiling-and-unchanged-stops](tasks/01_ceiling-and-unchanged-stops.feature)** (ADR-002/008) — the ceiling feeds the EXISTING `maxAttempts exhausted` stop; reclaim/rollback recover (never stop); the `<stop_conditions>` set is exactly the existing five, no sixth.
- [ ] **[02 · anti-loop](tasks/02_anti-loop.feature)** (ADR-006 skill side) — the loop skips self-triggering hand-offs using the recorded lineage/`brief.initiator` facts; a genuine hand-off proceeds; a slipped self-trigger is the store's dedup backstop (the loop treats it as in-loop).

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md). This story **owns**
[src/bundle/commands/autonomous.md](../../../../../src/bundle/commands/autonomous.md) (and its generated copy
under `.claude/commands/aof/`): it wires the loop to CALL story 01's `work:run-retry` (retry-on-infra-failure
within the existing `maxAttempts` loop), to invoke story 00's reclaim scan at restart, and to apply the
**anti-loop guidance** — the cascade's multi-agent hand-offs skip self-triggers, using the run lineage /
`brief.initiator` the store records as the signal (**ADR-006**, skill side). The skill provides the POLICY;
the store provides the FACTS. Per **ADR-008** it adds **NO new stop condition** — its `<stop_conditions>`
set is unchanged; resilience makes the existing stops (`@uat`, blocker, unsafe ambiguity, `maxAttempts`
exhausted) RELIABLE, it does not add new ones.

**Independent because** it depends ONLY on story 01 (the registered commands it drives) — the last edge of
the single forward chain. It is skill-layer markdown above the command core; it couples DOWN to the
registered commands, never sideways into the store. Because it touches no `.mjs` mechanic and registers no
command, it owns **no fitness function** — anti-loop POLICY and the no-new-stop CONFORMANCE are skill-layer
judgment (the `11` prompt-wiring altitude), asserted by structural/behavioural review + a story `.feature`,
not an arch-test.

**Sequencing:** build last (00 → 01 → 02). The skill is only meaningful once `work:run-retry` and the
reclaim/rollback paths exist for it to call.
