<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — the two preconditions of the advance, each a LOUD CODED REFUSAL that
# leaves the branch byte-unchanged: `assignment-gate-propagation-dirty-worktree` (the
# advance runs only against a clean tree — it must never check out or merge over
# uncommitted work) and `assignment-gate-propagation-conflict` (a conflicting merge is
# `git merge --abort`ed and the dispatch fails, because handing an agent a half-merged
# tree is strictly worse than not propagating).
#
# LITMUS: every Then is confirmable after the dispatch returns — the branch tip
# (`git rev-parse <branch>`, compared to the hash captured BEFORE the dispatch), the
# absence of an in-progress merge (`git rev-parse -q --verify MERGE_HEAD` exits non-zero;
# `git status --porcelain` carries no unmerged `U*`/`*U`/`AA`/`DD` entry), the uncommitted
# work still on disk (`git status --porcelain` identical to the pre-dispatch capture, and
# the working file's BYTES identical), reachability of every worker commit
# (`git merge-base --is-ancestor <commit> <branch>` exits 0), and the SETTLED assignment
# state and code recorded on the status/effect channel — the same channel
# `assignment-base-commit-unavailable` already settles through, so the operator reads the
# cause on the fleet rather than watching an agent reason from a wrong base. No source read.
#
# FIXTURES (real git, extending the file-00 shapes):
#   dirty     — the materialized worktree carries an UNCOMMITTED modification to a tracked
#               file (and an untracked file) at the moment the advance would run, with the
#               pinned base C2 diverged from the branch tip W1.
#   conflict  — worker commit W1 edits line N of `<contested-path>`; the pinned base C2
#               edits the SAME line N of the SAME file, so `git merge C2` conflicts.
#   Both capture `git rev-parse aof/mesh/43-05` and `git status --porcelain` BEFORE the
#   dispatch; "byte-unchanged" is literally the comparison against those captures.
#
# FEASIBILITY NOTE (raised at refine, honest about altitude): the ordinary dispatch path
# materializes a FRESH worktree (`reuseWorktreeOnBranch` releases any holder, prunes, then
# `git worktree add`), so at the dispatch altitude a dirty tree is a DEFENSIVE case rather
# than a routinely reachable one. The dirty scenario is therefore written to be exercisable
# at the seam's own altitude — the branch-advance export in `src/mesh-worktree.mjs`
# (indicatively `advanceBranchToBase(worktreePath, commit, options)`) invoked against a
# worktree the fixture dirtied — which is exactly where the guard lives. The seam must be
# exported and callable for that reason; the dispatch-level rows below remain valid for the
# conflict case, which IS routinely reachable.
#
# @qa: the two rows are not variants of one failure — they refuse at different moments (one
# before touching anything, one mid-merge) and so need different proofs of "untouched". The
# dirty row's proof is that the operator's uncommitted bytes are still there; the conflict
# row's proof is that the repo is not left MERGING with a half-written index. Both rows
# additionally assert the positive safety property the whole story exists for: every worker
# commit is still reachable.

@executable @cli @work @distribution
Feature: A dirty worktree and a conflicting merge each refuse LOUDLY with their own code, leave the branch byte-unchanged, and never hand an agent a state no human authored
  In order that the advance can never be the thing that loses work — neither by merging over uncommitted changes nor by starting a phase on a half-merged tree
  the worker refuses before it acts when the tree is dirty, aborts and refuses when the merge conflicts, settles the assignment `failed` with the matching code in both cases, and leaves the branch and the working tree exactly as it found them

  Background:
    Given a real local git fixture repo whose item `43/05` has the branch `aof/mesh/43-05` carrying worker commits
    And the worker's checkout holds that branch locally, so the dispatch takes the reuse door
    And the directive pins base commit C2, which is diverged from the branch tip
    And the branch tip hash and `git status --porcelain` are captured before the dispatch

  # A dirty tree is refused BEFORE anything is touched — the operator's uncommitted bytes
  # are the one thing git itself cannot recover, so they are never merged over.
  Scenario: uncommitted work in the tree refuses the advance and survives it untouched
    Given the worktree carries an uncommitted modification to a tracked file and one untracked file
    When the worker dispatches the continuing assignment
    Then the assignment settles `failed` with code `assignment-gate-propagation-dirty-worktree`
    And `git rev-parse aof/mesh/43-05` equals the hash captured before the dispatch
    And `git status --porcelain` in the worktree is identical to the capture before the dispatch
    And the modified tracked file's bytes on disk are identical to before the dispatch
    And the untracked file is still present with identical bytes
    And `git rev-parse -q --verify MERGE_HEAD` exits non-zero — no merge was ever begun
    And `git cat-file -e aof/mesh/43-05:<the-gate-edited-path>` exits non-zero — the gate edit did NOT arrive

  # A conflicting merge is aborted, not left for an agent to inherit. The observable is not
  # "an error was returned" but "the repo is not MERGING and the tree is as it was".
  Scenario: a conflicting merge is aborted and the branch is left byte-unchanged
    Given worker commit W1 and the pinned base C2 edit the same line of the same file
    When the worker dispatches the continuing assignment
    Then the assignment settles `failed` with code `assignment-gate-propagation-conflict`
    And `git rev-parse aof/mesh/43-05` equals the hash captured before the dispatch
    And `git rev-parse --verify aof/mesh/43-05^2` exits non-zero — no merge commit was created
    And `git rev-parse -q --verify MERGE_HEAD` exits non-zero — the repo is NOT left in a MERGING state
    And `git status --porcelain` carries no unmerged entry (no `UU`, `AA`, `DD`, `AU` or `UA` line)
    And no conflict-marker text (`<<<<<<<`, `=======`, `>>>>>>>`) exists in any file in the worktree
    And the contested file's bytes on disk are identical to their content at W1
    And `git merge-base --is-ancestor W1 aof/mesh/43-05` exits 0 — the worker's commit is untouched

  # Both refusals are one rule with two triggers: settle `failed` with the code, leave the
  # line whole, never start the agent, and retain the worktree so a human can look.
  Scenario Outline: each refusal settles `failed` with its code, preserves every worker commit, and never starts the agent
    Given the precondition <precondition>
    When the worker dispatches the continuing assignment
    Then the assignment settles `failed` with code `<code>`
    And `git rev-parse aof/mesh/43-05` equals the hash captured before the dispatch
    And `git merge-base --is-ancestor W1 aof/mesh/43-05` exits 0 — every worker commit is still reachable
    And `git rev-parse -q --verify MERGE_HEAD` exits non-zero — nothing is left half-applied
    And the runtime is never spawned — no agent begins a phase on this state
    And the worktree is RETAINED for inspection, as every other `failed` outcome retains it
    And <untouched_proof>

    Examples:
      | precondition                                              | code                                          | untouched_proof                                                     |
      | an uncommitted modification to a tracked file             | assignment-gate-propagation-dirty-worktree    | the modification is still on disk with identical bytes              |
      | an untracked file the operator left in the tree           | assignment-gate-propagation-dirty-worktree    | the untracked file is still present with identical bytes            |
      | a staged-but-uncommitted change in the index              | assignment-gate-propagation-dirty-worktree    | `git diff --cached --name-only` lists the same paths as before      |
      | a merge that conflicts on the same line of the same file  | assignment-gate-propagation-conflict          | `git status --porcelain` carries no unmerged entry after the abort  |
      | a merge that conflicts on a delete/modify pair            | assignment-gate-propagation-conflict          | the deleted-on-one-side file is in the state W1 left it in          |

  # The refusal must reach the OPERATOR, not just the return value — it settles through the
  # same channel `assignment-base-commit-unavailable` already settles through, so the fleet
  # renders a coded failure rather than a run that silently never happened.
  Scenario: the refusal is visible on the fleet as a coded failure, exactly as an unavailable base commit is
    Given a merge that will conflict
    When the worker dispatches the continuing assignment
    Then the terminal frame the worker reports carries state `failed` and the code `assignment-gate-propagation-conflict`
    And the failure detail names the branch and the pinned base commit, so the cause is readable without an SSH inspection
    And the code is distinct from `assignment-base-commit-unavailable` — the two causes are never conflated
