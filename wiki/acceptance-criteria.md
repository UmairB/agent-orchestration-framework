# Acceptance Criteria — The Feature Files

> **The question this document answers:** *What goes in a feature file, and how is it verified?*

The feature files are the heart of ACD: the **executable contract of observable behaviour**. They
are what makes the deliverable visible ([philosophy.md → principle 3](philosophy.md)) and what the
agents collaborate to produce. This document defines exactly what is — and is not — allowed inside
one, and how a scenario connects to a passing test.

## What a feature file is for

A feature file states **what will be observably true when the work is done**. Nothing else. It is
written in Gherkin so that a reviewer, a future QA specialist, or a PM tool can read the deliverable
in seconds without reading the source.

It is *not* a place for design decisions, implementation notes, research findings, or structural
invariants. Each of those has its own home ([documents.md](documents.md)); putting them in a
feature file destroys the one property the feature file exists to provide — that "it's a `.feature`
file" reliably means "here is a tested, observable outcome."

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

## Granularity: "acceptance surface," not "task"

A feature file covers a **coherent acceptance surface**, which floats between "one method's edge
cases" and "one whole capability" — not a uniform "task." `provider-workflow-read-write.feature`
(a subsystem's read/write contract) and `dashboard-deep-link.feature` (one small behaviour) are
both legitimate; they're just different-sized surfaces. Name the unit honestly: a surface, not a
task.

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

| Tag class | Examples | Purpose |
|---|---|---|
| Milestone | `@milestone-321` | Which milestone owns it |
| Layer | `@application`, `@portal-admin` | Primary architectural layer |
| Refinement | `@providers`, `@workflow`, `@workflow-ui` | Sub-area within the layer |
| Domain | `@telnyx`, `@knowledge-base` | Feature/provider/domain |
| **Verification** | **`@executable`** / **`@manual`** | **How this scenario is verified** |

The **verification tags are load-bearing**:

- `@executable` — verified by an automated test. Subject to the traceability lint below.
- `@manual` — verified by a human procedure recorded in `UAT.md` (which `verifies →` back to it).

An `@manual` scenario that becomes automatable is **re-tagged `@executable`** and its UAT entry is
deleted. The frontier shrinks toward the irreducibly-manual core.

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
