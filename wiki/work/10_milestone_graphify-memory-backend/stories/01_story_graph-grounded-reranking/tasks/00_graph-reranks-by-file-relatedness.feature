@cli @adapter @memory @executable
Feature: the work-stream graph re-orders the 05 records by file relatedness (the graph contributes only to score)
  In order for "graph-grounded recall" to earn its name — a better #1 hit than BM25-lite alone
  the pure re-ranker must lift a record whose source_file is graph-central or graph-related to the
  query's matched files ABOVE a record whose file is graph-isolated, while returning the exact same
  record set the 05 base ranking saw — same records by id, only the ORDER changed, no field added.

  # This is milestone 10's VALUE story (ADR-001): the graphify graph RE-RANKS, never replaces, the 05
  # records; the join is FILE-LEVEL by source_file (never graph-id-keyed); the graph contributes ONLY
  # to `score`. Every scenario drives the FROZEN pure re-ranker signature (story-00 stub; this story
  # supplies the body):
  #     rerank(records, normalizedGraph, query, scope, opts) -> ranked records (each + numeric score)
  # over a COMMITTED, hand-authored fixture (fixtures/reranking-records.json +
  # fixtures/reranking-graph.normalized.json, the already-normalized 09/ADR-003 { nodes, edges,
  # hyperedges } shape) — NO live binary, NO spawn, NO normalizeGraph round-trip. @executable, never
  # @manual / @uat: it is a pure function of its inputs.
  #
  # THE DETERMINISTIC REORDERING THE FIXTURE ENCODES. The four `architecture` candidate records carry
  # IDENTICAL bodies and the same recordType with no title-term match, so the 05 base ranking
  # (05/ADR-006) scores them an EXACT 4-way TIE, broken only by stable fixture order:
  #     base order (graph absent): ISOLATED, RELATED, CENTRAL, CENTRAL_TWO     (ISOLATED wins the tie)
  # The graph (anchor community 1; CENTRAL.md = god-node central + community 1; RELATED.md =
  # semantically_similar_to INFERRED edge to the anchor + community 1; ISOLATED.md = no edges,
  # community 0) lifts the graph-connected files above the graph-isolated one, FLIPPING the base
  # tie-break winner to LAST:
  #     re-ranked order:           CENTRAL, CENTRAL_TWO, RELATED, ISOLATED      (graph-isolated falls)
  # CENTRAL and CENTRAL_TWO share CENTRAL.md, so they get the SAME file-level graph signal and stay
  # adjacent, ordered WITHIN the file by the 05 base ranking. (The exact CENTRAL-vs-RELATED interior
  # order is the implementer's graph math; the LOAD-BEARING observable contract these scenarios pin is
  # "every graph-connected record ranks above the graph-isolated one" + "a graph-central record is #1".)
  #
  # NOTE (NOT asserted here, by design): the structural invariants — the re-ranker NEVER imports
  # graphify.mjs / child_process, records come from the 05 parsers not graph nodes, the graph-id is
  # never the join key — are story-03 ARCH-TESTS (acd-graphify-records-from-parsers /
  # -backend-via-command), not Then-lines. The frozen-shape / provenance / --json behaviour is
  # story-00's 02_recall-returns-frozen-records. This feature pins ONLY observable ranked ORDER,
  # set-equality, and field-presence.
  Background:
    Given the committed re-ranker record fixture "fixtures/reranking-records.json"
    And the committed normalized-graph fixture "fixtures/reranking-graph.normalized.json"
    And a query "derived index invariant"
    And a scope of area "architecture"

  # THE CORE VALUE (ADR-001). With the graph, a record whose file is graph-central/related to the query
  # outranks a record whose file is graph-isolated — flipping an order the base ranking left tied.
  Scenario: the graph lifts a record on a graph-central file above a record on a graph-isolated file
    When the re-ranker ranks the records against the graph
    Then record "CENTRAL" ranks above record "ISOLATED"
    And record "RELATED" ranks above record "ISOLATED"
    And record "CENTRAL" is the top-ranked record

  # The graph EARNS its name: the same records base-ranked ISOLATED-first (the stable tie-break
  # winner), and the only thing that moved ISOLATED to last is the graph signal.
  Scenario: without the graph the base ranking leaves ISOLATED first, so the graph is what reorders
    When the re-ranker ranks the records with NO graph (an empty normalized graph)
    Then record "ISOLATED" is the top-ranked record
    And the ranked order is "ISOLATED, RELATED, CENTRAL, CENTRAL_TWO"

  # RE-RANK, NEVER REPLACE (ADR-001). The returned set is EXACTLY the 05 scoped candidate set — same
  # records by id, only the order may change; the graph adds and removes NO record.
  Scenario: the re-ranked set is exactly the scoped candidate set — same ids, only the order changes
    When the re-ranker ranks the records against the graph
    Then the returned records are exactly the same ids as the base-ranked scoped candidates
    And no record id absent from the base-ranked candidates appears in the re-ranked result
    And no base-ranked candidate id is missing from the re-ranked result

  # ONLY SCORE CHANGES (ADR-001 / 05/ADR-004,005). Each returned record is still a frozen MemoryRecord
  # (every ADR-005 field present) plus the numeric score the re-ranker adds; no field added, none's
  # meaning changed.
  Scenario: each re-ranked record is a frozen MemoryRecord plus a numeric score, and nothing else
    When the re-ranker ranks the records against the graph
    Then every record carries the MemoryRecord fields "recordType, id, item, itemSlug, title, area, stage, kind, owner, status, summary, text, source"
    And every record carries a numeric "score"
    And no record carries a field outside the MemoryRecord fields plus "score"

  # HARD SCOPE PRE-FILTER PRESERVED (05/ADR-006). Scope is applied BEFORE re-ranking; re-ranking only
  # reorders the survivors. OFFSCOPE (area "process") must never appear under an area-"architecture"
  # scope, graph signal notwithstanding.
  Scenario: the scope pre-filter runs before re-ranking, so no off-scope record is re-ranked in
    When the re-ranker ranks the records against the graph
    Then no record with area "process" is present
    And record "OFFSCOPE" is not present
    And every returned record has area "architecture"

  # FILE-LEVEL JOIN (ADR-001). A record is boosted via ITS FILE's graph relatedness
  # (source_file <-> GraphNode.sourceFile), not via any graph node id — two records in the SAME file
  # (CENTRAL, CENTRAL_TWO, both CENTRAL.md) get the SAME graph signal, and the base ranking orders
  # them WITHIN the file.
  Scenario: two records in the same file share one graph signal and stay adjacent, base-ordered within the file
    When the re-ranker ranks the records against the graph
    Then record "CENTRAL" and record "CENTRAL_TWO" are adjacent in the ranked order
    And record "CENTRAL" ranks above record "CENTRAL_TWO"
    And record "CENTRAL_TWO" ranks above record "ISOLATED"

  # NULL-GRAPH FALLBACK (ADR-001's null case). With NO graph present (empty/absent normalized graph)
  # the re-ranker returns the 05 base ranking UNCHANGED (graph term = 0) and never errors — recall
  # degrades to keyword ranking. (The full binary-absent DEGRADE wiring across verbs is story 02; this
  # is the pure-function null-graph INPUT only.)
  Scenario Outline: a null / empty graph yields the 05 base ranking unchanged, never an error
    When the re-ranker ranks the records with <graph>
    Then the re-ranker does not throw
    And the ranked order is "ISOLATED, RELATED, CENTRAL, CENTRAL_TWO"
    And the ranked order equals the 05 base ranking for the same query and scope

    Examples: every shape of "no graph" degrades to base ranking
      | graph                                                  |
      | an empty normalized graph of no nodes and no edges     |
      | a normalized graph whose nodes match no candidate file |
      | an absent graph (null)                                 |

  # THE REORDERING CASE MATRIX — the graph signal kind to the record it lifts above the graph-isolated
  # record. Each row is one ADR-001 relatedness channel (community co-membership / a
  # semantically_similar_to INFERRED edge / god-node centrality) joined by source_file; the Then pins
  # the OBSERVABLE lift (relatedAbove ranks above isolated) and the #1 hit. ISOLATED.md is the
  # graph-isolated foil in every row (no edges, community 0).
  Scenario Outline: each graph relatedness channel lifts its related file above the graph-isolated file
    When the re-ranker ranks the records against the graph
    Then record "<relatedAbove>" ranks above record "ISOLATED"
    And the top-ranked record is on a graph-central file

    Examples: god-node centrality — the highest-degree candidate file leads
      | relatedAbove |
      | CENTRAL      |

    Examples: a semantically_similar_to INFERRED edge to the query anchor lifts the related file
      | relatedAbove |
      | RELATED      |

    Examples: community co-membership with the query anchor — same community (1) as the anchor
      | relatedAbove |
      | CENTRAL_TWO  |

  # BOUNDARY (the analog of 05/02/01's "relevance dominates" row). The graph term is a re-rank LAYER on
  # top of the 05 base ranking, not a replacement: when the base relevance is NOT tied — one record
  # matches the query far more strongly — a weak graph signal on a graph-isolated file does NOT
  # override the clearly stronger base match. (This pins that the graph LAYERS ON, per ADR-001: it
  # boosts comparable-relevance records, it does not invert a decisive relevance gap.)
  Scenario: a graph signal does not override a clearly stronger base-relevance match
    Given a query that matches "ISOLATED" far more strongly than any other candidate
    When the re-ranker ranks the records against the graph
    Then record "ISOLATED" is the top-ranked record
