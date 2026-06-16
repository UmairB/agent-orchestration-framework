# The Workflow

> **The question this document answers:** *What is the sequence from idea to accepted delivery?*

This is the lifecycle that ties the [documents](documents.md) and the [agents](agents.md) together:
the order artifacts are produced, the gate at each handoff, and how the pipeline collapses for small
work. It spans the hierarchy — a **milestone** is framed and broken into **stories**, each story's
**tasks** are contracted and built.

> **Where milestones come from.** This lifecycle starts at a framed milestone. For multi-milestone
> initiatives, the milestone itself is derived upstream from a PRD — see [planning.md](planning.md).

## The pipeline

A substantial milestone runs through nine stages. Each produces or consumes a durable artifact — the
handoff is always a file ([philosophy.md → principle 6](philosophy.md)).

| # | Stage | Agent | Produces / consumes | Gate to pass |
|---|---|---|---|---|
| 1 | **Frame** | product-owner | milestone `SPEC.md` | Objective + scope bounded; dependencies named |
| 2 | **Research** | researcher | `RESEARCH.md` | Every blocking unknown has a finding + source |
| 3 | **Decide** | architect (+ designer; + security / compliance) | `ARCHITECTURE.md` (ADRs, fitness functions); `DESIGN.md`; `SECURITY.md`; `COMPLIANCE.md` | Each decision has context + alternatives + consequences; invariants have arch-tests; every threat & obligation maps to a control |
| 4 | **Break down** | product-owner + architect | one `STORY.md` per story (with `parent:`) | The milestone splits into **independent** stories; cross-story coupling is minimised |
| 5 | **Contract** | Three Amigos | each story's task `*.feature` files | Every outcome is black-box observable; cases are in Examples tables; Dev + QA signed the elaboration |
| 6 | **Build** | developer (one per story) | code + `@executable` step definitions | Every `@executable` row green; traceability lint passes |
| 7 | **Review** | architect + qa + tooling | review notes → fixes | Structural (architect) + behavioural (QA) + craft (tooling) all clear |
| 8 | **Verify** | qa | `UAT.md` sign-offs | Every `@manual` scenario has a recorded procedure + result + sign-off |
| 9 | **Accept** | product-owner | milestone acceptance; `STATE.md` compaction | All stories accepted; STATE summarised; durable conclusions graduated |

Stages **6–8 run per story, in parallel** — independent stories fan out one-per-agent (and per
worktree when they mutate files). The milestone is accepted (stage 9) once its stories are.
`STATE.md` is the product-owner's running ledger throughout, compacted at accept.

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

## Conditional collapse — the item type selects the pipeline

The nine-stage pipeline is the *maximum*, for a full milestone. The **item type you create** picks
how much of it runs — depth scales with planning ([conditional activation](agents.md#conditional-activation--the-anti-ceremony-guardrail)):

| You create | Pipeline |
|---|---|
| **A `task`** (adhoc fix) | Contract (write the `.feature`) → Build → Review → Accept. No milestone, no story, no SPEC. |
| **A `story`** (group of adhoc work) | + `STORY.md` (the user story) and its tasks; Frame/Decide only if it needs them. |
| **A `milestone`** | The full pipeline — Frame → … → Break down into stories → … → Accept. |

Within a milestone, the *stage* selector is still content: Research/Decide/Design run only when the
work has unknowns / decisions / UI, and the architect fans out the **security** specialist only when
there's an attack surface and the **compliance** specialist only when the work touches regulated or
personal data. Absence of content *is* the lightweight mode — there is no toggle.

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

**Security and compliance add no fourth surface.** A security invariant is a fitness function
(surface 1); a security outcome is an `@executable` scenario (surface 2); an irreducibly-manual
control — a pen-test, a DPIA sign-off — is a `@manual`/UAT item (surface 3). `SECURITY.md` and
`COMPLIANCE.md` are the *maps* from each threat or obligation to the surface that proves it, written
at Decide alongside the ADRs.

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
