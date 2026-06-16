---
type: milestone
number: 00
slug: work-cli
title: "Work CLI"
status: in-progress
owner: product-owner
created: 2026-06-16
updated: 2026-06-16
---
# 00 · Work CLI

## Objective

Give aof a deterministic CLI for its own ACD work stream — resolve, validate, and order work items
straight from folder names — so commands stop hand-globbing `**/*.md` and CI can gate the stream.

## Scope

In scope:
- `aof work find <ref|query>` — resolve a milestone / story / slug from the folder index (no content reads).
- `aof work validate [ref]` — folder↔frontmatter, the closed tag vocabulary, and the `depends` graph
  (resolves + acyclic); exit codes for CI.
- `aof work next [range]` — the next actionable item in dependency order (ready / blocked / done).
- The `src/work.mjs` engine + unit tests.

Out of scope: `aof work list` / `status` / scaffolding verbs (later); the language-aware
test-traceability check; the board UI (03).

## Stories

<!-- to be broken down — `aof:refine 00` -->

## Dependencies

- None — this is the foundation the other milestones build on.
