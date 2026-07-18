@executable @cli @work @distribution
Feature: An explicit `NEEDS_INPUT` sentinel yields a THIRD outcome `needs-input` that RETAINS its worktree — a question-ended turn is no longer mis-read as `done`
  In order that a session which pauses to ask a human is NOT mistaken for finished work and force-removed, an explicit
  `NEEDS_INPUT` sentinel from the interactive session yields a THIRD terminal outcome `needs-input` — distinct from
  `done` and `failed` — and a `needs-input` session RETAINS its worktree (the `failed`-style retention branch), never
  the `done` force-remove, so an attached human has a live working directory to `claude --resume` into.

  # ARCHITECTURE 38/ADR-013 (terminal state via an explicit `NEEDS_INPUT` sentinel CONSTANT → a new `needs-input`
  # outcome; three states: done/failed/needs-input; invariant 4: a `needs-input` outcome takes the `failed`-style
  # RETAIN branch, NEVER the `done` force-remove). RESEARCH §4.3 (MEASURED: `claude -p` reports
  # `terminal_reason: "completed"` for a QUESTION-ended turn — the EXACT signal `defaultSpawnRuntime` maps to `done`
  # at mesh-worker-execution.mjs:582, `terminal === "completed" || terminal === "end_turn"` — so the worker today
  # cannot tell "finished" from "ended the turn to ask". The transcript survives in `~/.claude/projects/...` but the
  # worktree does NOT, so the checkout MUST be retained for `claude --resume` to be useful). Done force-remove:
  # mesh-worker-execution.mjs:891-893; the `failed` retention else-branch: :894-896. Armed by
  # `acd-worker-driver-no-headless-print`.
  #
  # @executable over INJECTED seams — a fake pty whose output stream can emit the `NEEDS_INPUT` sentinel, and a
  # recording `removeWorktree` seam that captures WHETHER force-remove was called. No real `claude`, no subscription,
  # no PTY, no network.

  Background:
    Given the worker driver over a fake pty (whose output can emit the `NEEDS_INPUT` sentinel) and a recording worktree-remove seam

  Scenario: a `NEEDS_INPUT` sentinel yields `needs-input`, never `done`
    Given the interactive session emits the explicit `NEEDS_INPUT` sentinel and ends its turn
    When the worker resolves the terminal state
    Then the outcome is `needs-input` — a THIRD state, distinct from both `done` and `failed`
    And it is NOT mapped to `done` (closing the §4.3 gap where a question-ended `completed` turn read as `done`)

  Scenario: a `needs-input` session retains its worktree
    Given a driven assignment whose session ends `needs-input`
    Then the worktree is RETAINED — the `failed`-style retention branch (mesh-worker-execution.mjs:894-896)
    And `removeWorktree(..., { force: true })` is NEVER called for it (the `done`-only path, :891-893)
    And the retained checkout is a live directory a human can `claude --resume <session_id>` into

  Scenario Outline: each end-signal maps to its own terminal outcome AND worktree disposition
    Given the interactive session ends with <end_signal>
    When the worker resolves the terminal state
    Then the terminal outcome is <outcome>
    And its worktree is <worktree>

    Examples:
      | end_signal                 | outcome     | worktree      |
      | the `NEEDS_INPUT` sentinel | needs-input | retained      |
      | a clean completion         | done        | force-removed |
      | a non-zero / fault exit    | failed      | retained      |
