<!--
  ARCHITECTURE.md — answers ONE question: how did we decide to build it, and why that way?
  Owner: architect.  Conditional (only if a non-trivial decision was made).
  A log of ADRs: numbered, IMMUTABLE, superseded-not-edited.
  Does NOT contain: observable behaviour (→ tasks/*.feature). "Returns URL ending ?tab=workflows"
  is an outcome; "we source it from the shared registry" is the ADR behind it.
-->
# NNN · <Milestone Name> — Architecture Decisions

## ADR-001: <decision title>

**Status:** Accepted <!-- | Superseded by ADR-NNN | Proposed -->
**Date:** <date>

**Context.** <The forces at play — what makes this a decision, what constrains it (cite
RESEARCH.md findings).>

**Decision.** <What we chose, stated plainly.>

**Alternatives considered.**
- <alternative> — <why rejected>

**Consequences.** <What this makes easy, hard, or impossible downstream.>

**Invariant (if any).** <A structural rule this decision implies, e.g. "no provider conditionals
in the generic machinery." Becomes a FITNESS FUNCTION below.>

## Fitness functions

<!-- Each structural invariant from an ADR, paired with the arch-test that enforces it in CI.
     These replace "invariant-as-scenario" anti-patterns — they belong here, not in feature files. -->

| Invariant | Enforced by (arch-test) | From |
|---|---|---|
| <e.g. zero `=== PROVIDER` branches in machinery> | `test/arch/<name>.test.ts` (grep/AST) | ADR-001 |
