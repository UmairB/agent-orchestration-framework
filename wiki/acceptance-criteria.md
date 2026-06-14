# Acceptance Criteria — The Task Feature Files

> **The question this document answers:** *What goes in a task's feature file, and how is it
> verified?*

A **task** is the atomic unit of work, and its `.feature` file is the heart of ACD: the **executable
contract of observable behaviour**. Acceptance criteria live at the **task** level — the task's
scenarios *are* its criteria. This is what makes the deliverable visible
([philosophy.md → principle 3](philosophy.md)). This document defines exactly what is — and is not —
allowed inside a task feature, and how a scenario connects to a passing test.

## What a task feature file is for

A task feature states **what will be observably true when the task is done**. Nothing else. It is
written in Gherkin so that a reviewer, a future QA specialist, or a PM tool can read the deliverable
in seconds without reading the source.

**No user story.** The `As a / I want / so that` belongs to the *parent story* (`STORY.md`), not the
task. A task feature opens with `Feature: <name>` and, optionally, a one-line objective
(`In order to … the system must …`) — then its scenarios. A standalone (adhoc) task feature is the
same: a goal line + scenarios, no user story.

It is *not* a place for design decisions, implementation notes, research findings, or structural
invariants. Each of those has its own home ([documents.md](documents.md)); putting them in a
feature file destroys the one property it exists to provide — that "it's a `.feature` file" reliably
means "here is a tested, observable outcome."

## The litmus test (apply it to every line)

> **Could a black-box tester confirm this line without reading the source?**

- **Yes** → it's an observable outcome. It belongs in the feature file.
- **No** (it requires knowing the internal structure) → it's a decision or an invariant. It belongs
  in `ARCHITECTURE.md`, and — if it's enforceable — in a fitness function.

Apply it at the **line** level, not just the file level. A scenario can be 90% outcome with one
smuggled design assertion in a `Then` step; that one line still has to move.

| Smuggled line (wrong) | Why | Where it goes |
|---|---|---|
| "the URL comes from the PROVIDER_URLS registry, not a config key" | how it's sourced — design | ADR |
| "routes through the factory, not a TELNYX branch" | internal structure | ADR + fitness function |
| "a grep for `conversation_flow` returns nothing" | a research finding | RESEARCH.md |
| "the template declares a KB slot with a content contract" | a design decision | ADR |

The correct outcome in row 1 is just: *"returns the fixed editor URL ending in `?tab=workflows`."*
The reader doesn't care *how* it's sourced; the test can confirm the URL without knowing.

## Structural invariants become fitness functions

Some of the most valuable assertions are negative and structural — "**zero** `=== TELNYX` branches
in the machinery," "the workflow blob is never parsed." These are real and verifiable, but they are
**not behavioural outcomes**, so they don't go in feature files. They become **fitness functions**:

1. State the invariant as an ADR in `ARCHITECTURE.md`.
2. Enforce it with an **arch-test** — a grep/lint/AST test that fails CI if the invariant is
   violated.

The architect owns these ([agents.md](agents.md)). The value is preserved; the home is correct; and
the invariant is enforced *continuously* rather than asserted once in prose.

## Three zoom levels from one source

The tension to resolve: the feature file must stay **scannable** (few headline outcomes) while test
coverage must be **exhaustive** (every edge, every error code). Cramming every case in as a
top-level scenario recreates the wall-of-text problem ACD exists to kill. Gherkin already solves
this with three zoom levels from a single source:

1. **Scenario** — a headline acceptance case. The outcome a stakeholder needs to see. Few per
   feature.
2. **Scenario Outline + Examples** — the *case matrix*. The exhaustive enumeration — every status
   code, boundary, malformed input — as rows under one readable template. Visible **and**
   executable, with zero drift.
3. **Step definitions / spec** — execution.

```gherkin
Scenario Outline: getWorkflow maps the provider response to the right result
  When getWorkflow targets an assistant that returns <response>
  Then it yields <result>

  Examples:
    | response   | result                      |
    | has flow   | workflow + contentHash      |
    | null flow  | null (NEVER_PULLED signal)  |
    | 404        | ProviderAgentNotFoundError  |
    | 500        | ProviderApiError            |
```

A reader skims **outlines**; a tester reads **tables**; the suite runs **rows**. One source, three
audiences. Push exhaustive enumeration into Examples tables, keep top-level scenarios to the 3–7
headline behaviours.

## Granularity: a task is one coherent unit of work

One `.feature` = one **task** = one coherent unit of work, whose scenarios are its acceptance
criteria. A task can be a method's edge cases or one small behaviour; if it sprawls across several
unrelated behaviours, that's the signal to split it into multiple tasks under the same **story**.
The story is the user-facing grouping; the tasks are its testable units. When a current artifact
mixes a user story with many scenarios, split it: user story → `STORY.md`, scenarios → one or more
task features.

## The same scenario, three roles

A single scenario is simultaneously, depending on who picks it up:

- the **acceptance contract** (what "done" means),
- the **manual QA script** (a human executes the Given/When/Then by hand),
- the **automated BDD test** (once step definitions exist).

You do not write separate manual test cases. The scenario *is* the test case at three maturity
levels, and `@manual → @executable` is the migration you drive over time. This is what makes the
"future QA specialist" investment pay off for free.

## Tags

Every feature and scenario carries tags. They make the contract queryable across a monorepo and —
critically — they drive verification routing.

### The allowed tags (the closed vocabulary)

Tags fall into two tiers. **Universal** tags are part of ACD and are identical in every project.
**Project-specific** tags name your own architecture and product — the methodology defines the
*class*, your project enumerates the *values*.

> **Where the enforced list lives.** The authoritative, machine-checked vocabulary is owned by the
> **ACD commands/skills** (the universal tags) and **project config** (the project-specific values);
> a lint rejects any tag outside it. This section is the human registry the tooling implements —
> keep them in lockstep: a tag's *name* is enforced by the tooling, its *meaning* is documented
> here. Adding a tag is a deliberate edit to the skills / project config **and** this registry,
> never an ad-hoc keystroke in a feature file.

**Universal — verification** · *exactly one per scenario* · load-bearing (drives routing):

| Tag | Meaning |
|---|---|
| `@executable` | Verified by an automated test. Subject to the traceability lint below. |
| `@manual` | Verified by a human procedure in `UAT.md` (which `verifies →` back to it). |

An `@manual` scenario that becomes automatable is **re-tagged `@executable`** and its UAT entry is
deleted — the frontier shrinks toward the irreducibly-manual core.

**Universal — lifecycle / lineage** · *optional, repeatable*:

| Tag | Meaning |
|---|---|
| `@bug` | Born from a defect — a permanent regression guard. |
| `@wip` | Not yet green; pending / in-progress. Excluded from the green gate. |
| `@uat-<id>` | Lineage pointer to the originating UAT finding (e.g. `@uat-F01`). Lint: must resolve to a real finding. |

*Deliberately not used:* a separate `@regression` — `@bug` is the regression marker (avoid
redundant tags).

> **No milestone/story membership tag.** A task's place in the hierarchy is **structural** — its
> folder (`NN_story_slug/tasks/…`) and the `parent:` references — not a tag. Don't restate
> membership as `@milestone-NN`; the tooling derives the set of a milestone's tasks from the stream
> (`list --milestone 03`). Tags are for *cross-cutting* facets (verification, lineage, layer,
> domain), not containment.

**Project-specific** · *your architecture names these; values enumerated in project config*
(examples are from the `voice-vox` reference, illustrative only):

| Class | Cardinality | Examples | Means |
|---|---|---|---|
| Layer | one or more | `@application`, `@portal-admin` | Primary architectural layer |
| Refinement | pairs with a layer | `@providers`, `@workflow`, `@workflow-ui` | Sub-area within the layer |
| Domain | one or more | `@telnyx`, `@retell`, `@knowledge-base` | Feature / provider / subject |

> **Controlled vocabulary or it rots.** A queryable contract depends on a *closed* set with *one
> spelling per concept* — `@knowledge-base`, never also `@kb`. The moment two scenarios spell the
> same concept differently, every query silently misses rows. That is why the list is enforced by
> tooling, not convention.

## Traceability — the spine

This is the keystone of the whole methodology. **The link from `@executable` scenario to green test
must be enforced, not conventional.** A freeform comment ("Proven by foo.spec.ts (18 green)") is a
lie waiting to happen — rename the spec and the comment silently rots.

The rule:

> **A lint fails CI when an `@executable` scenario (or any row of an `@executable` Scenario Outline)
> has no matching, passing test.**

With Examples tables this is enforceable **row by row** — each row is a case, each case maps to a
test. The mechanism: a stable scenario/row identifier referenced by the test (a tag, an ID, or a
naming convention the lint understands), checked in CI.

Without this spine, ACD is good documentation, not a methodology. With it, the feature files are a
verifiable contract: green CI *proves* every `@executable` outcome is real, and `UAT.md` sign-offs
*prove* every `@manual` one is. That is the difference between "we wrote nice specs" and "the specs
are true."

## Anti-patterns

Drawn from the `voice-vox/321` worked example — these are the exact mistakes ACD now forbids:

- **Design-decision-as-feature.** A `knowledge-base-strategy.feature` whose scenarios are "the
  template declares a KB slot, not a KB." That's an ADR. No test exercises it. → `ARCHITECTURE.md`.
- **Research-finding-as-feature.** A `transport-spike.feature` asserting "a grep returns nothing."
  That's a finding. → `RESEARCH.md` (and the spike itself is process, not a deliverable contract).
- **Implementation-assertion in a `Then`.** "the URL comes from the registry, not a config key."
  Fails the litmus test. → ADR; the feature keeps only the observable URL.
- **Invariant-as-scenario.** "no file contains a `=== TELNYX` branch." → fitness function.
- **Exhaustive cases as top-level scenarios.** Twenty near-identical scenarios for twenty status
  codes. → one Scenario Outline + an Examples table.

## Next

- Where the rejected content goes → [documents.md](documents.md)
- Who authors the feature file (Three Amigos) → [agents.md](agents.md)
- A copy-paste feature template → [templates/tasks/](templates/tasks/)
