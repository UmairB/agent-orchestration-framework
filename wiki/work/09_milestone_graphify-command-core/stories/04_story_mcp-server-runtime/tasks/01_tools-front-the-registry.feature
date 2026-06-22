@cli @adapter @distribution
Feature: Each MCP tool call is answered by invoke(graph:…) behind the registry, never by spawning graphify
  In order that an agent reaching the graph through MCP goes through aof's single source of truth
  the server's tool handlers map every tools/call to invoke("graph:…", input, ctx) over the in-process command core,
  so that the MCP face is a thin transport over the registered commands — never a side-channel that calls graphify directly.

  # ADR-005 (amended) + ADR-006 inv. 2: the server is a thin transport face over the
  # 08 command core, exactly as the CLI face is. A tools/call for graph_query becomes
  # invoke("graph:query", input, { workspace }); the tool response is the projected
  # command result. The server reaches the graph ONLY through invoke — it never spawns
  # the graphify binary (the driver src/graphify.mjs is the sole spawn site). The
  # handler→invoke mapping is unit-testable in-process (@executable); the live
  # agent-over-stdio round-trip is @manual.
  Background:
    Given the aof graph MCP server running over a stdio transport
    And a built graph in the project

  # Each MCP graph tool maps to its registered command via invoke — the mapping the
  # whole face rests on.
  @executable
  Scenario Outline: a tool call is answered by invoking the matching graph command
    When the agent calls the "<tool>" tool with its input
    Then the server answers by invoking "<command>" behind the registry
    And the tool response carries the projected command result

    Examples:
      | tool         | command       |
      | graph_build  | graph:build   |
      | graph_query  | graph:query   |
      | graph_triage | graph:triage  |

  # The server reaches the graph through the registry only — it never spawns graphify
  # itself (that is the driver's sole job; the structural guarantee is ADR-006 inv. 2,
  # this is its observable counterpart).
  @executable
  Scenario: a tool call drives the registry, not the graphify binary
    When the agent calls the "graph_query" tool
    Then the answer comes from an invoke("graph:query") call
    And the server process does not spawn the graphify binary

  # A tool call whose command surfaces a precondition failure (no graph built yet) is
  # returned as a clean MCP tool error, not a crashed transport.
  @executable
  Scenario: a precondition failure is a clean MCP tool error
    Given the project has no built graph
    When the agent calls the "graph_query" tool
    Then the tool returns an MCP error reporting that a graph must be built first
    And the server stays up for the next call

  # End-to-end over a live agent runtime: the rendered MCP face actually answers a
  # query by driving aof's command core.
  # verifies → milestone UAT.md "graphify MCP face end-to-end (live agent)" procedure (authored at verify).
  @manual
  Scenario: an agent reaches the graph through the live MCP face
    Given a live agent runtime configured with the rendered graphify MCP face
    And a built graph
    When the agent calls the graphify query tool
    Then the answer is produced by an `aof graph query` invocation behind the registry
