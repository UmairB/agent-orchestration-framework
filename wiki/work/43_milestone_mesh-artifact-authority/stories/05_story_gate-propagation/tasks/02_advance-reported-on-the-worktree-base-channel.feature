<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — the REPORTING half of the advance, which is contractual and not cosmetic:
# every dispatch that reaches the reuse door emits one line on the SAME log channel that
# already carries `worker-worktree-base` (the worker's own record of which base a worktree
# was built from), carrying the OUTCOME (`already-current` / `fast-forwarded` / `merged` /
# the refusal code) and BOTH COMMITS — so "which base did it actually run on" stays one
# `aof mesh logs --node <id>` read rather than an SSH inspection of a worker's checkout.
#
# LITMUS: every Then is confirmable from the entries the worker emits on its log sink —
# captured hermetically through the handler's injected `onLog` seam (the same seam
# `worker-worktree-base` is emitted through, so channel identity is itself observable), and
# read live through `aof mesh logs --node <id>` in the task-04 soak. The two commits are
# confirmed by comparing the hashes IN the entry against `git rev-parse` of the pinned base
# and of the branch tip after the dispatch. The settled assignment state is read from the
# recorded status/effect frames. No source read decides any assertion.
#
# FIXTURES: the five shapes from files 00 and 01 — already-current, behind, diverged, dirty,
# conflicting — each dispatched once through the real handler with a recording `onLog`.
#
# @qa: "both commits" is pinned here to the pair that answers the question the line exists
# for: the PINNED BASE the directive carried, and the BRANCH TIP the agent actually starts
# from (identical to the pinned base only in the fast-forward row; the tip of a new merge
# commit in the diverged row; unchanged in the no-op and both refusal rows). The exact field
# names are the implementer's mechanic; what the rows assert is that both hashes and the
# outcome token are PRESENT and machine-readable in the entry, and that the refusal rows
# carry the code rather than an outcome word. Levels follow the existing precedent in this
# module: `info` for a completed advance, `warn` for a coded refusal.

@executable @cli @work @distribution
Feature: Every advance reports its outcome and both commits on the existing worker log channel, beside `worker-worktree-base`
  In order that an operator can answer "which base did this phase actually run on" with one `aof mesh logs --node` read — including when the advance was refused — instead of reconstructing it from a worker's checkout over SSH
  the worker emits one entry per dispatch on the same channel that already records which base a worktree was built from, carrying the outcome or the refusal code, the pinned base commit, and the branch tip the agent starts from

  Background:
    Given a real local git fixture repo whose item `43/05` has the branch `aof/mesh/43-05`
    And the worker's checkout holds that branch locally, so the dispatch takes the reuse door
    And the worker handler is driven with a recording log sink on its existing `onLog` seam

  # One line per dispatch, on the channel that already answers the base question — so the
  # advance is readable in the same place, in the same read, as the worktree's base.
  Scenario: the advance emits one entry on the same log channel as `worker-worktree-base`
    Given the item branch carries worker commits W1 and W2 and the directive pins the diverged base C2
    When the worker dispatches the continuing assignment
    Then exactly one advance entry is recorded for this assignment
    And it is emitted on the same log sink as the `worker-worktree-base` entry for the same dispatch
    And it names the assignment id and the item ref, as `worker-worktree-base` does
    And it names the branch `aof/mesh/43-05`
    And the existing `worker-worktree-base` entry is still emitted, unchanged in meaning

  # Each outcome — including both refusals — is distinguishable from the line alone.
  Scenario Outline: each outcome reports its own token and BOTH commits
    Given the branch/base relationship <case>
    When the worker dispatches the continuing assignment
    Then the advance entry carries `<reported>` — the outcome, or the refusal code
    And it carries the pinned base commit, equal to `git rev-parse C2` (or C1 for the already-current row)
    And it carries the branch tip the agent starts from, equal to `git rev-parse aof/mesh/43-05` after the dispatch
    And the two hashes it carries are <relationship>
    And the entry level is `<level>`

    Examples:
      | case                                          | reported                                    | relationship                                       | level |
      | pinned base already an ancestor of the tip    | already-current                             | different — the tip is ahead of the pinned base    | info  |
      | branch strictly behind the pinned base        | fast-forwarded                              | identical — the tip IS the pinned base             | info  |
      | branch and pinned base diverged               | merged                                      | different — the tip is the new merge commit        | info  |
      | the worktree is dirty                         | assignment-gate-propagation-dirty-worktree  | different — the tip is unchanged from before       | warn  |
      | the merge conflicts and is aborted            | assignment-gate-propagation-conflict        | different — the tip is unchanged from before       | warn  |

  # The refusal rows must be readable as refusals, not as a missing line — an absent entry
  # is indistinguishable from a worker that never got the dispatch.
  Scenario: a refused advance still reports — the operator sees a refusal, never silence
    Given a merge that will conflict
    When the worker dispatches the continuing assignment
    Then an advance entry is still recorded for this assignment
    And it carries the refusal code `assignment-gate-propagation-conflict`
    And it carries the branch tip, which is unchanged from before the dispatch
    And the assignment's settled `failed` frame carries the same code — the log and the fleet agree

  # Reporting never blocks the work, mirroring the existing `worker-worktree-base` emission,
  # which is wrapped so a faulting sink degrades rather than failing the run.
  Scenario: a faulting log sink degrades — the advance and the dispatch are unaffected
    Given the item branch carries worker commits W1 and W2 and the directive pins the diverged base C2
    And the log sink throws when it is called
    When the worker dispatches the continuing assignment
    Then `git merge-base --is-ancestor C2 aof/mesh/43-05` still exits 0 — the advance still happened
    And `git merge-base --is-ancestor W1 aof/mesh/43-05` still exits 0
    And the assignment settles on its normal outcome, not on a reporting fault
