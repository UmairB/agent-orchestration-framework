@executable @cli @work @distribution
Feature: The worker checks out a REAL branch (aof/mesh/<itemRef>-<assignmentId>), never a detached HEAD
  In order that a worker's commits live on a named, pushable branch instead of an unreachable detached HEAD that is
  garbage-collected the instant the worktree is force-removed (RESEARCH §4.1), the worker materializes its
  per-assignment worktree on a REAL branch named `aof/mesh/<itemRef>-<assignmentId>` — the itemRef sanitized to a
  git-ref-safe slug, keyed by assignmentId for collision-freedom — with HEAD ON that branch, not detached.

  # ARCHITECTURE 38/ADR-015 (decision 1): a REAL branch, not a detached HEAD; DOCUMENTED DEFAULT naming
  # `aof/mesh/<itemRef>-<assignmentId>` — scoped, collision-free, keyed by assignmentId (mirroring meshWorktreePath's
  # assignmentId key, mesh-worktree.mjs:47); itemRef sanitized to a git-ref-safe slug for readability. The MECHANIC
  # (change addWorktree's `--detach` call to create the branch, or `git switch -c <branch>` inside the worktree
  # before the run) is the Three Amigos' pick; the INVARIANT is "a named branch, not detached HEAD".
  # CONTRAST TODAY (RESEARCH §4.1, MEASURED): addWorktree runs `git worktree add --detach` (mesh-worktree.mjs:101) —
  # a detached HEAD, no branch. STRUCTURAL side is acd-write-token-scoped-to-push (ADR-015); this task is the
  # BEHAVIOURAL branch-existence contract.
  #
  # @executable over a REAL LOCAL git repo (the story-01 real-local-repo pattern) + the INJECTED git exec seam — NO
  # real GitHub, NO network (the REAL remote push is exclusively task 03's @manual soak). OBSERVABILITY: from inside
  # the materialized worktree, `git symbolic-ref --short HEAD` RESOLVES on a branch and FAILS on a detached HEAD;
  # `listWorktrees` reports `branch` set + `detached:false`.
  #
  # @qa: the Scenario Outline enumerates ref-HOSTILE itemRef/assignmentId shapes that MUST sanitize to a valid git
  # ref. The exact sanitized slug is the implementer's mechanic (Three Amigos) — so the rows assert the produced
  # branch is `git check-ref-format`-VALID, prefixed `aof/mesh/`, and DISTINCT per assignmentId — NOT a literal
  # string. If the team pins an exact mapping later, these rows gain an `expected_branch` column. (Some forbidden
  # classes are position-sensitive once `<assignmentId>` is appended, e.g. a trailing `.lock`; the "valid ref out"
  # invariant is the litmus that holds for every row regardless of position.)

  Background:
    Given a real local git repo with at least one commit and the injected git exec seam
    And an assignment "asg-1" for item "38-07-worker" whose worktree the worker is about to materialize

  Scenario: the worktree is checked out on a real branch — HEAD is on it, not detached
    When the worker materializes the worktree for the assignment
    Then from inside the worktree `git symbolic-ref --short HEAD` resolves to a branch under `aof/mesh/`
    And `git rev-parse --abbrev-ref HEAD` is that branch name, never the literal `HEAD` (a detached head)
    And the branch `aof/mesh/38-07-worker-asg-1` (the ADR-015 DOCUMENTED convention for this clean itemRef) exists in `git branch --list`
    And `listWorktrees` reports the worktree entry with `branch` set and `detached` false
    And the worktree is NOT created by `git worktree add --detach` (the measured RESEARCH §4.1 detached-HEAD form)

  Scenario: two assignments for the SAME item get DISTINCT branches, keyed by assignmentId
    Given a second assignment "asg-2" for the same item "38-07-worker"
    When the worker materializes a worktree for each assignment
    Then the two branches `aof/mesh/38-07-worker-asg-1` and `aof/mesh/38-07-worker-asg-2` are distinct
    And neither branch collides with the other (collision-free by the assignmentId key, mirroring meshWorktreePath)

  Scenario Outline: a ref-hostile itemRef/assignmentId sanitizes to a VALID git branch
    Given an assignment "<assignmentId>" for item "<itemRef>"
    When the worker computes the branch name for the worktree
    Then the branch name starts with `aof/mesh/`
    And the branch name passes `git check-ref-format refs/heads/<branch>` (a valid, checkout-able git ref)
    And the branch name embeds a slug of "<assignmentId>" so it is distinct per assignment

    Examples:
      | itemRef      | assignmentId | note                                      |
      | 38-07-worker | asg-1        | already clean — passes through valid       |
      | 38/07        | asg-1        | slash — valid path-component or collapsed  |
      | feat 1       | asg-1        | space — forbidden, must sanitize           |
      | feat~1       | asg-1        | tilde — forbidden                          |
      | a^b          | asg-1        | caret — forbidden                          |
      | ns:ref       | asg-1        | colon — forbidden                          |
      | v1..v2       | asg-1        | double-dot — forbidden                     |
      | head@{0}     | asg-1        | @{ sequence — forbidden                    |
      | .hidden      | asg-1        | leading dot on component — forbidden       |
      | a\b          | asg-1        | backslash — forbidden                      |
      | feat?x       | asg-1        | question mark — forbidden                  |
      | 38-07        | asg/../x     | hostile assignmentId — must sanitize too   |
