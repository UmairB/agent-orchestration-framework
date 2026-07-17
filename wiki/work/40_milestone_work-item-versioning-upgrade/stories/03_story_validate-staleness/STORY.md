---
type: story
number: 03
slug: validate-staleness
title: "Staleness in validate — a stream behind the current aof is reported, with aof upgrade named, so silence is no longer indistinguishable from up-to-date"
parent: 40
status: not-started
owner: product-owner
created: 2026-07-17
updated: 2026-07-17
depends: [40/01]
schema: 1
aofVersion: 0.1.0
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs (ARCHITECTURE.md).
-->
# 03 · Staleness in validate — the stream that knows it is behind

## User story

As the **maintainer running `aof work validate` on an installed stream**,
I want validate to **report any item whose `schema` is behind the current aof and name `aof upgrade` as
the remedy**,
so that a stale stream is **visibly stale** instead of silently tolerated — today, silence is
indistinguishable from "up to date", and that is exactly how drift goes unnoticed until it breaks.

<!-- This is the report half (ADR-005 / ADR-006). It lives in validateWork (work.mjs:574) and depends on
     story 01 ONLY: it compares each item's `schema` against WORK_ITEM_SCHEMA_VERSION (both story-01
     artifacts in work.mjs) and names `aof upgrade` as a STRING LITERAL in the finding — NOT an import of
     work-upgrade.mjs. That is what keeps it dep-01-only and lets it run in parallel with story 02.
     Enumerating WHICH transforms are pending is deliberately an `aof upgrade --dry-run` concern (02). -->

## Acceptance criteria (outcome — detailed scenarios authored at refine, into the task `.feature`s)

Grounded in `ARCHITECTURE.md` ADR-005 (staleness-independence) / ADR-006:

1. **A behind item is reported (ADR-005):** `aof work validate` reports any item whose `schema` is less
   than `WORK_ITEM_SCHEMA_VERSION` — including an **unstamped** item (read as schema `0`, ADR-003) — as
   a staleness finding. An item **at** the current schema produces **no** staleness finding.
2. **The remedy is named (ADR-006):** the finding names **`aof upgrade`** as the fix — a **string
   literal** in the finding message. Validate does **not** enumerate which transforms are pending (that
   is `aof upgrade --dry-run`, story 02) — so it needs no registry.
3. **Validate stays deterministic and dep-01-only (ADR-005):** `validateWork` reads `schema` from item
   frontmatter and compares against the `work.mjs` constant. It does **NOT** `import work-upgrade.mjs` —
   no code dependency on story 02 is created (confirmed by the graph: the only relevant edge is
   `validate → work.mjs`).
4. **The staleness check is purely additive to `validateWork`** — it adds a new finding class inside the
   existing deterministic pass (folder↔frontmatter, tags, depends graph); it widens no existing check
   and touches a disjoint region from story 01's reader/writer edits (ADR-005 god-node discipline).

## Tasks

<!-- Authored at `aof:refine 40 --autonomous` (Three Amigos). -->

- [ ] `tasks/00_validate-flags-behind-item-naming-upgrade.feature`

## Notes

- **Dependency:** `depends: [40/01]` — needs the constant + the schema-0 baseline reader ONLY. Runs in
  parallel with story 02.
- **The dep-01-only cut is the whole point (ADR-005):** if a future validate wants "3 migrations
  pending", that is a deliberate widening onto story 02's registry — explicitly out of scope here so the
  parallel cut holds.
- No new fitness function is owned by this story; the behaviour is proven by the task `.feature`
  scenarios against a fixture stream containing both a stamped-current and an unstamped item.
