---
doc: state
---
<!--
  Milestone STATE.md — where are we, and what happened? The running narrative.
-->
# 14 · AOF.md Digest — State

## Progress

- Built + accepted `2026-06-23` as a single additive slice (no story breakdown). **Surfaced by the
  milestone-13 voice-vox testbed**: importing/ingesting a real project's milestones showed that 14 of
  15 milestones contributed ZERO memory records (they carry SPEC/STATE but no `ARCHITECTURE.md`/
  `RETROSPECTIVE.md`), so the `imported` marker was hollow and recall saw almost nothing. The remedy is
  a digest source (ADR-001).
- **Delivered** (`src/memory/local-indexing.mjs`, `src/memory/local-retrieval.mjs`):
  - `parseAof` — each `## ` section of an `AOF.md` → one frozen `MemoryRecord` of `recordType: "summary"`
    with a resolving `source:line`; h1/h3 excluded; empty heading → no record.
  - `buildRecords` EXTENDED to scan each milestone's `AOF.md` (conditional — additive, `05/ADR-007`).
  - `status` reports a `summaries` count; recall renders a `summary` record with its own tag.
- **Enforced**: `test/arch/acd-memory-aof-digest.test.mjs` (the derived-index fitness function — resolves
  + byte-identical reindex) + the `aof/digest:` behaviour tests in `test/memory-indexing.test.mjs`
  (parseAof shape/section roots, the scan, the `summaries` status count). `npm test`: **1160 ok / 0 not-ok**.
- **Applied to the voice-vox testbed** (the `@manual` evidence): 13 per-milestone digests authored
  (00–12); voice-vox's own memory went **12 → 51 records** (+39 summaries); recall surfaces the right
  milestone's digest (m11 Azure / m04 GDPR / m06 RAG) and each `source:line` resolves to its `## ` heading.

## Notes & decisions in flight

- The digest currently indexes only in the **work-stream** scan, NOT the import-store scan — so an
  `aof import milestone` of an external repo does not auto-emit a digest. Deferred follow-up (`SPEC §Out-of-scope`):
  have the milestone-13 materialize writer also produce an `AOF.md`, scanned the same way.
- Durable decision in ADR-001 (the digest source + the no-fabrication / derived-index discipline).

## Verification

- [x] `@executable` + fitness green — `npm test`: 1160 ok / 0 not-ok (`2026-06-23`)
- [x] Fitness function green — `test/arch/acd-memory-aof-digest.test.mjs`
- [x] `@manual` real-data — applied to the voice-vox testbed (recall verified); see `VERIFICATION.md`
