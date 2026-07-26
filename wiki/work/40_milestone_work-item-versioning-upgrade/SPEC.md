---
type: milestone
number: 40
slug: work-item-versioning-upgrade
title: "Work-item versioning & the upgrade path — a stream that knows how old it is, and migrations that run"
status: done
owner: product-owner
created: 2026-07-14
updated: 2026-07-17
depends: [00, 01]
schema: 1
aofVersion: 0.1.0
---
<!--
  Milestone SPEC.md — the record doc. Answers ONE question: why + scope of this milestone.
  Owner: product-owner. A milestone GROUPS stories and holds their shared context
  (ARCHITECTURE / DESIGN / RESEARCH / UAT live in this folder too, conditionally).
  Does NOT contain: a per-story user story (→ each STORY.md) or acceptance criteria (→ task .feature).
-->
# 40 · Work-Item Versioning & the Upgrade Path

## Objective

aof versions every store it owns **except the one it exists to manage**. The global work store carries
a `GLOBAL_WORK_SCHEMA_VERSION` with a version read and a recorded migration; the memory index carries
an `INDEX_VERSION`; the config format has `aof project migrate` for its legacy shape. Three deliberate
versioning mechanisms — all of them protecting *machine* state. The **document stream** — the work
items themselves, the artifact aof is *for* — carries no version stamp at all. Not one item in the
stream can say which aof produced it.

That was survivable while aof only ran on aof. It is not survivable now. The bundle installs into
other people's repos, and their streams were scaffolded by whatever aof was current that week. Doc
shape has already moved twice — milestone 14 introduced the `AOF.md` digest, milestone 37 introduced
the `spike` and `chore` item types — and milestone 39 will move it again by adding `OUTCOME.md`. Each
change silently strands every stream that predates it. An installed stream cannot know it is stale,
cannot know what it is missing, and has no way to catch up. The only current answer is a human
noticing and hand-editing, which is not an answer.

This milestone gives a work item a **version** and gives aof a way to **run the upgrade**. Each item
records the aof that created it. Migrations between versions are registered as executable transforms,
`aof upgrade` applies them (dry-run first), and `validate` reports a stale stream instead of quietly
tolerating one.

One property is load-bearing, and the milestone is not met without it.

**A migration is code that runs, not prose that advises.** The tempting shape here is a changelog file
that describes how to upgrade — and a document that tells you how to upgrade binds nobody, is found
only by whoever thinks to look, and rots the moment the next change lands. That is the same passive-
note failure this stream is currently trying to abolish for delivery gaps (milestone 39); repeating it
one milestone later in a new file would be a straight own-goal. So the registry of executable
transforms is the source of truth, and **the changelog is generated from it**. "How do I upgrade" must
resolve to a command, not to advice.

## Scope

In scope:
- **A version stamp on every work item** — the aof that created it, recorded in record-doc
  frontmatter, written at scaffold time and backstamped onto the existing stream.
- **A migration registry** — version→version transforms, declared as code and discoverable, so the set
  of migrations between "what this stream is" and "what aof is now" is *computable* rather than
  researched.
- **`aof upgrade`** — reports what would change, applies the transforms, and is idempotent. Follows the
  existing precedent (`GLOBAL_WORK_SCHEMA_VERSION` / `readSchemaVersion` / recorded migration) rather
  than inventing a fourth versioning idiom.
- **A generated changelog** — derived from the registry, so it cannot drift from the transforms it
  describes.
- **`validate` knows about staleness** — a stream behind the current aof is reported, with the upgrade
  named. Silence today is indistinguishable from "up to date".

Out of scope:
- **Backfilling `OUTCOME.md` across the completed stream.** It rides on this milestone but must not be
  built inside it — see below. It lands as milestone 39's *registered migration*, depending on both.
- **Mechanically reconstructing any doc whose content requires inference.** This milestone transforms
  *shape* (add a field, rename a doc, restructure frontmatter). Content that must be *inferred from
  delivered code* is a different risk class and is not a mechanical transform.
- **Versioning the machine stores** — the global work store, the memory index, and the config format
  are already versioned. This is the document stream only; it borrows their idiom, it does not
  re-open them.
- **Rewriting history.** An upgrade brings an item's *shape* forward. It does not revise what the item
  recorded, and it does not touch an item's authored prose.

### Why the backfill is deliberately excluded

A mechanical migration adds a field or renames a file — the transform is total and its correctness is
checkable. Authoring an `OUTCOME.md` for a milestone that closed months ago is neither: it requires an
agent to read the delivered code and **infer** what shipped, what it assumed, and what it left
dangling. Inference presented as fact is exactly the defect milestone 39 exists to kill, and exactly
what 13/ADR-001 already forbids for imported `SPEC.md` (recovered intent is legible, never a record
source). Run that inference across a completed stream and this milestone becomes a fiction generator
at scale — the original bug, industrialised, with a command to invoke it.

So the reconstruction constraint is stated here and inherited by whoever builds the backfill: a
reconstructed `OUTCOME.md` is **marked as reconstructed** (the import leg's `imported: true` is the
precedent) and can never be recalled as an authored fact. A migration framework that cannot express
that distinction is not ready to carry the backfill.

## Stories

<!-- Populated by `aof:refine 40` (2026-07-17). Four independent stories cut along the real coupling
     (ARCHITECTURE.md "Story boundaries"): the version MODEL is foundational, everything reads it.
     Dep graph: 01 → {02, 03} and 02 → 04. After 01, stories 02 and 03 run in parallel. -->

- [x] [01 · version stamp & reader](stories/01_story_version-stamp-and-reader/STORY.md) — the foundation:
  the `WORK_ITEM_SCHEMA_VERSION` constant, the two frontmatter keys (`schema` int + `aofVersion`
  string), the reader (schema-0 baseline), the born-stamp at scaffold, and the transform-scoped writer
  primitive. *No intra-milestone dep.*
- [x] [02 · migration registry & `aof upgrade`](stories/02_story_migration-registry-and-upgrade/STORY.md)
  — the engine: `work-upgrade.mjs` (`WORK_ITEM_MIGRATIONS` incl. the `0→1` stamp transform + the
  reconstructed-marker) and the `aof upgrade` dry-run→apply idempotent CLI face. *Dep 40/01.*
- [x] [03 · staleness in validate](stories/03_story_validate-staleness/STORY.md) — validate reports a
  stream behind the current aof, naming `aof upgrade`. *Dep 40/01 only.*
- [x] [04 · generated changelog](stories/04_story_generated-changelog/STORY.md) — a projection of the
  registry that cannot drift. *Dep 40/02.*

## Dependencies

- **00 · Work CLI** — owns item frontmatter (the reader, and the one bounded programmatic writer,
  20/ADR-005) and `work validate`. The version stamp lands in frontmatter; staleness is reported by
  validate. Both surfaces are 00's.
- **01 · ACD asset bundle** — the templates and the bundle are how doc shape reaches another repo in
  the first place. A stream's version is meaningless unless the bundle that scaffolds it stamps one.
