# PRD — ACD Loop Performance & Model Economics

> Planning PRD for the loop-performance arc. Upstream of ACD: this document is the seam
> `aof:shatter` consumes to lay out the milestone roadmap. Origin: a whole-architecture review of
> the `refine → continue (implement) → verify` loop, prompted by milestones slowing down markedly
> after the developer role was switched to `sonnet`. The review's finding is that the slowdown is
> **architectural amplification**, not per-token model speed: the developer sits inside the only
> unbounded loop in the framework, and every shortfall in its output cascades into opus-priced
> rework — full structural + behavioural re-reviews, validate-gate fix loops, and cold-context
> subagent respawns each cycle.

> **Review amendments (obs-346, 2026-07-19).** A live working-run review — driving `aof work observe`
> over milestone 346 (voice-vox-web) — validated the core thesis and produced the tagged inline
> amendments below (`⟨amend · obs-346⟩`). Headline evidence, flipping the developer sonnet→opus on the
> **same milestone**: the story build went **511 → 248 turns, 46% → 20% toolchain-wait, 33 → 6
> error-ish results**. The `developer → opus` default and the transcript-observability layer are
> **already shipped**; the amendments reweight and extend the rest.

## Objective

**Objective.** Make the ACD loop's cost and wall-clock **proportional to the work item, not to the
weakest agent's iteration count**. Four levers, foundation-first: (1) **measure** — surface
per-phase durations, attempt counts, and review-cycle counts from the run records so "too long" is
a number, not a feeling; (2) **reallocate model spend** — put the strongest model where iteration
is most expensive (the developer's build loop) and allow cheap models where the work is mechanical
(contract-checking reviews), including automatic **escalation-on-retry** using the run lineage that
already exists; (3) **discipline the loop** — cap the build-to-green inner loop, gate expensive
reviews behind the free deterministic validate, scope re-reviews to the delta, and hand fix-loop
developers a distilled brief instead of the full document tree; (4) **harden the headless mesh
driver** — fix its timeout classification, its result-envelope parsing, and thread model/session
into the spawn. Throughout, the CLI-as-contract spine (milestone 08) holds: every new observable
lands as a registered command with a `--json` contract, and prompts/board stay thin faces.

## Context & Constraints

The loop today, as built (findings from the architecture review, 2026-07):

- **The loop is prompt-driven, not code-driven.** No `.mjs` sequences the phases.
  [autonomous.md](../../src/bundle/commands/autonomous.md) is a meta-prompt looping on the
  deterministic `aof work next` (`nextWork`, [work.mjs](../../src/work.mjs) §857) and dispatching
  [refine.md](../../src/bundle/commands/refine.md),
  [continue.md](../../src/bundle/commands/continue.md), or
  [verify.md](../../src/bundle/commands/verify.md) by item `type` + `status`. Any performance fix
  is therefore split across two surfaces: bundle prompts (behaviour) and the command core
  (contracts, caps, telemetry).
- **Model allocation is inverted.** Role models are pinned in agent frontmatter
  ([aof-developer.md](../../src/bundle/agents/aof-developer.md): `sonnet`; researcher `sonnet`; the
  other six roles `opus`), overridable per-project via `work.agents.models`
  ([work-bundle.mjs](../../src/work-bundle.mjs) §173–202). The cheap model does the hardest
  generative work (implement to a locked contract) while opus agents re-check and repair its
  output. Reviewing against a locked contract with a green suite is more mechanical than
  implementing against one — the natural allocation is the reverse of today's.
  - **⟨amend · obs-346⟩** Confirmed by A/B on m346: developer sonnet→opus cut the story build
    **511 → 248 turns** and **46% → 20%** toolchain-wait, with error-ish results **33 → 6**. The flat
    `developer → opus` default is the **primary** lever and is **already shipped** (bundle +
    `bundle-model-map.test.mjs` now 7 opus / 1 sonnet). Escalation-on-retry is a secondary refinement
    on top of it (see Scope amendment), not the headline.
- **The build-to-green inner loop is the only uncapped loop in the framework.**
  [continue.md](../../src/bundle/commands/continue.md) instructs "implement … until every task's
  `@executable` scenarios/rows are green" with no iteration ceiling. The only hard cap anywhere is
  `work.autonomous.maxAttempts` (default 3) on the **validate** gate
  ([run-start.mjs](../../src/commands/run-start.mjs)) — a different, later gate. A
  struggling model grinds invisibly until it converges, exhausts validate attempts, or (mesh) hits
  the 10-minute process timeout.
  - **⟨amend · obs-346⟩** A cap bounds iteration *count* but not *cost per iteration*. The bigger
    measured sink is that the developer re-runs the **full** workspace suite (vitest + typecheck +
    build) after ~every edit — m346: **56 runs, 46% of active time**, avg 56s / worst 404s (a "tight
    fix-test loop"). Add a discipline lever for **targeted test execution** (failing spec in the loop,
    full suite once at the gate). Model-independent, and the single biggest wall-clock item observed —
    see Scope › Loop discipline (e).
- **Failure surfaces downstream at opus prices.** One weak build triggers: architect review (opus)
  + QA review (opus) + designer (opus, when UI) + craft pass → findings → respawn developer → fix →
  `aof work validate` → red → fix loop → re-review. Each extra developer iteration drags two to
  four opus agents back through the cycle. Reviews also run **before** the free deterministic
  validate in the continue flow, so cheap mechanical failures consume expensive review runs.
- **Every iteration starts cold.** There is no session continuity anywhere in the execution path:
  the run store models `sessionId` ([run-store.mjs](../../src/run-store.mjs) §204–236, carried
  forward on retry §468–480) but `defaultSpawnRuntime` never consumes it, and Task subagents are
  fresh by nature. Every fix-loop respawn re-reads config, SPEC, ADRs, DESIGN, all `.feature`
  files, and re-runs `aof work memory recall` (bounded at 5 records,
  [work-memory.mjs](../../src/work-memory.mjs) §154). Fixed per-iteration overhead multiplies with
  iteration count — exactly the variable a weaker developer model increases.
- **`maxAttempts` exhaustion converts model weakness into idle wall-clock.** On exhaustion the
  autonomous loop stops and waits for a human ([autonomous.md](../../src/bundle/commands/autonomous.md)
  stop-conditions). More red validates → more hand-backs → milestones that "take forever" while
  parked on a stop.
- **The headless mesh driver is documented-but-lightly-exercised, and has three defects.**
  [mesh-worker-execution.mjs](../../src/mesh-worker-execution.mjs): (a) the spawn's hard timeout is
  10 minutes (§572, `options.timeoutMs ?? 10 * 60 * 1000`) — far too short for "drive a work item
  to a terminal state" — and an execFile timeout is classed `agent_error`, which is
  **non-retryable**, even though `timeout` is in `RETRYABLE_REASONS`
  ([run-store.mjs](../../src/run-store.mjs) §116); (b) completion detection reads
  `parsed.terminal_reason ?? parsed.stop_reason` (§580–583) but real `claude -p --output-format
  json` emits a different result envelope (`type`/`subtype`/`is_error`), so real runs likely all
  classify as failed — the in-code comments (§562–567) confirm the real binary is only exercised in
  a manual soak; (c) the spawn passes no `--model` (the worker inherits the node's default) and
  never threads the stored `sessionId` into `--resume` on infra retries.
- **The bookkeeping needed for telemetry and escalation already exists.** Run records carry
  attempt, lineage (`retryOf`), outcome, reason, and timestamps
  ([run-store.mjs](../../src/run-store.mjs)); retry-vs-fresh is already a coded verb
  (`run-retry` → `not-retryable` / `attempts-exhausted`). Nothing new has to be invented to count
  cycles or key a model off the attempt number — it has to be *surfaced* and *consumed*.
- **Constraint — the locked contract stays locked.** No lever here may weaken the ACD gates: a
  capped build loop stops and flags, it never edits a scenario or fitness function to force green;
  delta re-reviews narrow scope, not standards.
- **Constraint — prompts are assets with a manifest.** Bundle prompt edits ride the existing
  bundle/manifest-hash machinery ([work-bundle.mjs](../../src/work-bundle.mjs)); rendered
  `.claude/` output stays generated, never hand-edited.

## Scope

### In scope

- **Loop telemetry as registered commands.** Per-item and per-range rollups derived from run
  records: attempts per item, wall-clock per phase (refine/continue/verify), review cycles per
  story, exhaustion stops — `aof work stats <range> --json` (name illustrative), surfaced on the
  board as a thin face.
  - **⟨amend · obs-346⟩** Two layers, not one. This run-record rollup answers *how long / how many
    attempts* but cannot see *why* a phase was slow. The transcript layer — `aof work observe <ref>`
    (per-agent toolchain-wait %, grind flag, edit↔test rhythm, model-vs-tool split, stalls) — answers
    *why*, and is **already built** (`src/work-observe.mjs`, opt-in via `work.observability.enabled`,
    auto-written at the retrospective). Unify them, or have `loop-telemetry` cite the transcript layer
    as its diagnostic companion rather than re-deriving it.
- **Model reallocation defaults + guidance.** Revisit the shipped frontmatter defaults (developer
  back to `opus`, or continue-stage reviewers to `sonnet`); document the intended economics in the
  wiki so `work.agents.models` overrides are made deliberately.
  - **⟨amend · obs-346⟩** `developer → opus` is done and A/B-proven, so this becomes documentation +
    the escalation map. **Caution on the "reviewers → sonnet" option:** "reviewing a locked contract
    is mechanical" is untested, and 346 is exactly the class (federated OAuth, security + compliance
    lenses) where a missed finding is worst. The locked-contract constraint guards the *gates*, not
    review *acuity* — hold reviewers at opus on any security/compliance-touching item.
- **Escalation-on-retry.** Attempt-indexed model selection for the developer role (e.g. attempt 1 =
  `sonnet`, attempt ≥ 2 = `opus`), keyed off the existing run lineage; config-shaped as an
  extension of `work.agents.models`, validated in
  [config-inspect.mjs](../../src/config-inspect.mjs), inert in solo mode like the existing map.
  - **⟨amend · obs-346⟩** Blind spot: escalation fires only on **failure / retry**, but the observed
    pathology is slow **success** — m346 story-01 ground 511 turns and converged **green on attempt 1**,
    so it would never escalate. Demote this beneath the flat `developer → opus` default (the actual
    fix); escalation is a secondary refinement for the genuine validate-red fail-loop, and it only
    helps once the build-loop cap (Loop discipline (a)) makes attempt 1 fail *fast* instead of grinding
    — so it **depends on** loop-discipline, not "independent of" it.
- **Loop discipline in the phase prompts.** (a) An explicit build-loop cap in `continue.md` — after
  N consecutive red runs of the same scenario, stop and flag; (b) reorder the continue flow to
  build → `aof work validate` (deterministic, free) → reviews only on green; (c) delta re-review
  after a fix loop — re-review the fixed findings, not the full structural + behavioural + design
  pass; (d) a consolidated per-story **build brief** assembled once at continue-start (files-as-
  handoff, one doc instead of the SPEC/ADR/DESIGN/feature tree), with fix-loop respawns handed only
  the failing scenarios + diff context. **(e) targeted test execution during the build loop** — run
  the single failing scenario/spec while converging, and the full suite + typecheck + build **once** at
  the gate, not after every edit. `⟨amend · obs-346⟩` m346: 56 full-suite runs = **46%** of developer
  active time (avg 56s, worst 404s) — the top wall-clock item, and the only lever here that is fully
  **model-independent**. Highest-confidence, cheapest win in the arc; consider pulling it ahead of the cap.
- **Headless driver hardening.** Configurable spawn timeout with the execFile timeout mapped to the
  retryable `timeout` reason; result-envelope parsing verified against the real `claude -p
  --output-format json` contract (soak becomes a test); `--model` passed explicitly; stored
  `sessionId` threaded to `--resume` on infra retries.

### Out of scope

- Session continuity for Task subagents — Claude Code owns that runtime; aof's lever is the brief
  it hands them, not `--resume` (that flag applies only to the headless spawn path).
- Changing the ACD contract surfaces (litmus, tags, gates) or the nine-stage pipeline itself — this
  arc tunes the loop's economics, not its semantics.
- New runtimes beyond `claude` / `codex`, and any codex-side model mapping (still dropped-with-
  warning per [adapter-warnings.mjs](../../src/adapter-warnings.mjs)).
- Mesh dispatch topology (leasing, reclaim cadences, presence) — milestone 22+ territory; only the
  worker's spawn contract is touched here.
- Automatic model *selection* by task difficulty prediction — escalation is attempt-indexed
  (observed failure), never speculative.

## Milestones

> Foundation-first: telemetry is the enabler — it turns every later lever into a measured
> before/after instead of a vibe. The three consumer chunks depend on it for evaluation but are
> otherwise independent of each other (parallel-eligible once telemetry lands).

- **loop-telemetry** — the foundation. Derive per-phase durations, attempt counts, review-cycle
  counts, and stop reasons from the existing run records; register the rollup as a command with a
  stable `--json` contract; board surfaces it as a thin face. **Depends on milestones 19–21
  (run lifecycle) and 08 (cli-command-core)** — it reads what they persist, through the door they
  mandate.
- **model-economics** — reallocate spend. Ship the revised role-model defaults with documented
  rationale, and the attempt-indexed escalation-on-retry map for the developer role (config
  extension + validation + render plumbing through
  [work-bundle.mjs](../../src/work-bundle.mjs)). **Depends on loop-telemetry** for the
  before/after; consumes the existing run lineage.
- **loop-discipline** — bound and reorder the loop. The four prompt-level changes (build-loop cap,
  validate-before-review, delta re-review, build brief) landed as bundle asset revisions with
  manifest hashes; the cap's stop-and-flag path reuses the existing feedback/STATE trace so a
  capped loop leaves a learnable record. **Depends on loop-telemetry** to prove the cycle-count
  drop; independent of model-economics.
- **headless-driver-hardening** — make the mesh path truthful. Timeout configurability +
  reclassification, real-envelope completion parsing under test, `--model` and `--resume`
  threading in [mesh-worker-execution.mjs](../../src/mesh-worker-execution.mjs). **Depends on
  milestone 38 (cross-machine-worker-execution)**; independent of the other two consumers.
  - **⟨amend · obs-346⟩** Orthogonal to the *observed* 346 slowness — that ran on Claude Code Task
    subagents, not the mesh spawn path, so none of these three defects touched it. Real and worth
    doing, but should not be sequenced ahead of loop-discipline + model-economics, which are what
    actually bit the observed run.

## Adjacent techniques (separate arcs — captured, not scoped here)

> Surfaced by the same review; each is its own arc, recorded so it is not lost.

- **Streaming stall detection for the headless driver.** Switch the spawn to `--output-format
  stream-json` and detect stalls by output idleness instead of a hard wall-clock kill — a wedged
  turn dies in seconds, a productive long turn lives past ten minutes. → a mesh-execution arc
  (natural successor to headless-driver-hardening).
- **Difficulty-aware story sizing at refine.** The break-down already consults `aof graph impact`;
  the same coupling data could size stories against a model-capability budget (small well-coupled
  story → cheap developer; cross-cutting story → strong developer from attempt 1). → a refine/
  graphify arc, only worth exploring once escalation-on-retry data shows where attempt-1 failures
  cluster.
- **Review-tier laddering.** Beyond continue-stage reviews: a cheap-model first-pass triage that
  routes only contested findings to an opus adjudicator — the same economics lever applied inside
  the review stage itself. → a review-pipeline arc, gated on loop-telemetry showing review time
  dominates.
- **Architect-decides loop rhythm (write-first vs TDD) at refine.** `⟨amend · obs-346⟩` Today the
  developer runs a test-per-edit rhythm regardless of story complexity (m346: "tight fix-test loop"
  observed on a not-especially-hard story). Make the **architect** call the rhythm at refine — a
  simple/low-coupling story → write-code-first, verify once; a genuinely complicated or high-risk one
  → red-green TDD — recorded in `ARCHITECTURE.md` and honoured by `continue.md`. The observe
  `interleave` classifier makes the chosen rhythm auditable after the fact. → a refine/architecture
  arc; overlaps difficulty-aware sizing but is a distinct call (loop *rhythm*, not story *size*).
