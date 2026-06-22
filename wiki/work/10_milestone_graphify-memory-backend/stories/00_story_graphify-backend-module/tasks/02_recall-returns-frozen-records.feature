@cli @adapter @memory @executable
Feature: recall returns the frozen RecallResult of 05-sourced MemoryRecords
  In order to answer recall through graphify without changing what a record IS or where it traces
  recall must return the frozen RecallResult shape over MemoryRecords produced by the 05 parsers,
  each carrying a resolving source and a numeric score, pre-filtered by scope before ranking, with
  --json emitting the structured records array rather than the rendered text view.

  # ADR-001: the records come from the 05 parsers — the graph is a re-rank SIGNAL over them, never
  # the record source. So recall's shape and provenance are exactly 05's (05/ADR-004 RecallResult,
  # 05/ADR-005 MemoryRecord with a resolving source:line, 05/ADR-006 scope-then-rank). The graph
  # contributes ONLY to `score`; it adds no field to MemoryRecord and changes no field's meaning.
  #
  # The graph-grounded RE-RANK ORDER (community co-membership / similar-to edges / god-node
  # centrality joined by source_file, reordering records by file relatedness) is story 01's
  # contract, asserted over a committed graph.json fixture — explicitly OUT OF SCOPE here. This
  # feature asserts the SHAPE/PROVENANCE invariants the backend holds with or without a graph, so no
  # live binary is needed (@executable). Story 02 owns the binary-absent degrade signal; this feature
  # asserts only that the frozen shape + 05 provenance hold once the store is populated.
  Background:
    Given the graphify backend is selected
    And a reindex has populated the record store from the work stream

  Scenario: recall returns the frozen RecallResult shape
    When I run "aof work memory recall \"derived index invariant\""
    Then the command exits 0
    And the result's top-level keys are exactly "query", "scope", "records", and "text"
    And "query" echoes the submitted query
    And "records" is an array

  # Each record is a frozen MemoryRecord PLUS a numeric score (the only field recall adds, 05/ADR-004),
  # and its provenance resolves — the ADR-001 guarantee that records come from the 05 parsers, so
  # every source:line points at live text even though graphify produced the ranking signal.
  Scenario: each recalled record is a frozen MemoryRecord with a numeric score and a resolving source
    When I run "aof work memory recall \"derived index invariant\""
    Then every record is a frozen MemoryRecord
    And every record carries a numeric "score"
    And every record's "source" resolves to live text at its "path:line"

  # 05/ADR-006 scope is a HARD pre-filter applied BEFORE ranking — inherited unchanged. The graph
  # re-rank (story 01) reorders only WITHIN the scoped survivors; it can never surface an off-scope
  # record, so the pre-filter guarantee holds regardless of the graph signal.
  Scenario: scope flags pre-filter before ranking, so no off-scope record is returned
    Given milestones "00" and "01" both hold sources
    When I run "aof work memory recall \"\" --item 01"
    Then every record returned has item "01"
    And no record sourced from milestone "00" is present

  Scenario Outline: a scope flag narrows recall to records carrying that field value
    When I run "aof work memory recall \"\" <flag> <value>"
    Then every record returned has <field> matching <value>

    Examples: each scope dimension is a hard pre-filter (05/ADR-006, inherited)
      | flag    | value         | field |
      | --area  | architecture  | area  |
      | --item  | 01            | item  |

  # 05/ADR-004: under --json recall emits the structured `records` array (the agent-path contract),
  # NEVER the rendered text blob. The seam owns this projection (it is unchanged by the backend).
  Scenario: --json emits the structured records array, not the rendered text
    When I run "aof work memory recall \"derived index invariant\" --json"
    Then the command exits 0
    And stdout parses as a JSON array of MemoryRecords
    And stdout does not contain the rendered text view
