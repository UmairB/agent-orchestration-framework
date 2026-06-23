---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  COMPACTED at Accept 2026-06-22: durable decisions graduated to ADR-001..005, lessons to
  RETROSPECTIVE.md R1–R4, evidence to VERIFICATION.md — the blow-by-blow is archived there, not restated.
-->
# 12 · Managed Tool Provisioning — State

## Progress

<!-- Story-by-story roll-up; the source of truth for each story's status is its own STORY.md frontmatter. -->

- **Framed 2026-06-21** (`aof:add-milestone`) — originated mid-`aof:verify 09`: aof is accreting heavy
  non-npm external tools (graphify = Python; headroom = Python/Rust/ONNX), each milestone independently
  deferring the install ("PATH-check + hint, never install"). The user's call: aof should own its dependency
  stack in a controlled, aof-managed `~/.aof` home.
- **Refined 2026-06-21** (`aof:refine 12 --autonomous`) — RESEARCH (uv/provisioning reality) + 5 ADRs
  (ARCHITECTURE.md) + break-down into **5 independent stories** (00 spine · 01/02/03/04 fan out); contracts
  authored for 00/01/02/03 (Three Amigos), 04's contract is ADR-005.
- **Built + reviewed 2026-06-22** (`aof:continue 12`) — built in dependency order 00 → 01 → 02 → 03 → 04,
  suite green between waves (989/0). Review gate **CONFORMS / PASS** after fixes: one **BLOCKER** (uninstall
  path-traversal) + three **MAJORs** (failed-spawn-reported-installed, npx-lane silent no-op, QA degrade-row
  tautology) found and FIXED at the gate. Durable decisions graduated to **ADR-001..005**; process lessons to
  **RETROSPECTIVE.md R1–R4**.
- **Verified + accepted 2026-06-22** (`aof:verify 12`) — the `@executable` suite (989/0) + all five ADR-005
  fitness functions green; the live `@manual` lanes passed (graphify store install + store-first resolution +
  the live doctor store/platform surface); **⚠ CLEANUP OBLIGATION CLOSED** (below). headroom's live install
  is platform-blocked on win32 (no wheel — the matrix advisory, by design, not a defect). No `@uat` scenarios.
  `aof:validate 12` gate **PASS**; no blocker/design-gap finding open. All five stories done → **milestone
  accepted**. Evidence + accept decision → [VERIFICATION.md](VERIFICATION.md).
  - **00** done · **01** done · **02** done · **03** done · **04** done.

## Closed

- **⚠ CLEANUP OBLIGATION (carried from `aof:verify 09`, user-instructed) — CLOSED 2026-06-22.** The temporary
  GLOBAL graphify (`uv tool install graphifyy`, graphify 0.8.44) was removed (`uv tool uninstall graphifyy`)
  **after** graphify migrated into `~/.aof/tools/graphify/0.8.44/` and `resolveGraphifyBinary` was confirmed to
  resolve the store copy (`source:"store"`). The sequencing precondition was honoured (removed only after the
  store copy resolved); graphify now runs exclusively from the managed store, none on PATH. _verifies →_
  VERIFICATION.md "⚠ CLEANUP OBLIGATION CLOSED".

## Verification

<!-- Pointers, not restatements. -->
- [x] `@executable` suite green — `node scripts/test.mjs` → 989 ok / 0 not-ok (2026-06-22).
- [x] Fitness functions green — the five ADR-005 arch-tests enforce; the superseded 09 `acd-graph-binary-absent`
      is updated + green.
- [x] `@manual` signed off — live graphify store install + store-first resolution + the ⚠ CLEANUP OBLIGATION
      closed; the live doctor surface reports graphify from the store + the headroom win32 platform warning.
      headroom's live uv install is platform-blocked on win32 by the matrix (advisory). Evidence → VERIFICATION.md.

<!-- ARCHIVED at accept (2026-06-22): the refine `## Default decisions taken at refine`, the build blow-by-blow,
     the `## Notes & decisions in flight`, and the `## Feedback (for retro)` notes have all graduated — the
     decisions into ADR-001..005 (ARCHITECTURE.md), the lessons into RETROSPECTIVE.md R1–R4. History is
     preserved there; not duplicated here. -->
