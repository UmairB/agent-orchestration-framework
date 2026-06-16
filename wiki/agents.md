# The Agent Model

> **The question this document answers:** *Who owns what, and how do the agents collaborate?*

ACD delivers work with six specialist agents. The model works — where naive multi-agent setups fail
on context loss — because [the document model came first](philosophy.md): each agent owns one
durable artifact, and the artifacts are the handoff interface, not chat. Substantial milestones may
also fan out **domain specialists** (security, compliance, …) — conditionally-activated technical
experts the architect spawns when the work has that surface; they obey the same one-artifact rule.

## The six roles

| Agent | Owns | Reads |
|---|---|---|
| **product-owner** | milestone `SPEC.md` + story `STORY.md` (the user story) + acceptance + orchestration | everything |
| **researcher** | `RESEARCH.md` | SPEC |
| **architect** | `ARCHITECTURE.md` / ADRs + fitness functions + **structural code review** | RESEARCH, SPEC |
| **designer** | `DESIGN.md` | SPEC, RESEARCH |
| **developer** | code + `@executable` step definitions | task features, ADRs, DESIGN |
| **qa** | `UAT.md` + test-case design + **behavioural sign-off** | task features, SPEC |

One role, one owned artifact — except the **task features**, which are co-authored (see Three
Amigos). Ownership spans the hierarchy: the PO writes the milestone `SPEC` (objective + scope) and
each story's `STORY.md` (its user story); the Three Amigos author the **task** `.feature` files
beneath a story.

## product-owner is the orchestrator

"Manage the delivery of the milestone" is two jobs: own the *what* (product ownership) and
*sequence the other agents* (orchestration). These are one agent wearing two hats. In agent terms
the **product-owner is the main/orchestrator agent**, and the other five are **sub-agents it spawns
and sequences**. Don't add a separate "PM" for coordination — the orchestrator loop does
coordination for free. (Split a pure-coordination PM out only if a milestone ever needs cross-team
scheduling, which per-milestone work doesn't.)

**Orchestration has two tiers.** The product-owner orchestrates the *milestone* — it sequences the
five core sub-agents and owns the product intent. The **architect sub-orchestrates the technical
specialists** inside the Decide stage: when the work has a security, compliance, cloud, or
performance surface, the architect fans out a [domain specialist](#domain-specialists--the-architects-conditional-tier)
and folds its artifact into the technical contract. This is the one sanctioned case of a sub-agent
spawning sub-agents, and it is safe for the same reason the top tier is — the specialist hands back a
**file**, not a memory, so nesting adds no context loss. The PO never micromanages a threat model;
the architect, at the right altitude, does.

The PO also owns `STATE.md` as its **single writer**: sub-agents report completion back, the PO
records it. One writer, no merge races.

## Domain specialists — the architect's conditional tier

Some milestones carry a surface the core six don't cover: an attack surface, a regulatory
obligation, a cloud topology, a performance budget. ACD handles these with **domain specialists** —
technical experts the **architect fans out at the Decide stage**, each owning one **conditional**
domain document. They are an *extension* of the architect's altitude, not new core roles, so the six
stay six.

| Specialist | Owns | The one question it answers | Activates when |
|---|---|---|---|
| **security** | `SECURITY.md` | What could an attacker do, and how do we stop them? (threat model + technical controls) | the work has a meaningful attack surface |
| **compliance** | `COMPLIANCE.md` | Which obligations (GDPR, ISO 27001, …) bind us, and where is each evidenced? | the work touches regulated or personal data |

Three properties keep this ACD-native rather than ceremony:

- **Architect-shaped, not developer-shaped.** Like the architect, a specialist *reads, researches,
  runs tests, owns its document, and (security) writes fitness functions* — but it **never edits
  implementation**. So it stays an independent reviewer of the developer; it cannot grade its own
  homework.
- **Conditional activation governs them.** Neither fires on trivial work. `security` fires on an
  attack surface; `compliance` fires on regulated/personal data. Absence of the document *is* the
  decision not to run the specialist.
- **Reference, never restate.** A control lives **once** — as a fitness function, an `@executable`
  scenario, or an ADR. `SECURITY.md` is the threat model that *points at* those controls;
  `COMPLIANCE.md` maps each obligation to the control (often a security one) that evidences it.
  Neither doc copies an implementation, and neither is a fourth verification surface — they route
  into the existing three.

The tier is **open-ended**: a `cloud`, `performance`, or `data` specialist joins it the same way —
the architect fans it out, it owns its conditional doc — without touching the core six or widening
the product-owner's span.

## Who authors the feature files: Three Amigos

The feature files are the contract — the most valuable artifact — so they are **not owned by one
agent alone**. They are authored by the established **Three Amigos** practice, three viewpoints
negotiating the contract before it locks:

- **product-owner** brings the *what* and *why* → writes the headline **Scenario** (the outcome).
- **qa** brings *what could break / how do we know* → writes the **Examples tables** (the case
  matrix; see [acceptance-criteria.md](acceptance-criteria.md)).
- **developer** brings *is this feasible* → sanity-checks before lock.

The PO holds the pen (so it isn't owned-by-committee), but the feature is not locked until Dev and
QA have signed the elaboration. This gives QA a real **upstream** job — designing the cases that
shape the contract — instead of being a downstream rubber stamp.

> Concretely, this maps onto the Scenario-Outline structure: **PO writes the outcome, QA enumerates
> the cases, the developer implements the step definitions.** Three amigos, three sub-artifacts, one
> task feature.

## Stories are the unit of parallelism

A milestone's **stories are designed to be independent**, so they run **concurrently — one story per
agent** (and, when they mutate files, one git worktree per agent). Two jobs follow:

- **architect** (at refine time) draws **story boundaries to minimise cross-story coupling** — the
  fewer dependencies between stories, the wider the fan-out.
- **product-owner** (the orchestrator) **fans out one story per agent** at build time, and only
  serialises where a real dependency forces it.

Tasks *within* a story may be sequential; **stories should not be**. Maximising independent stories
is an explicit design goal, not an accident — it is where the orchestrator earns its keep.

## The review model: review decomposes by contract

There is no separate code-reviewer agent. "Code review" is three reviews at three altitudes, and
each already has an owner — review is split by *which contract is being checked*:

| Review | Checks against | Owner | Largely automated by |
|---|---|---|---|
| **Structural** | the ADRs / invariants | **architect** | fitness functions (arch-tests) |
| **Behavioural** | the feature files | **qa** | the `@executable` BDD suite |
| **Craft + latent bugs** | readability, simplification, untested-path bugs | **tooling** (architect backstops) | `/code-review`, `/simplify` style passes |

This gives you **two independent reviewers of the developer** — architect (structure) and QA
(behaviour) — neither of whom wrote the implementation. That is the no-self-grading property,
satisfied by construction.

The architect's structural review is **mostly automated**: the invariant is written once as a
fitness function and CI enforces it forever, so the architect's *manual* review shrinks to the
judgment residue the tests can't encode. The architect is not a per-PR bottleneck.

The **craft** slice (naming, duplication, bugs in paths no scenario exercises) is off the
architect's altitude — hand it to an automated adversarial-review/simplify pass, with the architect
as the human backstop only for calls the tool flags but can't decide.

### Domain review is a conditional lens

When a [domain document](#domain-specialists--the-architects-conditional-tier) exists, its specialist
adds a review *lens* — but **not** a fourth verification surface. Each decomposes into the same three
surfaces the table above uses:

| Lens | Checks against | Owner | Decomposes into |
|---|---|---|---|
| **Security** | the threat model (`SECURITY.md`) | **security** | fitness functions (invariants) + `@executable` scenarios (outcomes); residual is a `@manual` pen-test in `UAT.md` |
| **Compliance** | the obligation map (`COMPLIANCE.md`) | **compliance** | mostly `@manual` evidence in `UAT.md` + ADRs; a few fitness functions (e.g. PII encrypted at rest) |

This adds a third independent reviewer of the developer for regulated work and keeps the
no-self-grading property: the specialist that reviews against a contract never wrote the
implementation.

## Don't grade your own homework

The developer implements code **and** step definitions, but it does not own the *contract* it's
implementing against (PO + QA do) nor the *cases* (QA does). The meaningful separation is
**"what to test" (QA) vs "how it's wired" (developer)** — QA designs the cases, the developer wires
them. Enforced by tool-scoping (below), not by trust.

## Conditional activation — the anti-ceremony guardrail

Six agents per milestone is heavy; running the full pipeline for a one-line fix is exactly the
ceremony ACD exists to escape. So the agent layer inherits the document model's rule:

> **An agent activates only when its artifact has content.**

- No UI → no designer.
- No unknown to resolve → no researcher.
- No non-trivial decision → the architect does a trivial pass or is skipped.
- Trivial change → **product-owner + developer**, full stop.

The full six-agent pipeline is for a *substantial* milestone. Small ones collapse to two or three.
If you build one guardrail, build this one.

## Tool-scoping makes the boundaries real

Role boundaries are nominal until they're enforced by **per-agent tool restrictions**. This is what
makes "QA doesn't grade its own homework" and "researcher doesn't write code" true rather than
aspirational:

| Agent | Read | Web/Research | Edit code | Run tests | Write own artifact |
|---|---|---|---|---|---|
| product-owner | ✓ | — | — | — | SPEC, STATE |
| researcher | ✓ | ✓ | — | — | RESEARCH |
| architect | ✓ | ✓ | — (review only) | ✓ | ARCHITECTURE, arch-tests |
| designer | ✓ | ✓ | — (UI assets only) | — | DESIGN |
| developer | ✓ | — | ✓ | ✓ | code, step defs |
| qa | ✓ | — | — (tests/cases only) | ✓ | UAT, Examples tables |
| security | ✓ | ✓ | — (review only) | ✓ | SECURITY.md, security arch-tests |
| compliance | ✓ | ✓ | — | — | COMPLIANCE.md |

(Exact tool lists are an implementation detail of the agent definitions; the **shape** — who can
and cannot edit implementation — is the contract.)

## How they hand off

The agents never depend on each other's memory; they depend on each other's **files**. The sequence
of handoffs is [workflow.md](workflow.md). The short version:

```
product-owner (milestone SPEC)
      │
      ▼
researcher (RESEARCH) ──► architect (ADRs + fitness fns) ──► designer (DESIGN)
      │                        │                                    │
      │                        ▼  fans out — conditional            │
      │                   security    (SECURITY.md)                 │
      │                   compliance  (COMPLIANCE.md)               │
      ▼                                                             │
PO + architect: break down into independent STORY.md's ◄───────────┘
      │
      ▼   (per story, fanned out — one agent each)
Three Amigos author the story's task *.feature files
      │
      ▼
developer (code + step defs)
      │
   ┌──┴───────────────────┬────────────────────┐
   ▼                      ▼                     ▼
architect: structural   qa: behavioural      tooling: craft
   review                review/sign-off
                          │
                          ▼
                qa runs @manual / UAT, signs off  →  story accepted
                          │
                          ▼ (all stories accepted)
            product-owner accepts the milestone
```

## Next

- The full lifecycle and gates → [workflow.md](workflow.md)
- What each agent reads and writes → [documents.md](documents.md)
- The contract they converge on → [acceptance-criteria.md](acceptance-criteria.md)
