---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  Compacted at Accept: durable decisions graduate to ADRs / the next SPEC; the blow-by-blow archives.
-->
# 40 · Work-Item Versioning & the Upgrade Path — State

## Progress

- [x] Framed 2026-07-14.
- [x] **Refined 2026-07-17** (`aof:refine 40 --autonomous`) — ARCHITECTURE.md ADR-001..008 authored (all
  five open questions resolved as documented defaults, see below), 6 guard-if-present fitness functions
  committed, and the milestone broken into **4 independent stories** (`01 → {02, 03}`, `02 → 04`). Status
  → in-progress. Next: `aof:continue 40` — build the stories to green in dependency order.

## Refine decisions (2026-07-17) — the five open questions, resolved as documented defaults

All five open questions were resolved as documented defaults consistent with the SPEC's own steer and the
three existing versioning precedents (no fourth idiom invented). None required a hand-back — recorded here
per the autonomous mandate. Full context + code citations are in `ARCHITECTURE.md`.

- **Q1 — what is the version? → BOTH, as two distinct fields (ADR-001).** `schema` (a monotonic integer,
  the *only* field the migration selector reads, mirroring `GLOBAL_WORK_SCHEMA_VERSION`) + `aofVersion` (a
  human-legible provenance string, `packageVersionString()`, never parsed for logic). The current schema
  is one exported constant `WORK_ITEM_SCHEMA_VERSION` in `work.mjs`, initial value **1**. Conflating the
  two is exactly what STATE warned makes version fields useless — kept separate.
- **Q2 — where does the stamp live? → per-item record-doc frontmatter (ADR-002).** Items drift
  independently (foreign installs at different aof versions; a migration may touch some item *types* not
  others), so per-item is the only shape that represents a partially-upgraded stream honestly. New items
  born stamped at scaffold; existing stream backstamped via the registry's `0→1` transform.
- **Q3 — what version are the pre-stamp items 00–38? → schema 0, the pre-versioning baseline (ADR-003).**
  No `schema` key reads as `0` (mirrors `readSchemaVersion` null→needs-migration). The `0→1` transform IS
  the stamp transform; it backstamps the aof repo's own current stream truthfully (they ARE current) and
  brings foreign unstamped streams forward. Genuinely-old *shape* drift (pre-m14/m37) is NOT retroactively
  reconstructed — that would be the forbidden inference (see inherited constraint below).
- **Q4 — widening the bounded frontmatter writer? → NO; a separate transform-scoped writer (ADR-004).**
  `rollbackItemStatus`'s hard status-only bound (20/ADR-005) is preserved verbatim. A NEW writer
  (`applyItemFrontmatter`) in `work.mjs` (the item-frontmatter authority, 19/ADR-002) rewrites only the
  `---…---` block with a byte-identical body, runs only inside a registered transform. Two narrow bounded
  writers, never one wide mutator.
- **Q5 — is `chore` the right vehicle? → NO for BUILDING the machinery; YES for RUNNING an upgrade
  (ADR-007).** This milestone builds the registry/engine/stamp/staleness as stories with real `.feature`
  contracts (observable behaviour + fitness functions a checklist can't carry). *Invoking* `aof upgrade`
  on a specific installed stream later is the chore-shaped act (m39's backfill applied to a repo is the
  first such chore).

**Two consequences flagged by the architect (not blockers, defaulted):**
- `schema` starts at **1** and does not retro-encode the already-shipped m14 (`AOF.md`) / m37
  (`spike`/`chore`) shape moves — so "stamped current" declares *version*, not *shape completeness*. Any
  residual shape gap in a genuinely-ancient foreign stream needs a *future explicit* registered transform,
  never a silent guess. This is the honest consequence of ADR-008.
- `aofVersion` is a **born-stamp**, unchanged by an upgrade (a migration advances `schema`; provenance
  keeps recording origin). A per-item `migratedBy`/`upgradedAt` was considered and deferred — addable
  later without re-opening ADR-001.

**Security/compliance tier: none (ARCHITECTURE.md verdict).** `aof upgrade` does local in-place frontmatter
transforms on the user's own repo — no network, no personal/regulated data, no auth. The real risk
(data-loss from a buggy transform) is *correctness*, covered by the fitness functions (dry-run-first +
idempotency + atomic write + body-byte-identity), not a threat model.

## Notes & decisions in flight

**Framing (2026-07-14).** Raised while scoping milestone 39's retroactive `OUTCOME.md` backfill. The
backfill was the prompt, but it is *not* the justification — see below.

**The evidence that justifies this milestone.** aof already versions three stores and the document
stream is the conspicuous omission:

| store | mechanism |
| --- | --- |
| global work store | `GLOBAL_WORK_SCHEMA_VERSION` + `readSchemaVersion` + recorded migration |
| memory index | `INDEX_VERSION` (05/ADR-005), bumped on a breaking record-shape change |
| config format | `aof project migrate` (legacy root-config migration) |
| **work items** | **none — no item in `wiki/work/` carries any version stamp** |

Doc shape has already moved twice (14 → `AOF.md` digest; 37 → `spike`/`chore` item types) and 39 will
move it again (`OUTCOME.md`). Every move silently strands streams installed in other repos
(voice-vox-web, let-shield). That drift — not the backfill — is the load-bearing problem.

**Considered and rejected — versioning as a means to the backfill.** The backfill does not need a
version stamp: its predicate is `status: done` AND no `OUTCOME.md`, so presence/absence *is* the
signal. Building the framework to enable one backfill would be scope creep; it stands on the drift
problem or not at all. Recorded because the two keep getting conflated.

**Considered and rejected — a prose changelog that "indicates how to upgrade".** This was the shape
first proposed and it is the passive-note failure mode milestone 39 exists to abolish for delivery
gaps: a document that advises binds nobody and rots. Inverted — the executable registry is the source
of truth and the changelog is *generated from it*. "How do I upgrade" must resolve to a command.

### Open questions for `aof:refine`

- **What is the version?** The aof package version (`0.1.0` today), a monotonic stream-schema integer
  (the `GLOBAL_WORK_SCHEMA_VERSION` idiom), or both — a human-legible provenance stamp *and* a
  machine-comparable schema number? These answer different questions and conflating them is how
  version fields become useless. Decide before anything is stamped.
- **Where does the stamp live?** Per-item frontmatter (precise, but 38 items to backstamp and a
  frontmatter write per item) versus once per stream (cheap, but cannot express a partially-upgraded
  stream). Per-item is the honest shape if items can drift independently — confirm that they can.
- **Backstamping the existing stream.** Items 00–38 predate the stamp. What version are they declared
  to be? An honest answer may be "unknown/pre-versioning", which the registry must then be able to
  migrate *from*.
- **Frontmatter writes.** 20/ADR-005 notes work.mjs's status writer was the *first* programmatic
  item-frontmatter writer and was bounded hard (status field only, `in-progress` → `not-started`/
  `blocked`) precisely to avoid a general mutator. An upgrade transform needs a broader write. That
  bound was deliberate — widening it is an architecture decision, not an implementation detail.
- **Is `chore` the right vehicle for an upgrade?** A migration is housekeeping with a checklist and a
  green validate — which is the `chore` shape (37) almost exactly. Worth checking before inventing a
  new item type.

### Inherited constraint — reconstruction is not migration

Stated in the SPEC and repeated here because it is the constraint most likely to be lost at refine: a
transform that must *infer content from delivered code* is not a mechanical migration. A reconstructed
`OUTCOME.md` must be marked reconstructed (the import leg's `imported: true` is the precedent) and must
never be recalled as an authored fact. If the registry cannot express that distinction, it is not ready
to carry milestone 39's backfill — and shipping it anyway turns this milestone into an industrialised
version of the exact defect that started this work.

## Verification

<!-- Pointers, not restatements. -->
- [ ] `@executable` suite green
- [ ] Fitness functions green
- [ ] `@manual` signed off
