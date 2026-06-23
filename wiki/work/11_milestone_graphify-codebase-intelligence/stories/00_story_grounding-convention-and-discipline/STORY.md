---
type: story
number: 00
slug: grounding-convention-and-discipline
title: "The grounding convention + the freshness/derivation/advisory/no-op discipline (the spine)"
parent: 11
status: in-review
owner: product-owner
created: 2026-06-22
updated: 2026-06-23
---
# 00 · The grounding convention + the freshness/derivation discipline — the spine

## User story

As the codebase-intelligence milestone wiring graph grounding into three agent decision points,
I want the **shared grounding convention** frozen once — *build-fresh → run the registered `aof graph` command → read the legible output → cite it*, with the codebase graph held as a **derived, git-ignored artifact** rebuilt from current source, the grounding **advisory-only** (read-and-inject into agent context, never auto-acting), and a **silent no-op when graphify is absent** —
so that the two seam stories (01 architect+refine coupling, 02 code-review triage) paste the **same** discipline into their respective prompts without renegotiating freshness, advisory-only, or the absent-binary fallback — and the cross-milestone drift gap (`graphify-out/` not git-ignored today) is closed before any consumer builds a graph.

<!-- This is the SPINE the milestone makes safe: it freezes the convention (ADR-002) + the
     freshness/derivation discipline (ADR-003) + the advisory-only boundary (ADR-004) + the
     no-op-when-absent gate (the existing 09/ADR-004 graphify-missing miss) that stories 01/02 consume.
     It owns NO consumer seam (no aof-architect.md / refine.md / code-review.md edit — those are 01/02)
     and NO arch-test (story 03). Because 11 is pure prompt-wiring (ADR-002) its one concrete structural
     artifact is closing the git-ignore gap; the rest is the convention the seams adopt + agent-observed
     discipline. -->

## Tasks

<!-- Contract authored 2026-06-22 via Three Amigos (`aof:refine 11 --autonomous`): PO headline Scenarios
     + aof-qa Examples/tagging + aof-developer feasibility. Each task is one `.feature` under tasks/.
     The git-ignore is @executable (a CI-checkable structural fact); the convention/freshness/advisory/
     no-op discipline is agent-observed @manual (it needs the live binary + an agent), exactly the 05/03
     read-hook split — there is no @executable render of its own because the 09 command OUTPUT is the
     context (ADR-001/ADR-002). -->

- [x] **00 · [codebase-graph-derived-and-git-ignored](tasks/00_codebase-graph-derived-and-git-ignored.feature)** — `@executable`: `graphify-out/` is git-ignored at the project root (closing the currently-open gap); the built codebase graph is a derived, rebuildable artifact, never committed (ADR-003). _@executable green — repo-root `.gitignore:4` carries `graphify-out/`; `git check-ignore -v graphify-out/` resolves to the ROOT (not m10's in-dir file); the rebuildable scenario is `@manual` (needs a live build, at verify)._
- [x] **01 · [grounding-convention-freshness-advisory-no-op](tasks/01_grounding-convention-freshness-advisory-no-op.feature)** — `@manual`: the frozen convention an agent follows — build-fresh-then-query/triage (freshness *visible* via the 09 `BuildResult` `builtAt`/`egress`), read the legible output (never parse — ADR-001), cite it as **advisory** context (never gate/merge/mutate — ADR-004), and **silent no-op** when graphify is absent (the 09 `graphify-missing` miss → proceed on grep-and-infer, behaving identically to today). _`@manual` signed off `2026-06-22` (`aof:verify`): build-fresh + freshness-visible (builtAt/egress/275·549) and legible-output confirmed live; advisory confirmed (prompt + architect demonstrated). CAVEAT (VERIFICATION F11-2, non-blocker): the no-op clause covers only `graphify-missing`, not a present-but-failing build — deferred prompt refinement._

**Build + review (2026-06-22, `aof:continue 11`):** `graphify-out/` added to the repo-root `.gitignore:4`
(build-independent — `git check-ignore -v graphify-out/` resolves to the ROOT, defeating m10's in-dir-file
vacuity trap). ZERO production code (ADR-002). The convention is frozen and pasted byte-consistent into the
01/02 seams. **Architect: CONFORMS** (ADR-003/derived honoured). **QA: PASS** (the @executable git-ignore
facts verified directly — root resolution, `graph.json` ignored, nothing tracked). Remaining for `done`:
the `@manual` convention + rebuildable sign-off at `aof:verify` (needs the live binary).

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) (**ADR-001** agent-consumed legible output /
no-parse, **ADR-002** pure prompt-wiring / no new module, **ADR-003** build-fresh freshness + git-ignored
derived `graphify-out/`, **ADR-004** advisory-only, **ADR-005** reach-via-09-commands + codebase scope).
This story **owns**: the `graphify-out/` git-ignore (the one concrete structural artifact — extends the
`10/ADR-005` derived/git-ignore idiom to the codebase graph) and the **shared grounding convention** the
seam stories adopt (build-fresh → run the registered command → read the legible output → cite it;
advisory; no-op when absent; freshness surfaced). It edits **no consumer seam** (01 owns
`aof-architect.md` + `refine.md`; 02 owns `code-review.md`) and authors **no arch-test** (03).

**Independent because** it consumes only the already-frozen 09 command contract (`09/ADR-001/004/005`) and
the `10/ADR-005` git-ignore idiom, and produces the ONE frozen contract the siblings consume: the
convention text + the git-ignore. 01 and 02 paste the convention into their prompts without renegotiating
freshness/advisory/no-op; story 03's `acd-codebase-graph-derived` arch-test pins the git-ignore.

**Cross-milestone note (architect, retro):** `graphify-out/` is not git-ignored today (`git check-ignore
graphify-out` misses; the session `git status` shows it `?? untracked`) — a latent drift vector across
**both** milestone 10 (its derived work-stream graph) and 11 (the codebase graph). Closing it here covers
the codebase graph; the 10 derived `graphify-out/` is covered by the same `.gitignore` entry (it sits at
the same project root). See STATE §Feedback (for retro).
