---
doc: state
---
<!--
  Milestone STATE.md — where are we, and what happened? Owner: product-owner.
  COMPACTED at Accept (2026-07-03): the build/review blow-by-blow archived, durable decisions graduated
  to ARCHITECTURE ADRs, lessons to RETROSPECTIVE.md, findings to VERIFICATION.md. Canonical status lives
  on SPEC.md frontmatter + each STORY.md.
-->
# 27 · Cross-Machine Issuance & Routing — State

## Progress

**DONE — verified + accepted `2026-07-03`.** All three stories on the `00 → 01 → 02` chain built,
reviewed, and accepted; milestone `SPEC.status: done`.

- **Framed** `2026-06-29` (`aof:shatter`, PRD Phase 3 — issuance & routing).
- **Refined** `2026-07-03` (`aof:refine 27 --autonomous`): ARCHITECTURE (6 ADRs + 7 fitness functions),
  DESIGN (the `[⊕ assign]` affordance — per-board-tile picker, control-node-gated absence), SECURITY (the
  first cross-machine inbound write surface). Broken into three file-disjoint stories; **15 task features**
  authored (Three Amigos), all `@executable` except the KR3 3-OS soak (`@manual`) and the affordance
  visual review (`@uat`). Two security controls landed at Decide: **S-1** (`acd-mesh-issue-route-same-origin`)
  + **S-2** (`acd-issuance-revoked-issuer-filtered`).
- **Built + reviewed** `2026-07-03` (`aof:continue 27`, orchestrated): story 00 (`src/mesh-issuance.mjs`
  substrate + the `mesh-store` path reservation) → story 01 (`mesh:issue` + `--withdraw`, the unified
  `candidacyView` in `next.mjs`, the ADR-007 every-ready-return fold-in in `work.mjs`, the `mesh:status`
  issued render + unconditional `isControlNode` marker) → story 02 (the FIRST write route
  `POST /api/mesh/issue` → `invoke("mesh:issue")`, the `[⊕ assign]` affordance, the fitness #7 flip to
  bounded-write). Architect CONFORMS + QA FAITHFUL + designer CONFORMS (after the Gap-B popover-anchoring
  fix) on all three.
- **Verified + accepted** `2026-07-03` (`aof:verify 27`): suite **2221 ok / 0 fail**; the KR3 `@manual`
  soak measured **100 % pickup / ≤2 sync intervals / 0 ineligible / no manual shuffle** (single-OS);
  design-conformance **CONFORMS**; `aof work validate` PASS; **no blocker finding open**. See
  [VERIFICATION.md](VERIFICATION.md).

## Compaction (what graduated where)

- **Durable decisions → ADRs.** The refine-time defaults (per-issuer partitioned `.mesh/issuance/`
  directive not a control-node aggregate; single data-driven `--to` disambiguation; v1 issue does NOT ride
  the relay; the control-node-gated affordance) are recorded in [ARCHITECTURE.md](ARCHITECTURE.md)
  ADR-001…006. **Owed at accept:** graduate the developer's `candidacySkipped` guard into ADR-004.3 (see
  [RETROSPECTIVE.md](RETROSPECTIVE.md) — ADR-graduation owed).
- **Process/tooling lessons → RETROSPECTIVE.md** (R1 detector definition-vs-consumption · R2 cross-face
  input-normalization parity · R3 same-origin guard on every new loopback write route + the owed
  board-ui/mesh-relay retrofit · R4 per-route Allow/code method matrix · R5 graphify phantom-node ·
  R6 structural ADR citations).
- **Findings → VERIFICATION.md** (F-2701 KR3 3-OS breadth → the whole-mesh UAT session · F-2702
  Open-board wrap @1280 design-gap deferred · F-2703 task-05 withdraw prose drift deferred · F-2704
  task-00 code-cell drift **reconciled at verify** to `404/ref-not-found`).

## Verification

- [x] `@executable` suite green — 2221 ok / 0 fail (fresh `node scripts/test.mjs`).
- [x] Fitness functions #1–#7 + S-1/S-2 green — all non-vacuous.
- [x] `@manual` KR3 soak (task 06) — 100 % / ≤2-interval / 0-ineligible / no-shuffle, MEASURED single-OS;
      the 3-OS real-fleet breadth (F-2701) delegated to the whole-mesh UAT session (`depends: 18–28`).
- [x] `@uat` design-conformance (task 02) — CONFORMS (idle-control · gated-absent-runner, 3 breakpoints);
      the interactive-state experiential sign-off delegated to the whole-mesh UAT session.

## Delegated to the whole-mesh UAT session (18–28)

The operator elected to perform the experiential human acceptance holistically across the whole mesh arc
(a dedicated `type: uat` gate). Milestone 27's residuals — the KR3 3-OS real-fleet soak (F-2701) and the
affordance interactive-state click-through — are that session's headline `@manual`/`@uat` scenarios.
