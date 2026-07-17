---
type: story
number: 03
slug: shatter-emits-spike
title: "Shatter emits spike drivers — de-risk chunks as roadmap-level investigations"
parent: 37
status: done
owner: product-owner
created: 2026-07-09
updated: 2026-07-10
schema: 1
aofVersion: 0.1.0
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
-->
# 03 · Shatter emits spike drivers

## User story

As a product owner shattering a PRD into a roadmap,
I want `aof:shatter` — which frames a PRD's deliverable chunks into milestones as it does today — to
*also* frame a `spike` driver when a chunk is a blocking unknown to de-risk *before* committing to a
milestone, wiring that milestone's backward-only `depends` to the spike,
so that roadmap-level investigations land as first-class, ordered drivers instead of being force-fit
into a milestone or dropped off-book. (Shatter keeps framing milestones; it does **not** frame `chore`s.)

<!-- Added at refine (user direction). Sibling skill file only (`.claude/commands/aof/shatter.md`);
     touches NO src/work.mjs. Reuses story 01's SPIKE.md template exactly as shatter reuses the milestone
     SPEC template today.
     ALTITUDE: shatter's spike is a top-level de-risk DRIVER a milestone depends on — distinct from
     aof:refine's in-milestone `aof-researcher → RESEARCH.md` (an unknown resolved *within* one milestone).
     Shatter emits a spike only when the unknown is big enough to gate a milestone.
     SCOPE: spike ONLY — shatter does NOT emit `chore`. Housekeeping is discovered *during* work and
     created ad-hoc via `aof:add-chore`; it does not fall out of shattering product strategy (ADR-004). -->

## Tasks

- [x] `tasks/00_shatter-frames-spike.feature` — given a PRD whose seam surfaces a blocking unknown that
  must be resolved before a milestone, `aof:shatter` frames a `NN_spike_<slug>` driver (from the
  `SPIKE.md` template) rather than folding the unknown into a milestone; wires the dependent milestone's
  backward-only `depends` to it; the spike is not broken into stories; the roadmap validates green.
  *(@manual → skill behaviour, verified at `aof:verify`; implemented in `shatter.md` per ADR-004.)*

## Notes

- **Depends: 00, 01** (parallel to 02). Needs the vocabulary + spike as a valid `depends` target
  (story 00) and the `SPIKE.md` template shatter frames from (story 01). Per ADR-001/ADR-004.
- **Spike only — no chore emission.** Consistent with shatter's existing guardrails: *frame, don't break
  down* (a spike groups no stories — ADR-001), *depends authored here, backward-only*, *acyclic + validate
  before finishing*.
