<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — the advance itself: at the worker's REUSE door, an existing item branch
# is brought up to the directive's pinned base commit before the agent starts, by
# fast-forward when it can be and a REAL MERGE when it cannot, and never by any operation
# that could drop a worker commit.
#
# LITMUS: every Then is confirmable from git state in the materialized worktree and the
# worker's checkout after the dispatch returns — `git rev-parse <branch>` /
# `git rev-parse <branch>^1` / `git rev-parse --verify <branch>^2` /
# `git merge-base --is-ancestor <commit> <branch>` (exit 0 / non-zero) /
# `git rev-list --count` / `git cat-file -e <branch>:<path>` — plus the advance's own
# REPORTED outcome value (rendered on the log channel; task 02 pins the rendering) and the
# settled assignment state recorded on the status/effect channel. NO source read decides
# any assertion here. The absence-shaped half of ADR-008 ("no history-rewriting git
# operation exists on this path") is deliberately NOT a scenario — it lives in the arch
# test `acd-gate-propagation-never-discards` (green today, arming when the advance lands);
# what this file asserts instead is its OBSERVABLE consequence, per case: every commit the
# worker had already made is still reachable from the branch afterwards.
#
# FIXTURES (real git, no fake — the shapes each scenario needs, buildable on the existing
# `test/support/mesh-worker-exec-fixture.mjs` real-local-repo family):
#   C0            — the fixture repo's initial commit.
#   C1            — an earlier control HEAD; the commit the item branch was cut from.
#   W1, W2        — real worker commits on `aof/mesh/43-05`, made after C1.
#   C2            — the control's NEW HEAD, carrying the gate edit (a file that exists in
#                   C2 and in no worker commit), with C1 as its ancestor.
#   diverged pair — branch tip W2 (descended from C1) and pinned base C2 (descended from
#                   C1 on its own line): neither is an ancestor of the other, which is the
#                   COMMON case and the one SPEC/STATE's word "fast-forward" mis-describes.
#   behind pair   — the same repo with NO worker commits on the branch (tip == C1).
# The dispatch is driven through the real `createMeshWorkerExecutionHandler` with an
# injected `exec`, a scripted `spawnRuntime`, and a recording `onLog` — the existing
# `materializeOnly` idiom, with `commit` riding the directive verbatim.
#
# CITATION NOTE: SPEC/STATE cite commits `50c2c82` (the base-commit pin) and `87a7f39`
# (the item-branch derivation); NEITHER resolves in this checkout (verified read-only at
# refine). The mechanisms are cited from source instead — `meshItemBranchName` /
# `headCommit` / `ensureCommitAvailable` in `src/mesh-worktree.mjs`, and the pin gate
# `baseBranch == null && !branchExists && directive.commit != null` plus the reuse door
# `reuseWorktreeOnBranch` in `src/mesh-worker-execution.mjs`.
#
# @qa: the three-outcome Examples table below IS this story. SPEC and STATE both say
# "fast-forward"; ADR-008 corrects it, because the item branch carries the worker's
# commits while the control's new HEAD carries the gate edit — in git's terms the two are
# DIVERGED, not behind. A strict `--ff-only` rule would deliver the propagation only in the
# rare row and refuse the common one, so the table enumerates all three and pins each to
# its own git-observable shape (parent count, parent identity, reachability).

@executable @cli @work @distribution
Feature: A dispatch advances an EXISTING item branch to the directive's pinned base commit at the reuse door — fast-forward when possible, a real merge otherwise, and never by discarding a worker commit
  In order that a control-side edit made at a gate — the only moment the item lock permits one — reaches the item's next phase even when the item is CONTINUING on a branch that already exists, instead of being silently ignored by exactly the case it matters most for
  the worker brings the item branch up to the pinned base immediately after the worktree is materialized and before the agent starts, taking the fast-forward when the branch is merely behind, a real merge commit when the two lines have diverged, and no action at all when the pinned base is already on the branch

  Background:
    Given a real local git fixture repo whose item `43/05` has the branch `aof/mesh/43-05` cut from commit C1
    And the worker's checkout holds that branch locally, so the dispatch takes the reuse door
    And the control's HEAD has moved on to C2, which carries a gate edit absent from every worker commit
    And the directive carries C2 as its pinned base commit and no explicit base branch

  # Headline (the bug this story fixes): today the pin check is gated
  # `baseBranch == null && !branchExists && directive.commit != null`, so a CONTINUING item —
  # which by definition takes the reuse door — never sees the control's edit. After this
  # story it does, and the worker's own commits survive it intact.
  Scenario: a control-side gate edit reaches a CONTINUING item on an existing branch
    Given the item branch carries worker commits W1 and W2 made after C1
    When the worker dispatches the continuing assignment and materializes the worktree on `aof/mesh/43-05`
    Then `git merge-base --is-ancestor C2 aof/mesh/43-05` exits 0 — the pinned base is now on the branch
    And `git cat-file -e aof/mesh/43-05:<the-gate-edited-path>` exits 0 — the gate edit is in the branch's tree
    And the gate-edited file is present on disk inside the materialized worktree
    And `git merge-base --is-ancestor W1 aof/mesh/43-05` exits 0
    And `git merge-base --is-ancestor W2 aof/mesh/43-05` exits 0 — both worker commits are still reachable
    And the reported advance outcome is `merged`

  # The core matrix. Each row is a DIFFERENT relationship between the branch tip and the
  # pinned base, and each has its own git-observable shape — the parent count at the tip is
  # what distinguishes "nothing created" from "a real merge commit".
  Scenario Outline: the advance resolves to exactly one of three outcomes, each with its own observable git shape
    Given the item branch's tip is <branch_tip> and the directive pins base commit <pinned_base>
    When the worker dispatches the continuing assignment
    Then the reported advance outcome is `<outcome>`
    And `git rev-parse aof/mesh/43-05` resolves to <tip_after>
    And `git rev-parse --verify aof/mesh/43-05^2` <second_parent> — <parents>
    And `git merge-base --is-ancestor <pinned_base> aof/mesh/43-05` exits 0
    And every commit the branch carried before the dispatch is still reachable from the branch: <preserved>
    And `git rev-list --count aof/mesh/43-05` is <count_delta>

    Examples:
      | case                       | branch_tip              | pinned_base | outcome         | tip_after                     | second_parent | parents                                    | preserved   | count_delta                    |
      | pinned base already on it  | W2 (descended from C2)  | C2          | already-current | W2, byte-identical to before  | exits non-zero | one parent — nothing was created          | W1, W2      | unchanged                      |
      | branch strictly behind     | C1, no worker commits   | C2          | fast-forwarded  | exactly C2                    | exits non-zero | one parent — no merge commit was created  | C1          | grown by C1..C2 only           |
      | the two lines diverged     | W2 (descended from C1)  | C2          | merged          | a NEW merge commit M          | resolves to C2 | two — `M^1` is W2, `M^2` is C2            | W1, W2      | grown by C1..C2 plus one merge |

  # Divergence is the common case, so its shape gets its own scenario rather than only a
  # table row: a REAL merge commit, both parents named, both lines whole.
  Scenario: the diverged case produces a real merge of the pinned base INTO the item branch
    Given the item branch carries worker commits W1 and W2, and the pinned base C2 is on a line neither contains
    And `git merge-base --is-ancestor C2 aof/mesh/43-05` exits non-zero before the dispatch (genuinely diverged)
    And `git merge-base --is-ancestor aof/mesh/43-05 C2` exits non-zero before the dispatch (not merely behind)
    When the worker dispatches the continuing assignment
    Then `git rev-parse aof/mesh/43-05^1` resolves to W2 — the item branch's own tip is the FIRST parent
    And `git rev-parse aof/mesh/43-05^2` resolves to C2 — the pinned base is merged IN, not the other way round
    And `git rev-list --count aof/mesh/43-05^1..aof/mesh/43-05` is 1 — exactly one merge commit was added
    And `git log --format=%H aof/mesh/43-05` contains W1 and W2 with their original hashes — no commit was rewritten
    And `git cat-file -e aof/mesh/43-05:<the-gate-edited-path>` exits 0

  # The timing is contractual: the advance runs AFTER the worktree is materialized and
  # BEFORE the agent starts. Observed from the agent's own side — the very first read the
  # spawned runtime makes inside `worktreeCwd` already sees the gate edit.
  Scenario: the advance completes before the agent starts — the agent's first read sees the gate edit
    Given the item branch carries worker commits W1 and W2 and the directive pins C2
    When the worker dispatches the continuing assignment
    Then at the moment the runtime is spawned, the gate-edited file is already present in the spawn's `worktreeCwd`
    And at that same moment `git merge-base --is-ancestor C2 HEAD` inside the worktree exits 0
    And the recorded git call order shows the advance strictly after the `worktree add` that materialized the tree
    And the recorded git call order shows the advance strictly before the runtime spawn

  # The advance must not disturb the checkout's shape — the worker commits afterwards and
  # pushes with a plain `git push origin <branch>`, both of which require HEAD to still be
  # ON the item branch.
  Scenario: the advance leaves HEAD on the item branch, never detached and never on another branch
    Given the item branch carries worker commits W1 and W2 and the directive pins C2
    When the worker dispatches the continuing assignment
    Then inside the worktree `git symbolic-ref --short HEAD` resolves to `aof/mesh/43-05`
    And `git rev-parse --abbrev-ref HEAD` is that branch name, never the literal `HEAD`
    And `git branch --list "aof/mesh/*"` lists exactly one branch — the item's line did not fork
    And `git rev-parse HEAD` inside the worktree equals `git rev-parse aof/mesh/43-05` in the checkout

  # BOTH reuse doors are "continuing": the derived branch that already exists locally, and
  # the branch name the control resolved from its cache and put on the directive. The pin
  # gate flips on for both — a pre-cure or reindexed item must not be the one case that
  # still misses the edit.
  Scenario Outline: both reuse doors see the pin — the derived branch and the directive-carried base branch
    Given a continuing dispatch that reaches the reuse door via <door>
    And the item branch carries worker commits W1 and W2, and the directive pins C2
    When the worker dispatches the assignment
    Then `git merge-base --is-ancestor C2 <branch>` exits 0 — the pinned base reached this door too
    And `git merge-base --is-ancestor W1 <branch>` exits 0
    And `git merge-base --is-ancestor W2 <branch>` exits 0
    And the reported advance outcome is `merged`

    Examples:
      | door                                                              | branch              |
      | the derived branch already existing locally (no `baseBranch`)     | aof/mesh/43-05      |
      | the directive carrying an explicit `baseBranch` (the cache's answer) | aof/mesh/43-05-old  |
