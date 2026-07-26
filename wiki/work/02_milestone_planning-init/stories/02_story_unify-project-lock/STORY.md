---
type: story
number: 02
slug: unify-project-lock
parent: 02
title: "Unify per-vertical lock files into the single .aof/aof.lock.json"
status: done
owner: product-owner
created: 2026-06-19
updated: 2026-06-19
schema: 1
aofVersion: 0.1.0
---
<!-- Accepted at aof:verify 02 (2026-06-19): @executable + the 3 lock fitness functions green; the
     @manual "one lock holds all states" re-verified live (asset + planning + work sections preserved
     across writers, one .aof/aof.lock.json, no per-vertical lock files). status: done. -->

# 02 · Unify per-vertical lock files into the single .aof/aof.lock.json

<!-- Added 2026-06-19 (PO decision): `.aof/aof.lock.json` is the ONE authoritative lock for all of a
     project's pinned dependencies and state. Per-vertical lock files (aof.planning.lock.json,
     aof.work.lock.json) are eliminated. This is a cross-cutting refactor, NOT planning-seam work — it
     layers on the already-built story 00 (planning provenance) and on milestone 01's `work init/update`
     (the work bundle manifest), so it is sequenced AFTER them, not run in parallel. The user chose to
     fold the work-lock vertical into this milestone rather than defer it. -->

## User story

As a maintainer of an ACD-managed project,
I want every pinned dependency and recorded state to live in a single `.aof/aof.lock.json` (one section
per concern), instead of a separate lock file per vertical,
so that there is one source of truth to read, diff, and reason about — and no risk of one command's lock
silently shadowing another's.

## Tasks

<!-- The unifying invariant — "exactly one `.aof/*.lock.json`; every writer preserves the sections it
     does not own" — is a fitness function (architect, in ARCHITECTURE.md), not a scenario here; each
     task below asserts its own observable slice. -->

- [x] `tasks/00_planning-provenance-section.feature` — `aof planning init` records provenance under a
  `planning` section of `.aof/aof.lock.json` (never a separate `aof.planning.lock.json`), preserving the
  asset/package/framework sections. **Supersedes ADR-003**; reframes `acd-planning-lock-isolation` from
  file-isolation to section-isolation.
- [x] `tasks/01_work-manifest-section.feature` — `aof work init/update` records the work-bundle install
  manifest under a `work` section of `.aof/aof.lock.json` (never a separate `aof.work.lock.json`),
  preserving the other sections; the bundle drift-check keys off the `work` section. Supersedes
  milestone 01's separate-work-lock decision (m01-ADR-004); reframes its install-manifest fitness function.

## Notes

Depends on story 00 (planning provenance, built) and milestone 01 (`work init/update`, accepted). The
shared mechanic both tasks need: the asset-lock writer (`createLockManifest` / the `mergeFrameworkInstallAttempts`
helper in [src/lock.mjs](../../../../../src/lock.mjs)) today reconstructs the lock from a FIXED field set,
so it would DROP any `planning`/`work` section — the build must make every writer preserve foreign
sections (a read-merge-write per section, not a wholesale rebuild). `aof assets clean` and the
re-run/drift guards must also be taught the section model. The architect records the superseding ADR(s)
and the single-lock fitness function; the developer migrates the three writers + their tests.
