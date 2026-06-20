---
type: story
number: 01
slug: install-proof
title: "Install proof — a fresh repo gets a real, complete ACD install"
parent: 4
status: done
owner: product-owner
created: 2026-06-20
updated: 2026-06-20
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH.
-->
# 01 · Install proof — a fresh repo gets a real, complete ACD install

## User story

As a developer adopting ACD in a brand-new repo,
I want `aof work init` to land a correct, complete ACD setup on the first run — the bundle members rendered, the unified lock's `work` section written to schema, and the work CLI verbs resolving over the result,
so that I can trust the very first command of the round-trip is solid ground before any milestone is driven through it.

<!-- The "install side" of the round-trip. Pure files-on-disk + CLI-output outcomes → entirely
     `@executable` (ARCHITECTURE.md ADR-003: the deterministic CLI spine is the executable surface).
     Consumes the harness's createRoundTripRepo() + installBundle() (ADR-005) — nothing of story 02. -->

## Tasks

<!-- Contracted (Three Amigos) 2026-06-20. Each `.feature` below is the authored contract. Every
     scenario here is `@executable` — it asserts files on disk / CLI `--json` output, never
     agent-authored content (ADR-003). -->

- [x] `tasks/00_renders-bundle.feature` — after a cold `installBundle`, every bundle member kind renders at its conventional path (agents `.claude/agents/`, commands `.claude/commands/aof/`, templates `.aof/templates/work/`); `--dry-run` writes nothing
- [x] `tasks/01_work-lock-section.feature` — the unified `.aof/aof.lock.json` `work` section is written with a `sha256:` `files[]` entry per rendered member (observable lock-v2 conformance); no separate `aof.work.lock.json`
- [x] `tasks/02_verbs-resolve.feature` — `aof work list/find --json` resolve the installed + seeded refs from inside the fresh repo (the install is genuinely usable, not just present on disk)

## Notes

Inherits the milestone ADRs. **Independent of `02_story_loop-proof`** — the only coupling is the frozen
harness API (`createRoundTripRepo` + `installBundle`); this story never imports the loop-proof story's
code. Depends on `00_story_roundtrip-harness` (the harness contract).

Lives entirely on the `@executable` surface (CI-forever). It overlaps milestone 01's behaviour by
*design* but proves it composes from a cold start in a hermetic repo — that end-to-end cold-start
assertion is what 01's per-unit tests don't make.
