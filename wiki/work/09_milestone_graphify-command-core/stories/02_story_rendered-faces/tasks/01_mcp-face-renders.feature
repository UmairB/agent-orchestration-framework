@cli @assets @distribution @executable
Feature: The graphify MCP face renders into each runtime config and fronts aof graph, not graphify's own server
  In order that an agent can reach the graph as MCP tools without bypassing aof's command core
  aof declares its own graphify MCP face in mcpServers and renders it into .mcp.json (claude) and config.toml (codex) through the existing machinery,
  so that the MCP face fronts `aof graph` behind the registry — never graphify's own `python -m graphify.serve`, whose 9 read tools omit PR triage and skip the command core.

  # ADR-005 (amended 2026-06-21): this task is the rendered MCP *config entry* ONLY —
  # the entry that renderRuntimeConfigOutputs writes (claudeMcpJson → .mcp.json for
  # claude; codexConfigToml → config.toml for codex), pointing command/args at the
  # aof-fronted server. The SERVER RUNTIME the entry launches is NET-NEW work and is
  # story 04 (mcp-server-runtime) — not here. aof does NOT declare graphify's own
  # `python -m graphify.serve` as the MCP (that re-exposes 9 tools sans triage and
  # bypasses the core, RESEARCH §H). Everything in THIS file is @executable rendering
  # over the existing machinery; the live agent-reaches-the-graph end-to-end lives in
  # story 04's contract.
  Background:
    Given an aof project configured with the runtimes claude and codex
    And the graphify MCP face declared in the config mcpServers

  # The MCP face renders into each runtime's native config file through the existing
  # machinery.
  Scenario Outline: the graphify MCP face renders into each runtime config
    When I render the project's config outputs
    Then the graphify MCP server appears in "<configFile>" for runtime "<runtime>"

    Examples:
      | runtime | configFile |
      | claude  | .mcp.json  |
      | codex   | config.toml |

  # The rendered MCP face fronts the aof command core, not graphify's own server.
  Scenario: the rendered MCP face launches an aof-fronted server, not graphify's
    When I render the project's config outputs
    Then the graphify MCP server's command invokes the aof graph commands
    And it does not launch "python -m graphify.serve"

  # The MCP face is drift-tracked like any rendered output.
  Scenario: an edit to the rendered MCP config is reported as drift
    Given the project's config outputs are rendered and locked
    When the rendered graphify MCP entry is edited out of band
    And I run "aof project doctor"
    Then the generated-output-drift check reports the graphify MCP config as drifted

  # NOTE: the live "an agent reaches the graph through the MCP face" end-to-end moved
  # to story 04 (mcp-server-runtime) — it needs the net-new aof MCP server, not just
  # this rendered config entry. See stories/04_story_mcp-server-runtime/.
