---
type: story
number: 02
slug: work-update
title: "aof work update — drift-checked bundle re-render"
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
# 02 · aof work update — drift-checked bundle re-render

## User story

As a developer who installed ACD via `aof work init`,
I want `aof work update` to re-render the bundle against my install manifest and on-disk files, classifying each as create/update/skip/drift/delete,
so that I receive upstream ACD bugfixes safely — getting new and changed files while my own edits are never silently overwritten.

<!-- Manifest-diff re-render (ARCHITECTURE.md ADR-003/ADR-004): load the bundle, synthesize the config,
     createRenderPlan → planApplyActions(desired, previousLock = the install manifest, {force}) →
     executeApplyActions → rewrite the install manifest. Depends ONLY on the locked shared contract
     (ADR-004 manifest + ADR-005 stamp) and Story 00's bundle — NOT on Story 01. -->

## Tasks

<!-- Finalised by the contract authors (Three Amigos). Disjoint split: 00 owns create/update/skip +
     dry-run + the no-manifest guard; 01 owns the user-edit drift / no-clobber path; 02 owns
     delete-stale; 03 owns the manifest rewrite. -->

- [x] `tasks/00_classify-against-manifest.feature` — `aof work update` re-renders the bundle and reports each member up-to-date / changed / new (skip/update/create); `--dry-run` reports without writing; no manifest refuses and points to `aof work init`
- [x] `tasks/01_no-clobber-without-force.feature` — a locally-edited managed file is detected as user-modified, drift-warned and preserved; `--force` overwrites it with the new bundle content
- [x] `tasks/02_delete-stale-members.feature` — a member dropped from the bundle is deleted on update; if it was edited locally it is drift-warned and preserved
- [x] `tasks/03_update-rewrites-manifest.feature` — after applying, `.aof/aof.work.lock.json` records the new bundle version and the freshly written hashes; drift-warned entries are preserved; the consumer's own `.aof/aof.lock.json` is untouched

## Notes

Inherits the milestone ADRs. The only cross-story coupling is the **locked shared contract** —
install-manifest schema (ADR-004) + `aof-generated` stamp (ADR-005) — and Story 00's bundle/loader.
This story does not read or import Story 01; it only assumes a manifest of the frozen shape exists.
Fitness functions `acd-reuses-render-plan`, `acd-install-manifest-contract`, and
`acd-no-clobber-without-force` guard it.
