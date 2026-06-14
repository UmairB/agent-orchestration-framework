# The Agent Model

> **The question this document answers:** *Who owns what, and how do the agents collaborate?*

ACD delivers work with six specialist agents. The model works — where naive multi-agent setups fail
on context loss — because [the document model came first](philosophy.md): each agent owns one
durable artifact, and the artifacts are the handoff interface, not chat.

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

The PO also owns `STATE.md` as its **single writer**: sub-agents report completion back, the PO
records it. One writer, no merge races.

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
      │                                                              │
      ▼                                                              │
PO + architect: break down into independent STORY.md's ◄────────────┘
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
