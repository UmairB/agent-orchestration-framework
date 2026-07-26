---
type: milestone
number: 02
slug: planning-init
title: "Planning Init (the bought seam)"
status: done
owner: product-owner
created: 2026-06-16
updated: 2026-06-19
schema: 1
aofVersion: 0.1.0
---
# 02 · Planning Init (the bought seam)

## Objective

Stand up the bought planning seam: `aof planning init` installs the pm-skills planner and records
pinned-sha provenance, so a PRD can be produced upstream and shattered into milestones downstream —
without aof owning the planning method.

## Scope

In scope:
- `aof planning init` — register the marketplace, install the recommended pm-skills plugins, write a
  provenance manifest (source / sha / plugins).
- Confirm the `aof:shatter` seam consumes the resulting `PRD-*.md` (shatter itself is already authored).
- **Unified project lock (PO decision, 2026-06-19).** `.aof/aof.lock.json` is the single authoritative
  lock for ALL of a project's pinned dependencies/state; per-vertical lock files are eliminated. Both
  the planning provenance (was `aof.planning.lock.json`) and the work-bundle manifest (was
  `aof.work.lock.json`) move into named sections of the one lock, and every writer preserves the
  sections it does not own. Supersedes ADR-003 (planning) and milestone 01's separate-work-lock
  decision (m01-ADR-004). Owned by the new cross-cutting story `02_story_unify-project-lock`. The user chose to fold
  the work-lock vertical in here (rather than defer it), accepting that it reopens milestone 01's
  accepted surface (`work init/update` + its install-manifest fitness function).

Out of scope: the planner's internals (bought, not owned); delivery (00 / 01).

## Stories

Stories 00 and 01 are **independent** (story 01 runs against a PRD fixture, not story 00's output — see
[ARCHITECTURE.md](ARCHITECTURE.md) breakdown). Story 02 is a cross-cutting lock refactor added 2026-06-19;
it layers on 00 (and milestone 01's work-init), so it is sequenced after them, not run in parallel.

- [x] `00_story_planning-init` — `aof planning init`: register the marketplace pinned to a commit sha,
  install the recommended pm-skills plugins via the runtime plugin CLI, write the provenance manifest.
- [x] `01_story_shatter-consumes-prd` — confirm the seam: `aof:shatter` discovers + consumes a
  `PRD-*.md` (objective/scope/milestone-chunks) and stamps each milestone's `origin` back to it.
- [x] `02_story_unify-project-lock` — collapse the per-vertical lock files (`aof.planning.lock.json`,
  `aof.work.lock.json`) into named sections of the single `.aof/aof.lock.json`; every writer preserves
  foreign sections. Supersedes ADR-003 + milestone 01's work-lock decision (m01-ADR-004).

## Dependencies

- None — the planning seam is independent of the delivery CLI.
