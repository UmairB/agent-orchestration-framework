@executable @cli @work @distribution
Feature: Successful work and mesh mutations publish one workspace snapshot to the global projection
  In order for the machine-wide mesh view to converge after local changes
  mutation commands publish a workspace snapshot after their canonical local write succeeds
  so that the global store follows local work/run/mesh records without becoming the write authority.

  Background:
    Given a mesh-enabled workspace with config.mesh.enabled true
    And a fake global publisher injected into the command context
    And the canonical local work store is a fixture directory

  Scenario Outline: successful mutation commands publish after the local write succeeds
    Given the command "<command>" is set up to mutate the local workspace successfully
    When the command runs
    Then its canonical local write has completed before the global publisher is called
    And the global publisher is called exactly once with the loaded workspace
    And the command result returned to the caller is the original command result, not the publish result

    Examples:
      | command           |
      | work:run-start    |
      | work:run-complete |
      | mesh:issue        |
      | work:feedback     |

  Scenario Outline: failed or refused commands do not publish
    Given the command "<command>" is set up to fail before its local mutation
    When the command runs
    Then the command returns its original error code
    And the global publisher is not called
    And no global projection rows are changed

    Examples:
      | command           |
      | work:run-start    |
      | work:run-complete |
      | mesh:issue        |
      | work:feedback     |

  Scenario: mesh issue push failure still publishes the durable local directive state
    Given mesh:issue writes its directive locally
    And the subsequent mesh sync push fails with code "push-failed"
    When mesh:issue runs
    Then mesh:issue returns the original "push-failed" error
    And the global publisher is called once after the directive write
    And the projected workspace snapshot includes the locally durable directive

  Scenario: run-complete publishes after lease release and rollback side effects
    Given work:run-complete transitions a run to failed
    And the command releases its mesh lease
    And it rolls the item status back to not-started
    When work:run-complete runs
    Then the global publisher is called after the run transition, lease release, and status rollback
    And the projected snapshot sees the terminal run and the rolled-back item status
