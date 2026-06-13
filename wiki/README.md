# Acceptance-Criteria Development (ACD)

> A declarative, outcome-first methodology for delivering software with LLM agents.
> The executable acceptance criteria *are* the contract; single-purpose documents are
> the handoff interface between specialist agents.

Also called **acceptance-criteria prompting** when the emphasis is on the agent loop:
you hand an agent the goal, the context, and the outcomes — and let it plan the steps.

## The one-paragraph pitch

You should be able to see *what a piece of work will deliver* in seconds, without reading
hours of imperative plans. In ACD the deliverable is a set of **Gherkin feature files** that
describe **observable outcomes** — the things that must be true when the work is done. Every
other concern (why, how-decided, how-it-looks, what-we-learned, where-we-are, how-a-human-
confirms-it) lives in its own single-purpose document, stated **once**, referenced **never
restated**. Specialist agents each own one document and hand off through the files, not through
chat. The whole thing rests on one enforced link: every `@executable` scenario maps to a green
test.

## Why it exists

ACD is a reaction to plan-centric, imperative workflows (e.g. GSD) where:

- the plan describes the *steps to take*, which fight the model's own planning ability and rot
  against the code;
- you **cannot see what will be delivered** without reading a wall of markdown;
- the same fact is restated across many documents, and the copies drift.

ACD inverts this: **describe the outcome, let the agent find the steps, verify against the
contract.** See [philosophy.md](philosophy.md).

## The three ideas

1. **Declarative outcomes.** Feature files state what's observably true when done — not how to
   build it. They survive refactors and read as a contract. → [acceptance-criteria.md](acceptance-criteria.md)
2. **One question per document.** Each artifact answers exactly one question. A line is in the
   wrong file when it answers a different question. → [documents.md](documents.md)
3. **Specialist agents, document handoffs.** Six roles, each owning one artifact, communicating
   through durable files so nothing is lost between them. → [agents.md](agents.md)

## Navigate

| Doc | The question it answers |
|---|---|
| [philosophy.md](philosophy.md) | *Why* does ACD exist and what does it believe? |
| [documents.md](documents.md) | *What documents* make up a milestone and what does each own? |
| [acceptance-criteria.md](acceptance-criteria.md) | *What goes in a feature file* and how is it verified? |
| [agents.md](agents.md) | *Who owns what* and how do the agents collaborate? |
| [workflow.md](workflow.md) | *What is the sequence* of a milestone from start to sign-off? |
| [glossary.md](glossary.md) | What do the *terms* mean? |
| [templates/](templates/) | Copy-paste milestone skeleton. |

## The unit of work: a milestone

Work is organised into **milestones** — a coherent slice of delivery. A milestone is a folder:

```
NNN-name/
  SPEC.md              ← why + scope                 (the brief)
  RESEARCH.md          ← what we learned             (the evidence)        [conditional]
  ARCHITECTURE.md      ← ADRs: how/why decided       (the reasoning)       [conditional]
  DESIGN.md            ← UI/UX intent + mockups      (the experience)      [conditional]
  tasks/*.feature      ← observable outcomes         (the contract)
  UAT.md               ← how a human confirms it     (the sign-off)        [conditional]
  STATE.md             ← progress + history          (the ledger)
```

The **spine** — `SPEC.md` + `tasks/*.feature` + `STATE.md` — is always present. The rest appear
only when they have content. See [documents.md](documents.md) and [templates/](templates/).

## Worked example

A real milestone built in this shape (before the methodology was formalised here) lives in the
`voice-vox` repo at `wiki/milestones/321-telnyx-workflow-support/`. It is a useful reference for
the file shapes — and also for the **anti-patterns** ACD now forbids (design decisions and
research findings dressed as feature files). See
[acceptance-criteria.md → Anti-patterns](acceptance-criteria.md#anti-patterns).

## Status

This wiki is the canonical reference for ACD. It is implementation-ready: the agent definitions,
slash commands, and skills that operationalise it are derived directly from
[agents.md](agents.md) and [workflow.md](workflow.md).
