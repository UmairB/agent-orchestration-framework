---
type: story
number: 02
slug: isolated-worker-execution
title: "Isolated worker execution — a worker accepts a directive, materializes the ref in a dedicated git worktree, drives it to a terminal run, and streams the lifecycle back; reclaimed if the worker dies"
parent: 35
status: done
owner: product-owner
created: 2026-07-08
updated: 2026-07-09
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH / SECURITY.
-->
# 02 · Isolated worker execution — the headline: assigning work creates a worktree, and the worker runs it

## User story

As a **worker-node operator**, I want my node to take an assignment handed to it over the mesh, run it in
its **own dedicated git worktree** — isolated from my local work and from every other assignment — and
report `accepted → running → done|failed` back up the stream, so that concurrent assignments never collide,
a crashed run is recovered automatically, and the answer to "does assigning work create a worktree?" is
finally **yes**.

<!-- The HEADLINE story. On an accepted directive the worker: guards that it actually has the repo, creates
     a worktree keyed by assignmentId under .aof/mesh/worktrees/, mints a NODE-PARTITIONED run through the
     existing run-store (mesh-blind), drives the ref to a terminal state via a bounded headless runtime,
     completes the run, emits each transition up the channel, and cleans up (retain on failure). A worker
     that dies mid-run has its assignment reclaimed under DUAL staleness. This is where the worktree +
     run-lifecycle bracketing live. -->

## Tasks

<!-- Contract authored `2026-07-08` via `aof:refine 35 --autonomous` (Three Amigos: PO headline + aof-qa
     Examples + aof-developer feasibility). `@executable` over real `git worktree` in a temp repo + injected
     runtime spawn + injected clocks (RESEARCH.md measured worktree + headless-runtime reality). One
     end-to-end `@manual` two-machine soak — the milestone's deferred human gate. -->

- [x] [`tasks/00_worktree-materialize.feature`](tasks/00_worktree-materialize.feature) — `@executable` — on
  an accepted directive, materialize a dedicated `git worktree add` (detached-at-commit) under the ONE seam
  `.aof/mesh/worktrees/<assignmentId>/`; concurrent assignments get distinct, non-colliding worktrees; the
  path is scoped to that root and the ref (validated against the folder allowlist) can never escape it
  (ADR-004, SECURITY T4).
- [x] [`tasks/01_worker-repo-guard.feature`](tasks/01_worker-repo-guard.feature) — `@executable` — BEFORE
  any worktree, the worker re-checks it actually has the repo for `workspaceId` (`global_node_workspaces` +
  local `mesh.repo.published`); a miss streams a loud coded `assignment-repo-unavailable` `failed` up the
  channel — never an opaque crash, never a worktree (ADR-004, SECURITY T3, 34/ADR-008).
- [x] [`tasks/02_run-lifecycle-bracketing.feature`](tasks/02_run-lifecycle-bracketing.feature) —
  `@executable` — mint a node-partitioned run (`startRun(item, { node })`), heartbeat it, drive the ref to a
  terminal state via a bounded headless runtime, `completeRun`; each edge emits an `assignment-status` frame
  (`accepted → running` sets `runId` → `done|failed`); the run-store stays mesh-blind (node id as DATA)
  (ADR-004).
- [x] [`tasks/03_worktree-cleanup-retention.feature`](tasks/03_worktree-cleanup-retention.feature) —
  `@executable` — on `done` the worktree is removed with `git worktree remove` (never `rm` — RESEARCH.md:
  manual removal leaves stale `prunable` metadata that blocks path reuse); on `failed` it is RETAINED for
  inspection, bounded by a documented retention default; double-assign never reaches here (refused upstream
  by ADR-003) (ADR-004).
- [x] [`tasks/04_reclaim-on-worker-death.feature`](tasks/04_reclaim-on-worker-death.feature) — `@executable`
  — a non-terminal assignment is reclaimed to `reclaimed` (+ `reclaimedAt`, force-failing the run
  `runtime_offline`, retryable) ONLY under DUAL staleness — worker presence stale (`isNodeStale`, 90s) AND
  run heartbeat stale (`isStale`, 15m), both strict `>`; fresh presence and no-presence-record are hands-off
  (ADR-005, mining `fleet-orphan-reclaim`).
- [ ] [`tasks/05_two-machine-assignment-soak.feature`](tasks/05_two-machine-assignment-soak.feature) —
  `@manual` — the real control(Windows)→worker(macOS) dispatch over Tailscale: assign a story from the
  control node; the worker runs it in its own worktree without colliding with its local work; the fleet view
  advances `assigned → running → done` live; kill the worker mid-run and confirm the assignment goes
  `reclaimed`. **Deferred human gate** — the cross-machine dispatch + real worktree + live advance are the
  only parts not covered by the `@executable` 00–04 lanes; validated at `aof:verify` (spans stories 01/02/03).
- [x] [`tasks/06_reclaim-scheduler.feature`](tasks/06_reclaim-scheduler.feature) — `@executable` — the control-node
  launcher runs `reclaimStaleAssignments` on its periodic tick (the missing scheduler — B2), so a dual-stale
  assignment converges to `reclaimed` live without a manual call; reuses ADR-005's decision verbatim; shares the
  one control driver with the dispatch scan (ADR-008). Added at Review to close the reclaim-scheduler gap.

## Fitness units (proposed)

Inherited from [ARCHITECTURE.md](../../ARCHITECTURE.md) and [SECURITY.md](../../SECURITY.md) — this story arms:

- `acd-assignment-worktree-path-scoped` (ADR-004 / SECURITY T4) — every `git worktree add` target joins the
  ONE `meshWorktreePath(assignmentId)` seam under `.aof/mesh/worktrees/`; no `os.tmpdir()` / hand-built path.
- `acd-assignment-repo-availability-loud` (ADR-004 / SECURITY T3 / 34-ADR-008) — the repo guard precedes the
  worktree create and emits a coded miss on failure.
- `acd-assignment-reclaim-dual-staleness` (ADR-005) — reclaim ANDs `isNodeStale` (imported from
  `mesh-presence`) with `isStale` (imported from `run-store`); no single-predicate reclaim, no
  missing-presence-as-stale.
- `acd-assignment-run-store-mesh-blind` (ADR-004) — the run-store imports no mesh/assignment module; the
  worker calls `startRun(item, { node })` with the node id as an option (re-arms `acd-fleet-reclaim-guarded`).

## Notes

Inherits **ADR-004** (worktree-per-assignment + run-store reuse + cleanup/retention + repo guard) and
**ADR-005** (dual-staleness reclaim) and **ADR-006** (auto-accept within the tailnet boundary — no local
confirm). Inherits [SECURITY.md](../../SECURITY.md) T3 (repo guard), T4 (worktree scoping), and the RCE
posture (T1 residual risk is accepted/out-of-scope per SPEC — this story runs assigned work within the
tailnet boundary).

**Depends:** Story 00 (the record it advances) + Story 01 (the channel seam — it consumes the parsed
directive the transport hands to its handler and emits status over `sendAssignmentStatus`). Independent of
Story 03.

**Execution depth — documented default (RESEARCH.md).** There is NO execution driver in `src/` today and
`runtimes: [...]` is scaffolding metadata, not invocation config. The documented default this milestone
takes: the worker drives the ref to a terminal run via a **bounded headless runtime** — `claude -p
--output-format json` (measured working) or `codex exec --json -o <file> --sandbox … --ask-for-approval
never` (a first-class non-interactive subcommand) — spawned in the worktree, bracketed by
`run-start`/`run-complete`. This does NOT reproduce `aof:continue`'s full multi-agent build+review depth; the
outsider-verifiable success ("assigned → running → done|failed live, in an isolated worktree") is satisfied
by a bounded headless run. The exact driver + the brief it carries is pinned by the aof-developer feasibility
seat at build (see Build notes).

**Worktree feasibility (RESEARCH.md, measured):** detached-at-commit worktrees are fast (~1.16s) and allow
concurrency; 5-way concurrent `git worktree add` succeeded with no `index.lock` contention (caveat: never
two worktrees on the same branch name — use detached commits); `core.longpaths=true` is set; **`node_modules`
is gitignored and is NOT materialized by `worktree add`** — a worktree that runs a build needs its own dep
install (a real build-order flag, not a blocker).

## Build notes (developer-amigo feasibility seat — folded in at Contract)

**Verdict: tasks 00–04 stay `@executable`, task 05 irreducibly `@manual`.** No retag. The `@executable` lanes
run over a real `git worktree` in a temp repo + an injected runtime-spawn + injected clocks. `run-store`'s
`startRun`/`heartbeat`/`completeRun`/`reclaimStaleRuns`/`isStale` (`:294`/`:488`/`:416`/`:525`/`:508`) and
`mesh-presence.isNodeStale` (`:202-204` → `isStale`) are reused UNMODIFIED — real reuse, not aspirational.

- **Net-new infra to budget:** (1) an **injected runtime-spawn seam** (mirroring the `transport`/`ticker`
  injection idiom) — REQUIRED before tasks 00/02/03 can be fixtured; the stub scripts `done`/`failed` without
  a real binary. (2) a real-`git worktree`-in-temp-repo harness (RESEARCH.md's measurements are directly
  reusable as assertions). (3) **`node_modules` per worktree:** a worktree that builds the ref needs its own
  dep install — invoke `npm ci` in the worktree BEFORE spawning the runtime, INSIDE the `accepted → running`
  gap; do NOT add a new lifecycle state for it.
- **Recommended default driver: `claude -p --output-format json`** (the one RESEARCH.md exercised with a real
  transcript — `stop_reason`/`terminal_reason` map straight to `done`/`failed`; simpler worktree-cwd story
  than codex's sandbox/approval matrix). Keep the spawn seam **driver-pluggable** (`codex exec --json -o <file>
  --sandbox workspace-write --ask-for-approval never` is the valid fallback; `runtimes:[…]` expresses per-node
  preference). The brief carries: `itemRef` + the worktree cwd + enough task context for ONE non-interactive
  turn — scoped honestly to "drive this ref to a terminal state," NOT to reproduce `aof:continue`'s
  multi-agent build+review depth.
  **⚠ Scope call for the operator:** a single headless turn is a BOUNDED proxy for the build half — it proves
  the dispatch/isolation/lifecycle, not that the assigned work was completed to full ACD quality. Taken as a
  documented default (STATE.md, ADR-004); revisit if the milestone quality bar demands deeper execution.
- **Windows child-cwd-at-cleanup — handled by SEQUENCING, not detection.** The spawn seam's contract must be:
  `spawnRuntime` resolves ONLY after the child has fully EXITED (never stdout-drained-but-alive). Because
  terminal status (→ cleanup, task 03) is observed only after exit, the fixtured lane (fake spawn, no live
  cwd) cannot manifest the race and the real residue lands only on the `@manual` soak (05). Make this an
  explicit spawn-seam invariant at build.
- **Reclaim at-threshold row is byte-stable — confirmed.** `isStale` is `age > threshold` (pure,
  caller-supplied `now`+threshold); seed `heartbeatAt` at exactly `now − thresholdMs` → `false`
  deterministically. Keep the injected `now` threading through the reclaim decision (no wall clock).
- **HARD build-order `02 → 00, 01`.** Story 02 can begin tasks 00/01 once Story 01's task-00 handler
  registration SHAPE is frozen, against an interim stub `{ onDirective(handler), sendAssignmentStatus(frame) }`
  — without waiting for Story 01's tasks 01/02 to be code-complete.
