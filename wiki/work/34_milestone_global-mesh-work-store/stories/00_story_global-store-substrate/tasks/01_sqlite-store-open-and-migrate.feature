@executable @cli @work @distribution
Feature: The global work projection opens as a versioned SQLite store or refuses cleanly when SQLite is unavailable
  In order to query machine-wide mesh work without making SQLite the canonical work source
  the global store opens a versioned projection database under the global mesh work root
  so that schema creation, migration, and unsupported-runtime failures are deterministic.

  Background:
    Given AOF_GLOBAL_HOME points at a fixture global home
    And the global mesh paths resolve under that fixture

  Scenario: opening the store creates the directory and schema version metadata
    Given the global mesh work directory does not exist
    And a supported SQLite runtime is available
    When the global work projection store is opened
    Then the global mesh work directory exists
    And the projection database exists under the global mesh work directory
    And the database contains a schema version row for the current schema
    And the database contains tables for workspaces, work items, projection metadata, and projection errors

  Scenario: opening the store is idempotent
    Given a supported SQLite runtime is available
    And the global work projection store has already been opened
    When the global work projection store is opened again
    Then no duplicate schema version rows are created
    And existing projected rows are preserved
    And the returned store reports the same schema version

  Scenario: an older compatible schema migrates in place
    Given a projection database exists with the previous schema version
    And it contains one projected workspace row
    When the global work projection store is opened
    Then the schema version is upgraded to the current schema
    And the existing workspace row is still queryable
    And a migration record is written to projection metadata

  Scenario: an unsupported future schema refuses without mutation
    Given a projection database exists with a schema version newer than this AOF build supports
    When the global work projection store is opened
    Then the operation fails with code "global-store-schema-unsupported"
    And the database file is left byte-unchanged
    And the error message includes the database path and the unsupported schema version

  Scenario: SQLite unavailable is a structured unsupported-runtime refusal
    Given no supported SQLite runtime is available
    When the global work projection store is opened
    Then the operation fails with code "sqlite-unavailable"
    And no empty or partial database file is created
    And the error message says the global work projection requires a supported SQLite runtime
