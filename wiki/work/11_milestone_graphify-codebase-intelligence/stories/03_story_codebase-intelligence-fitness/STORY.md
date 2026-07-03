---
type: story
number: 03
slug: codebase-intelligence-fitness
title: "The codebase-intelligence fitness functions — no-parse, via-commands, advisory-only, derived/git-ignored — as arch-tests"
parent: 11
status: done
owner: product-owner
created: 2026-06-22
updated: 2026-06-23
---
# 03 · The codebase-intelligence fitness functions — the load-bearing structural guarantee

## User story

As the architecture itself (the "grounding is agent-consumed command output never parsed by aof; the loop reaches the graph only through the 09 commands with no new spawn site; the grounding is advisory-only — no auto-act; and the codebase graph is a git-ignored derived artifact" guarantee),
I want the structural invariants of ADR-001…ADR-005 enforced as CI **arch-tests**,
so that the contract is **durable**: a future change that parses `graph:query`/`graph:triage` markdown into a data shape, adds a bespoke graphify spawn or a new graph-reaching module, wires a graph finding into a gate/merge/work-mutation, or commits the derived codebase graph — fails CI **loudly** instead of silently re-introducing the drift.

## Tasks

<!-- This story's deliverable is the FITNESS FUNCTIONS of the ARCHITECTURE.md table — arch-tests, NOT
     task `.feature` scenarios (structural invariants belong in the fitness table, never inside a
     behaviour feature). Its contract is therefore ALREADY fully specified by the fitness-functions table
     — there is no Three-Amigos `.feature`-authoring pass to run; `aof:continue 11/03` authors the
     arch-tests directly and they turn GREEN as 00/01/02 land (mirrors 05/03, 09/03, 10/03). The four
     arch-tests are tracked here as the story's buildable units. -->

- [x] `test/arch/acd-codebase-grounding-no-parse.test.mjs` — **no-parse / legible-output**: no 11 seam parses `graph:query`/`graph:triage` `stdout` into a data shape, and no 11-introduced `src/` module reads `graph.json` / imports `normalizeGraph`/`readGraph` — the grounding is agent-consumed command OUTPUT — ADR-001 _GREEN (4 assertions; mutation-verified)_
- [x] `test/arch/acd-codebase-grounding-via-commands.test.mjs` — **reached only via the 09 commands; no new spawn/module**: the only `graphify` spawn in `src/` remains `src/graphify.mjs`; 11 adds no `src/` module reaching the graph by any path other than `invoke("graph:…")` / the CLI / the pure reads; the bundled seams invoke `aof graph build/query/triage` — extends the 09 `acd-graph-no-face-spawn` idiom — ADR-002, ADR-005 _GREEN (3 assertions; mutation-verified)_
- [x] `test/arch/acd-codebase-grounding-advisory.test.mjs` — **advisory-only / no auto-act**: no `graph:*` output from any 11 seam feeds a gate / merge (`work.codeReview.autoComplete`) / status-write / work-mutation; the grounding is read-and-inject into agent context only; the triage queue is ranking context, never an auto-block — ADR-004 _GREEN (4 assertions; mutation-verified)_
- [x] `test/arch/acd-codebase-graph-derived.test.mjs` — **derived + git-ignored**: the repo-ROOT `.gitignore` carries `graphify-out/` (build-independent; `git check-ignore -v` resolves to the root, not m10's in-dir file); the freshness prompt step builds-then-queries (surfacing `builtAt`/`egress`); the codebase graph is rebuildable, never committed — ADR-003 _GREEN (4 assertions; mutation-verified)_

**Build + review (2026-06-22, `aof:continue 11`):** all four `test/arch/acd-codebase-*` authored (15
assertions total) + registered in [scripts/test.mjs](../../../../../scripts/test.mjs) (the canonical
runner — NOT the stale `scripts/test-unit.mjs`, which omits the graph tests). **All GREEN; full suite
1082 ok / 0 fail.** Non-vacuity mutation-verified per test (remove the advisory line / inject a graphify
spawn / drop the root `.gitignore` entry / query-before-build → each goes RED, reverted). The
derived-test pins the **repo-root** `.gitignore` (not m10's in-dir file), so it is non-vacuous against a
real in-dir file present on disk. Fitness-only story (no `.feature`, no `@manual`) → at `aof:verify` it is
the four green + validate. **Architect: CONFORMS** (arch-tests faithful to the ADR-006 table). **QA: PASS**.

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) (the **Fitness functions** table — the
load-bearing deliverable). This story **owns** the four arch-tests above + their registration in
[scripts/test.mjs](../../../../../scripts/test.mjs). It authors **no production code**.

**Independent because** it asserts against the **frozen** convention (story 00) + the wired seams (stories
01/02) but consumes **none of their internals**: it source-greps the bundled prompt content + the spawn/
import surface, and runs `git check-ignore`. Owning no production code, it cannot block — or be blocked by
— the siblings; the prompt-content + git-ignore guards are RED-until-built by design (they reference the
00/01/02 seams and fail cleanly until those land), and the no-new-spawn/no-new-module guard is GREEN-now
(11 adds nothing — a regression guard it STAYS so).

> **Note (a separately-tracked deliverable, not a behaviour story):** the SPEC names the advisory-only +
> derived-from-source guarantees as load-bearing, so they get their own owner and review surface here. But
> the units are *arch-tests*, not `.feature` files — there is no Three-Amigos Contract pass; the contract
> is the ARCHITECTURE.md fitness table (mirrors 05/03, 09/03, 10/03).
