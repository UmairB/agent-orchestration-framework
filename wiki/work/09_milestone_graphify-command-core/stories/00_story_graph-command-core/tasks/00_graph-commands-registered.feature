@cli @adapter @distribution @executable
Feature: The three graphify operations are registered graph:* commands the CLI can run
  In order that graphify arrives "as commands first" in the SAME core milestone 08 froze
  the registry exposes graph:build / graph:query / graph:triage with the { id, input, run, cli } shape and an `aof graph <verb>` dispatch,
  so that the CLI is the single source of truth for graphify and every face couples through the registry, not graphify's binary.

  # ADR-001: three command modules (src/commands/graph-build.mjs / graph-query.mjs /
  # graph-triage.mjs) are added to the COMMANDS array in src/command-core.mjs. They
  # inherit the 08 frozen shape and the getCommand/listCommands/invoke surface. The
  # CLI grows a top-level `aof graph <verb>` dispatch (sibling to `aof work`). This
  # feature is the REGISTRATION + SHAPE + dispatch-reachability (observable); the
  # "is the ONLY graphify spawn site" structural fact is a fitness function (03), not
  # here. A verb is "reachable" when `aof graph <verb> --json` emits a single
  # parseable JSON envelope — success when its preconditions hold, a structured error
  # envelope otherwise (proving the dispatch is wired without a live graph).
  Background:
    Given the command registry loaded in-process from src/command-core.mjs
    And a work-stream fixture workspace

  # The registry now carries the three graph commands ALONGSIDE the six work commands.
  Scenario: the registry exposes the three graph commands alongside the work commands
    When I list the registered command ids
    Then the ids include "graph:build", "graph:query", and "graph:triage"
    And the six work command ids are still present

  # getCommand(id) resolves each graph id; an unknown graph id resolves to nothing.
  Scenario Outline: getCommand resolves a registered graph id and only a registered id
    When I get the command for "<id>"
    Then the lookup "<outcome>"

    Examples:
      | id            | outcome           |
      | graph:build   | returns a command |
      | graph:query   | returns a command |
      | graph:triage  | returns a command |
      | graph:nope    | returns nothing   |

  # Every graph command carries the full frozen 08 shape — id, input schema, async
  # run, cli adapter with argv + render — so each is CLI-runnable by construction.
  Scenario: every graph command carries the frozen { id, input, run, cli } shape
    When I inspect each registered graph command
    Then each command has a string "id" equal to its registry key
    And each command has an "input" schema that survives a JSON round-trip unchanged
    And each command has an async "run" function
    And each command has a "cli" adapter with an "argv" mapper and a "render" function

  # The new `aof graph <verb>` dispatch is wired: each verb is reachable and emits a
  # SINGLE parseable JSON envelope under --json (success or a structured error when a
  # live graph/binary is absent — both are parseable, proving the verb is dispatched).
  Scenario Outline: aof graph <verb> --json is reachable and emits one parseable JSON envelope
    When I run "aof graph <verb> --json" against the fixture workspace
    Then the entire stdout parses as JSON in a single pass
    And the JSON is a single envelope for the "<verb>" operation

    Examples:
      | verb    |
      | build   |
      | query   |
      | triage  |

  # An unknown graph verb is rejected by the dispatch rather than silently ignored.
  Scenario: aof graph on an unknown verb exits non-zero
    When I run "aof graph nonsense"
    Then the command exits non-zero
    And stderr names the unknown graph verb
