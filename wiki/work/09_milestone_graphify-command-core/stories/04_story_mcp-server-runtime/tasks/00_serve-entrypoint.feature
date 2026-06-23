@cli @adapter @distribution @executable
Feature: aof graph serve launches a stdio MCP server that advertises the graph tools
  In order that the rendered MCP config entry (story 02) points at a server aof actually ships
  aof grows an `aof graph serve` command that starts a stdio MCP server advertising the graph tools,
  so that an agent runtime can list and call the graph tools, and the config entry's command/args have a real target.

  # ADR-005 (amended): the rendered MCP entry's command/args target THIS server. It is
  # a net-new stdio MCP server (MCP SDK + a stdio transport) launched by `aof graph
  # serve`, a new dispatch branch in cli.mjs sibling to build/query/triage. This task
  # is the ENTRYPOINT + the advertised tool list — observable by listing the server's
  # tools over the MCP handshake (@executable in-process / over a test stdio pair);
  # the live agent round-trip is task 01's @manual scenario.
  Background:
    Given the aof CLI in a project with the graphify MCP face configured

  # The serve command exists and is the exact command/args the story-02 rendered entry
  # targets (the two must agree on the launch command name).
  Scenario: aof graph serve is the command the rendered MCP entry launches
    When I inspect the rendered graphify MCP config entry
    Then its command and args launch "aof graph serve"
    And "aof graph serve" is a reachable CLI dispatch branch

  # Starting the server brings up a stdio MCP transport that completes the MCP
  # initialize handshake.
  Scenario: aof graph serve starts a stdio MCP server
    When I start "aof graph serve" over a stdio transport
    Then the server completes the MCP initialize handshake
    And it reports itself as an aof-fronted graphify server

  # The server advertises one tool per aof graph verb — the agent reaches build /
  # query / triage as MCP tools, not graphify's own 9-tool surface.
  Scenario Outline: the server advertises a tool for each aof graph verb
    When I list the server's tools
    Then the tools include a "<tool>" tool

    Examples:
      | tool         |
      | graph_build  |
      | graph_query  |
      | graph_triage |

  # The server does NOT re-export graphify's own MCP tool surface verbatim (which omits
  # triage and bypasses the command core, RESEARCH §H).
  Scenario: the server does not re-export graphify's own MCP tools
    When I list the server's tools
    Then the tools are the aof graph verbs
    And the tools are not graphify's own get_node / get_neighbors / god_nodes surface
