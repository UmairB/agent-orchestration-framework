---
doc: retrospective
---
# 25 · Mesh UI — Retrospective

Distilled at accept (`aof:verify 25`) from the STATE `## Feedback (for retro)` notes + the VERIFICATION
findings. The durable design decisions graduated to ADRs (`ARCHITECTURE.md` ADR-001…**005**); these are
the carryable *process* lessons, folded into memory for the next milestone's refine/continue.

## R1 — "buildable" ≠ "buildable against real data": a locked read must name the runtime *producer* of its source, not just a fixture that can plant it

**What happened.** Story 01's boards `activeRuns` was locked (Three-Amigos, dev verdict "buildable") against
`<workDir>/<slug>/` — a per-board local work stream. A white-box fixture *could* plant runs there, so the
tests passed, but **no runtime ever writes that layout** (aof items are direct children of `workDir`; the m24
registry mints group-level project slugs — separate repos). So the boards `activeRuns` column was **dead-`[]`
in production**: the NODES half showed real running counts while the BOARDS half showed every board idle.
Caught only at the verify design-render (finding **F1**), fixed by [ADR-005](ARCHITECTURE.md) (a board's
`activeRuns` = its owner's synced `presence.activeRuns` — a source with a real producer, reachable fleet-wide).

**Lesson.** A feasibility "LOCKED, buildable" verdict must confirm a **runtime writer** for every data source a
read depends on — not merely that a test fixture can plant the shape. "The fixture can create it" and "the
system produces it" are different claims; only the second makes a read real.

**How to apply.** In the Three-Amigos dev-feasibility pass, for each field a read projects, name the module +
code path that **writes** it in normal operation. If the only writer is the test, the contract is reading a
ghost — reject it or re-point the source before locking. [[verify-owns-record-docs]]

## R2 — reconcile the DESIGN binding checklist against the *actual* registered-command shape at refine, not at the build render

**What happened.** DESIGN was authored to the *intended* fleet view (a rich per-board run chip + a "this node"
tag); the ADR-002 `mesh:status` aggregate that got locked was **thinner** (`{ ref, owner?, activeRuns }`, no
per-board terminal state, no locality marker). The two were locked in **separate refine passes** and never
reconciled, so the build could only degrade — surfacing as design-gaps A (rich chip unfeedable) and B (no THIS
NODE / no drill-in split). The **mock arriving after the build** is what finally made the gap visible.

**Lesson.** DESIGN's binding checklist and the registered command's shape must be reconciled **at refine** — an
explicit "every rendered token has a real field on the command that renders it" pass — or the build inherits a
DESIGN-vs-data gap it can only degrade around. A mock produced *after* the build is a late smoke alarm; the
conformance truth should exist while the contract is still soft.

**How to apply.** When a UI reads a registered command, add a refine checkpoint that walks each DESIGN token →
the exact command field feeding it. A token with no field is a gap to resolve **then** (enrich the command, or
reduce the DESIGN rule) — not a surprise at the render. Here it resolved to a reduced fleet chip + a `local`
marker (ADR-005); pinning that at refine would have saved the round-trip.

## R3 — graph-independence is necessary but not sufficient for parallel story fan-out

**What happened.** The `aof graph impact` partition made stories 00 ∥ 01 look fully parallel (disjoint
functions, even in the one shared `cli.mjs`). But the build serialised 00 → 01 anyway: they share the
`scripts/test.mjs` wiring file, and story 01 integrates with the **untracked** m24 `mesh-registry.mjs` that a
git worktree can't see. Neither constraint shows up in the code-graph.

**Lesson.** Code-graph independence is one input to parallelisability, not the whole answer. A shared
test-wiring file and untracked cross-milestone substrate are real serialisation constraints that live *outside*
the import graph.

**How to apply.** Before projecting parallel fan-out, also check: (a) do the "independent" stories edit a shared
test-registration/wiring file, and (b) does either depend on untracked substrate a worktree won't have? If yes,
plan a serial build on the one tree — graph-clean ≠ worktree-parallel.
