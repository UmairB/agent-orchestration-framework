@cli @adapter @distribution @executable
Feature: The driver normalizes graph.json reading links (not edges), preserving confidence, hyperedges separate
  In order that every graph:* result is derived from the one stable machine artifact, not graphify's drifting markdown
  the driver's normalizer maps NetworkX node_link_data into aof's GraphNode / GraphEdge shapes against a committed fixture,
  so that a consumer reads structure from graph.json with confidence preserved and hyperedges intact — never from parsed stdout.

  # ADR-003: graph.json is NetworkX node_link_data — top-level arrays `nodes` and
  # `links` (links, NOT edges — the load-bearing spelling). Edge: source/target/
  # relation/confidence{EXTRACTED|INFERRED|AMBIGUOUS}/confidence_score (score set only
  # on INFERRED). Node: id/label/file_type/source_file/community/norm_label.
  # Hyperedges (3+ nodes) live separately under graph.hyperedges and must NOT be
  # flattened into edges. This feature pins the normalizer against a REAL committed
  # fixture (the contract's anchor); it is fully @executable — no live binary needed.
  Background:
    Given a committed fixture "graph.json" in NetworkX node_link_data shape
    And the fixture holds nodes, a "links" array, and a separate "hyperedges" array

  # The normalizer reads edges from the `links` key — reading `edges` would yield a
  # silently empty edge set (the bug this scenario forbids).
  Scenario: the normalizer reads edges from the links key
    When I normalize the fixture graph.json
    Then the normalized edges count equals the fixture's "links" array length
    And each normalized edge carries a source, a target, and a relation

  # A graph.json missing `links` but carrying `edges` is a SURFACED format error, never
  # a silent empty graph (guards against a future graphify shape change).
  Scenario: a links-absent edges-present graph is a surfaced format error
    Given a malformed fixture with an "edges" array and no "links" array
    When I normalize that fixture
    Then normalization reports a graph-format error
    And it does not return a silently empty edge set

  # confidence is preserved on EVERY edge; confidenceScore is preserved ONLY for
  # INFERRED edges and is absent for every other confidence (ADR-003 / RESEARCH §D:
  # "confidence_score set only on INFERRED"). The cases enumerate score-present vs
  # score-absent across the three confidence levels, including the INFERRED-with-no-
  # score boundary (graphify emits the edge but omits the float) which must normalize
  # to an absent score, never a fabricated 0.
  Scenario Outline: confidence is preserved and confidenceScore survives only for INFERRED
    When I normalize an edge with confidence "<confidence>" and score "<score>"
    Then the normalized edge has confidence "<confidence>"
    And its confidenceScore is "<normalizedScore>"

    Examples:
      | confidence | score | normalizedScore |
      | EXTRACTED  |       | absent          |
      | INFERRED   | 0.62  | 0.62            |
      | INFERRED   | 1.0   | 1.0             |
      | INFERRED   |       | absent          |
      | AMBIGUOUS  |       | absent          |

  # Hyperedges (3+ nodes) normalize into a SEPARATE hyperedges field — never flattened
  # into pairwise edges (which would corrupt the n-ary graph semantics).
  Scenario: hyperedges normalize separately and are never flattened into edges
    When I normalize the fixture graph.json
    Then the normalized result has a separate "hyperedges" field
    And the hyperedges are not present in the normalized edges array

  # Node fields map to aof's camelCase GraphNode shape on the stable `id` join key.
  Scenario: node fields map to the GraphNode shape
    When I normalize the fixture graph.json
    Then each normalized node carries id, label, fileType, sourceFile, community, and normLabel
    And the node id is preserved verbatim as the join key
