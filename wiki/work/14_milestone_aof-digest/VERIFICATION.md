---
doc: verification
updated: 2026-06-23
---
<!--
  Milestone VERIFICATION.md — is it truly done, and what is the evidence?
  No @uat scenarios → no ## User sign-off. No UI → no design-conformance section.
-->
# 14 · AOF.md Digest — Verification

## Verification evidence

### Automated + fitness (always; no human)

- **Suite green** — `node scripts/test.mjs` → **1160 ok / 0 not-ok** (exit 0), `2026-06-23`.
- **Fitness function green (the load-bearing deliverable, ADR-001)** — `test/arch/acd-memory-aof-digest.test.mjs`,
  two cases proven non-vacuous:
  - every `summary` record resolves to its own `## ` heading (the heading slug IS the record id), its
    title/summary trace to text at/after that line, and it matches the frozen `MemoryRecord` field set;
  - a second reindex yields the IDENTICAL summary set (rebuildable, no accretion).
- **Behaviour `@executable` green** — the `aof/digest:` cases in `test/memory-indexing.test.mjs`: a `## `
  section → a `summary` record (h1 + h3 excluded; empty heading → no record); `reindex` scans a
  milestone's `AOF.md`; a milestone-scoped reindex includes its digest; `status` reports a `summaries`
  count and `lessons + adrs + summaries == recordCount`.

### `@manual` lane (agent-run, real data — the voice-vox testbed; no human)

- **The digest source closes the "milestone indexes nothing" gap on a real project** _(ADR-001)_.
  Procedure: authored 13 per-milestone `AOF.md` digests for `voice-vox-cadence` (00–12, each from its
  real SPEC Goal + STATE outcomes/decisions), then `aof work memory reindex` in voice-vox. Result: PASS —
  voice-vox's own memory went **12 → 51 records** (`6 lessons + 6 adrs + 39 summaries`); `aof work memory
  recall` surfaces the right milestone's digest for topical queries (`azure pulumi managed identity` →
  m11, `gdpr conversation lifecycle` → m04, `knowledge base rag citations` → m06), and each recalled
  `summary`'s `source:line` resolves to its `## ` heading in the digest. _verifies →_ the SPEC objective
  ("a milestone with no ADR/retro gains a recallable presence") + ADR-001's derived-index invariant on
  real data.

## Findings

No blocker and no design-gap findings. One non-blocker deferral is tracked (not a defect):

| id | observed | type | severity | triage | status |
|---|---|---|---|---|---|
| V14-1 | The digest indexes only in the work-stream scan, not the import-store scan, so `aof import milestone` does not auto-emit a digest for an external milestone. | scope-gap / deferral | non-blocker | defer to backlog (have the milestone-13 materialize writer emit an `AOF.md`, scanned the same way) | open |

## Accept decision

**ACCEPTED — 2026-06-23.** The suite (1160/0) and the ADR-001 fitness function are green; the
behaviour over the new source is `@executable`-covered; the agent-run `@manual` on the voice-vox
testbed passed (12 → 51 records, recall verified, every `source:line` resolves); no `@uat` scenarios
exist (no human gate); no blocker or design-gap finding is open. Delivered as a single additive slice
(no stories), so the milestone is accepted on its SPEC + ADR-001 + fitness function → **done**.
