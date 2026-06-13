# Philosophy

> **The question this document answers:** *Why does ACD exist, and what does it believe?*

ACD is a reaction to plan-centric, imperative development workflows. This document states the
problem it solves and the six principles that follow from it. Everything else in the wiki is an
application of these principles.

## The problem ACD solves

Imperative workflows (GSD being the reference example) center the **plan** — a document that
describes the *steps to take*. Three failures follow:

1. **The deliverable is invisible.** You cannot tell what the work will produce without reading
   the whole plan. For a non-trivial milestone that is hours of markdown. "I didn't actually know
   what it was going to do" is the founding complaint.
2. **Plans fight the model.** An LLM agent is a capable planner. Handing it a rigid step list
   wastes that and produces brittle work that diverges the moment reality differs from the plan.
3. **Plans rot.** A plan describes *how*, and *how* changes constantly during implementation. The
   plan and the code drift apart, and the plan becomes a lie nobody trusts.

ACD inverts the center of gravity: **the contract, not the plan, is the durable artifact.**

## The six principles

### 1. Declarative over imperative

Describe **what is observably true when the work is done**, not the steps to get there. Outcomes
survive refactors; steps don't. Outcomes play to the agent's planning ability instead of fighting
it: you give it the goal and the contract, it finds the path, you verify against the contract.

> Imperative: "Add a `getWorkflow` method that calls `GET /v2/ai/assistants/{id}` and reads
> `conversation_flow`."
> Declarative: "`getWorkflow` returns the workflow and a content hash for an assistant that has a
> flow, and `null` for one that doesn't."

### 2. One question per document

Each artifact answers **exactly one question**. A line is in the wrong file when it answers a
different question than its document. This is the rule that keeps every artifact scannable and
single-purpose. The full taxonomy is in [documents.md](documents.md); even the pages of this wiki
obey it.

### 3. Visibility of the deliverable

You must be able to see *what is being delivered* in seconds. That is why the contract is
**Gherkin**: a feature file is a scannable list of outcomes a non-author — a reviewer, a future QA
specialist, a PM tool — can read without reading the source. Visibility is not a nice-to-have; it
is the founding requirement, and it constrains everything (e.g. it is *why* exhaustive test cases
go in collapsible Examples tables rather than as dozens of top-level scenarios — see
[acceptance-criteria.md](acceptance-criteria.md)).

### 4. Single source of truth — reference, never restate

Every fact lives in **exactly one place**. Other documents **link** to it; they never restate it.
Restating is how documents drift, and drift is the failure mode that kills every BDD/spec
methodology. The defence is structural:

- the outcome is stated once, in the feature file;
- the decision behind it is stated once, in an ADR, and the feature *references* it;
- the manual verification of it is stated once, in UAT.md, which *references* the scenario;
- and the keystone: every `@executable` scenario is **linked to a green test, enforced by a
  lint** — not by a hand-maintained comment. See
  [acceptance-criteria.md → Traceability](acceptance-criteria.md#traceability-the-spine).

### 5. Conditional ceremony — scale to the work

Process is a cost. Documents and agents appear **only when they have content**. A milestone with
no UI has no `DESIGN.md` and no designer. A one-line fix is `SPEC` + a feature + a developer, and
nothing else. The full six-agent, seven-document ceremony is for a *substantial* milestone; small
ones collapse. This is the explicit guardrail against becoming the heavy thing ACD replaced.

### 6. Artifacts are the interface

Specialist agents communicate through **durable documents**, not ephemeral chat. The architect
reads `RESEARCH.md` and writes ADRs; the developer reads the feature files and the ADRs. This is
what makes multi-agent delivery work without context loss: the handoff is a file, not a memory.
Naive multi-agent systems fail here; ACD doesn't, *because* it did the document work first.

## ACD vs imperative (e.g. GSD)

| Dimension | Imperative / plan-centric | ACD |
|---|---|---|
| Durable artifact | the plan (*how*) | the contract (*what*) |
| Visibility of deliverable | low — read the whole plan | high — scan the feature files |
| Relationship to the model | prescribes steps (fights it) | states outcomes (uses it) |
| Failure mode | plan rots against code | drift, *defended structurally* |
| Process weight | fixed and heavy | conditional, scales to the work |
| Multi-agent handoff | chat / shared plan | one document per owner |

ACD is not "lighter GSD." It is a different center of gravity: a **contract** the agent satisfies,
not a **plan** the agent follows.

## Where to go next

- The documents that embody these principles → [documents.md](documents.md)
- The contract itself, in detail → [acceptance-criteria.md](acceptance-criteria.md)
- The agents that own the documents → [agents.md](agents.md)
