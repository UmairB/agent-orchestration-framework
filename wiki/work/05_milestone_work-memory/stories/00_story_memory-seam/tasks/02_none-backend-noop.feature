@cli @work @memory @executable
Feature: the none backend answers every verb as a graceful no-op
  In order to run ACD unchanged when no memory is configured
  the system must let every memory verb succeed against the none backend, returning empty results
  rather than erroring — so a project with memory absent behaves exactly like one with backend "none".

  # ADR-001/003: "none" satisfies the frozen backend interface as a total no-op. recall returns an
  # empty RecallResult (records: []); reindex/ingest return { recordCount: 0 }; status returns
  # { backend: "none", recordCount: 0 }. No verb errors when memory is absent — that is the entire
  # point of "none". These scenarios assert the OBSERVABLE no-op behaviour of the verbs; both an
  # explicit { "backend": "none" } config and an absent "memory" key reach the none backend
  # (ADR-002), so each scenario must hold for both.
  Background:
    Given a project where the none backend answers (memory is absent or backend is "none")

  Scenario: recall against none succeeds with no records
    When I run "aof work memory recall \"anything\" --json"
    Then the command exits 0
    And the recall result's records array is empty

  Scenario: reindex against none succeeds reporting zero records
    When I run "aof work memory reindex --json"
    Then the command exits 0
    And the result reports a record count of 0

  Scenario: ingest against none succeeds reporting zero records
    When I run "aof work memory ingest --all --json"
    Then the command exits 0
    And the result reports a record count of 0

  Scenario: status against none reports the none backend with zero records
    When I run "aof work memory status --json"
    Then the command exits 0
    And the status reports the backend "none"
    And the status reports a record count of 0

  Scenario: brief against none succeeds with an empty digest
    When I run "aof work memory brief"
    Then the command exits 0

  # An absent "memory" key behaves identically to an explicit none backend (ADR-002): no verb
  # errors in either case.
  Scenario: every verb is a no-op when the memory key is absent
    Given a project config with no "memory" key
    When I run each memory verb in turn
    Then every verb exits 0
    And no verb reports an error

  # Each verb against the none backend: it exits 0 and returns the empty/zero shape the frozen
  # interface specifies for none (ADR-003). The result column is what --json surfaces.
  Scenario Outline: every verb is a graceful no-op against the none backend
    When I run "aof work memory <verb> <args> --json"
    Then the command exits 0
    And the result is <result>

    Examples: the no-op return shapes for the none backend
      | verb    | args        | result                                     |
      | recall  | "q"         | an empty RecallResult (records: [])        |
      | reindex |             | { recordCount: 0 }                         |
      | ingest  | --all       | { recordCount: 0 }                         |
      | status  |             | { backend: "none", recordCount: 0 }        |
