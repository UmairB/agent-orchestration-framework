@executable @cli @work @distribution
Feature: an accepted directive materializes a dedicated git worktree, keyed by assignmentId under the one mesh worktrees root, that the ref cannot escape
  In order to run every assignment isolated from the worker's local work and from every other in-flight
  assignment, an accepted directive materializes a dedicated `git worktree add` (detached at the target
  commit) at the single seam `.aof/mesh/worktrees/<assignmentId>/`; two concurrent assignments get two
  distinct, non-colliding worktrees; and the assigned ref resolves within that worktree's own checkout,
  never a path constructed from directive text that could escape the root.

  # ARCHITECTURE ADR-004 (one worktree per assignment, keyed by assignmentId, under the defined mesh
  # worktrees root <repo>/.aof/mesh/worktrees/<assignmentId>/; detached-at-commit so concurrent worktrees
  # never contend on a branch name; the ref resolves against the worktree's OWN checkout, repo-relative).
  # SECURITY T4 / F4 (acd-worktree-path-scoped) + T3b: the worktree path is a prefix-child of the ONE
  # dedicated root, and a ref is an ENUMERATE-then-filter selection of an item.dir validated against
  # ITEM_RE (src/work.mjs:39) — NEVER a path.join(root, directiveRef) built from raw directive text.
  # "Joins the one meshWorktreePath(assignmentId) seam, no os.tmpdir()/hand-built path" is STRUCTURAL →
  # the fitness acd-assignment-worktree-path-scoped, not a step; THIS feature asserts the observable path
  # location, the concurrency distinctness, detached-at-commit, and the traversal refusal.
  #
  # RESOLVED (developer-amigo): tested over a REAL `git worktree add` in a TEMP fixture repo (RESEARCH.md §4/§5:
  # detached-at-commit is fast ~1.16s and concurrency-safe, core.longpaths=true) driven by the worker
  # execution handler with an INJECTED runtime spawn (no real agent runtime — the run driver is stubbed to a
  # scripted terminal outcome) and an INJECTED clock. No real network. The runtime-invocation DEPTH inside the
  # worktree is a documented default the build pins (RESEARCH.md §2/§3); this feature is invariant to it — it
  # asserts the worktree MATERIALIZATION, not what runs inside.

  Background:
    Given a temp fixture repo with a resolvable work item and a worker that has the repo published
    And an accepted directive for that item carrying its own assignmentId

  # THE SEAM: an accepted directive produces a real, detached-at-commit worktree at the ONE mesh worktrees
  # root, keyed by the assignmentId — never the worker's primary working copy, never a temp dir.
  Scenario: an accepted directive materializes a dedicated git worktree at the mesh worktrees root
    When the worker materializes the assignment
    Then a git worktree exists at ".aof/mesh/worktrees/<assignmentId>/" under the repo
    And the worktree is a distinct checkout, not the worker's primary working copy
    And the worktree is detached at the target commit, holding no branch name

  # CONCURRENCY (RESEARCH.md §5): two accepted assignments produce two DISTINCT worktrees under the same
  # root, each keyed by its own assignmentId — no collision, no branch-name contention, both real checkouts.
  Scenario: two concurrent assignments materialize two distinct, non-colliding worktrees
    Given a second accepted directive for a second item, carrying a different assignmentId
    When the worker materializes both assignments concurrently
    Then each assignment has its own worktree under ".aof/mesh/worktrees/<assignmentId>/"
    And the two worktree paths are distinct, keyed by their respective assignmentIds
    And neither worktree's checkout is visible inside the other

  # PATH SCOPING (T4 / F4a): whatever the assignmentId, the resolved worktree path is a prefix-child of the
  # ONE dedicated mesh worktrees root — never an os.tmpdir() or hand-built path outside it.
  Scenario: the materialized worktree path is always under the dedicated mesh worktrees root
    When the worker materializes the assignment
    Then the normalized worktree path is a prefix-child of ".aof/mesh/worktrees/" under the repo
    And no worktree is created under a machine-global temp directory

  # REF SCOPING (T3b / T4 / F4b): the assigned ref selects an already-enumerated item under ITEM_RE; a
  # traversal ref matches NOTHING (never a path built from directive text) rather than escaping the checkout.
  Scenario Outline: a traversal ref resolves to no item and never escapes the worktree checkout
    Given an accepted directive whose itemRef is <ref>
    When the worker resolves the ref inside the worktree's own checkout
    Then resolution <result>
    And no path is constructed outside the worktree root from the ref text

    Examples:
      | ref                | result                                    |
      | 00                 | selects the enumerated item under ITEM_RE |
      | 00/01              | selects the enumerated story under ITEM_RE |
      | ../../etc          | yields no item (matches nothing)          |
      | /abs/outside       | yields no item (matches nothing)          |
      | 00/../../..        | yields no item (matches nothing)          |
