---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  Compacted at Accept: durable decisions graduate to ADRs / the next SPEC; the blow-by-blow archives.
-->
# 26 · Distributed Runs + Leasing — State

## Progress

<!-- COMPACTED AT ACCEPT (2026-07-03). The blow-by-blow build/review narrative for each story has
     archived; its durable decisions graduated to ADRs (ARCHITECTURE.md) and its process lessons to
     RETROSPECTIVE.md. This is now the closure roll-up — the canonical per-item status lives on each
     STORY.md / SPEC.md. -->

- Framed `2026-06-29` by `aof:shatter` from
  [PRD-decentralized-agent-orchestration](../../planning/PRD-decentralized-agent-orchestration.md)
  (Phase 2 — fleet-safe execution).
- Refined `2026-07-02` (`aof:refine 26 --autonomous`): [ARCHITECTURE.md](ARCHITECTURE.md) authored —
  six ADRs + twelve fitness gates; broken into three stories (00 substrate → 01 lease mechanics
  ∥-authorable → 02 the A2 integration join), boundaries grounded in a fresh graph build (1174 nodes /
  3162 edges). Contracts authored via Three Amigos, same session.
- Built + reviewed `2026-07-02` (`aof:continue 26`), all three stories — every task feature green,
  fitness #1–#12 armed, full suite green; each story PASSED structural + behavioural + craft review with
  all must-fixes applied same-session (the ADR-004.3 order drift, the lease-write-home consolidation, the
  fail-closed HELD path, the reclaimed-lineage `sessionId` override — all landed and re-verified).
- **Accepted `2026-07-03` (`aof:verify 26`).** All three stories `done`; milestone `done`. Evidence in
  [VERIFICATION.md](VERIFICATION.md): `@executable` suite + fitness #1–#12 + the four re-armed gates
  **1966/0** (`check.mjs` clean); the KR2 `@manual` soak agent-run + inline-re-verified on a real
  two-node fleet — **100 contested claims / 0 double-executions** + the full crashed-node reclaim chain
  (force-fail `runtime_offline` + `reclaimedAt` + `retryOf` lineage + byte-unchanged dead claim);
  `aof work validate 26` → PASS (traceability + litmus clean). No `@uat` lane (foundational milestone);
  no DESIGN surface. Eight findings logged + triaged (F-26-01..08), none a blocker.

## Durable decisions (graduated)

<!-- The refine-time decisions and the accept-time graduations now live as immutable ADRs — read them
     there, not here (STATE is not a second system of record). -->

- The six refine ADRs — **ADR-001** (fourteen-key node-dimensioned record + union readers + the
  `.gitattributes` R3 pin), **ADR-002** (the `syncMesh({ roots })` root-set generalisation), **ADR-003**
  (the per-contender lease-of-record; remote-history-order arbitration; presence as the lease clock;
  ambiguity fails closed), **ADR-004** (the frozen A2 sequence; the relay's second wire kind; zero relay
  change), **ADR-005** (the optional injected `leaseView`), **ADR-006** (dual-staleness fleet reclaim).
- The three accept-time graduations (verify findings + review deferrals) — **ADR-007** (mesh-aware
  `next` binds only the story walk; apply the `leaseView` at every ready-return — an ADR-005 supersede,
  F-26-05), **ADR-008** (the ceiling-exhausted reclaim trade + the run-record-propagation dependence of
  cross-node reclaim — an ADR-006 addendum, F-26-02/F-26-04), **ADR-009** (the alive-owner orphaned-claim
  reconciliation direction — an ADR-003.2 supersede, F-26-06). All three are bounded liveness/fidelity
  limitations, never a KR2 (double-execution) exposure; the durability/launcher fixes are routed to m27 /
  a serve-launcher follow-up.

## Verification

<!-- Pointers, not restatements. See VERIFICATION.md. -->
- [x] `@executable` suite green — 1966/0, `check.mjs` clean
- [x] Fitness functions green — #1–#12 + the four re-armed gates
- [x] `@manual` signed off — the KR2 soak (100 contested / 0 double-executions) — see [VERIFICATION.md](VERIFICATION.md)

## Retrospective

<!-- The §Feedback (for retro) running notes have ARCHIVED at accept — their lessons graduated to
     RETROSPECTIVE.md (R1–R8) and the durable ones to the ADRs above; the memory index was reingested
     (`aof work memory ingest` → 265 records) so they surface in the next milestone's refine/continue. -->

- Distilled `2026-07-03` — see [RETROSPECTIVE.md](RETROSPECTIVE.md): R1 (ADR-frozen-sequence drift —
  quote steps, assert order), R2 (cite a gate's actual assertions), R3 (every-X invariants need one home
  or an allowlist), R4 (verify a prescribed fix against the seam's actual shape), R5 (name the axis + date
  on "zero-change"/shape citations), R6 (a real-fleet `@manual` soak needs a launched entrypoint per
  seam), R7 (audit every step of an honest-failure doctrine), R8 (a parallel-story commit stages only its
  manifest).
