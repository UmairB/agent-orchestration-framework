@cli @work @round-trip @executable
Feature: createRoundTripRepo makes a hermetic, throwaway repo
  In order to prove the round-trip without ever touching the dev tree
  the harness must create an isolated git repo per run and tear it down cleanly.

  # Isolation as a SOURCE invariant (never cwd / dev-tree / global workspace) is the fitness
  # function acd-roundtrip-isolation (ADR-001) — these scenarios assert only the observable
  # outcomes a black-box tester can confirm from outside (the dir exists, is a real git repo,
  # is empty of bundle before install, and cleanup leaves nothing behind).

  Background:
    Given the round-trip harness module

  Scenario: the created repo is an initialised git repo under the OS temp root
    When createRoundTripRepo() is called
    Then it returns a "dir" path located under the OS temp root
    And "dir" contains an initialised git repository
    And it returns a "cleanup" function

  # QA added: ADR-001 says the harness `git init`s a REAL repo because the loop expects one.
  # "Real" is black-box confirmable without reading source: git status succeeds and a commit
  # can be recorded. This is the observable face of the "git init" decision, not the decision.
  Scenario: the created repo is a usable git repository, not just a ".git" folder
    Given createRoundTripRepo() has returned a repo
    When "git status" is run with the repo "dir" as its working directory
    Then the command exits successfully
    And a file added in the repo can be committed with "git commit"

  # QA added: ADR-001's "fresh, throwaway repository created per run" implies the dir is
  # empty-of-bundle before any install — observable (no .aof/, no .claude/). This is the
  # precondition story 01's installBundle scenarios rely on; assert it here at the source.
  Scenario: a freshly created repo carries no bundle render before install
    Given createRoundTripRepo() has returned a repo
    When the repo "dir" is inspected before any install runs
    Then it contains no ".aof/" directory
    And it contains no ".claude/" directory

  Scenario: cleanup removes the repo and leaves nothing behind
    Given createRoundTripRepo() has returned a repo
    When its cleanup() is called
    Then the repo "dir" no longer exists

  # QA added: cleanup idempotency / cleanup-after-already-removed. A teardown handle used in a
  # `finally` must be safe to call when the dir is already gone (e.g. a test removed it, or
  # cleanup ran twice) — it resolves without throwing. Observable: the call settles, dir absent.
  Scenario Outline: cleanup is idempotent and safe when the repo is already gone
    Given createRoundTripRepo() has returned a repo
    And the repo is in state <pre-state>
    When cleanup() is called
    Then the call resolves without throwing
    And the repo "dir" no longer exists

    Examples:
      | pre-state                                  |
      | present (never cleaned)                    |
      | already removed out-of-band                |
      | cleanup() already called once before       |

  Scenario: each call yields a distinct, independent repo
    When createRoundTripRepo() is called twice
    Then the two returned "dir" paths differ
    And neither path lies inside the other

  # QA added: independence is observable end-to-end — cleaning up one repo must not affect the
  # other (no shared scratch dir, per ADR-001's rejection of a fixed reused dir). Black-box.
  Scenario: cleaning up one repo does not disturb a second concurrent repo
    Given two repos from two separate createRoundTripRepo() calls
    When the first repo's cleanup() is called
    Then the first repo "dir" no longer exists
    And the second repo "dir" still exists and is still a git repository
