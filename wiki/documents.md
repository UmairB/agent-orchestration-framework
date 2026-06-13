# The Document Model

> **The question this document answers:** *What documents make up a milestone, and what does
> each one own?*

ACD organises a milestone into single-purpose documents. The governing rule is **one question per
document** ([philosophy.md → principle 2](philosophy.md)): each file answers exactly one question,
and a line is in the wrong file when it answers a different one.

## The taxonomy

| Document | The one question it answers | Owner | Verified by |
|---|---|---|---|
| `SPEC.md` | *Why* are we doing this, and what's in/out of scope? | product-owner | — |
| `RESEARCH.md` | What did we *learn* that constrains the choices? | researcher | — |
| `ARCHITECTURE.md` | *How* did we decide to build it, and *why that way*? | architect | arch-tests (fitness functions) |
| `DESIGN.md` | *How* should it look and feel, and *why*? | designer | visual review |
| `tasks/*.feature` | *What will be observably true* when it's done? | product-owner (Three Amigos) | `@executable` → CI |
| `UAT.md` | *How does a human confirm it* in the real world, and have they? | qa | `@manual` → sign-off |
| `STATE.md` | *Where are we* now, and what happened? | product-owner | — |

Owners and the collaboration around them are detailed in [agents.md](agents.md).

## The spine vs the conditional documents

- **Spine (always present):** `SPEC.md`, `tasks/*.feature`, `STATE.md`. Every milestone has a
  reason, a contract, and a ledger.
- **Conditional (present only when they have content):** `RESEARCH.md` (only if there was a real
  unknown to resolve), `ARCHITECTURE.md` (only if a non-trivial decision was made), `DESIGN.md`
  (only if there is UI), `UAT.md` (only if something needs human/live verification).

Do not create an empty conditional document. Its absence is information: no `DESIGN.md` means no
UI work; no `ARCHITECTURE.md` means nothing was decided worth recording.

## Each document in detail

### SPEC.md — the brief

**Answers:** why + scope. The product-owner's statement of intent.

**Contains:** the goal; what's in scope and explicitly out of scope; dependencies; the acceptance
summary (a checklist that points at the feature files, not a restatement of them).

**Does not contain:** how it's built (→ ARCHITECTURE), what was learned (→ RESEARCH), the detailed
outcomes (→ feature files). The SPEC frames; the feature files specify.

### RESEARCH.md — the evidence

**Answers:** what we learned. Findings that constrain the design — SDK realities, vendor
behaviour, prior-art, measured facts.

**Contains:** findings with sources; the constraints they impose; assumptions to confirm later
(and which are CI-testable vs live-only).

**Does not contain:** the decision the findings led to (→ ARCHITECTURE). Research reports facts;
the architect decides what to do about them.

### ARCHITECTURE.md — the reasoning (ADRs)

**Answers:** how/why decided. A log of **Architecture Decision Records**: numbered, immutable,
superseded-not-edited.

**Each ADR contains:** context → the decision → alternatives considered → consequences. Plus any
**structural invariant** the decision implies (e.g. "no provider conditionals in the machinery"),
which becomes a **fitness function** — an automated arch-test that enforces the invariant in CI.

**Does not contain:** observable behaviour (→ feature files). "Returns the editor URL ending in
`?tab=workflows`" is an outcome; "we source it from the shared registry, not a config key" is the
ADR behind it. The feature states the first and *references* the ADR for the second.

**Scope note:** a decision local to this milestone lives here; a *durable* principle that outlives
every milestone belongs in a project-level architecture reference, linked from here.

### DESIGN.md — the experience

**Answers:** how it looks and feels, and why. UI/UX intent.

**Contains:** layout and interaction intent; component choices and their rationale; mockup/Figma
links. Prefer a visual artifact to prose — Gherkin and markdown are poor at expressing visual
design.

**Does not contain:** UI *behaviour* (→ feature files). "The form offers Telnyx for workflow
templates" is a behavioural outcome and is a scenario; "the provider picker is a radio group laid
out thus" is design.

### tasks/*.feature — the contract

**Answers:** what will be observably true. The executable acceptance criteria.

This is the heart of ACD and has its own document: **[acceptance-criteria.md](acceptance-criteria.md)**.

### UAT.md — the sign-off

**Answers:** how a human confirms it, and have they. Verification that lives outside or alongside
the automated suite.

**Contains:** for each `@manual` scenario, the **procedure**, the **environment**, and the
**sign-off** — and a `verifies →` pointer to the scenario it confirms. Plus human-acceptance
judgments that aren't scenarios at all, and live/credentialed checks CI can't run.

**Does not contain:** restated outcomes. It **references** feature scenarios; it never copies their
text. It is a *frontier*, not a graveyard — items migrate out to `@executable` as they get
automated, so a shrinking UAT.md is a sign of maturity. See
[acceptance-criteria.md → Tags](acceptance-criteria.md#tags) and
[workflow.md](workflow.md).

### STATE.md — the ledger

**Answers:** where we are, and what happened. The living record.

**Contains:** status; a progress checklist; notes and decisions-in-flight; surprises and
corrections; live findings. It is the forensic history of the milestone.

**Owned by a single writer** — the product-owner (orchestrator). Sub-agents report completion back;
the PO records it. One writer avoids merge races on shared state.

**Has a lifecycle.** STATE.md grows during the milestone and is **summarised/collapsed at milestone
close** — the durable conclusions graduate into ADRs, the architecture reference, or the next
milestone's SPEC; the blow-by-blow is archived. STATE is append-mostly *during* the work and
*compacted* at the end. Do not let it become an unbounded log nobody reads past line 50.

## The cross-linking rule

A fact lives in one document; others **reference** it. Concretely:

- a feature scenario references the ADR that justifies its design;
- a UAT item references the scenario it verifies (`verifies → @tag "scenario name"`);
- the SPEC's acceptance summary references the feature files, not their text;
- STATE references everything and restates nothing durable.

If you find yourself copy-pasting a fact between documents, one of them is wrong. Replace the copy
with a link.

## Next

- The contract in full → [acceptance-criteria.md](acceptance-criteria.md)
- Who owns and writes these → [agents.md](agents.md)
- The order they're produced in → [workflow.md](workflow.md)
- Copy-paste skeletons → [templates/](templates/)
