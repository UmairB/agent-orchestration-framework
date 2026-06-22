@cli @adapter @distribution
Feature: aof graph query and aof graph triage return the opaque answer plus a graph handle, and fail clearly with no graph
  In order that an agent gets graphify's answer through the aof contract without aof parsing drifting markdown
  graph:query and graph:triage carry graphify's markdown stdout OPAQUE plus a graphPath to the whole graph, and refuse clearly when no graph exists yet,
  so that the result is honest (no underivable structured fields), stable against graphify's output drift, and a missing-graph precondition is a clear error, not a crash.

  # ADR-001 (amended 2026-06-21, Three-Amigos feasibility): query/triage have NO
  # stable --json and triage has NO MCP tool (RESEARCH §C/§H), so a per-query subgraph
  # or a structured prs[] is NOT derivable without parsing stdout (forbidden).
  #   QueryResult  { question, stdout, graphPath }   — stdout opaque; graphPath = the WHOLE graph.json.
  #   TriageResult { mode, stdout, graphPath }        — stdout opaque; graphPath = the WHOLE graph.json.
  # build is the only result with graph-derived counts. The SUCCESS scenarios drive the
  # real binary against a built graph (@manual at the feature level; verb/version are
  # live-only, RESEARCH §A3/A4). The MISSING-GRAPH failure is an operational precondition
  # the driver surfaces BEFORE any spawn, so it is CI-checkable with no graph present and
  # is split to @executable (scenario-level override below).
  # verifies → milestone UAT.md "graphify live query/triage" procedure (authored at verify).
  Background:
    Given graphify is installed on PATH
    And the project root has a built "graphify-out/graph.json"

  # query carries graphify's markdown answer opaque + a handle to the whole graph; it
  # does NOT invent per-query nodes/edges. (Drives the real binary → @manual.)
  @manual
  Scenario: aof graph query --json returns the opaque answer and a graph handle
    When I run "aof graph query \"what calls main\" --json"
    Then the entire stdout parses as JSON in a single pass
    And the JSON carries the question, an opaque "stdout" answer string, and a "graphPath"
    And the JSON has no per-query "nodes" or "edges" fields

  # triage carries graphify's triage-queue markdown opaque + the graph handle; mode
  # selects triage vs conflicts. (Drives the real binary → @manual.)
  @manual
  Scenario Outline: aof graph triage --json returns the opaque queue and the mode
    When I run "aof graph triage<modeFlag> --json"
    Then the entire stdout parses as JSON in a single pass
    And the JSON reports mode "<mode>" with an opaque "stdout" and a "graphPath"
    And the JSON has no structured "prs" field

    Examples:
      | modeFlag           | mode      |
      |                    | triage    |
      | --mode conflicts   | conflicts |

  # The build precondition: query / triage with no graph.json yet fail CLEARLY (a
  # guidance-bearing "build first" error), never a crash and never an empty success.
  # This is the missing-graph operational precondition (ADR-001) — the driver surfaces
  # it BEFORE spawning graphify, so it fires independent of whether the binary is even
  # present, which makes it deterministically CI-checkable: @executable (the only row in
  # this feature that needs no live binary).
  @executable
  Scenario Outline: <verb> with no built graph fails clearly with a build-first message
    Given the project root has NO "graphify-out/graph.json"
    And the missing-graph precondition is surfaced before any graphify spawn
    When I run "aof graph <verb> <arg>"
    Then the command exits non-zero
    And stderr says a graph must be built first

    Examples:
      | verb    | arg                |
      | query   | "what calls main"  |
      | triage  |                    |
