# Glossary

> **The question this document answers:** *What do the terms mean?*

Terms specific to ACD, or used here with a specific meaning. Linked from the rest of the wiki.

### Acceptance-Criteria Development (ACD)
The methodology this wiki describes. Declarative, outcome-first delivery with LLM agents, where
executable acceptance criteria are the contract and a flat chronological stream of work items is the
record. → [README](README.md)

### Work stream
The single flat directory holding all work items as numbered folders, in creation order. The number
is the timeline; scanning the last *N* is the recent-delivery view. → [documents.md](documents.md)

### Work item
Any of the three units: a **milestone**, **story**, or **task**. Each is a `NN_type_slug` folder in
the stream. → [documents.md](documents.md)

### Milestone
A delivery container that groups **stories** and holds their shared docs (SPEC/STATE/ADR/DESIGN/
RESEARCH/UAT/SECURITY/COMPLIANCE). The top of the hierarchy. → [documents.md](documents.md)

### Story
A user-facing deliverable that groups **tasks**. Owns the user story (`STORY.md`) and is the unit of
**parallelism**. Can belong to a milestone (`parent:`) or stand alone. → [documents.md](documents.md)

### Task
The atomic unit of work: a `.feature` file whose scenarios *are* its acceptance criteria. Has no
user story (that's the parent story's). Nests in a story's `tasks/`, or stands alone as an adhoc
fix. → [acceptance-criteria.md](acceptance-criteria.md)

### `NN_type_slug`
The folder-name convention: a zero-padded sequence number, the item type, and a kebab-case slug,
joined by `_` (the slug uses `-` for spaces). The name is a scannable index; the frontmatter is the
authoritative record; the validator keeps them in sync. → [documents.md](documents.md#frontmatter--the-authoritative-record)

### Reference grouping
Expressing the hierarchy with a `parent: <number>` field rather than physical folder nesting — what
keeps the stream flat and chronological. A milestone's stories are separate top-level items pointing
back at it. → [documents.md](documents.md)

### `STORY.md`
A story's record doc: the user story (`As a / I want / so that`), its status, and its task list. →
[documents.md](documents.md#story-document)

### ADR (Architecture Decision Record)
A numbered, immutable record of one decision: context → decision → alternatives → consequences.
Lives in a milestone's `ARCHITECTURE.md`. → [documents.md](documents.md)

### Black-box observable
The property a task-feature line must have: confirmable by a tester *without reading the source*.
The litmus test. → [acceptance-criteria.md](acceptance-criteria.md#the-litmus-test-apply-it-to-every-line)

### Conditional activation
The rule that an agent runs — or a document exists — only when its artifact has content. The
anti-ceremony guardrail; the item type (task/story/milestone) sets the baseline depth. → [workflow.md](workflow.md)

### Domain specialist
A conditionally-activated technical expert the **architect** fans out at the Decide stage, owning one
conditional domain document — `security` (`SECURITY.md`, threat model) and `compliance`
(`COMPLIANCE.md`, GDPR/ISO 27001 map) today; `cloud`/`performance`/`data` are future instances. An
extension of the architect's altitude, not a new core role. → [agents.md](agents.md#domain-specialists--the-architects-conditional-tier)

### Planning
The product-altitude work *above* the work stream — discovery, strategy, prioritisation — that
decides which milestones to build and why, often across several at once. ACD owns only the seam
(the PRD), not the planning method, which is supplied by plugins. → [planning.md](planning.md)

### PRD
The product requirements document a [planning](planning.md) effort produces: the boundary artifact
that hands off from `/planning` to `/work`. Lives upstream of the work stream and outside the
methodology boundary (its format is the planning tool's, not ACD's); the product-owner shatters it
into milestone `SPEC.md`s. Flow is one-directional — PRD → SPECs, never back. → [planning.md](planning.md)

### Drift
The decay where the same fact, restated in multiple places, diverges between copies. Defended by
*reference, never restate* and the validator (folder name ↔ frontmatter; `@executable` ↔ test). →
[philosophy.md](philosophy.md)

### Fitness function
An automated arch-test (grep / lint / AST) that enforces a structural invariant in CI. Where
structural assertions go *instead of* feature files. Owned by the architect. → [acceptance-criteria.md](acceptance-criteria.md#structural-invariants-become-fitness-functions)

### `@executable` / `@manual`
The two verification tags (exactly one per scenario). `@executable` → an automated test (traceability
lint); `@manual` → a human procedure in `UAT.md`. Items migrate `@manual → @executable`. → [acceptance-criteria.md](acceptance-criteria.md#tags)

### One question per document
The governing rule of the document model: each artifact answers exactly one question. → [philosophy.md](philosophy.md)

### Scenario Outline + Examples
The Gherkin construct ACD uses as the **test-case layer**: one readable template plus a table of
concrete rows. Visible *and* executable. → [acceptance-criteria.md](acceptance-criteria.md#three-zoom-levels-from-one-source)

### Three Amigos
Co-authoring a task feature from three viewpoints — product-owner (the *what*), qa (*what could
break*), developer (*is it feasible*). → [agents.md](agents.md#who-authors-the-feature-files-three-amigos)

### Traceability spine
The enforced link from every `@executable` scenario (or Examples row) to a passing test, checked by
a CI lint. The keystone of ACD. → [acceptance-criteria.md](acceptance-criteria.md#traceability--the-spine)

### UAT frontier
The idea that `UAT.md` is a *shrinking* set: manual items migrate out to `@executable` as they're
automated, so a small UAT is a sign of maturity. → [documents.md](documents.md)
