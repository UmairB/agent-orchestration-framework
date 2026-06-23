# PRD — Work-Run Orchestration

> Planning PRD for the work-run orchestration arc. Upstream of ACD: this document is the seam
> `aof:shatter` consumes to lay out the milestone roadmap. Derived from a gap analysis of
> [multica-ai/multica](https://github.com/multica-ai/multica) — an open-source *managed-agents
> platform* (Go server + local daemon + Postgres) whose board is an **execution control plane**.
> Multica is the prior art for the orchestration mechanics below; aof adopts the *mechanics*, not the
> platform (no server, daemon fleet, DB, or auth — the work stream stays the source of truth).

## Objective

**Objective.** Turn aof's board from a *read-mostly viewer* into a durable, observable, resumable
**run lifecycle** anchored in the command core. Today [board-ui.mjs](../../src/board-ui.mjs) is a thin
face over [command-core.mjs](../../src/command-core.mjs) exposing `list / doc / tasks / validate /
next / feedback` — it *shows* the work stream and names the next pipeline stage but never records what
actually *ran*; and `aof autonomous` already loops `refine → build → verify` driven by `aof work next`
gating on `aof work validate`, claiming to be "resumable" — but with no durable run state behind that
claim. This arc closes that gap by separating the durable **work item** from each **run** of it, and
giving runs an explicit state machine (`queued → running → done / failed / cancelled`) recorded *in*
the work stream as a derived artifact. On that foundation it lifts the orchestration mechanics that
make Multica's distributed runner robust — retryable-vs-non-retryable failure classification,
resume-the-session-on-infra-failure / start-fresh-on-rejection, attempt ceilings, heartbeat/liveness,
orphaned-run reclaim on restart, and anti-loop delegation guards — and adapts each to aof's
file-based, single-operator model. The payoff is two value axes. First, **resilience**: a multi-hour
`autonomous` cascade that crashes, stalls, or hits a blocker is detectable and resumable instead of
silently wedged. Second, **observability**: the board (and CLI, and MCP) shows run history, the
current run's state, and a rerun affordance per item — all through the one registry door, never a
side-channel. The arc is foundation-first: the run lifecycle is the enabler both consumers build on,
so it ships first and the autonomous-resilience and board-observability seams fan out from it.

## Context & Constraints

- **The command core is the single door (milestone 08).** Milestone 08 establishes that every
  operation is a registered command and that the CLI / board UI / MCP are thin faces that may *only*
  invoke registered commands (ADR-001/004, bijection arch-test). So the run lifecycle is authored **as
  command-core commands** (`work:run-start`, `work:run-status`, `work:run-complete`, …); the board and
  CLI faces inherit execution control for free. This makes 08 a precedent (and dependency) the
  foundation milestone inherits rather than re-litigates.
- **Multica's split mirrors aof's, which is why the mechanics port.** Multica's *server* owns data and
  is a WS hub but **never executes**; its *daemon* executes but **holds no durable state**. That is the
  same shape as aof's *command-core owns operations* / *faces are thin adapters*. The orchestration
  belongs in the core as commands, not in a face — exactly where 08 already points.
- **Prior-art mechanics worth lifting (concrete).** From Multica's task model:
  *(a)* **Issue ≠ Task** — the item is durable; every trigger produces a new run, giving clean audit
  and retry. *(b)* an explicit run **state machine** with **retryable** (`runtime_offline`/`timeout`)
  vs **non-retryable** (`agent_error`) failure reasons and a **2-attempt ceiling**. *(c)* a sharp
  **session rule**: auto-retry *resumes* the prior session (infra failure → continue) while a manual
  rerun starts *fresh* ("you judged the output bad — don't replay poisoned state"). *(d)*
  **liveness**: heartbeat + missing-after-N + a periodic backstop scan that reclaims a crashed
  runner's in-flight work. *(e)* **squad-leader delegation** with an injected operating-protocol +
  roster, **dedup** (no duplicate queued run per item) and **anti-loop guards** (skip self-triggers).
  *(f)* a **structured brief** injected per run (workspace context, requesting user, task initiator,
  resources, skills). *(g)* status **rollback** on failure (`in_progress → todo`).
- **aof already has the seams these plug into.** The `aof:autonomous` skill is the orchestration loop
  (`aof work next` + `aof work validate`, stopping only on `@uat`, a blocker, or unsafe ambiguity);
  it needs the durable run record to make "resumable" and "stops on blocker" robust. The work stream's
  `STATE.md` per item is the natural home for the run log; the `--autonomous` cascade ("all sub-steps
  + review once at the end") is the primary consumer of resume-vs-fresh semantics.
- **The derived-run-record invariant must hold.** A run record is a *derived* artifact — an
  observability/resume log, never an authoritative second copy of item state. Item status (frontmatter)
  stays the source of truth; the run log explains *how it got there* and must be rebuildable/prunable.
  This is the same single-source-of-truth constraint milestones 05/09 enforce.
- **Single-operator, file-based — adopt mechanics, not infrastructure.** No server, daemon fleet,
  Postgres, WebSocket hub, auth, or workspaces. "Liveness" is a heartbeat file, not a 3s network poll;
  "reclaim" is a restart-time scan of run records, not a 30s server sweep. The platform half is
  Multica's moat and explicitly out of scope.

## Scope

### In scope

- A **run lifecycle as registered command-core commands** (the milestone-08 contract): the item/run
  split, a run state machine (`queued → running → done / failed / cancelled`), and run records
  persisted as a derived log in the work stream (per-item `STATE.md` or a runs log), each capturing
  attempt count, outcome, session id, and the structured brief the run was spawned with — with stable
  `--json` shapes and the board + CLI faces invoking those commands.
- **Autonomous resilience** consuming the run lifecycle: retryable-vs-non-retryable classification,
  resume-session-on-infra-failure / fresh-session-on-rejection, an attempt ceiling, a heartbeat +
  restart-time orphan reclaim, blocker/status rollback, and dedup + anti-loop guards for multi-agent
  hand-offs in the cascade — conforming to the existing `aof:autonomous` stop conditions (`@uat`,
  blocker, unsafe ambiguity).
- **Board run observability**: surface run history per item, the current run's state, and a
  rerun affordance — all reached through the registered commands (no side-channel), preserving the
  read-mostly board's transport/path-display face discipline.

### Out of scope

- Any server / daemon / Postgres / WebSocket-hub / auth / multi-workspace infrastructure — aof stays
  file-based and single-operator; it adopts Multica's mechanics, not its platform.
- Executing agents *for* the user — aof orchestrates the operator's local agent session; it does not
  become a runner that spawns and bills agent processes.
- Real-time push to a live web client — observability is poll/refresh over the existing read-mostly
  board, not a WS event stream (revisit only if the board ever becomes interactive).
- New aof runtimes beyond those already supported (`claude`, `codex`).
- The adjacent incorporable techniques below — captured for the roadmap but their own arcs.

## Milestones

> Foundation-first: the first chunk is the enabler; the two consumer chunks each depend on it and are
> otherwise independent of each other (parallel-eligible once the foundation lands).

- **work-run-lifecycle** — the foundation. Split the durable work item from each run of it; author the
  run state machine and `work:run-*` operations into the command core with stable `--json` contracts;
  persist run records as a derived log in the work stream (attempt, outcome, session id, structured
  brief). This is the contract the other two consume. **Depends on milestone 08 (cli-command-core)** —
  it authors run ops into the command core 08 establishes.
- **autonomous-run-resilience** — make the loop robust. Consume the run lifecycle in `aof:autonomous`:
  retryable/non-retryable classification, resume-vs-fresh session semantics, attempt ceiling,
  heartbeat + restart-time orphan reclaim, status rollback on blocker, and dedup + anti-loop guards on
  multi-agent hand-offs. **Depends on the work-run-lifecycle foundation and on the autonomous loop**
  (`aof work next` / `aof work validate`).
- **board-run-observability** — make the run visible. Surface run history, current-run state, and a
  rerun affordance on the board through the registered commands, preserving the thin-face discipline.
  **Depends on the work-run-lifecycle foundation and on milestone 03 (work-board-ui)** (independent of
  autonomous-run-resilience — both consume the foundation).

## Adjacent techniques (separate arcs — captured, not scoped here)

> Other genuinely-incorporable mechanics surfaced by the Multica gap analysis. Recorded so they are
> not lost; each is its own arc, not part of work-run orchestration.

- **Managed config-block injection (adapter hardening).** Multica's daemon merges `BEGIN/END`
  marker-delimited managed blocks into a *per-task* `CODEX_HOME/config.toml` — idempotent regex
  strip/replace, adapts to the user's existing TOML table layout, and **never touches the user's
  global config**. aof's [adapters.mjs](../../src/adapters.mjs) own whole files today; for any file aof
  must *merge into* rather than own (notably codex `config.toml`), this is the robust co-existence
  pattern. → an `assets`/render-plan arc.
- **Webhook / autopilot triggers.** aof has `/schedule`; the additive idea is *webhook → create work
  item* (e.g. a CI failure POSTs → spawns a remediation task), with `create_issue`-style vs
  `run_only`-style modes and missed-trigger catch-up. → a scheduling/trigger arc.
