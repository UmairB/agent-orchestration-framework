@executable @cli @work @distribution
Feature: a done assignment removes its worktree with git worktree remove, a failed assignment retains it for inspection, and retention is bounded by a documented default
  In order that a succeeded assignment leaves no residue and its path is reusable while a failed assignment
  stays inspectable, a `done` assignment removes its worktree with `git worktree remove` — which clears the
  admin metadata so the path can be reused — never a bare `rm` that would leave stale `prunable` metadata; a
  `failed` assignment RETAINS its worktree for forensic inspection; and retention is bounded by a documented
  default so a retained failed worktree past the ceiling is swept.

  # ARCHITECTURE ADR-004 (cleanup on done via `git worktree remove` — RESEARCH.md §4: a bare rm leaves
  # .git/worktrees/<name> behind, `git worktree list` shows it prunable, and a later `git worktree add` at the
  # same path FAILS "missing but already registered" until pruned; `git worktree remove` clears both the dir
  # and the admin metadata so the path is reusable). Retain-on-failed (a failed run is a debugging artifact,
  # not garbage), bounded by a DOCUMENTED retention default living as a constant, not scattered. Double-assign
  # for the same (workspaceId, itemRef) never reaches here — refused upstream by ADR-003's store uniqueness.
  # SECURITY T4: no execution artifact escapes the worktree root; cleanup/retention is bounded.
  #
  # RESOLVED (developer-amigo): tested over a REAL `git worktree add`/`remove` in a TEMP fixture repo
  # (RESEARCH.md §4 measured: clean remove deletes dir + admin metadata; the path is then reusable; a bare rm
  # leaves prunable metadata that blocks re-add). The done/failed terminal is reached via the run-lifecycle
  # bracketing of task 02 with an INJECTED runtime spawn scripted to each outcome; retention sweeping is driven
  # with an INJECTED clock past the documented ceiling. No real network, no real agent runtime.

  Background:
    Given a temp fixture repo with a materialized worktree at ".aof/mesh/worktrees/<assignmentId>/" for an assignment

  # CLEANUP ON DONE: a done assignment removes its worktree with `git worktree remove` — dir AND admin
  # metadata gone, so the same path is reusable by a later worktree add (RESEARCH.md §4 measured).
  Scenario: a done assignment removes its worktree with git worktree remove, leaving the path reusable
    Given the assignment's run reaches "done"
    When the worker cleans up the worktree
    Then the worktree is removed with "git worktree remove"
    And the worktree directory no longer exists
    And its ".git/worktrees/" admin entry no longer exists
    And a subsequent worktree add at the same path succeeds

  # NEVER A BARE RM: cleanup uses `git worktree remove`, not a bare directory delete — a bare rm would leave
  # stale prunable metadata that blocks path reuse (RESEARCH.md §4).
  Scenario: cleanup does not leave stale prunable admin metadata behind
    Given the assignment's run reaches "done"
    When the worker cleans up the worktree
    Then no stale ".git/worktrees/" entry for the assignment is reported as prunable by "git worktree list"

  # RETAIN ON FAILED: a failed assignment KEEPS its worktree for inspection — the checkout stays on disk and
  # its admin entry stays registered.
  Scenario: a failed assignment retains its worktree for inspection
    Given the assignment's run reaches "failed"
    When the worker finishes handling the failure
    Then the worktree at ".aof/mesh/worktrees/<assignmentId>/" still exists on disk
    And its ".git/worktrees/" admin entry is still registered

  # BOUNDED RETENTION: retention is bounded by a documented default — a retained failed worktree is kept
  # within the ceiling and swept once it is past it.
  Scenario Outline: a retained failed worktree is kept within the retention default and swept past it
    Given a failed assignment's retained worktree whose age is <age>
    When the retention sweep runs
    Then the retained worktree is <disposition>

    Examples:
      | age                              | disposition                              |
      | within the documented default   | kept for inspection                      |
      | past the documented default     | swept with "git worktree remove" (pruned) |
