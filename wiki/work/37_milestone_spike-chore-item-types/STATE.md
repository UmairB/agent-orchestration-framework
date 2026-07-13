---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  COMPACTED at Accept (2026-07-10, aof:verify 37): durable decisions graduated to ARCHITECTURE.md
  ADR-001..004; the blow-by-blow + the ## Feedback (for retro) notes graduated to RETROSPECTIVE.md
  (R1..R3); verification evidence lives in VERIFICATION.md.
-->
# 37 · Spike & Chore Work-Item Types — State

## Progress

**ACCEPTED `2026-07-10`** via `aof:verify 37` — all four stories `done`, milestone `done`.

- Framed `2026-07-09` (`aof:add-milestone`); broken down `2026-07-09` (`aof:refine 37 --autonomous`) into
  four independent stories, all contracts authored in one Three-Amigos pass.
- `00 · vocabulary-and-validation` — **done.** Engine admits `spike`/`chore` (`ITEM_RE`, `recordDoc`→
  `SPIKE.md`/`CHORE.md`, `isDriver`, `nextWork` uat-shaped candidacy-guarded branch, `validateWork` native
  path). All four physical vocabulary copies folded in (see RETROSPECTIVE R1). Architect + QA review PASS.
- `01 · scaffold-commands-and-templates` — **done.** `SPIKE.md`/`CHORE.md` templates + `aof:add-spike`/
  `aof:add-chore` commands shipped via the ACD bundle (manifest 60→64). Architect + QA review PASS.
- `02 · lifecycle-and-verify` — **done.** Per-type verify dispatch (spike→finding-recorded; chore→ticked
  DoD + green validate), refine bypass, minimal board type-badge (no new lane). Architect + QA review PASS.
- `03 · shatter-emits-spike` — **done.** `shatter.md` frames milestone-vs-`spike` per PRD chunk with a
  backward-only `depends` edge; `chore` excluded (ad-hoc only, ADR-004). Architect + QA review PASS.

## Durable decisions (graduated)

Recorded in [`ARCHITECTURE.md`](ARCHITECTURE.md):
- **ADR-001** — spike/chore are top-level drivers, treated the `uat` way (own `NN_` slot, in the `depends`
  graph, `isDriver` true, `nextWork` item-is-the-work; reuses `uat`'s candidacy-guarded ready-return).
- **ADR-002** — one self-contained record doc per type (`SPIKE.md`/`CHORE.md`), no separate STATE.
- **ADR-003** — verify path is skill-orchestrated (spike=finding-recorded; chore=checklist+validate-green;
  both bypass refine + behavioural `.feature`); board/Notion = minimal type badge only.
- **ADR-004** — `aof:shatter` frames `spike` (never `chore`) for a PRD's blocking unknowns.

Process lessons → [`RETROSPECTIVE.md`](RETROSPECTIVE.md): R1 (single-source the quadruplicated vocabulary
seam — carried as a follow-up `chore`), R2 (a validation message pinned by a locked `.feature` is contract
surface — the C1 revert), R3 (an `@executable` scenario with no harness reads as covered — board badge).

## Verification

See [`VERIFICATION.md`](VERIFICATION.md). Summary: `@executable` suite + all 6 FFs green
(`node scripts/test.mjs` 2321 ok / 0 not-ok), `aof work validate 37` PASS, every `@manual` scenario
confirmed agent-run against the real templates/skill-docs/validator; design conformance `INCONCLUSIVE`
(minimal type-badge, no baseline — ADR-003 scope); one deferred non-blocker (F-3701). No `@uat` lane.
