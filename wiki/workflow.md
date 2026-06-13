# The Milestone Workflow

> **The question this document answers:** *What is the sequence of a milestone, from start to
> sign-off?*

This is the lifecycle that ties the [documents](documents.md) and the [agents](agents.md) together:
the order artifacts are produced, the gate at each handoff, and how the pipeline collapses for
small work.

## The pipeline

A substantial milestone runs through eight stages. Each stage produces or consumes a durable
artifact — the handoff is always a file ([philosophy.md → principle 6](philosophy.md)).

| # | Stage | Agent | Produces / consumes | Gate to pass |
|---|---|---|---|---|
| 1 | **Frame** | product-owner | `SPEC.md` | Scope is bounded; in/out is explicit; dependencies named |
| 2 | **Research** | researcher | `RESEARCH.md` | Every unknown that blocks a decision has a finding + source |
| 3 | **Decide** | architect (+ designer) | `ARCHITECTURE.md` (ADRs, fitness functions); `DESIGN.md` | Each decision has context + alternatives + consequences; invariants have arch-tests |
| 4 | **Contract** | Three Amigos | `tasks/*.feature` | Every outcome is black-box observable; cases are in Examples tables; Dev + QA signed the elaboration |
| 5 | **Build** | developer | code + `@executable` step definitions | Every `@executable` row is green; traceability lint passes |
| 6 | **Review** | architect + qa + tooling | review notes → fixes | Structural conformance (architect), behavioural conformance (QA), craft pass (tooling) all clear |
| 7 | **Verify** | qa | `UAT.md` sign-offs | Every `@manual` scenario has a recorded procedure + result + sign-off |
| 8 | **Accept** | product-owner | milestone acceptance; `STATE.md` compaction | The SPEC's acceptance summary is satisfied; STATE is summarised; durable conclusions graduated |

`STATE.md` is updated by the product-owner *throughout* — it is the running ledger of stages 1–8,
compacted at stage 8.

## The gates, in plain terms

A gate is "what must be true to hand off." The gates are deliberately the same facts the documents
already enforce, so passing a gate is mechanical, not a meeting:

- **Frame → Research:** the SPEC bounds the work. If scope is open, you can't research the right
  things.
- **Research → Decide:** findings exist for the blocking unknowns. The architect decides *from*
  evidence, not vibes.
- **Decide → Contract:** decisions are recorded as ADRs and invariants are arch-tested. The feature
  authors can now state outcomes without smuggling design (it has a home).
- **Contract → Build:** the litmus test passes on every line, cases are enumerated, the Three
  Amigos signed off. The developer builds against a locked, observable contract.
- **Build → Review:** the `@executable` suite is green and the **traceability lint passes** — every
  `@executable` row maps to a passing test. This is the keystone gate.
- **Review → Verify:** both independent reviews (structural, behavioural) clear, craft pass done.
- **Verify → Accept:** every `@manual` item is signed off in `UAT.md`.
- **Accept:** the PO confirms the SPEC's intent is delivered and compacts `STATE.md`.

## Conditional collapse — most milestones aren't substantial

The eight-stage pipeline is the *maximum*. [Conditional activation](agents.md#conditional-activation--the-anti-ceremony-guardrail)
means real milestones usually run a subset. The size of the work selects the pipeline:

| Milestone size | Pipeline |
|---|---|
| **Trivial** (one-line fix, rename) | Frame (lightweight) → Build → Accept. PO + developer. |
| **Small** (no UI, no unknowns) | Frame → Contract → Build → Review (QA + architect) → Accept. |
| **Standard** (a decision, maybe research) | + Research + Decide stages, as needed. |
| **Substantial** (UI + decisions + unknowns) | All eight stages, all six agents. |

The selector is content, not policy: a stage runs because its artifact has content, and skips
because it doesn't. There is no "lightweight mode" toggle — absence of content *is* the lightweight
mode.

## Where verification lives across the pipeline

ACD has three verification surfaces; they activate at different stages and route by tag:

1. **Fitness functions** (arch-tests) — written at **Decide**, run forever in CI. Enforce
   structural invariants.
2. **`@executable` BDD suite** — written at **Build**, run forever in CI. Enforce behavioural
   outcomes. Gated by the traceability lint at Build → Review.
3. **`@manual` / UAT** — executed at **Verify** by a human. Confirms what CI can't. Migrates to
   surface 2 over time.

Green CI proves surfaces 1 and 2; `UAT.md` sign-offs prove surface 3. Together they prove the whole
contract is true — not just present.

## Integration across milestones

Per-milestone work is the default. Integration coverage is carried by the **persistent automated
suite** (surfaces 1 and 2 re-run on every milestone), so cross-milestone regressions in tested paths
are caught automatically. The only gap is a *manual* integration check that spans milestones; cover
it cheaply by adding a regression line to the later milestone's `UAT.md` that `verifies →` the prior
milestone's still-relevant scenario. Stand up a dedicated release-level UAT only when that
cross-referencing repeats across several milestones — that repetition is the signal, not a
speculative default.

## Next

- The agents that run each stage → [agents.md](agents.md)
- The artifacts each stage produces → [documents.md](documents.md)
- Copy-paste skeletons to start a milestone → [templates/](templates/)
