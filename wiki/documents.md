# The Work Stream & Documents

> **The question this document answers:** *What items and documents make up the work stream, and
> what does each one own?*

ACD organises work as a flat, chronological **stream** of items, governed by **one question per
document** ([philosophy.md → principle 2](philosophy.md)): each file answers exactly one question.

## The three item types

Work is a hierarchy of three types — but the hierarchy is expressed by **reference**, not by
folder nesting:

| Type | Is | Holds | Groups |
|---|---|---|---|
| **task** | the atomic unit of work | a `.feature` file (its scenarios *are* the acceptance criteria) | — |
| **story** | a user-facing deliverable | `STORY.md` (the user story + status) + its tasks | tasks |
| **milestone** | a delivery container | the shared `SPEC` / `STATE` / `ADR` / `DESIGN` / `RESEARCH` / `UAT` / `SECURITY` / `COMPLIANCE` | stories |

Read top-down: a **milestone** groups **stories**, a **story** groups **tasks**, a **task** is the
acceptance criteria. Read for *value*: the **story** is the unit of user-facing delivery and of
**parallelism**; the **task** is the unit of work and of testing.

## The flat stream and the folder convention

Every top-level item is a numbered folder directly under the work dir:

```
work/
  00_milestone_console-shell/
  01_story_shell-layout/             parent: 00
  02_story_theming/                  parent: 00
  03_milestone_platform-foundation/
  04_story_database-package/         parent: 03
  47_task_snapshot-perf-fix/         (adhoc — no parent)
```

- **Folder name = `NN_type_slug`** — split on the first two `_` → `[number, type, slug]`. The slug
  uses `-` for spaces and never contains `_`. Regex: `^(\d+)_(milestone|story|task)_([a-z0-9-]+)$`.
- **Number** = creation order = the timeline (a stable id; never renumber). Scanning the last *N*
  folders is the catch-up-on-recent-delivery view.
- **Grouping is by reference:** an item names its container in frontmatter `parent: <number>`. A
  milestone's stories are *separate top-level items* pointing back at it — that is what keeps the
  stream flat and chronological. Reconstruct a group on demand (`list --milestone 03`).
- **Standalone** items omit `parent`: a lone `task` (adhoc fix) or a lone `story` (a group of adhoc
  work). Depth scales with planning; adhoc stays flat.

### What nests vs what's flat

- **Tasks of a story nest physically** inside that story: `01_story_shell-layout/tasks/00_sidebar-ia.feature`.
- **Stories of a milestone do not nest** — they are top-level items with `parent:`.
- A **standalone/adhoc task** is its own top-level folder (`47_task_snapshot-perf-fix/`) containing
  its `.feature`.

## Frontmatter — the authoritative record

The folder name is a human-scannable **index**; the frontmatter is the machine-authoritative
**record**. They intentionally carry the same identity (`type`/`number`/`slug`) — decoupled so the
record survives a change of folder convention or an export to another store. **The validator
asserts they agree** (controlled redundancy, not silent drift).

Each item has **one canonical record doc**: a milestone's `SPEC.md`, a story's `STORY.md`. It
carries the full record:

```yaml
---
type: story            # milestone | story | task
number: 01
slug: shell-layout
title: "Shell layout"
parent: 00             # the container's number; omit when standalone
status: in-progress    # not-started | in-progress | blocked | in-review | done
owner: product-owner
created: 2026-06-13
updated: 2026-06-13
---
```

- **Supporting docs** (a milestone's `STATE`/`ARCHITECTURE`/`DESIGN`/`RESEARCH`/`UAT`) carry only
  `doc: <kind>` — they inherit identity from the folder; they do not restate `number`/`slug`/`status`.
- **Tasks carry no frontmatter** — Gherkin can't. A task's identity is its folder/file name; its
  metadata is its **tags** (`@executable`/`@manual`, etc., see [acceptance-criteria.md](acceptance-criteria.md)).
  This is *why* the type is encoded in the name.

## Documents by level

### Milestone documents (the shared, heavy context)

| Document | The one question it answers | Owner |
|---|---|---|
| `SPEC.md` *(record)* | *Why + scope* of the milestone (its objective + which stories) | product-owner |
| `STATE.md` | *Where are we, what happened* (running log) | product-owner |
| `ARCHITECTURE.md` | *How decided, why* — ADRs + fitness functions | architect |
| `DESIGN.md` | *How it looks & feels, why* | designer |
| `RESEARCH.md` | *What we learned* that constrains choices | researcher |
| `UAT.md` | *How a human confirms it*, and have they | qa |
| `SECURITY.md` | *What could an attacker do, and how we stop them* — threat model + controls | security |
| `COMPLIANCE.md` | *Which obligations bind us* (GDPR, ISO 27001) *and where each is evidenced* | compliance |

Spine: `SPEC.md` (always). The rest are **conditional** — present only when they have content
(absence is information). They are produced by `refine`, per-milestone, when the work needs them.
`SECURITY.md` and `COMPLIANCE.md` are owned by the [domain specialists](agents.md#domain-specialists--the-architects-conditional-tier)
the architect fans out — they *reference* the controls (scenarios, fitness functions, ADRs) that
satisfy each threat or obligation, never restating them.

### Story document

| Document | The one question it answers | Owner |
|---|---|---|
| `STORY.md` *(record)* | *Why this story* — the user story (`As a / I want / so that`) + its task list | product-owner |

A standalone story's `STORY.md` is self-contained (it has no milestone SPEC to inherit from). A
milestone-bound story inherits the milestone's ADRs/design/research.

### Task document

| Document | The one question it answers | Owner |
|---|---|---|
| `*.feature` | *What is observably true* when done — the acceptance criteria | product-owner (Three Amigos) |

The task is the home of the Gherkin. It has no user story (that's the parent story's). See
**[acceptance-criteria.md](acceptance-criteria.md)**.

## Status & recency

- **Status** lives per level: a milestone/story in its record's frontmatter; a **task** is done when
  its `@executable` feature is green (or carries `@wip` until then).
- **Recency:** `created` (≈ the folder number) vs `updated` (last touch). Scan the last *N* folders
  for recently-*created* work; sort all items by `updated` for recently-*worked-on* work.

## The cross-linking rule

A fact lives in one place; others **reference** it. The user story lives on `STORY.md`; the
milestone references its stories (and they reference it) by number; the SPEC's scope points at its
stories, not their text; UAT references the scenario it verifies; `SECURITY.md` and `COMPLIANCE.md`
reference the controls that defend each threat or obligation. Copy-pasting a fact between docs means
one of them is wrong — replace the copy with a link.

## Next

- The acceptance criteria in full → [acceptance-criteria.md](acceptance-criteria.md)
- Who owns and writes these → [agents.md](agents.md)
- The order they're produced in → [workflow.md](workflow.md)
- Copy-paste skeletons → [templates/](templates/)
