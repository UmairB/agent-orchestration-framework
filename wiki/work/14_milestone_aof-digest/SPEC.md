---
type: milestone
number: 14
slug: aof-digest
title: "AOF.md Digest — a recallable per-milestone summary as a memory source"
status: done
owner: product-owner
created: 2026-06-23
updated: 2026-06-23
depends: [05]
schema: 1
aofVersion: 0.1.0
---
<!--
  Milestone SPEC.md — the record doc. Answers ONE question: why + scope of this milestone.
  Built directly (a single additive slice + its fitness function) and closed at creation —
  surfaced by the milestone-13 voice-vox testbed, not pre-scaffolded. See ARCHITECTURE.md (ADR-001
  + the fitness table) and VERIFICATION.md (evidence + the testbed @manual).
-->
# 14 · AOF.md Digest — a recallable per-milestone summary as a memory source

## Objective

Give a milestone whose `SPEC.md`/`STATE.md` carry no ADR/retrospective records a **recallable presence
in memory**. The derived index (milestone 05) sources records ONLY from `ARCHITECTURE.md`
(`## ADR-NNN` → `adr`) and `RETROSPECTIVE.md` (`## R<n>` → `lesson`). So a milestone aof did not drive
— a legacy planning doc, an imported milestone, or any milestone whose decisions/outcomes were never
captured in those two shapes — contributes **zero** records, and its intent + outcomes are invisible to
`aof work memory recall`. This milestone adds a new indexed doc type, **`AOF.md`**: a hand-authored
per-milestone **digest** whose `## ` sections each index as one `summary` record. The digest is the
recallable overview; the SPEC/STATE remain the un-indexed detail it points at.

An outsider can verify it: a milestone carrying an `AOF.md` (and no ARCHITECTURE/RETROSPECTIVE) yields
`summary` records that surface in recall, each tracing to a `## ` heading line; a milestone without one
indexes exactly as before.

## Scope

In scope:
- **A new `AOF.md` digest source**, indexed by EXTENDING the indexer scan (the `05/ADR-007` "add a source
  is a localised additive change" model): `parseAof` turns each `## ` section into one frozen
  `MemoryRecord` of a new `recordType: "summary"`; h1 (the digest title) and h3+ subsections are not
  section roots; an empty heading yields no record (no fabrication).
- **The derived-index invariant for the new source**: every `summary` record's `source:line` resolves to
  its `## ` heading; a re-index is byte-identical; the digest summarises and points — it is never a
  duplicate-as-authority of SPEC/STATE (the `05/ADR-001` second-copy failure mode).
- **Surface polish**: `status` reports a `summaries` count; recall renders a `summary` record correctly
  (not mislabelled `adr`).

Out of scope:
- **Auto-generating digests** — they are hand-authored, exactly as ARCHITECTURE/RETROSPECTIVE are.
- **A digest in the import-store scan** — work-stream only for v1; having the import materialize writer
  (milestone 13) also emit an `AOF.md` is a deferred follow-up.
- **Any change to the frozen `MemoryRecord` shape** (`05/ADR-005`) — `summary` is an additive
  `recordType` value, not a shape change.

## Stories

Delivered as a **single additive slice** — one new indexed source + its fitness function — so there is
no story breakdown. The load-bearing enforcement is the fitness function (see `ARCHITECTURE.md`),
mirroring the fitness-only stories of 05/10/13.

## Dependencies

- **05 · work-memory** — the derived index, the frozen `MemoryRecord` (`05/ADR-005`), and the
  "add a source = a localised additive change, gated by the same derived-index invariant" model
  (`05/ADR-007`) that this milestone instantiates.
