@cli @adapter @memory @executable
Feature: the graphify backend is a registered, schema-valid, selectable memory backend
  In order to answer the unchanged `aof work memory` verbs through graphify by a one-line config
  the system must register "graphify" as a $defs/memory.backend enum value and a BACKEND_REGISTRY
  loader, dispatch the verbs to the graphify backend when it is selected, expose the frozen
  { name, recall, reindex, status } interface, and still reject an unregistered backend name.

  # ADR-003 (05/ADR-002): selection grows the enum by ONE reviewable line — "graphify" joins
  # ["local","none"] in $defs/memory.backend, plus one BACKEND_REGISTRY loader line in
  # src/work-memory.mjs; MEMORY_VERBS, argv parsing and rendering are untouched. The graphify
  # backend module's default export mirrors the local backend's frozen shape (05/ADR-003):
  # EXACTLY { name, recall, reindex, status } with name === "graphify". An unregistered name still
  # fails the schema enum (the 05/ADR-002 guarantee — fail at validation, never with an opaque
  # dispatch error later).
  #
  # These are OBSERVABLE behaviours: which backend the seam reports as answering, whether a config
  # validates, and the shape of the backend module's default export. The "config.memory?.backend is
  # read in EXACTLY one place (selectBackendName)" structural invariant is the arch-test's
  # (acd-graphify-backend-selection, story 03), NOT a scenario here. The "reach graphify only via
  # invoke('graph:…'), never import src/graphify.mjs" structural invariant is the arch-test's too
  # (acd-graphify-backend-via-command, story 03) — not asserted here.
  Background:
    Given the local, none, and graphify backends are registered

  Scenario: a config naming the graphify backend is schema-valid
    Given a project config '{ "memory": { "backend": "graphify" } }'
    When the config is validated against the schema
    Then validation succeeds

  Scenario: a config naming the graphify backend dispatches to the graphify backend
    Given a project config '{ "memory": { "backend": "graphify" } }'
    When I run "aof work memory status"
    Then the command exits 0
    And the status reports the backend "graphify"

  # ADR-003 / 05/ADR-003: the module's default export is the frozen 4-method interface, no more, no
  # less — the same shape acd-memory-backend-interface pins for local, extended to graphify.
  Scenario: the graphify backend module's default export is the frozen interface
    Given the graphify backend module's default export
    Then its keys are exactly "name", "recall", "reindex", and "status"
    And "name" is "graphify"
    And "recall", "reindex", and "status" are each callable

  # The schema gate (05/ADR-002, inherited): an unregistered name fails the $defs/memory enum at
  # validation time, not with an opaque dispatch error later. The graphify line widens the enum by
  # exactly one value — every still-unregistered name remains rejected.
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
      | config                                   | selected   |
      | { "memory": { "backend": "local" } }     | local      |
      | { "memory": { "backend": "none" } }      | none       |
      | { "memory": { "backend": "graphify" } }  | graphify   |
      | absent                                   | none       |

    Examples: an unregistered name is rejected by the schema, never silently dispatched
      | config                                    | selected   |
      | { "memory": { "backend": "mempalace" } }  | (rejected) |
      | { "memory": { "backend": "" } }           | (rejected) |
