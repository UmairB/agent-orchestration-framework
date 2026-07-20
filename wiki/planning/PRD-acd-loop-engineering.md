# PRD — ACD as a Loop-Engineered Model

> Planning PRD for the loop-engineering arc. Upstream of ACD: this is the seam `aof:shatter` consumes
> to lay out the milestone roadmap. Origin: the **loop-engineering** thesis (Boris Cherny / Anthropic;
> LangChain's *Art of Loop Engineering*; the practitioner CLI patterns in
> `cobusgreyling/loop-engineering`) — the shift from prompting an agent by hand to **designing the
> system that prompts, checks, remembers, and re-runs it**, continuing until a defined termination
> condition is met. The finding of this review: **ACD is already a loop-engineered system in all but
> name.** It has the maker/checker sub-agents, the durable STATE + memory spine, worktree isolation,
> deterministic gates, and — as of the loop-performance arc — transcript observability and a
> retrospective→memory pass. What it lacks is the loop **driven from the CLI as code, not from a Claude prompt** —
> an explicit `aof work loop` shell that owns sequencing, gates, caps and session lifecycle — plus the
> three capabilities that shell unlocks: a **closed self-improvement (hill-climbing) loop**,
> **event-driven triggers** (an event just *calls the CLI*), and a **tight verification feedback loop**.
> Crucially the hard part is already built:
> [mesh-worker-execution.mjs](../../src/mesh-worker-execution.mjs) already spawns an interactive
> `claude` in a PTY terminal session, drives it to done/failed, is resumable, and detects the session
> from the transcript — but only inside the mesh path. This arc promotes that driver to the **local
> loop spine** and, with it, ACD from an *implicit* loop to a *first-class, code-owned* one.

> **Relationship to [PRD-acd-loop-performance.md](./PRD-acd-loop-performance.md).** That arc tunes the
> *economics* of the inner loop (telemetry, model spend, build-loop discipline, headless driver). This
> arc engineers the *structure* of the loop itself. They share a foundation (telemetry / observability)
> and must not duplicate it — loop-performance owns cost/model levers; this owns loop shape, autonomy,
> and self-improvement. Where they touch, this PRD defers to loop-performance and says so.

## Objective

**Objective.** Turn ACD's loop into a **designed, inspectable, self-improving control system** — one
where "run this milestone" means *the loop drives itself to a terminal state, escalates only real
gates, learns from its own traces, and can wake on an event without a human at the keyboard*. Four
levers, foundation-first: (1) **make the loop a CLI-driven artifact** — an explicit `aof work loop
<ref|range>` that is the *code-owned shell*: it sequences via `aof work next`, spawns a per-phase
session (the atomic `aof work refine|continue|verify <ref>` drivers), enforces the gates, caps, budget
and stop-conditions **in code**, and is **resumable** across a machine-off — the phase *prompts* stay
the agent node, the CLI owns only the shell. It carries an **L1 report → L2 assisted → L3 unattended**
autonomy ladder and a **Loop-Ready score**, so "how autonomous is this run" is a flag, not a vibe; (2) **tighten verification into a feedback loop** — treat the
`@executable` scenarios + fitness functions as the loop's rubric and feed structured grader output
back into the maker with a bounded retry, rather than a coarse pass/fail stage; (3) **close the
self-improvement loop** — an analysis pass over the accumulated observability + retrospectives that
*proposes* harness tuning (model map, caps, prompt/brief revisions), human-gated at L2 and auto-applied
at L3 — the hill-climbing loop ACD is one step from, having just shipped the telemetry and the
memory-ingest half; (4) **make the loop event-driven** — let it wake on a trigger (cron, PR, mesh
assignment, inbound finding) through the existing mesh substrate, not only a human `/aof:autonomous`.
Throughout, the CLI-as-contract spine (milestone 08) holds: every new observable lands as a registered
command with a `--json` contract, and prompts/board stay thin faces.

## Context & Constraints

### ACD mapped onto the loop stack (findings from the review, 2026-07)

The four-level loop stack (LangChain) and the practitioner anatomy (maker/checker sub-agents,
worktrees, durable knowledge, MCP, STATE/LOOP spine, gates, budget, Loop-Ready score) map onto
aof-as-built as follows — **most of it already exists**:

- **Agent loop — present.** aof spawns role agents that call tools until a task is reached; the
  build-to-green inner loop ([continue.md](../../src/bundle/commands/continue.md)) *is* an agent loop.
  Gap: it is uncapped (loop-performance owns the cap).
- **Maker/checker separation — present and strong.** The entire ACD role model *is* maker/checker:
  developer = maker; architect / QA / security = checkers, with tool-scoped agents
  ([bundle/agents](../../src/bundle/agents)). This is aof's single biggest loop-engineering asset —
  loop engineering treats maker/checker as an advanced pattern; ACD makes it the default.
- **Durable STATE + memory spine — present.** Every item carries a `STATE.md` (durable decision log)
  and ADRs; `aof work memory` recall/ingest ([work-memory.mjs](../../src/work-memory.mjs)) is the
  cross-run knowledge spine. This is exactly loop engineering's `STATE.md` + durable-Skills spine.
- **Worktree isolation — present.** [mesh-worktree.mjs](../../src/mesh-worktree.mjs) / continue's
  worktree-isolate path give the parallel-execution environments the anatomy calls for.
- **Verification loop — partial.** [verify.md](../../src/bundle/commands/verify.md) has the rubric
  (`@executable` scenarios + fitness functions) and the feedback (findings → back to continue), but it
  runs as a **coarse stage**, not a tight grader-middleware loop that re-drives the maker turn-by-turn
  with structured feedback under a cap.
- **Loop control — prompt-driven today, but the code substrate is half-built.** The loop is DRIVEN
  from a Claude prompt: [autonomous.md](../../src/bundle/commands/autonomous.md) is a meta-prompt that
  loops on the deterministic `aof work next` ([work.mjs](../../src/work.mjs) `nextWork`) and dispatches
  the phase slash-commands. So the *sequencer* is already code, but the *dispatcher, session lifecycle,
  caps and stop-conditions* live in prose — which is exactly why the build-loop cap is unenforceable (a
  prompt instruction the model may skip). Yet the code-driven driver already exists in the mesh path:
  [mesh-worker-execution.mjs](../../src/mesh-worker-execution.mjs) spawns interactive `claude` in a
  node-pty PTY via the `terminal-providers` seam, resolves to `{outcome: done|failed}`, is resumable
  (`claude --resume`), detects the session from the first new transcript `.jsonl` (reusing
  `claudeProjectsDir` from `work-observe.mjs`), and is driver-pluggable (claude / codex). It is scoped
  to mesh work-assignment, not exposed as a local loop. **Promoting it to `aof work loop` is the
  central move of this arc.**
- **Event-driven loop — weak, but trivial once the loop is a CLI entrypoint.** No cron / webhook / PR /
  assignment trigger *wakes* the loop today; it is human-invoked (`/aof:autonomous`). Once the loop is
  `aof work loop <ref>`, an event just *calls the CLI* — the trigger no longer needs a Claude session
  to be the orchestrator.
- **Hill-climbing loop — missing, but half-built.** aof does not yet feed its own run traces back to
  improve the harness. **The raw material now exists**: `aof work observe`
  ([work-observe.mjs](../../src/work-observe.mjs)) produces per-agent traces (toolchain-wait, grind,
  edit↔test rhythm), and the retrospective→`memory ingest` pass distils lessons. The missing arc is the
  step that *closes* the loop: an analysis pass that turns those traces into **harness changes**.
- **Autonomy ladder + Loop-Ready score — implicit.** aof spans L1 (the read-only observe report), L2
  (review-stops), and L3 (`--autonomous` cascade), and `aof work doctor` / `validate`
  ([work-doctor.mjs](../../src/work-doctor.mjs)) are a proto Loop-Ready check — but none of it is
  surfaced as an explicit maturity level or a single readiness score.

### Constraints

- **The loop stays a governed loop.** No lever may weaken the ACD gates: a self-improving harness may
  *propose* a model-map or cap change, but the locked contract, litmus, tag vocabulary, and the
  nine-stage semantics are out of bounds — the loop tunes its *economics and cadence*, never its
  *standards*. Hill-climbing is human-gated until explicitly promoted to L3.
- **The CLI owns the loop SHELL only.** `aof work loop` owns sequencing, gate order, caps, budget,
  session lifecycle, retry and stop-conditions — deterministic control. It NEVER encodes product
  judgment: "blocker vs documented default", triage, story-independence, and review verdicts stay in
  the spawned agent turns. Human gates (`@uat`) and genuine blockers **pause and surface**, never
  auto-proceed or get swallowed by the shell.
- **Prompts + config are assets with a manifest.** Loop-spec and prompt edits ride the existing
  bundle/manifest-hash machinery ([work-bundle.mjs](../../src/work-bundle.mjs)); rendered `.claude/`
  output stays generated.
- **CLI-as-contract spine holds (milestone 08).** Every new observable (Loop-Ready score, loop state,
  harness-tuning proposal) is a registered command with a stable `--json` contract; the board and
  prompts are thin faces over it.
- **Do not duplicate loop-performance.** Telemetry, token budget/`loop-cost`, model-economics, and the
  build-loop cap are that arc's; this arc *consumes* them (the cap becomes the verification loop's
  bound; the telemetry becomes the hill-climber's input).
- **Auto-tuning is attempt/trace-evidenced, never speculative.** A harness change must trace to
  observed run evidence (a measured grind, a recurring finding class), mirroring loop-performance's
  "escalation is observed failure, never predicted."

## Scope

### In scope

- **The loop as a CLI-driven artifact + autonomy ladder.** Promote the mesh PTY driver to the local
  loop spine:
  - **`aof work loop <ref|range>`** — the code-owned shell. Loops on `aof work next` (scoped to the ref
    or `NN-MM` range), dispatches the phase by type + status, spawns the session, runs the gate
    (`validate`) between phases with a bounded retry (the cap), and drives the range to done — or halts
    at a real gate. Registered with a stable `--json` state contract.
  - **`aof work refine|continue|verify <ref>`** — the *atomic* per-phase drivers `loop` composes: spawn
    one session running that phase's existing prompt, watch the transcript to completion, gate. (The
    phase prompts are unchanged; these are the CLI drivers around them.)
  - **`--level L1|L2|L3`** — the autonomy ladder: `L1` report-only (observe + validate, no writes),
    `L2` assisted (cascade with review-stops — today's `--autonomous` default), `L3` unattended
    (cascade + auto-apply low-risk harness proposals, gated by the Loop-Ready score).
  - **`--resume`** — durable loop state in the run store, so a loop **survives a machine-off and
    resumes** rather than stranding sessions. (This is the failure mode that *motivated* the
    observability arc — a stalled overnight run — reduced to `aof work loop --resume`, not a manual
    re-ping.)
  - **Loop-Ready score** on `aof work doctor` (gates present, tests traceable, memory on, budget set,
    denylist honoured) — the readiness bar an unattended (L3) run must clear.
  - **`/aof:autonomous` deprecated in favour of `aof work loop`.** For now the two COEXIST, with
    `autonomous.md` reduced to a thin prompt that shells out to `aof work loop` (the prompt-driven
    version is exactly the one with unenforceable caps); it is removed once `loop` is proven.
- **Verification as a feedback loop.** Reframe the continue→verify boundary as a **grader loop**: the
  `@executable` suite + fitness functions are the rubric; a failed rubric emits **structured feedback**
  (which scenario, which fitness function, the delta) that re-drives the maker for a **bounded** number
  of cycles (the cap is loop-performance's); on cap-exhaustion it stops-and-flags with the feedback as
  the record. Deterministic grading (validate) runs before any model grading (review), per
  loop-performance's reorder.
- **The self-improvement (hill-climbing) loop.** A registered analysis pass — `aof work tune <range>
  --json` (name illustrative) — that reads the accumulated `aof work observe` traces + `RETROSPECTIVE`
  lessons + run-store lineage and **emits harness-change proposals**: role-model reallocations, cap
  adjustments, prompt/brief revisions, story-sizing hints. At **L2** the proposals are written as a
  review surface (a diff a human accepts); at **L3** low-risk classes (e.g. a model-map override backed
  by N measured grinds) auto-apply through the same `work.agents.models` / bundle machinery, with every
  application logged to the run store and reversible.
- **Event-driven triggers → `aof work loop`.** Once the loop is a CLI entrypoint, a trigger just calls
  it: a cron cadence (`aof work loop <range>` on schedule), a mesh work-assignment, a PR/CI signal, or
  an inbound `aof:feedback` finding — each resolves to `aof work loop <ref>` at a declared autonomy
  level, with **no Claude-session-as-orchestrator required**. The mesh
  ([mesh-worker-execution.mjs](../../src/mesh-worker-execution.mjs)) is the execution substrate; a
  `gate.yaml`-style **path allow/denylist** bounds what an unattended trigger may touch.

### Out of scope

- The **economics** of the loop — telemetry, `loop-cost`/budget, model defaults, escalation-on-retry,
  the build-loop cap itself, headless-driver hardening — all owned by
  [PRD-acd-loop-performance.md](./PRD-acd-loop-performance.md). This arc *consumes* them.
- Changing the ACD contract surfaces (litmus, tags, gates) or the nine-stage pipeline semantics — the
  loop is engineered *around* the pipeline, never rewriting it.
- A general workflow/DAG engine, or moving *phase logic* into code — the SHELL becomes code
  (`aof work loop`), but each phase's *what-to-do* stays the existing prompt (`refine` / `continue` /
  `verify`) run in a spawned session; this arc moves the dispatcher + session lifecycle into code, it
  does not re-implement the ACD phases as a `.mjs` pipeline or a DAG engine.
- Fully-autonomous (L3) harness self-modification of *standards* — auto-tuning touches economics and
  cadence only; contract/gate changes always require a human.
- New runtimes beyond `claude` / `codex`, and mesh dispatch topology (leasing/reclaim/presence) —
  milestone 22+ territory; only the trigger→loop seam is touched here.

## Milestones

> Foundation-first: the **loop artifact** is the enabler — it gives every other lever a place to be
> declared, gated, and measured. Verification-loop and self-improvement depend on it; event-driven
> triggers depend on it plus the mesh. Self-improvement additionally consumes the telemetry the
> loop-performance arc lands.

- **loop-artifact** — the foundation, and the central move: promote the mesh PTY driver
  ([mesh-worker-execution.mjs](../../src/mesh-worker-execution.mjs)) to the **local loop spine**. Ship
  `aof work loop <ref|range>` (the code-owned shell) composed from the atomic
  `aof work refine|continue|verify <ref>` drivers; the `--level L1/L2/L3` ladder; `--resume` durable
  loop state; the **Loop-Ready score** on `aof work doctor`; and `autonomous.md` reduced to a thin
  shell-out (coexist-then-deprecate). **Unifies with loop-performance's `headless-driver-hardening`** —
  its timeout / envelope / `--model` / `--resume` fixes ARE this driver's reliability work. **Depends
  on milestones 08 (cli-command-core), 19–21 (run lifecycle), and 38
  (cross-machine-worker-execution)** — it promotes m38's driver and declares over the run store.
- **verification-loop** — tighten the grader. Reframe continue→verify as a bounded grader loop:
  structured rubric feedback (scenario / fitness-function / delta) re-drives the maker, deterministic
  validate before model review, stop-and-flag on cap-exhaustion with the feedback as the record.
  **Depends on loop-artifact** (for the declared gate order + stopping conditions) and **on
  loop-performance's build-loop cap** (the bound it enforces).
- **self-improvement-loop** — close the hill-climbing loop. `aof work tune <range>` reads observability
  traces + retrospectives + run lineage and emits harness-change proposals; L2 writes a
  human-accepted diff, L3 auto-applies low-risk classes reversibly. **Depends on loop-artifact** (for
  the autonomy level that gates auto-apply) **and on loop-performance's telemetry + `aof work observe`**
  (already shipped) for its input. Independent of verification-loop.
- **event-driven-triggers** — wake the loop. Cron / mesh-assignment / PR / inbound-finding triggers
  each resolve to a plain `aof work loop <ref>` call at a declared autonomy level (no orchestrator
  session), bounded by a path allow/denylist. **Depends on loop-artifact** (the loop must be a CLI
  entrypoint first) **and on milestone 38 (cross-machine-worker-execution)** for the execution
  substrate. Independent of the other two consumers.

## Adjacent techniques (separate arcs — captured, not scoped here)

> Surfaced by the same review; each is its own arc, recorded so it is not lost.

- **Loop-cost projection before a run.** A `loop-cost`-style estimator (cobusgreyling) that projects
  token spend for a milestone/range at a given autonomy level *before* driving it — the pre-flight
  companion to loop-performance's after-the-fact telemetry. → a loop-performance/economics arc.
- **Loop-Ready badge + CI gate.** Emit the Loop-Ready score as a repo badge and a CI check, so a
  project cannot be driven unattended (L3) until its harness clears the readiness bar (gates present,
  denylist set, memory on, budget bounded). → a governance arc, gated on loop-artifact.
- **Trace-seeded story sizing.** Feed the hill-climber's clustered attempt-1 failures back into refine
  so the architect sizes stories against a measured model-capability budget — the convergence of
  self-improvement with loop-performance's "difficulty-aware story sizing." → a refine/graphify arc,
  only worth exploring once `aof work tune` shows where failures cluster.
- **Fleet-level loop orchestration.** Multiple loops running concurrently across the mesh with a
  supervisor that rebalances model spend and reclaims stalled loops — loop engineering's "event-driven
  loop" at fleet scale. → a mesh arc, milestone 22+ territory.
