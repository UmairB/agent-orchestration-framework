# Glossary

> **The question this document answers:** *What do the terms mean?*

Terms specific to ACD, or used with a specific meaning here. Linked from the rest of the wiki.

### Acceptance-Criteria Development (ACD)
The methodology this wiki describes. Declarative, outcome-first delivery with LLM agents, where
executable acceptance criteria are the contract and single-purpose documents are the handoff
interface. Also "acceptance-criteria prompting" when emphasising the agent loop. → [README](README.md)

### Acceptance surface
The unit a feature file covers — a coherent area of behaviour, floating between "one method's edge
cases" and "one whole capability." Deliberately *not* called a "task," because the grain isn't
uniform. → [acceptance-criteria.md](acceptance-criteria.md#granularity-acceptance-surface-not-task)

### ADR (Architecture Decision Record)
A numbered, immutable record of one decision: context → decision → alternatives → consequences.
Superseded, never edited. Lives in `ARCHITECTURE.md`. → [documents.md](documents.md#architecturemd--the-reasoning-adrs)

### Black-box observable
The property a feature-file line must have: confirmable by a tester *without reading the source*.
The litmus test for what belongs in a feature file. → [acceptance-criteria.md](acceptance-criteria.md#the-litmus-test-apply-it-to-every-line)

### Conditional activation
The rule that an agent runs — or a document exists — only when its artifact has content. The
anti-ceremony guardrail; absence of content *is* the lightweight mode. → [agents.md](agents.md#conditional-activation--the-anti-ceremony-guardrail)

### Drift
The decay where the same fact, restated in multiple documents, diverges between copies. The failure
mode that kills spec methodologies. Defended structurally by *reference, never restate* and the
traceability lint. → [philosophy.md](philosophy.md)

### Fitness function
An automated arch-test (grep / lint / AST) that enforces a structural invariant in CI. Where
structural assertions go *instead of* feature files. Owned by the architect. → [acceptance-criteria.md](acceptance-criteria.md#structural-invariants-become-fitness-functions)

### `@executable` / `@manual`
The two verification tags. `@executable` scenarios are verified by an automated test (and subject to
the traceability lint); `@manual` scenarios are verified by a human procedure in `UAT.md`. Items
migrate `@manual → @executable` as they get automated. → [acceptance-criteria.md](acceptance-criteria.md#tags)

### Milestone
The unit of work in ACD: a coherent slice of delivery, represented as a folder of documents. →
[documents.md](documents.md)

### One question per document
The governing rule of the document model: each artifact answers exactly one question; a line is in
the wrong file when it answers a different one. → [philosophy.md](philosophy.md)

### Scenario Outline + Examples
The Gherkin construct ACD uses as the **test-case layer**: one readable template plus a table of
concrete rows. Keeps the feature scannable while enumerating cases — visible *and* executable. →
[acceptance-criteria.md](acceptance-criteria.md#three-zoom-levels-from-one-source)

### Spine
The always-present documents of a milestone: `SPEC.md`, `tasks/*.feature`, `STATE.md`. Everything
else is conditional. → [documents.md](documents.md#the-spine-vs-the-conditional-documents)

### Three Amigos
The practice of co-authoring the feature files from three viewpoints — product-owner (the *what*),
qa (*what could break*), developer (*is it feasible*). The PO holds the pen; the feature locks only
after Dev and QA sign the elaboration. → [agents.md](agents.md#who-authors-the-feature-files-three-amigos)

### Traceability spine
The enforced link from every `@executable` scenario (or Examples row) to a passing test, checked by
a CI lint. The keystone of ACD — without it, the methodology is documentation. → [acceptance-criteria.md](acceptance-criteria.md#traceability--the-spine)

### UAT frontier
The idea that `UAT.md` is a *shrinking* set: manual items migrate out to `@executable` as they're
automated, so a small UAT is a sign of maturity, not neglect. → [documents.md](documents.md#uatmd--the-sign-off)
