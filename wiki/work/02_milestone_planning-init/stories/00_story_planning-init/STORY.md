---
type: story
number: 00
slug: planning-init
title: "aof planning init — install the bought planner, record pinned provenance"
parent: 02
status: done
owner: product-owner
created: 2026-06-18
updated: 2026-06-19
schema: 1
aofVersion: 0.1.0
---
# 00 · aof planning init — install the bought planner, record pinned provenance

<!-- Accepted at aof:verify 02 (2026-06-19): @executable + fitness functions green; the @manual F1/F2
     live install verified (HTTPS clonable tag #v2.0.0, 3 plugins, 40-hex provenance in the unified
     lock's `planning` section). All blockers (F1/F2) resolved. status: done. -->


<!-- Reopened at aof:verify (2026-06-18): blocker Finding F1 — the live install failed over SSH for
     HTTPS-only GitHub auth; task 04 (@bug @finding-F1) fixed the transport (HTTPS URL, ADR-007).
     Reopened AGAIN at aof:verify (2026-06-19): blocker Finding F2 — F1's HTTPS fix worked but the
     `#<sha>` ref is not clonable (`git clone --branch` takes a branch/tag, not a commit sha). Task 05
     (@bug @finding-F2) pins the clonable tag `#v2.0.0` + records the resolved commit; ADR-008
     supersedes ADR-007's ref decision. Built + reviewed via `aof:continue 02` (2026-06-19); both
     @executable green + the @manual live install PROVEN (marketplace registered + 3 plugins + 40-hex
     provenance). Back to `in-review`; `done` at aof:verify once the story-01 @uat round-trip runs green
     (now unblocked — the planner is actually installed). -->


## User story

As a maintainer adopting ACD's bought planning seam,
I want `aof planning init` to register the `phuryn/pm-skills` marketplace pinned to an exact commit sha, install the recommended planner plugins through the runtime's own plugin CLI, and record a provenance manifest (`source` / `marketplaceVersion` / `sha` / `plugins`),
so that a PRD can be produced upstream reproducibly and traced to *how it was made* — without aof owning the planning method.

## Tasks

<!-- A task is done when its @executable feature is green. The live network/plugin-install steps are
     @manual (RESEARCH A6–A8); the command-plan and manifest shape are @executable via the simulation hook. -->

- [x] `tasks/00_dry-run-install-plan.feature` — `--dry-run` prints the exact runtime command plan (`marketplace add phuryn/pm-skills@<sha>` then `plugin install <plugin>@pm-skills`, verb `install`) for the recommended set, spawning nothing (ADR-001)
- [x] `tasks/01_pin-marketplace-sha.feature` — resolve the marketplace commit sha (`git ls-remote`) and pin it as `@<sha>`; the recorded sha is a 40-hex commit, never a floating ref (ADR-002)
- [x] `tasks/02_execute-and-write-provenance.feature` — execute behind the network/code-execution boundary (warn-then-spawn by argv) and write `.aof/aof.planning.lock.json` with the frozen schema (ADR-001/003)
- [x] `tasks/03_codex-degrade-and-guard.feature` — `--runtime codex` honestly degrades (marketplace-only, `pluginsInstalled:false`, manual fallback) and never emits `codex plugin install`; re-run guard + `--force` mirror `work init` (ADR-004/006)
- [x] `tasks/04_https-marketplace-source.feature` — `@bug @finding-F1`: switched the marketplace-add source to the HTTPS git URL, not the SSH-able `owner/repo` shorthand (Finding F1 — the live install failed `Permission denied (publickey)`). Superseded ADR-001's shorthand invariant via **ADR-007**. (The `#<sha>` ref form it introduced was itself superseded by task 05 / ADR-008 — see below; the HTTPS-transport fix stands.) Built + reviewed `aof:continue 02` (2026-06-18); `@executable` green.
- [x] `tasks/05_clonable-marketplace-ref.feature` — `@bug @finding-F2`: the marketplace-add command pins the **clonable release tag** `#v2.0.0` (a `git clone --branch <ref>` resolves a branch/tag, NOT the 40-hex commit sha F1 emitted), while the provenance manifest still records the 40-hex commit the tag resolves to (audit anchor). Superseded ADR-007's `#<sha>` ref via **ADR-008** + revised `acd-planning-install-commands` + added the networked **clone-smoke** fitness function (`acd-planning-clonable-ref`) that proves the emitted ref actually resolves upstream — closing the F1/F2 "string-passes-but-clone-fails" blind-spot class. **Built + reviewed via `aof:continue 02` (2026-06-19); both `@executable` scenarios green AND the `@manual` live install PROVEN end-to-end (pm-skills registered at `…git@v2.0.0`, 3 plugins installed, provenance sha `5042ff61…`).**
<!-- The unified-lock work (planning provenance → a `planning` section of aof.lock.json, superseding
     ADR-003) was promoted into its own cross-cutting story `02_story_unify-project-lock` (2026-06-19),
     alongside the work-lock vertical — it is a lock refactor, not planning-seam work. -->


## Notes

Independent of story 01 (which runs against a PRD *fixture*, not this command's output). Inherits the
milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) ADR-001–004, 006 and [RESEARCH.md](../../RESEARCH.md).
The install mechanics mirror the existing GSD framework-installer pattern in
[src/cli.mjs](../../../../../src/cli.mjs) (plan → `--dry-run` → per-item network boundary → argv spawn).
The structural invariants (command verbs/tokens, 40-hex sha, lock isolation, no-codex-install) are
fitness functions in ARCHITECTURE.md, not scenarios here.
