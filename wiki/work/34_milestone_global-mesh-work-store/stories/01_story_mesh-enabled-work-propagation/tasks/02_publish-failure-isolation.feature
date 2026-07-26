@executable @cli @work @distribution
Feature: Global publish failures do not roll back successful local mutations
  In order to keep the workspace record docs canonical and durable
  a global projection failure is isolated from the local command result
  so that local work succeeds and operators receive an actionable propagation warning.

  Background:
    Given a mesh-enabled workspace with config.mesh.enabled true
    And a mutation command has completed its canonical local write

  Scenario: a global store open failure becomes a propagation warning
    Given the global store cannot open because SQLite is unavailable
    When the post-mutation publish hook runs
    Then the local command result remains successful
    And the hook returns a warning with code "sqlite-unavailable"
    And the warning includes the global mesh store path
    And no local work file is rolled back or rewritten

  Scenario: a global publish write failure is recorded as a projection error
    Given the global store opens successfully
    But writing the workspace snapshot fails with code "projection-write-failed"
    When the post-mutation publish hook runs
    Then the local command result remains successful
    And a projection error is recorded for the workspace when the store can record it
    And the hook returns a warning with code "projection-write-failed"

  Scenario: warning output is stable under JSON and text CLI faces
    Given a successful work:run-start command whose global publish failed with code "projection-write-failed"
    When the command is rendered as JSON
    Then the JSON result includes a propagationWarnings array with the warning code and message
    When the same command is rendered as text
    Then the text output includes a concise propagation warning line
    And the primary success line is still present

  Scenario: disabled propagation does not warn
    Given config.mesh.enabled is false
    And a mutation command completes locally
    When the post-mutation publish hook runs
    Then no warning is returned
    And no global store is opened
