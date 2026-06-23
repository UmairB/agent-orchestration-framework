<!-- aof-generated: bundle -->

---
doc: architecture
---
<!--
  Milestone ARCHITECTURE.md — answers ONE question: how did we decide to build it, and why that way?
  Owner: architect. Conditional (only if a non-trivial decision was made). Shared by the milestone's
  stories. A log of ADRs: numbered, IMMUTABLE, superseded-not-edited.
  Does NOT contain: observable behaviour (→ task .feature files). "Returns URL ending ?tab=workflows"
  is an outcome; "we source it from the shared registry" is the ADR behind it.
-->
# NN · <Milestone Title> — Architecture Decisions

## ADR-001: <decision title>

**Status:** Accepted <!-- | Superseded by ADR-NNN | Proposed -->
**Date:** <date>

**Context.** <The forces at play — what makes this a decision, what constrains it (cite RESEARCH findings).>

**Decision.** <What we chose, stated plainly.>

**Alternatives considered.**
- <alternative> — <why rejected>

**Consequences.** <What this makes easy, hard, or impossible downstream.>

**Invariant (if any).** <A structural rule this implies, e.g. "no provider conditionals in the
machinery." Becomes a FITNESS FUNCTION below — not a Gherkin scenario.>

## Fitness functions

<!-- Each structural invariant from an ADR, paired with the arch-test that enforces it in CI.
     These replace "invariant-as-scenario" — they belong here, never in a task feature. -->

| Invariant | Enforced by (arch-test) | From |
|---|---|---|
| <e.g. zero `=== PROVIDER` branches in the machinery> | `test/arch/<name>.test.ts` (grep/AST) | ADR-001 |
