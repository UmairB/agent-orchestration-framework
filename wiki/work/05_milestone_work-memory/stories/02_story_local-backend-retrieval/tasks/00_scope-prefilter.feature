@cli @work @memory @executable
Feature: scope filters are a hard pre-filter that decides which records can reach scoring
  In order for a scoped recall to never surface an off-scope record
  the local backend must intersect the supplied scope filters (area / stage / kind / owner / item)
  and apply them as a hard pre-filter over the fixture index BEFORE ranking, so only surviving records can rank.

  # This story reads a hand-authored FIXTURE INDEX of MemoryRecords (the frozen ADR-005 shape) —
  # it needs no parser code (story 01) and no argv/dispatch (story 00). Each scenario is GIVEN a
  # fixture index and a parsed scope, then asserts EXACTLY which record ids survive the pre-filter.
  # Empty-string-present convention (ADR-005): adr-only fields (stage/kind/owner) are "" on lessons'
  # absent fields and on adrs, so a filter on such a field matches only records carrying that value.
  # These are CONCRETE cases that pin the behaviour on representative inputs; the universal "no
  # off-scope record in results" rule is owned by the acd-memory-ranking fitness function, not here.
  Background:
    Given a fixture index of these MemoryRecords:
      | id      | recordType | item | area         | stage  | kind      | owner     |
      | R1      | lesson     | 01   | architecture | design | smell     | architect |
      | R2      | lesson     | 01   | tooling      | build  | near-miss | developer |
      | R3      | lesson     | 04   | architecture | build  | near-miss | developer |
      | ADR-002 | adr        | 01   | architecture |        |           |           |
      | ADR-009 | adr        | 04   | architecture |        |           |           |

  Scenario: an empty scope leaves every record a candidate
    Given an empty scope
    When recall pre-filters the fixture index
    Then the surviving record ids are "R1, R2, R3, ADR-002, ADR-009"

  Scenario: a single area filter keeps only records in that area
    Given a scope of area "tooling"
    When recall pre-filters the fixture index
    Then the surviving record ids are "R2"

  Scenario: intersected filters keep only records matching every filter (AND)
    Given a scope of area "architecture", stage "build", and kind "near-miss"
    When recall pre-filters the fixture index
    Then the surviving record ids are "R3"

  Scenario: a filter on a lesson-only field excludes every adr (adr fields are empty-string)
    Given a scope of kind "near-miss"
    When recall pre-filters the fixture index
    Then the surviving record ids are "R2, R3"

  Scenario: a scope that no record satisfies yields zero candidates
    Given a scope of area "architecture" and owner "product-owner"
    When recall pre-filters the fixture index
    Then no records survive

  # The case matrix — a fixture scope to the exact set of surviving ids. Covers single-filter,
  # multi-filter intersection, the empty-string-present lesson-only/adr-only fields, the empty
  # scope (all candidates), and the no-match case (zero survivors).
  Scenario Outline: the scope pre-filter admits exactly the records matching every filter
    Given a scope of <scope>
    When recall pre-filters the fixture index
    Then the surviving record ids are <ids>

    Examples: empty scope and single-filter scopes
      | scope                | ids                            |
      | (empty)              | R1, R2, R3, ADR-002, ADR-009   |
      | item 01              | R1, R2, ADR-002                |
      | area tooling         | R2                             |
      | owner developer      | R2, R3                         |

    Examples: intersected multi-filter scopes (AND across fields)
      | scope                                          | ids     |
      | area architecture, stage build                 | R3      |
      | area architecture, stage build, kind near-miss | R3      |
      | area architecture, item 04                      | R3, ADR-009 |

    Examples: lesson-only / adr-only fields under the empty-string-present convention
      | scope             | ids    |
      | kind near-miss    | R2, R3 |
      | stage design      | R1     |

    Examples: no-match scopes yield zero survivors
      | scope                              | ids    |
      | area security                      | (none) |
      | area architecture, owner developer-x | (none) |
