---
type: story
number: 05
slug: gate-propagation
title: "Gate-time propagation — a dispatch advances an existing item branch to the directive's pinned base at the worker's reuse door, by fast-forward when possible and a REAL MERGE otherwise, so a control-side gate edit reaches a continuing item and no worker commit is ever discarded"
parent: 43
status: in-review
owner: product-owner
created: 2026-08-01
updated: 2026-08-05
depends: [43/01]
schema: 1
aofVersion: 0.1.0
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH; a standalone story
  (no parent) is self-contained.
-->
# 05 · Gate-time propagation, control → worker

## User story

As the **operator who edits a work item at a gate** — the only moment the lock permits it —
I want that edit to **reach the item's next phase even when the item is *continuing* on a branch that
already exists**,
so that a control-side change is not silently ignored by exactly the case it matters most for. Today the
base-commit pin carries the edit only when a branch is created; **the reuse doors ignore the pin by
design** (*"an existing line continues from where it is"*), so a continuing item never sees it.

<!-- This story and story 01 are ONE mechanism viewed twice: the lock creates the quiet window, and the
     advance uses it. The advance is safe precisely because it runs at a gate, when no assignment is
     active and the tree is therefore quiescent. -->

## Acceptance criteria (outcome — detailed scenarios authored at refine, into the task `.feature`s)

Grounded in `ARCHITECTURE.md` **ADR-008**.

1. **The advance happens WORKER-SIDE, at the reuse door** — immediately after `reuseWorktreeOnBranch`
   materialises the worktree and **before the agent starts** (`mesh-worker-execution.mjs:2388-2390`). The
   worker owns the checkout and the branch; directive 4 rules out a control→worker pull; the pin already
   travels on the directive, so **no new wire field is needed**; and `ensureCommitAvailable`
   (`mesh-worktree.mjs:143-162`) already exists to make the commit present in the worker's clone. This
   story **flips the existing pin gate on for the reuse door** rather than inventing a second propagation
   path.
2. **"Fast-forward" is corrected to fast-forward-if-possible, MERGE otherwise.** SPEC's and STATE's word
   needs an honest reading: the item branch was cut from an earlier control HEAD and carries the worker's
   commits, while the control's new HEAD carries the gate edit — in git's terms the two are **diverged**,
   not "behind". A strict `--ff-only` rule would deliver the propagation only in the rare case where the
   worker committed nothing and refuse the common one; a refuse-on-divergence rule would block nearly every
   continue. Three outcomes:
   - pinned commit already an ancestor ⇒ **no-op**, reported `already-current`;
   - branch strictly behind ⇒ **`--ff-only`**; nothing created, nothing lost;
   - diverged ⇒ a **real merge of the pinned base INTO the item branch** — every worker commit preserved by
     construction, the gate edit arrives, and the history stays honest about both.
3. **The forbidden operations are NAMED and forbidden absolutely on this path**, with **no `--force` escape
   hatch** (a flag that permits history loss will eventually be passed): `rebase`, `push --force` /
   `--force-with-lease`, `reset --hard`, `checkout -B`, `branch -f`, and any `update-ref` against
   `refs/heads/*`. Every one of them can discard a worker commit.
4. **Two preconditions, each a loud coded refusal that leaves the tree untouched:**
   - **`assignment-gate-propagation-dirty-worktree`** — the advance runs only against a clean tree. **Never
     check out or merge over uncommitted work.**
   - **`assignment-gate-propagation-conflict`** — a merge that conflicts is **`git merge --abort`**ed and
     the dispatch fails with this code. Handing an agent a half-merged, conflicted tree is **strictly worse
     than not propagating**: it would begin a phase on a state no human authored.
   Both settle the assignment `failed` with the code, exactly as `assignment-base-commit-unavailable`
   already does (`:2379-2385`), so the operator sees the cause on the fleet rather than an agent reasoning
   from a wrong base.
5. **The advance is REPORTED on the existing log channel**, beside the `worker-worktree-base` line
   (`:2396-2401`) that already records which base a worktree was built from — carrying the outcome
   (`already-current` / `fast-forwarded` / `merged` / refused-with-code) and **both commits**. "Which base
   did it actually run on" stays one `aof mesh logs --node` read.
6. **The baseline is clean and worth locking.** Measured at HEAD, none of the forbidden operations exists
   anywhere in `src/`: the only force is `git worktree remove --force` (a worktree, not a branch), the only
   `reset` is a path-scoped `git reset -q -- .aof`, and the only push is a plain
   `git push origin <branch>` (`mesh-worker-execution.mjs:583`).

## Tasks

<!-- Authored at `aof:refine 43 --autonomous` (Three Amigos: PO headline Scenarios + aof-qa Examples +
     aof-developer feasibility). Each is a tasks/NN_<slug>.feature whose @executable scenarios are the
     acceptance criteria. Kept independent of the other stories' tasks. -->

- [ ] `00_reuse-door-advances-to-the-pinned-base.feature` — a continuing item's existing branch is brought
      up to the directive's pinned base before the agent starts: the three-outcome matrix
      (`already-current` / `fast-forwarded` / `merged`), each pinned to its own git shape, with every
      worker commit still reachable in every row, and both reuse doors covered.
- [ ] `01_advance-refusals-leave-the-branch-untouched.feature` — a dirty worktree and a conflicting merge
      each refuse with their own code, settle the assignment `failed`, leave the branch byte-unchanged and
      the tree not MERGING, retain the worktree, and never start the agent.
- [ ] `02_advance-reported-on-the-worktree-base-channel.feature` — one entry per dispatch on the same log
      channel as `worker-worktree-base`, carrying the outcome (or the refusal code) and both commits, so
      "which base did it run on" is one `aof mesh logs --node` read; a faulting sink degrades.
- [ ] `03_create-path-and-unavailable-base-regression.feature` — flipping the pin gate does not change the
      create path (fresh branch still built from exactly the pinned commit),
      `assignment-base-commit-unavailable` still fires at every door, the item's line stays single, and the
      plain push still lands the whole line on origin.
- [ ] `04_gate-edit-reaches-a-real-worker-soak.feature` — `@manual`: on real hardware, an operator's gate
      edit on the control node reaches a real worker's continuing phase, both lines survive to the real
      origin, the advance is readable from the control, and a deliberate conflict refuses cleanly.
- [ ] `05_operator-signs-off-the-gate-edit-loop.feature` — `@uat`: the operator accepts that a gate edit
      changes what the next phase does, that nothing from the previous phase was lost, and that a refusal
      is legible enough to act on without a shell on the worker.

## Notes

- **Dependency shape (ADR-009):** wave 2, parallel with stories 03 and 04. Depends on `43/01` for the
  lock's quiescence guarantee. **File-disjoint from every sibling.**
- **Where the code lives is an architectural requirement, not a preference (ADR-008 + TECH_DEBT item 10):**
  the branch-advance logic belongs in `src/mesh-worktree.mjs`, which already owns every git verb and imports
  0 mesh modules. This story therefore adds a **call site**, not a new block, to
  `mesh-worker-execution.mjs` — the largest file in the repo at 3,174 lines (+47% since 2026-07-26).
- **`advanceBranchToBase(worktreePath, commit, options)` MUST be EXPORTED from `mesh-worktree.mjs`, not
  inlined at the call site — a hard requirement, ruled by ADR-010 R5.2.** The developer amigo confirmed
  why: `reuseWorktreeOnBranch` (`mesh-worktree.mjs:261-300`) **always** `git worktree add`s a fresh tree, so
  a dirty worktree is unreachable at dispatch altitude — *always*, not merely usually. Three Examples rows
  in task 01 that say "the worker dispatches" cannot go green there. An untestable safety rule is not a
  safety rule.
- **The behaviour change in AC-scope, confirmed rather than assumed (ADR-010 R5.1):** flipping the pin gate
  on for the reuse door means `assignment-base-commit-unavailable` now fires there too — a continue whose
  pinned commit is unreachable **refuses** where today it silently runs. The architect confirmed this and
  reframed it: it **removes an inconsistency** (a refine already refuses on an unreachable pin; only the
  reuse door proceeded), and required that the refusal message **name the cure**.
- **The invariant that is NOT a scenario:** "no history-rewriting git operation exists on the branch-advance
  path" is an **absence**, which no scenario can prove — it lives in `acd-gate-propagation-never-discards`
  (committed green today over the worktree/worker/recovery-push path, arming as an outright ban the moment
  the advance lands).
- **Citation note:** SPEC/STATE cite commits `50c2c82` (the base-commit pin) and `87a7f39` (the item-branch
  derivation); **neither resolves in this checkout** (re-verified read-only at refine). The mechanisms are
  cited from source instead — `mesh-worktree.mjs:112-162` (branch derivation + `ensureCommitAvailable`) and
  `mesh-worker-execution.mjs:2357-2390` (the pin gate and the reuse door).
- **One decision the tasks force into the open (QA, refine):** flipping the pin gate on for the reuse door
  means `assignment-base-commit-unavailable` now also applies there. Today a continue whose pinned commit
  is unreachable **runs** (the pin is ignored at that door); after this story it **refuses**. Task 03
  contracts the refusal — it is ADR-008's posture applied consistently ("never a silent build from a stale
  base") — but it turns a previously-runnable continue into a coded failure whenever the control's HEAD is
  unpushed, so it is recorded here rather than smuggled in under a regression guard.
- **One feasibility note (QA, refine):** the ordinary dispatch path materialises a *fresh* worktree, so a
  dirty tree is a defensive case at that altitude. The dirty-worktree refusal is therefore contracted to be
  exercisable at the seam's own altitude (an exported branch-advance function in `mesh-worktree.mjs`,
  invoked against a worktree the fixture dirtied) — which is where the guard lives. The conflict refusal is
  routinely reachable at the dispatch altitude.
