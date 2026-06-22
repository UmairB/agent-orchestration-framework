---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  Compacted at Accept: durable decisions graduate to ADRs / the next SPEC; the blow-by-blow archives.
-->
# 10 · Graphify Memory Backend — State

## Progress

<!-- Story-by-story, mirroring the SPEC Stories list. The source of truth for each story's status
     is its own STORY.md frontmatter; this is the at-a-glance roll-up. -->

- **Framed 2026-06-21** (`aof:shatter wiki/planning/PRD-graphify-integration.md`) → `not-started`.
  Spine only (SPEC objective + scope). A consumer milestone of the graphify arc — fans out from the
  09 foundation, in parallel with 11. **Next:** `aof:refine 10` to break it into independent stories
  and author the ADRs (the graphify backend over 05's interface; the graph derived-index invariant).
- **Refined 2026-06-22** (`aof:refine 10`) → `in-progress`. Decide (researcher → RESEARCH.md §A–§O; a
  runnable pre-refine spike → [spike/FINDINGS.md](spike/FINDINGS.md); architect → ARCHITECTURE.md, 6 ADRs
  + 6 fitness functions) then Break-down into **four** independent stories (00 spine; 01/02/03 fan out).
  Stopped at the break-down review gate (no `--autonomous`) — story task `.feature` contracts NOT yet
  authored. **Next:** `aof:continue 10` (fans out the stories; starts with 00, the spine), or
  `aof:refine 10/00` to author story 00's Contract first.

- **Built + accepted 2026-06-22** (`aof:autonomous 10-11`) → **`done`**. All four stories built green and
  accepted: **00** the backend module (frozen `{name,recall,reindex,status}`; reuses the 05 parsers; own
  derived store; reaches graphify only via `invoke("graph:build")`) — its `@manual` lane verified live
  (real 275-node `wiki/work` graph via `claude-cli`, **keyless**, ~$0.00 — VERIFICATION.md); **01** the
  graph re-ranker (shared `src/graph-normalize.mjs` extracted, 09 preserved); **02** the `claude-cli`
  posture + visible binary-absent degrade; **03** the six `acd-graphify-*` fitness guards (all GREEN,
  mutation-verified). **Full suite 1067 ok / 0 fail.** One finding (F-01, the half-covered derived-store
  git-ignore) caught at the live verify and fixed in place; no blocker stops. Lessons distilled into
  [RETROSPECTIVE.md](RETROSPECTIVE.md) (R1–R3). The capability ships; the repo's own `memory.backend`
  stays `none` (opt-in). **Next:** `aof work next 10-11` → milestone 11 (graphify-codebase-intelligence).

## Notes & decisions in flight

<!-- Surprises, corrections, mid-build discoveries. Decisions that prove durable graduate to ADRs at
     Accept — don't leave them only here. Strike-through corrected assumptions to keep history honest. -->

- **Origin (2026-06-21).** Shattered from [PRD-graphify-integration.md](../../planning/PRD-graphify-integration.md).
  Fills the semantic-backend slot milestone 05 (work-memory) reserved by design — graphify behind the
  unchanged `aof work memory` verbs, reached through the 09 graph commands.
- **Carry-forward to refine.** The derived-index invariant is the load-bearing constraint to encode as
  a fitness function (the graph holds no fact absent from its `.md` source — mirrors 05's local-index
  guarantee). Open question for the ADR: graph scope = work stream only, or work stream + codebase.
- **Refine decisions (2026-06-22) — two surprises reshaped the thesis.** **(1) graphify can't be the
  record source.** Research + the spike (real `graph.json`) confirmed graph nodes carry FILE-level
  provenance only (`source_location: null`) and `graph:query` is opaque (`09/ADR-001`) — so graphify
  cannot supply the frozen per-line `MemoryRecord.source`. Resolved: records stay from the 05 parsers;
  the graph is a file-level **re-ranking** signal. "Graph-grounded" = "graph-reranked" (ADR-001). **(2)
  The egress reframe.** The "cheap local index" framing didn't hold — graphing prose REQUIRES an LLM
  pass. Surfaced to the user; direction: keep extraction **within the user's own Claude** via graphify's
  native `--backend claude-cli` (no metered key, no third party; spike-proven keyless). Honest caveat
  recorded in ADR-003: this is **credential-local, NOT data-local** — prose still goes to Anthropic for
  inference; `ollama` is the only on-box option. **Open question RESOLVED** → ADR-006: **graph scope =
  work stream only** (codebase grounding stays milestone 11). A throwaway local Anthropic-compatible shim
  fronting `claude -p` was prototyped in the spike and documented as the generic-gateway fallback (the
  native `claude-cli` backend made it unnecessary).

## Feedback (for retro)

<!-- Raw, attributed notes captured as they happen — mistakes, near-misses, default decisions. Triaged
     into RETROSPECTIVE.md at aof:verify (milestone accept), then this section is archived. -->

_Archived at accept (2026-06-22) — the two notes (the `graph-normalize.mjs` extraction default decision; the
file-pinned-grep near-miss) graduated to [RETROSPECTIVE.md](RETROSPECTIVE.md) R1/R2, joined by R3 (the F-01
git-ignore gap from VERIFICATION). Durable structural decisions live in the ADRs (ARCHITECTURE.md)._

## Verification

<!-- Pointers, not restatements. -->
- [x] `@executable` suite green — full suite **1067 ok / 0 fail**
- [x] Fitness functions green — the six `acd-graphify-*` (story 03), mutation-verified non-vacuous
- [x] `@manual` signed off — the live `claude-cli` work-stream graph build ([VERIFICATION.md](VERIFICATION.md), story-00 lane); no `@uat` (no human-judgement surface)

## Accept decision

**Accepted 2026-06-22** (`aof:verify 10`). All four stories `done`; validate PASS; full suite green; the
one `@manual` lane verified live; F-01 fixed in place (no open blocker); lessons in RETROSPECTIVE.md.
`SPEC.md status: done`. The graphify memory backend is a selectable, derived, source-traceable
graph-reranked backend behind the unchanged `aof work memory` verbs — the slot milestone 05 reserved,
filled.
