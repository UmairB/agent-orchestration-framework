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

- [ ] Not started — framed 2026-07-14. Next: `aof:refine 40` to break into stories.

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
