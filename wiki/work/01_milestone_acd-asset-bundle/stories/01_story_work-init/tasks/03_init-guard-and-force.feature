@cli @assets @distribution @executable
Feature: init is a guarded first-install
  In order to never clobber an existing install by re-running the first-install command
  the system must refuse when a work manifest already exists and re-render only under --force.

  Background:
    Given a target repo

  Scenario: init succeeds when there is no existing work manifest
    Given the file ".aof/aof.work.lock.json" does not exist
    When I run "aof work init"
    Then the command exits 0
    And the file ".aof/aof.work.lock.json" exists

  Scenario: re-running init refuses when the work manifest already exists
    Given a repo already initialised with ACD
    When I run "aof work init"
    Then the command exits non-zero
    And the output points the user to "aof work update"
    And no rendered file is overwritten

  Scenario: re-running init does not touch the existing manifest
    Given a repo already initialised with ACD
    When I run "aof work init"
    Then the file ".aof/aof.work.lock.json" is unchanged from before the run

  Scenario: --force on an initialised repo re-renders from scratch and rewrites the manifest
    Given a repo already initialised with ACD
    When I run "aof work init --force"
    Then the command exits 0
    And the bundle files are re-rendered
    And the file ".aof/aof.work.lock.json" is rewritten

  # The guard's decision table: the precondition (presence of the work manifest
  # and the --force flag) determines the outcome.
  Scenario Outline: the init guard maps the precondition to an outcome
    Given the precondition "<precondition>"
    When I run "aof work init<flag>"
    Then the outcome is "<outcome>"

    Examples:
      | precondition            | flag    | outcome                        |
      | no work manifest        |         | render + write manifest        |
      | work manifest present   |         | refuse, exit non-zero, no writes |
      | work manifest present   | --force | re-render + rewrite manifest   |
