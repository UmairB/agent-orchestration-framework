@executable @cli @work @distribution @round-trip
Feature: On a successful run the worker PUSHES the branch BEFORE the worktree is removed, and RETAINS it until the push succeeds
  In order that a worker's real diff reaches `origin` for review instead of being force-deleted with the worktree
  (RESEARCH §4.1: the earlier soak's output was garbage-collected the instant the worktree was force-removed), on a
  `done` outcome the worker runs `git push origin <branch>` (via the ADR-009 buildAskpassShim) BEFORE removeWorktree
  — and a FAILED push RETAINS the worktree loudly, never force-removing over unpushed commits.

  # ARCHITECTURE 38/ADR-015 (decision 2 + invariants 3/4): PUSH on `done`, BEFORE force-remove, reusing
  # buildAskpassShim (mesh-worker-execution.mjs:349 — the SAME GIT_ASKPASS path the clone uses, ADR-009's PULL); the
  # worktree is NOT removed until the push succeeds; a failed push RETAINS (the `failed`-style retention, so commits
  # are recoverable + retryable), never force-removes. CONTRAST TODAY (RESEARCH §4.1 / mesh-worker-execution.mjs:
  # 891-893): on `done` the worktree is force-removed (`removeWorktree(..., { force: true })`) with NO `git push`
  # anywhere in src/. STRUCTURAL pin: acd-write-token-scoped-to-push (ADR-015 invariant 3 — no remove until push
  # succeeds).
  #
  # @executable over a REAL LOCAL BARE repo as the push `origin` (story-01's real-local-bare-repo pattern) + the
  # INJECTED git exec seam RECORDING call order — NO real GitHub, NO network (the REAL remote push is exclusively
  # task 03's @manual soak). OBSERVABLE ORDERING (NOT merely "both were called", per ADR-015): the recorded exec
  # call order shows `push` BEFORE `worktree remove`, AND at the instant push runs the worktree dir is still present
  # on disk (the push targets a still-present worktree).
  #
  # @qa: the happy path asserts push-then-remove + the branch reaching the local bare origin; the failure Outline
  # enumerates the push-fault classes that MUST retain the worktree + surface a loud coded failure, never a clean
  # `done` (the agent run may be `done` but a failed push means the ASSIGNMENT is not cleanly done).

  Background:
    Given a real local bare repo serving as the push `origin`
    And a worker worktree on branch `aof/mesh/38-07-asg-1` carrying a real commit not yet on origin
    And the injected git exec seam records the ordered sequence of git invocations

  Scenario: on `done` the push runs BEFORE the worktree is removed, and the worktree is present at push time
    When the worker completes the run with a `done` outcome
    Then the recorded git call order shows `push origin aof/mesh/38-07-asg-1` BEFORE any `worktree remove`
    And at the moment the push is invoked the worktree directory still exists on disk (retained until push succeeds)
    And only AFTER the push returns success is `removeWorktree(..., { force: true })` invoked

  Scenario: the pushed branch reaches origin — durable output at the hermetic altitude
    When the worker completes the run with a `done` outcome
    Then the local bare origin's `git branch --list aof/mesh/38-07-asg-1` shows the branch
    And `git show aof/mesh/38-07-asg-1:<a-changed-file>` in the bare origin resolves the worker's committed diff
    And the diff survives the subsequent worktree force-remove (the direct contradiction of RESEARCH §4.1)

  Scenario: the push reuses the ADR-009 askpass shim — no new credential wire, no token at rest
    When the worker pushes the branch on a `done` outcome
    Then the push transmits its credential via GIT_ASKPASS (buildAskpassShim), scoped to the push exec's own env only
    And the write token is never written into `.git/config`, never onto ambient process.env, never into a log line
    And the ambient credential helper is reset for the push (`-c credential.helper=`), as the clone path does (SECURITY T7)

  Scenario Outline: a FAILED push RETAINS the worktree and fails LOUDLY — never a clean `done`
    Given a push that will <push_fault>
    When the worker completes the agent run `done` and then attempts to push
    Then the worktree is <worktree> — never force-removed over unpushed commits
    And the assignment surfaces a <terminal> — a loud coded failure, never a silent clean `done`
    And the worker's local branch and its commits remain on disk, recoverable and retryable

    Examples:
      | push_fault                          | worktree | terminal          |
      | be rejected (non-fast-forward)      | retained | loud coded failed |
      | hit an unreachable remote           | retained | loud coded failed |
      | be refused for missing write auth   | retained | loud coded failed |
