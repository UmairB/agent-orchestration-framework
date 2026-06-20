@cli @work @memory @executable
Feature: recall returns a RecallResult whose records and text view are the same projection
  In order for the agent path and the human path to read the same recalled records
  recall must return { query, scope, records[], text } over a fixture index — echoing the applied
  scope, scoring each record, and rendering a text view that projects exactly those records.

  # ADR-004 froze the RecallResult shape; this story produces it from a real recall over a hand-authored
  # FIXTURE INDEX (the frozen ADR-005 MemoryRecord shape). The universal contract — "the four keys, each
  # record a MemoryRecord + numeric score, --json emits records not text" — is owned by the
  # acd-memory-recall-contract fitness function. This feature pins the behaviour on a CONCRETE recall:
  # given these records and this scope, recall returns this result with these echoed filters, these
  # scored records, and a text view that surfaces the same record ids. No CLI / argv here (that is
  # story 00) — these scenarios call recall over the fixture directly.
  Background:
    Given a fixture index of these MemoryRecords:
      | id      | recordType | item | area         | title                                 | source                                   |
      | R1      | lesson     | 01   | architecture | requiring-grep is a fitness-fn smell  | 01_milestone_acd-asset-bundle/RETROSPECTIVE.md:42 |
      | ADR-002 | adr        | 01   | architecture | content-addressed manifest membership | 01_milestone_acd-asset-bundle/ARCHITECTURE.md:66  |

  Scenario: recall returns the four top-level RecallResult keys
    Given a query "content addressed manifest"
    And a scope of area "architecture"
    When recall runs over the fixture index
    Then the result has exactly the top-level keys "query, scope, records, text"

  Scenario: the result echoes back the query and the applied scope
    Given a query "content addressed manifest"
    And a scope of area "architecture"
    When recall runs over the fixture index
    Then the result's query is "content addressed manifest"
    And the result's scope is the applied scope of area "architecture"

  Scenario: each returned record carries a numeric score plus the frozen MemoryRecord fields
    Given a query "content addressed manifest"
    And a scope of area "architecture"
    When recall runs over the fixture index
    Then every record carries a numeric "score"
    And every record carries the MemoryRecord fields "recordType, id, item, itemSlug, title, area, stage, kind, owner, status, summary, text, source"

  Scenario: the text view is a projection of the same records the agent path reads
    Given a query "content addressed manifest"
    And a scope of area "architecture"
    When recall runs over the fixture index
    Then the text view surfaces the id of every record in the records array
    And the text view introduces no record id absent from the records array

  Scenario: a scope echo reflects an empty scope as an empty filter set
    Given a query "content addressed manifest"
    And an empty scope
    When recall runs over the fixture index
    Then the result's scope carries no applied filters

  # The case matrix — a query/scope to the shape assertions on the resulting RecallResult.
  # Asserts the four keys, the echoed scope, the per-record score, and that the text view projects
  # the same record ids as the records array — across an empty scope and a single-filter scope.
  Scenario Outline: recall returns the frozen shape with an echoed scope and scored records
    Given a query "<query>"
    And a scope of <scope>
    When recall runs over the fixture index
    Then the result top-level keys are "query, scope, records, text"
    And the result's scope echoes <echoed>
    And every record carries a numeric score
    And the text view surfaces exactly the record ids in the records array

    Examples: an empty scope echoes back empty; a filtered scope echoes the filter
      | query                     | scope             | echoed            |
      | content addressed         | (empty)           | no filters        |
      | content addressed         | area architecture | area architecture |
