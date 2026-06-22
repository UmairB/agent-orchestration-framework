@cli @work @work-stream @executable
Feature: aof work list, validate and next route through the registry with their output byte-for-byte unchanged
  In order to make the CLI a thin face over the one core without changing what the terminal already prints
  `aof work list` / `validate` / `next` are rewired to invoke the registry, with their existing --json and human renders becoming the command's CLI face adapter,
  so that the CLI is a single face over the command core while every existing byte of its output — cwd-relative paths, validate's bare-array --json, pretty 2-space JSON — is preserved.

  # ADR-002/003: these three already share a work.mjs export but via an independent
  # call site; they are REWIRED to invoke the registry. The CLI face adapter applies
  # the CLI path projection (cwd-relative via path.relative, OS separators) and the
  # CLI's historical wire quirks: validate's --json is the BARE array (the command
  # result is the richer { findings } envelope — the CLI adapter unwraps it), and the
  # human/JSON renders stay pretty 2-space. The target is "today's CLI output,
  # byte-for-byte" — the existing CLI tests (e.g. acd-work-list-contract) are the
  # regression net; if a byte moves, they go red. This feature asserts the observable
  # invariance over the rewire.
  Background:
    Given a work-stream fixture covering a milestone, its stories, and a uat session
    And I am positioned to run the aof CLI against that fixture

  # work list --json is unchanged by the rewire: the whole stream, pretty 2-space
  # JSON, byte-stable across runs. The committed acd-work-list-contract test is the
  # reachable oracle for "unchanged".
  Scenario: aof work list --json still satisfies its committed contract after the rewire
    When I run "aof work list --json"
    Then the command exits 0
    And the output is the whole work stream as pretty 2-space JSON
    And the output still satisfies the committed acd-work-list-contract

  # work validate --json keeps its BARE array shape (NOT the command's { findings }
  # envelope) and its cwd-relative paths — the CLI adapter unwraps + re-bases.
  Scenario: aof work validate --json keeps its bare-array shape and cwd-relative paths
    Given the fixtured stream has one malformed item
    When I run "aof work validate --json"
    Then stdout is a bare JSON array of { path, problem } entries, not a { findings } envelope
    And each path is relative to the current working directory with OS separators
    And the command exits non-zero because there is a finding

  # work validate's human output is unchanged: the PASS line on a clean stream, the
  # issue list otherwise.
  Scenario Outline: aof work validate human output renders as before
    Given the fixtured stream is "<state>"
    When I run "aof work validate"
    Then stdout is "<rendering>"

    Examples:
      | state      | rendering                          |
      | well-formed| the PASS well-formed line          |
      | malformed  | the numbered issue list            |

  # work next --json keeps its cwd-relative path and pretty 2-space shape.
  Scenario: aof work next --json keeps its cwd-relative path and pretty shape
    When I run "aof work next --json"
    Then the command exits 0
    And stdout is pretty 2-space JSON carrying the next item
    And the result path is relative to the current working directory

  # The rewire is observably inert across all three: each command still satisfies
  # its committed CLI --json contract test (the reachable regression net), which
  # the rewire must keep green. (The explicit shape assertions above — bare-array
  # validate, cwd-relative paths, pretty 2-space — are the byte-level oracle.)
  Scenario Outline: each rewired command keeps its committed CLI contract green
    When I run "<command>"
    Then the output still satisfies the committed CLI contract for "<command>"

    Examples:
      | command                  |
      | aof work list --json     |
      | aof work validate --json |
      | aof work next --json     |
