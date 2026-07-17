---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Compacted at Accept: durable decisions graduated to ADRs
  (ARCHITECTURE.md) and lessons to RETROSPECTIVE.md; the blow-by-blow archived.
-->
# 40 · Work-Item Versioning & the Upgrade Path — State

## Progress

- [x] **ACCEPTED 2026-07-17** (`aof:autonomous 40`, unattended — no blocker, no human gate). Framed
  2026-07-14 → refined into 4 independent stories → built + verified + accepted in dependency order
  (`01 → {02, 03} → 04`). Consolidated surface 77/77 green; `aof work validate 40` clean.

## What shipped

The document stream now knows how old it is and can catch up:
- **A version stamp on every item** — `schema` (int, drives migration) + `aofVersion` (provenance string),
  born-stamped at scaffold across all five record-doc types, and the existing stream **backstamped**
  (170 items → schema 1, purely additive, `aof work validate` green).
- **`aof upgrade`** — a registry of version→version transforms (`WORK_ITEM_MIGRATIONS` in
  `src/work-upgrade.mjs`, first entry the `0→1` stamp), dry-run→apply, idempotent, refuses a
  newer-than-build schema, and READY to carry a reconstructed doc (the `reconstructs:`/`reconstructed:`
  marker) without performing one — the m39-backfill readiness gate.
- **`validate` reports staleness** — an item behind the current schema is flagged, naming `aof upgrade`.
- **A generated changelog** — `UPGRADE-CHANGELOG.md`, a drift-guarded projection of the registry
  (regenerate == committed byte-for-byte).

## Decisions & lessons (graduated)

- The five refine open-questions (version = two fields; per-item stamp; unstamped→0 baseline; a separate
  transform-scoped writer not a widened `rollbackItemStatus`; `chore` runs an upgrade, doesn't build the
  machinery) + the reconstruction-is-not-migration constraint → **ARCHITECTURE.md ADR-001..008**.
- Process/near-miss lessons (the stream-wide-rule ripple; the byte-identity + EOL hazard; the discovered
  m39 record-kind gap; the concurrent-committer git discipline) → **RETROSPECTIVE.md R1..R4**.

## Verification

- [x] `@executable` suite + 6 fitness functions green (77/77 consolidated).
- [x] `@manual` lanes signed off (the live backstamp; the changelog regenerate==committed) — see
  `VERIFICATION.md`.
- [x] No `@uat` (foundational CLI milestone — no human gate).

## Carried forward

- **F-40-01 → RETROSPECTIVE R3:** the memory `status` verb does not count `outcome` records, so
  `memory-integration`'s `lessons + adrs == recordCount` invariant is stale (a milestone-39 gap, NOT
  milestone 40's). A memory follow-up should add an `outcomes` bucket + fix the invariant.
