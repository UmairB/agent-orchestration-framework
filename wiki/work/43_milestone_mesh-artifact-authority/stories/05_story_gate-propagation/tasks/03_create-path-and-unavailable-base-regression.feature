<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — the REGRESSION GUARD around the gating change. This story flips a
# condition that today reads `baseBranch == null && !branchExists && directive.commit != null`,
# so the two behaviours that condition currently protects must be pinned before it moves:
# (a) the CREATE path still builds a fresh branch from exactly the pinned commit, and
# (b) `assignment-base-commit-unavailable` still fires — loudly, with no worktree left
# behind — when the pinned commit is unreachable after the one `git fetch origin` that
# `ensureCommitAvailable` performs. It also pins the two m42 invariants the advance runs
# through: ONE derivable branch per item (no per-assignment fork), and the plain
# `git push origin <branch>` at the end still landing the whole line on origin.
#
# LITMUS: every Then is confirmable from git state after the dispatch (`git rev-parse`,
# `git branch --list`, `git rev-list`, `git merge-base --is-ancestor`, and — for the push
# row — the same reads inside a real LOCAL BARE repo serving as `origin`), plus the settled
# assignment state and code from the recorded status/effect frames, plus `listWorktrees`
# for the "no worktree was materialized" assertion. No source read.
#
# FIXTURES:
#   create path      — the item has NO local `aof/mesh/43-05` branch and the directive
#                      carries no `baseBranch`; the checkout has drifted PAST the pinned
#                      commit (a later commit exists), so "built from the pin" is
#                      distinguishable from "built from HEAD".
#   unavailable base — a pinned commit that exists nowhere (an all-zero-ish hash), in a
#                      fixture with no reachable `origin`, so the one fetch cannot rescue it.
#   push row         — the real local BARE-origin fixture family
#                      (`test/support/mesh-worker-push-fixture.mjs`), driven to `done`.
#
# @qa: the reuse-door row of the unavailable-base table is the ONE genuinely NEW behaviour
# in this file and it is flagged as a decision, not an inheritance: today a continuing item
# with an unreachable pinned commit RUNS (the pin is ignored at the reuse door); after this
# story it REFUSES with the existing code. That is the ADR-008 posture applied consistently
# ("never a silent build from a stale base"), and it is the safe direction — but it turns a
# previously-runnable continue into a coded failure whenever the control's HEAD is
# unpushed, so it is called out explicitly rather than smuggled in under a regression guard.

@executable @cli @work @distribution
Feature: The create path and the unavailable-base refusal survive the gating change, and the item's line stays single and pushable
  In order that flipping the pin gate on for the reuse door cannot quietly change what already works — a fresh branch built from the assigned commit, a loud refusal when that commit cannot be reached, one branch per item, and a push that lands the whole line
  a dispatch that creates a branch behaves exactly as it does today, an unreachable pinned commit still fails with `assignment-base-commit-unavailable` at every door, and the advanced branch still converges on one name and still reaches `origin` intact

  Background:
    Given a real local git fixture repo whose item `43/05` resolves in the worker's checkout
    And the worker's checkout has drifted past the commit the control assigned against

  # Unchanged: a fresh branch is cut AT the pinned commit, so there is nothing to advance —
  # the create path's observable behaviour must be identical to today's.
  Scenario: a fresh branch is still built from exactly the pinned commit, with no merge commit
    Given the item has no local `aof/mesh/43-05` branch and the directive carries no base branch
    And the directive pins base commit C1, which the checkout has since moved past
    When the worker dispatches the assignment
    Then inside the worktree `git rev-parse HEAD` is exactly C1 — the state the assignment was made against, not the drifted HEAD
    And `git rev-parse --verify aof/mesh/43-05^2` exits non-zero — no merge commit was created on the create path
    And `git symbolic-ref --short HEAD` inside the worktree resolves to `aof/mesh/43-05`
    And the `worker-worktree-base` entry still reports a fresh branch off the pinned commit

  # Unchanged: an unreachable pinned commit is a loud coded failure and NOT a silent build
  # from the clone's stale HEAD — now enforced at every door, including the reuse doors.
  Scenario Outline: an unreachable pinned commit refuses with `assignment-base-commit-unavailable` at every door
    Given a dispatch that reaches <door>
    And the directive pins a commit that exists nowhere and cannot be fetched from origin
    When the worker dispatches the assignment
    Then the assignment settles `failed` with code `assignment-base-commit-unavailable`
    And <branch_state>
    And no advance is performed and no merge commit exists anywhere under `aof/mesh/`
    And <worktree_state>

    Examples:
      | door                                                        | branch_state                                                          | worktree_state                                              |
      | the CREATE door (no local branch, no base branch)           | no `aof/mesh/43-05` branch was created                                | no worktree was materialized for the assignment             |
      | the REUSE door via the existing derived branch              | `git rev-parse aof/mesh/43-05` is unchanged from before the dispatch  | the worktree is retained for inspection, its tree untouched |
      | the REUSE door via a directive-carried `baseBranch`         | `git rev-parse aof/mesh/43-05-old` is unchanged from before           | the worktree is retained for inspection, its tree untouched |

  # The one fetch is still one fetch — a commit the clone does not have yet must be
  # RESCUED by it, at the reuse door as well as the create door.
  Scenario: a pinned commit the worker's clone lacks is fetched once and then advanced from
    Given a local bare repo serving as `origin`, holding commit C2 which the worker's clone does not yet have
    And the item branch `aof/mesh/43-05` exists locally with worker commits W1 and W2
    And the directive pins C2
    When the worker dispatches the continuing assignment
    Then `git cat-file -e C2^{commit}` in the worker's checkout exits 0 — the commit was fetched
    And `git merge-base --is-ancestor C2 aof/mesh/43-05` exits 0 — the advance used it
    And `git merge-base --is-ancestor W1 aof/mesh/43-05` exits 0
    And the assignment does not settle `failed`

  # The m42 cure is not regressed by the advance: one derivable branch per item, converging.
  Scenario: two successive dispatches for the same item still converge on ONE branch
    Given the item branch `aof/mesh/43-05` exists locally with worker commits
    And a first continuing dispatch has already advanced it to pinned base C2
    When a second continuing dispatch pins base C3, a later control HEAD
    Then `git branch --list "aof/mesh/*"` lists exactly one branch — no per-assignment fork was minted
    And `git merge-base --is-ancestor C2 aof/mesh/43-05` exits 0
    And `git merge-base --is-ancestor C3 aof/mesh/43-05` exits 0
    And every worker commit made before either dispatch is still reachable from the branch

  # The advance must not break durable push-back: the merge commit and every worker commit
  # reach `origin` through the SAME plain `git push origin <branch>` that exists today.
  Scenario: after an advance, the plain push still lands the whole line on origin
    Given a real local bare repo serving as the push `origin`
    And the item branch carries worker commits W1 and W2 and the dispatch advanced it by a real merge
    When the worker completes the run with a `done` outcome and pushes the branch
    Then the bare origin's `git branch --list aof/mesh/43-05` shows the branch
    And in the bare origin `git merge-base --is-ancestor W1 aof/mesh/43-05` exits 0
    And in the bare origin `git merge-base --is-ancestor W2 aof/mesh/43-05` exits 0
    And in the bare origin `git merge-base --is-ancestor C2 aof/mesh/43-05` exits 0 — the gate edit travelled with it
    And the push was a plain `push origin <branch>` — no force flag was passed
