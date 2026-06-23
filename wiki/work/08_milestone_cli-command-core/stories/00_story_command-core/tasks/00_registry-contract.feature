@cli @work @work-stream @executable
Feature: The command registry exposes the six work operations as {id,input,run,cli} commands both faces invoke
  In order to give the CLI and the board ONE in-process source of truth for every work operation
  the command core registers each operation under a stable id with a frozen { id, input, run, cli } shape and an invoke(id, input, ctx) entry point,
  so that both faces couple through the same registry instead of two independent call sites, and every operation is CLI-runnable by construction.

  # This is the spine of the milestone (ADR-002): src/command-core.mjs holds a
  # registry keyed by string id; getCommand(id) / listCommands() / invoke(id,
  # input, ctx) are the access surface both faces import. A command is the frozen
  # { id, input, run, cli } shape — input a JSONSchema, run an async (input, ctx)
  # => result, cli the { argv, render } face adapter every command carries (the
  # readiness the ADR-004 command->CLI bijection arch-test asserts structurally;
  # here we assert the observable shape). ctx = { workspace } (the loadWorkspace
  # result). This feature is the registry MECHANICS; the per-command run behaviour
  # lives in the read / basis-neutral / feedback task features.
  Background:
    Given a work-stream fixture with a milestone "08" and a story "08/00"
    And the command registry loaded in-process from src/command-core.mjs

  # The registry holds exactly the six work operations the milestone re-homes — no
  # more, no fewer. listCommands() is what the ADR-004 bijection arch-test counts.
  Scenario: the registry exposes exactly the six work commands
    When I list the registered command ids
    Then the ids are exactly "work:list", "work:doc", "work:tasks", "work:validate", "work:next", and "work:feedback"
    And there are no other registered commands

  # getCommand(id) is the registry lookup both faces and the arch-tests use; a
  # known id resolves to its command, an unknown id resolves to nothing.
  Scenario Outline: getCommand resolves a registered id and only a registered id
    When I get the command for "<id>"
    Then the lookup "<outcome>"

    Examples:
      | id            | outcome              |
      | work:doc      | returns a command    |
      | work:feedback | returns a command    |
      | work:unknown  | returns nothing      |

  # Every registered command carries the full frozen shape — id, an input schema,
  # an async run, and a cli adapter with argv + render. A command missing any part
  # is not a valid command (and would fail the bijection arch-test).
  Scenario: every registered command carries the frozen { id, input, run, cli } shape
    When I inspect each registered command
    Then each command has a string "id" equal to its registry key
    And each command has an "input" schema that survives a JSON round-trip unchanged
    And each command has an async "run" function
    And each command has a "cli" adapter with an "argv" mapper and a "render" function

  # invoke(id, input, ctx) is the in-process call both faces make: it runs the
  # command's run with the supplied input + ctx and returns the run's result
  # verbatim (no face projection — that is the caller's job, ADR-002).
  Scenario: invoke returns the command's result unchanged
    When I invoke "work:doc" with input ref "08" and doc "SPEC" and the fixture workspace
    Then the result carries exactly the fields ref, doc, present, and body
    And the result equals the object the command's own run produces for the same input

  # invoke against an unregistered id fails loudly rather than silently returning
  # undefined — a typo'd command id is a programmer error both faces surface.
  Scenario: invoke on an unknown id fails rather than returning undefined
    When I invoke "work:nope" with any input and the fixture workspace
    Then invoke raises an error naming the unknown command id
    And no result is returned
