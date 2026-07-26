@executable @cli @work @distribution
Feature: The assignment directive's whole command string is TYPED into the interactive session's PTY stdin — ONE long-lived session per assignment
  In order that the control node drives a full-lifecycle command (`/aof:refine <ref> --autonomous`, `/aof:continue`,
  `/aof:verify <ref>`) on the worker's interactive session rather than baking a throwaway prompt into a `-p` argv,
  the assignment directive carries the WHOLE command string as a first-class field, and the worker WRITES it into the
  spawned interactive `claude` session's PTY stdin as a whole line — into ONE long-lived session that lives for the
  whole assignment run, not a fresh spawn per command.

  # ARCHITECTURE 38/ADR-013 (invariant 2: the command to run is TYPED into the PTY stdin via `pty.write`, carried as a
  # directive field — NOT baked as a `-p` prompt argv; the m03/ADR-006 "the board's primary action runs an aof command
  # by TYPING it as ordinary PTY input" precedent. Lifecycle DOCUMENTED DEFAULT: ONE long-lived interactive session
  # PER ASSIGNMENT in one worktree, living for the whole run — NOT one shared session per worker, NOT a spawn per turn).
  # RESEARCH §4.3 (the operator's build shape (B): keep the `claude` CLI driver, on subscription, driven by whole
  # commands). Armed by `acd-worker-driver-no-headless-print`.
  #
  # @executable over INJECTED seams — a fake pty that records the spawn argv AND every PTY stdin write, plus a
  # stubbed-present provider binary. No real `claude`, no subscription, no PTY, no network.

  Background:
    Given the worker driver over a fake pty that records the spawn and every PTY stdin write

  Scenario Outline: the directive's command string is typed into the PTY stdin as a whole line
    Given an assignment whose directive carries the command <command>
    When the worker drives the assignment
    Then interactive `claude` is spawned ONCE for the assignment (not re-spawned to deliver the command)
    And <command> is written into that session's PTY stdin as a single whole line (one newline-terminated `pty.write`)
    And <command> is NOT baked into the spawn argv as a `-p` prompt

    Examples:
      | command                        |
      | /aof:refine 38/05 --autonomous |
      | /aof:continue                  |
      | /aof:verify 38/05              |

  Scenario: ONE long-lived interactive session per assignment
    Given an assignment directive carrying a command string
    When the worker drives the assignment
    Then EXACTLY ONE interactive `claude` PTY is spawned for the assignment's whole run
    And the command is delivered by typing into that live session, never by spawning a fresh process per command line
    And the session is per-assignment (its own worktree + its own `session_id`), not a single shared session reused across assignments
