---
type: story
number: 01
slug: work-init
title: "aof work init — render the ACD bundle into a repo"
parent: 1
status: done
owner: product-owner
created: 2026-06-17
updated: 2026-06-17
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH.
-->
# 01 · aof work init — render the ACD bundle into a repo

## User story

As a developer adopting ACD in my repo,
I want `aof work init` to render the shipped ACD bundle into my runtime, stamp each generated file as aof-managed, and record what it installed,
so that I get a working ACD setup in one command and a manifest that later lets `aof work update` deliver bugfixes without clobbering my edits.

<!-- Built on the existing render/apply machinery (ARCHITECTURE.md ADR-003): synthesize a config from
     the bundle, createRenderPlan → planApplyActions (previousLock = null) → executeApplyActions →
     write the install manifest. Depends ONLY on the locked shared contract (ADR-004 manifest schema +
     ADR-005 stamp) and Story 00's bundle — NOT on Story 02. --runtime selects per ADR-006. -->

## Tasks

- [x] `tasks/00_render-bundle-into-repo.feature` — `aof work init` renders every supported bundle member onto disk under the target repo's runtime root; `--dry-run` writes nothing; a directory argument targets that directory, not the CLI's cwd
- [x] `tasks/01_stamp-and-manifest.feature` — each written file carries the `aof-generated` stamp (frontmatter for resources, comment marker for templates) and a lock-v2 install manifest is written to `.aof/aof.work.lock.json`, never the consumer's own `.aof/aof.lock.json`
- [x] `tasks/02_runtime-selection.feature` — `--runtime` selects the runtime(s) (default claude); on codex, command members are reported as not installable per the capability matrix rather than dropped or force-written
- [x] `tasks/03_init-guard-and-force.feature` — init is a guarded first-install: it refuses (pointing to `aof work update`, exit non-zero, no writes) when `.aof/aof.work.lock.json` already exists, and `--force` re-renders from scratch and rewrites the manifest

## Notes

Inherits the milestone ADRs. The only cross-story coupling is the **locked shared contract** —
install-manifest schema (ADR-004) + `aof-generated` stamp (ADR-005) — and Story 00's bundle/loader.
This story does not read or import Story 02. Fitness functions `acd-reuses-render-plan`,
`acd-install-manifest-contract`, `acd-generated-stamp`, and `acd-capability-delegation` guard it.

**init/update boundary (PO decision, 2026-06-17):** `init` renders with `previousLock = null` (ADR-003),
so it is a *first-install* command — it guards against re-running over an existing install (which would
otherwise overwrite, since there is no prior lock to drift-check against) and points the user to
`aof work update`. All cross-version drift safety (skip/drift-warn/delete on re-render) lives in
Story 02 (`work update`). This keeps the two stories' behaviours disjoint, not overlapping.
