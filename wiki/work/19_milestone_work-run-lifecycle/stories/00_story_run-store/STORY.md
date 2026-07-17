---
type: story
number: 00
slug: run-store
title: "The run-record store & state machine — src/run-store.mjs, the derived runs/ log the lifecycle couples through"
parent: 19
status: done
owner: product-owner
created: 2026-06-29
updated: 2026-06-30
schema: 1
aofVersion: 0.1.0
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH.
-->
# 00 · The run-record store & state machine — the spine

## User story

As the foundation the run-lifecycle commands (story 01) — and milestones 20 (resilience) and 21 (board observability) — all couple through,
I want one mechanic, `src/run-store.mjs`, that persists each run as a derived per-run JSON file under the item's `runs/` directory and validates every state change against one explicit transition table,
so that run state is durable, rebuildable, prunable, and partition-ready — an observability/resume log that *explains how an item got to its status* without ever becoming a second, authoritative copy of that status.

<!-- This is the SPINE the milestone exists to make safe: it freezes the run-record schema (ADR-003),
     the runs/ path seam (ADR-002), and the state-machine transition table (ADR-001) that story 01's
     three commands wrap. It owns NO command registration and NO CLI dispatch — only the store mechanic. -->

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 19/00`, Contract stage). Each behaviour task is one
     `.feature` under tasks/; done when its @executable feature is green. The fitness functions are
     arch-tests (structural invariants → never a behaviour feature) tracked as buildable units below. -->

- [x] `tasks/00_run-record-store.feature` — creating a run persists one `runs/<run-id>.json` carrying the frozen schema (sortable `runId`, `itemRef`, `state`, `attempt`, `outcome`, `sessionId`, opaque `brief`, `createdAt`/`updatedAt`); reading returns the item's runs; a story's runs live under the story folder's own `runs/`.
- [x] `tasks/01_state-machine.feature` — the transition table: `running → done|failed|cancelled` legal (sets `outcome == state`, bumps `updatedAt`); an illegal transition (out of a terminal state, a self-loop) is rejected with `illegal-transition` and writes nothing; `queued`'s outbound edges are representable+validated though no store call mints a `queued` run.
- [x] `tasks/02_derived-log-lifecycle.feature` — many runs accumulate as discrete files (audit/retry — "Issue ≠ Task"); history reads are ordered; an absent `runs/` reads as an empty history (not an error); pruning a run file removes exactly that run; the dir is regenerated on the next start.
- [x] **Fitness `acd-run-record-derived`** (arch-test, ADR-002 / fitness #1) — pruning AND rebuilding the `runs/` log leaves the item record-doc bytes **byte-identical** (derived-record invariant; covers the full invariant, not just prune).
- [x] **Fitness `acd-run-write-scope`** (arch-test, ADR-001/002 / fitness #2) — every write the store performs joins `runsDir(...)`; no `writeFile`/`appendFile`/`mkdir` targets an item record doc or its frontmatter.
- [x] **Fitness `acd-run-partition-ready`** (arch-test, ADR-002 / fitness #3) — N runs → N discrete files under `runs/`, no monolithic aggregate; the run path is built by a single seam (`runsDir`/`runRecordPath`) the milestone-26 `<node>/` segment slots into.

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md). This story **owns**: `src/run-store.mjs` —
the run model + the frozen per-run JSON schema (**ADR-003**), the `runs/` path seam `runsDir(item)` /
`runRecordPath(item, runId)` (**ADR-002**), and the state-machine transition table as a pure
from→to validator (**ADR-001**) — plus the three arch-tests above + their registration in
[scripts/test.mjs](../../../../../scripts/test.mjs). It *reads* the existing
[work.mjs](../../../../../src/work.mjs) item model (`listItems`/`recordDoc` resolve the `item.dir` the
`runs/` dir sits in) — it does **not** rewrite it, and it does **not** touch `command-core.mjs`,
`cli.mjs`, or `board-ui.mjs` (those are story 01 / milestone 21).

**Independent because** it consumes nothing new — only the already-shipped `work.mjs` item model and
`node:fs` — and produces the ONE frozen contract (the run-record schema + the path seam + the transition
table) that story 01's three commands wrap. It is the dependency root the call graph dictates store-first
(see ARCHITECTURE §Story break-down rationale): `run-store.mjs` plays the exact spine role `work.mjs`
plays today (a low-fan-out mechanic at the centre of a high-fan-in star), so it can be built and tested
in full isolation before any command exists.

**Feasibility (developer amigo seat — confirmed at Contract): FEASIBLE.** New mechanic, but a small and
well-precedented one — per-run JSON files written with `node:fs` under an item dir `listItems` already
resolves (`item.dir` is the story's own folder for a `NN/SS` ref, so `runs/` lands under the story, never the
milestone), the `feedback.mjs` write discipline (resolve, then write under the item folder) as the local
model, `readDirSafe`'s ENOENT→`[]` as the absence-tolerant-read precedent, and a pure transition-table
function (no I/O) for the state machine. The runId compact form `<YYYYMMDDTHHMMSSsssZ>-<seq>` follows directly
from `toISOString()` punctuation-stripped + a zero-padded live-file count. The one load-bearing constraint —
every write lands under `runs/`, never the record doc — is structural and enforced by `acd-run-write-scope`.

## Build notes (developer-amigo feasibility seat — fold in at `aof:continue`)

<!-- Implementation guidance surfaced at Contract; none is a contract defect (no `.feature`/ADR change). -->

- **Validate-before-write ordering is load-bearing** for `01_state-machine.feature`'s *"an illegal transition
  … writes nothing / byte-unchanged"*: the apply-transition path must `read → compute (from,to) → validate →
  (legal) write / (illegal) throw illegal-transition` — never truncate-then-validate or read-modify-write, so
  a rejected transition leaves the on-disk file byte-identical.
- **`acd-run-record-derived` (fitness #1) must resolve the record doc via `recordDoc(item)`**, not hard-code
  `SPEC.md` — a milestone's record doc is `AOF.md` when present, else `SPEC.md` (`work.mjs:recordDoc`). The
  fixture is a native milestone (so `SPEC.md` happens to be right), but the test should assert the real
  invariant via `recordDoc(item)`.
- **Keep ALL record-doc resolution OUT of `src/run-store.mjs`** so `acd-run-write-scope` (fitness #2) greps
  clean: the store should reference **zero** record-doc filenames (`SPEC.md`/`STORY.md`/`STATE.md`/`SESSION.md`)
  — every path it builds joins `runsDir(item)`. (`seq` is positional over the live `runs/` dir — the runId
  tie-break — and is independent of the per-record `attempt` field, fixed at 1 here; don't conflate them.)
