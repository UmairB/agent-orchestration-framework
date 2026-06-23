---
doc: architecture
---
<!--
  Milestone ARCHITECTURE.md — how did we decide to build it, and why that way?
  A log of ADRs: numbered, IMMUTABLE, superseded-not-edited, + the fitness-function table.
-->
# 14 · AOF.md Digest — Architecture Decisions

> Inputs: this milestone's `SPEC.md` (a new `AOF.md` digest source so a milestone with no ADR/retro
> indexes a recallable overview) and the milestone-05 frozen contracts it extends, read at `file:line`:
> `src/memory/local-indexing.mjs` (`buildRecords` scans each milestone for `RETROSPECTIVE.md`/`ARCHITECTURE.md`
> via `parseRetrospective`/`parseArchitecture`, `splitSections` records each heading's 1-based line, the
> frozen `MemoryRecord`, the derived index at `.aof/aof.memory.index.json`); `src/memory/local-retrieval.mjs`
> (`MEMORY_RECORD_FIELDS`, the `recordType` boost/render). The `05/ADR-007` extension model
> (*adding a source is a localised change — a new parser producing `MemoryRecord`s with a resolving
> `source`, gated by the same derived-index fitness function*) is the precedent this milestone applies.

## ADR-001: An `AOF.md` digest is a NEW indexed source — each `## ` section is one `summary` record with a resolving `source:line`; the digest summarises and POINTS, it is never a duplicate-as-authority of SPEC/STATE

**Status:** Accepted
**Date:** 2026-06-23

**Context.** The derived index sources records only from `ARCHITECTURE.md` (`## ADR-NNN` → `adr`) and
`RETROSPECTIVE.md` (`## R<n>` → `lesson`). A milestone with neither — a legacy/imported milestone, or
one whose decisions/outcomes were never captured in those shapes — contributes ZERO records, so its
intent + outcomes are invisible to recall (surfaced concretely by the milestone-13 voice-vox testbed:
14 of 15 milestones indexed nothing). `05/ADR-007` already prescribes the remedy — *a new source is a
localised additive change: a new parser producing `MemoryRecord`s with a resolving `source`, gated by
the same derived-index fitness function*. The load-bearing constraint is `05/ADR-001`/`05/ADR-005`:
memory holds **no fact absent from its `.md` source**, every record traces to a `source:line`, and the
index is rebuildable. The REJECTED alternative — hand-summarise a milestone into free prose and index
the prose wholesale — is the **authoritative-second-copy** failure mode `05/ADR-001` names: unattributed
prose has no stable `path:line` record identity and drifts from SPEC/STATE.

**Decision.**
- **A new `AOF.md` digest doc**, scanned by EXTENDING `buildRecords`' work-stream scan (conditional — a
  milestone without one indexes exactly as before). `parseAof` splits the digest on `## ` section roots
  (h1 the digest title and h3+ subsections are NOT roots — they fold into their parent) and emits one
  record per section.
- **A new `recordType: "summary"`** — an ADDITIVE value, NOT a shape change: each record carries the
  EXACT frozen `MemoryRecord` field set (`05/ADR-005`), with the lesson/adr-only fields present-as-`""`,
  and a `source:line` that is the section's `## ` heading. The id is the heading slug; the `item` is the
  milestone number (namespacing it). An empty/whitespace heading yields NO record (no fabrication).
- **The digest summarises and POINTS — never duplicates as authority.** It is its OWN committed `.md`
  and the source of its own `summary` records (the same standing `ARCHITECTURE.md` has for `adr`
  records); it does not restate SPEC/STATE as a rival source of truth. The SPEC/STATE remain the
  un-indexed detail. Frontmatter on the digest may mark provenance (e.g. `imported`/`source`), but
  provenance is never a `MemoryRecord` field — the record's `source:line` carries it.
- **Surface:** `status` reports a `summaries` count alongside `lessons`/`adrs`; recall renders a
  `summary` record with its own tag (not mislabelled `adr`).

**Locked contract this ADR satisfies (FROZEN by 05 — inherited, NOT re-opened):**

```js
// 05/ADR-005 MemoryRecord — parseAof emits EXACTLY this shape, recordType "summary":
//   { recordType:"summary", id, item, itemSlug, title, area:"", stage:"", kind:"", owner:"",
//     status:"", summary, text, source:"<workRelPath>:<1-based ## heading line>" } // source MUST resolve
// 05/ADR-007 — a NEW parser (parseAof) producing MemoryRecords with a resolving source; the index PATH
//   and the work-stream scan are EXTENDED, never forked. No change to the frozen record SHAPE.
```

**Alternatives considered.**
- *Index a free-prose `AOF.md` blob as one record* — REJECTED (`05/ADR-001`): an authoritative second
  copy with no `path:line` record identity; it drifts from SPEC/STATE. The `## `-section discipline gives
  every record a resolving heading line.
- *Reuse `RETROSPECTIVE.md` `## R<n>` entries for the highlights* — REJECTED: a digest "highlight" is
  not a "lesson"; overloading the lesson type muddies recall semantics and the brief's lesson/adr split.
  A distinct `summary` type keeps the kinds honest.
- *Index SPEC/STATE directly* — REJECTED: they are not record-shaped (no per-fact heading line), and
  indexing them wholesale is the second-copy failure mode. The digest is the deliberate, structured
  record source.

**Invariant.** Every `summary` record an `AOF.md` contributes carries the frozen `MemoryRecord` shape
and a `source:line` that resolves to its own `## ` heading; a fresh re-index reproduces the identical
digest record set (rebuildable, no accretion); no record is produced that the digest does not contain.
(Enforced by `acd-memory-aof-digest`.)

## Fitness functions

| Invariant | Enforced by (arch-test `test/arch/acd-*.test.mjs`) | State now | From |
|---|---|---|---|
| **Every `summary` record resolves to its own `## ` heading + matches the frozen `MemoryRecord` shape; a re-index is byte-identical (rebuildable, no accretion); the digest is the record source, never a second copy.** | `test/arch/acd-memory-aof-digest.test.mjs` (build the index from a fixture stream whose milestone carries an `AOF.md`; for each `summary` record resolve `source` → the `## ` heading whose slug IS the record id, assert title/summary trace to text at/after that line + the frozen field set; assert a second reindex yields the identical summary set — the `05/acd-memory-derived-index` idiom applied to the new source) | GREEN | ADR-001 |

<!-- The behaviour over the new source (a `## ` section → a `summary` record; the scan picks up AOF.md;
     status reports a summaries count; h1/h3/empty-heading handling) is covered by the @executable tests
     in test/memory-indexing.test.mjs (the `aof/digest:` cases) — the milestone-05 indexing test home. -->
