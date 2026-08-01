---
type: story
number: 01
slug: item-lock
title: "The exclusive item lock — an active assignment owns its item at EXECUTION scope, and every door (second assignment, local mint, retry, control-side mutation) refuses with one coded refusal until the next gate"
parent: 43
status: not-started
owner: product-owner
created: 2026-08-01
updated: 2026-08-01
schema: 1
aofVersion: 0.1.0
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH; a standalone story
  (no parent) is self-contained.
-->
# 01 · The exclusive item lock

## User story

As the **operator of a mesh whose work items are executed by whichever node is free**,
I want an active assignment to **exclusively own its item for the whole of its phase** — so that a second
assignment, a local `run-start`/`run-retry`, and a control-side mutation of that item are each **refused
with a coded, loud answer naming the holder**,
so that two nodes can never author the same item at once, and the destructive case the operator named
(inserting a story on the control node — an **insert**, which renumbers folders — while a worker holds a
worktree full of the old refs) becomes **impossible rather than merely unlikely**.

<!-- This is one of the two risk-carrying cores (ADR-009 wave 1). It is also the prerequisite for
     story 05: the lock is what makes the tree quiescent at a gate, which is the window
     gate-propagation advances the branch in. -->

## Acceptance criteria (outcome — detailed scenarios authored at refine, into the task `.feature`s)

Grounded in `ARCHITECTURE.md` **ADR-003**, closing the two holes STATE measured at HEAD:

1. **The scope rule has ONE home, and it is a leaf.** `executionScopeRef` moves **down** from
   `src/board-mesh-execution.mjs` (a face, imported by `continue`/`list`/`run-status`) into
   `src/assignment-record.mjs` (**imports 0** — a pure leaf, per the graph). `board-mesh-execution.mjs`
   imports it from there and re-exports for its existing consumers. The function is **defined exactly
   once in the repo**, as it is today — the spine must never import a face.
2. **The lock predicate is SYMMETRIC over the execution scope.** `findActiveAssignment` keeps its
   exact-ref semantics untouched for its 6 importers; a **new** scope-aware read returns the active row
   whose `item_ref` shares this ref's execution scope. Symmetry is load-bearing and is a conscious
   extension of `resolveScopedExecution`, which only walks **upward**: running `42` must lock `42/03`
   **and** running `42/03` must lock `42`, because both execute in ONE worktree on ONE branch.
3. **There is exactly ONE enforcement door: INSIDE `transitionRunStart`** (`src/effects/run-transitions.mjs:39`),
   in front of the fact — not in front of it at each of the five call sites
   (`commands/run-start.mjs:156,176`; `commands/run-retry.mjs:65`; `mesh-worker-execution.mjs:2458,2954`).
   No mint can reach the run store without passing it.
4. **The guard ADMITS the holder by identity, never by exemption** — mirroring `guardAssignmentTransition`.
   A mint made *under* an assignment passes that assignment's identity and is admitted; a local mint that
   passes none is refused when any **foreign** active assignment covers the scope. The worker's own two
   mint sites run under the very assignment that holds the lock and are admitted for that reason.
5. **The refusal is coded and loud: `item-locked-by-assignment`** — ONE code for every door, because it
   is one rule. The payload carries `{ itemRef, scopeRef, assignmentId, holderNode, state }` so a face can
   render "42 is held by aof-wsl — refused" without parsing prose. It joins the existing coded-refusal
   vocabulary (`assignment-status-not-holder`, `assignment-base-commit-unavailable`).
6. **`work next` skips-and-reports through the SAME predicate.** It does not silently omit a held item
   (invisible), and does not hand one out to be refused a step later (a bad seam): it returns the next
   **unheld** item and reports the skipped ones in its envelope **with the holder**. One rule, two
   renderings.
7. **Operator-initiated vs automatic renders differently, and that is decided ONCE here, not per call
   site.** An **operator verb** (a mint, a second assignment, a control-side item mutation) is refused,
   coded, loud — a human asked and gets an answer. An **automatic periodic tick** (the control's publish,
   ADR-004) **skips the rows it does not own and counts the skips in its result** — a coded refusal per
   held item per tick is log spam, and the tick asked nothing.
8. **The run store stays mesh-blind.** The guard lives in the seam and in the new lock module;
   `src/run-store.mjs` gains no import and no config read — `acd-run-store-mesh-free` (m26/ADR-001) is
   re-armed, never duplicated.

## Tasks

<!-- Authored at `aof:refine 43 --autonomous` (Three Amigos: PO headline Scenarios + aof-qa Examples +
     aof-developer feasibility). Each is a tasks/NN_<slug>.feature whose @executable scenarios are the
     acceptance criteria. Kept independent of the other stories' tasks. -->

- [ ] `tasks/00_scope-rule-one-home-faces-unchanged.feature` — the execution-scope rule moves down into the pure leaf and every existing face (continue/refine/verify, the board's row overlay, run-status) answers byte-identically (AC1's no-regression half; "defined exactly once" stays in the arch-test).
- [ ] `tasks/01_lock-is-symmetric-over-execution-scope.feature` — an active assignment holds the WHOLE execution scope in both directions: running `42` locks `42/03` and running `42/03` locks `42`, while a sibling scope, a string-prefix near-miss and every terminal state stay free (AC2).
- [ ] `tasks/02_one-coded-refusal-at-every-door.feature` — a second assignment, a local `run-start`, a `run-retry` and a control-side mutation are each refused with the one code `item-locked-by-assignment` and its five-key payload, minting nothing and renaming nothing — and all of them open again at the gate (AC3 + AC5).
- [ ] `tasks/03_holder-admitted-by-identity-never-exemption.feature` — the mint carried out under the holding assignment is admitted because it names that assignment; a different, a stale, an unknown or an absent identity is refused, and an unheld or unmeshed item mints byte-identically (AC4 + AC8's behavioural half).
- [ ] `tasks/04_next-skips-held-items-and-reports-the-holder.feature` — `work next` returns the next UNHELD item and reports every skipped one with its holder, never silently omitting it and never handing out an item `run-start` would refuse a step later (AC6).
- [ ] `tasks/05_operator-refused-automatic-skipped-and-counted.feature` — an operator verb is refused loudly and exactly once; the control node's periodic publish tick skips the held rows, counts them in its own result, and logs no refusal across repeated ticks (AC7).
- [ ] `tasks/06_cross-machine-lock-soak.feature` — `@manual`: on two real machines, a real control-side insert against a milestone a real worker is holding renames not one folder, every door is refused, the worker is never locked out of its own work, and everything releases at the gate.

## Notes

- **Dependency shape (ADR-009):** wave 1, parallel with `02_story_cache-authority` — the two touch
  **disjoint modules**. Story `05_story_gate-propagation` depends on this one for its quiescence
  guarantee.
- **The invariant that is NOT a scenario:** "the lock check sits in front of the single mint door" is a
  *placement* property and lives in the arch-test `acd-item-lock-single-door` (already committed green:
  it asserts a single `executionScopeRef` definition, and arms on the lock module landing). The
  **refusal itself** is behavioural and belongs in a scenario.
- ADR-004 routes control-side mutation of a held ref into **this same guard** rather than inventing a
  second rule — so STATE's settled "control-side mutation refused mid-phase, allowed at a gate" is
  discharged here. **But the guard's HOME is `effects/stream-transitions.mjs`'s `transitionStreamReindexed`,
  not story 02's upsert seam** (developer finding at refine): routing it through the seam would serialise
  this story behind `43/02` and destroy wave 1's parallelism. `transitionStreamReindexed` is the single seam
  both insert call sites (`insert-shared.mjs:274,599`) already route through, already takes `workspace`,
  already imports `resolveWorkspaceId` — and **no other story touches it**.
- **Rulings that changed this story's contract at refine (ADR-010):**
  - **R1.1** — "ONE code for every door" is superseded. The exact-ref duplicate-assign gate **keeps**
    `assignment-already-active` (it is HTTP-409-mapped at `mesh-ui-serve.mjs:775` and asserted twice by an
    m38 feature, which needs no amendment); only the **new scope predicate** raises
    `item-locked-by-assignment`.
  - **R1.3** — holder admission rides `brief.assignmentId`, already present at both worker mint sites, so
    no lookup is needed. The scope lookup takes a **new `opts.lock = { workspaceId, byAssignment }`** —
    deliberately **not** `opts.workspace`, which would flip `run-retry` into publishing as a side effect.
    `workspaceId` comes from the caller's resolved workspace and **never** from `item.dir` (TECH_DEBT item
    4). A missing `opts.lock` where mesh is configured **fails loud** (`item-lock-context-missing`), never
    silently skips.
  - **R1.4 (the question QA most wanted answered) — the lock FAILS CLOSED**, with a distinct code and a
    bounded blast radius: no mesh configured ⇒ mint freely (the right answer, not a failure); store
    readable ⇒ normal; **store configured but unopenable ⇒ refuse with `item-lock-undeterminable`**. Closed
    wins because an unreadable store is precisely the condition under which double-writing cannot be ruled
    out; the wedge risk is bounded by the first case.
  - **R1.5/R1.6** — the held-skip counter is `heldSkipped`, additive, never summed into
    `publishWorkspaceSnapshot`'s existing `skipped` (which counts projection errors); and `work next` gains
    an additive `skipped: [{ref, scopeRef, holderNode, assignmentId, state}]` plus a new state **`held`**,
    explicitly not `done`.
- **Known limit, recorded not hidden:** ADR-003's "admitted by identity, never by exemption" is **vacuous
  cross-machine** — `global_assignments` is control-only and `mesh-worker-execution.mjs` does not import
  `assignment-record.mjs`, so a worker is admitted by an empty store. Task 03's terminal-id row is
  in-process-only. The cross-machine proof is task 06's `@manual` soak.
