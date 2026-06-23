@cli @adapter @distribution @manual
Feature: aof graph build drives the real graphify binary and writes graph.json under the project root
  In order that the build command produces the one stable machine artifact every other graph op reads
  the driver spawns the pinned graphify binary with cwd at the project root and reports a graph-derived BuildResult,
  so that a subsequent query finds <projectRoot>/graphify-out/graph.json (working around graphify bug #756) and the result counts come from the graph, not stdout.

  # ADR-002: src/graphify.mjs runs the pinned graphify binary. Because graphify #756
  # hardcodes <cwd>/graphify-out/graph.json and ignores GRAPHIFY_OUT, the driver MUST
  # cwd into ctx.workspace.projectRoot. These scenarios need the REAL binary (verb set
  # / version / the #756 behaviour are live-only assumptions, RESEARCH §A3/A4/A5/A7),
  # so they are @manual — verified by a developer against a live `uv tool install
  # graphifyy` install, evidence recorded at verify. BuildResult counts are derived
  # from graph.json (ADR-001/003), never parsed from graphify's stdout.
  # verifies → milestone UAT.md "graphify live build" procedure (authored at verify).
  Background:
    Given graphify is installed on PATH (uv tool install graphifyy; graphify install)
    And a small fixture codebase folder to graph

  # The build produces the graph.json artifact under the project root and a BuildResult
  # whose counts come from that graph.
  Scenario: aof graph build writes graph.json under the project root with graph-derived counts
    When I run "aof graph build <fixture-folder>"
    Then a file "graphify-out/graph.json" exists under the project root
    And the BuildResult graphPath points at that file
    And the BuildResult reports nodeCount, edgeCount, and hyperedgeCount taken from the graph

  # The cwd discipline is observable end-to-end: a query run immediately after a build
  # finds the graph (it would not if the build wrote it anywhere but <projectRoot>).
  Scenario: a query after a build finds the graph (the #756 cwd discipline holds)
    Given I have run "aof graph build <fixture-folder>"
    When I run "aof graph query \"what calls main\""
    Then the query resolves against the built graph
    And it does not report a missing graph

  # The egress field reports whether the doc/media backend HOP ran (ADR-001): "none"
  # when no backend (code/AST only, fully local), "docs-media" when ANY --backend ran
  # the doc/media hop. Locality is a SEPARATE privacy property, NOT the egress field:
  # ollama is a local backend, yet its egress is still "docs-media" because the
  # doc/media extraction hop RAN — aof reports "the hop ran", never re-classifies it by
  # network reachability, and never widens whatever graphify does (ADR-005). A null/
  # absent backend = code/AST only = "none". (Resolved: the ollama row IS "docs-media"
  # — confirm the exact field value against the live tool at verify, RESEARCH §A8.)
  Scenario Outline: the build reports its doc/media egress hop honestly
    When I run "aof graph build <fixture-folder><backendFlag>"
    Then the BuildResult egress is "<egress>"

    Examples:
      | backendFlag        | egress     |
      |                    | none       |
      | --backend claude   | docs-media |
      | --backend ollama   | docs-media |
