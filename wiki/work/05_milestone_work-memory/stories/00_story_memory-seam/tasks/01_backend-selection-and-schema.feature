@cli @work @memory @executable
Feature: config.memory.backend selects which backend answers, and the schema gates the backend name
  In order to swap a cheap backend for a richer one without touching a single agent prompt
  the system must pick the backend named at config "memory.backend", treat an absent "memory" as
  "none", and reject an unregistered backend name when the config is validated against the schema.

  # ADR-001/002: selection lives at top-level "memory.backend", read once and dispatched; absent
  # "memory" is equivalent to backend "none" (the graceful no-op). ADR-002 also adds "$defs/memory"
  # to schemas/aof.schema.json (referenced from root as "memory"), with "backend" an enum of the
  # registered names. The locked config block (frozen 2026-06-19):
  #
  #   {
  #     "memory": {
  #       "backend": "local"          // enum: "local" | "none"
  #     }
  #   }
  #
  # These are OBSERVABLE behaviours: which backend the seam reports as answering, and whether a
  # config validates. The "read in exactly one place" structural invariant is the arch-test's
  # (acd-memory-backend-selection), not a scenario here.
  Background:
    Given the local and none backends are registered

  Scenario: a config naming the local backend dispatches to the local backend
    Given a project config '{ "memory": { "backend": "local" } }'
    When I run "aof work memory status"
    Then the command exits 0
    And the status reports the backend "local"

  Scenario: a config naming the none backend dispatches to the none backend
    Given a project config '{ "memory": { "backend": "none" } }'
    When I run "aof work memory status"
    Then the command exits 0
    And the status reports the backend "none"

  Scenario: an absent memory key is equivalent to the none backend
    Given a project config with no "memory" key
    When I run "aof work memory status"
    Then the command exits 0
    And the status reports the backend "none"

  Scenario: a config naming the local backend is schema-valid
    Given a project config '{ "memory": { "backend": "local" } }'
    When the config is validated against the schema
    Then validation succeeds

  Scenario: a config omitting the memory key is schema-valid
    Given a project config with no "memory" key
    When the config is validated against the schema
    Then validation succeeds

  # The schema gate: an unregistered backend name fails the $defs/memory enum at validation
  # time, not with an opaque dispatch error later (ADR-002 alternative considered).
  Scenario: a config naming an unregistered backend is rejected by the schema enum
    Given a project config '{ "memory": { "backend": "mempalace" } }'
    When the config is validated against the schema
    Then validation fails
    And the failure cites the "memory.backend" enum

  # config "memory" value -> which backend answers a verb (or whether the config validates).
  # "absent" = the config has no "memory" key; "(rejected)" = validation fails on the enum.
  Scenario Outline: the configured memory backend determines who answers
    Given a project config <config>
    Then the selected backend is <selected>

    Examples: a registered name selects that backend; absence selects none
      | config                               | selected     |
      | { "memory": { "backend": "local" } } | local        |
      | { "memory": { "backend": "none" } }  | none         |
      | absent                               | none         |

    Examples: an unregistered name is rejected by the schema, never silently dispatched
      | config                                    | selected     |
      | { "memory": { "backend": "mempalace" } }  | (rejected)   |
      | { "memory": { "backend": "" } }           | (rejected)   |
