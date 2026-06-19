@cli @work @memory @executable
Feature: An ARCHITECTURE ADR block becomes an adr MemoryRecord
  In order to recall the rationale behind a prior decision at decision time
  the local backend must turn each ARCHITECTURE "ADR-NNN" block into an adr record with the frozen
  fields populated and a source back-reference that resolves to the ADR's heading line.

  # Scope: the ARCHITECTURE parser only (ADR-007 — "ADR-NNN" blocks -> adr records). Field values are
  # grounded in the real milestone-01 ARCHITECTURE.md (ADR-001..ADR-007), each block being a
  # "## ADR-NNN: <title>" heading followed by "**Status:** ..." / "**Date:** ..." and Context/Decision/
  # Invariant prose. Per ADR-005: for an adr record, area is ALWAYS "architecture" and the lesson-only
  # fields (stage/kind/owner) are present as "". The "source resolves to live text / idempotent
  # rebuild" universal guarantee is the acd-memory-derived-index fitness function, NOT a scenario here.

  Background:
    Given the work stream's milestone "01" (slug "acd-asset-bundle") with an ARCHITECTURE.md holding ADR-001 through ADR-007

  Scenario: an Accepted ADR becomes an adr record with its decision fields populated
    When the ARCHITECTURE parser indexes milestone "01"
    Then a record exists with recordType "adr" and id "ADR-002"
    And its item is "01" and its itemSlug is "acd-asset-bundle"
    And its title is "Bundle membership and content are pinned by a content-addressed manifest reusing hashContent"
    And its area is "architecture"
    And its stage is "", its kind is "", and its owner is ""
    And its status is "Accepted"
    And its summary is the ADR's decision/invariant gist
    And its text is the searchable blob covering the ADR's title, context, decision, and invariant
    And its source resolves to "01_milestone_acd-asset-bundle/ARCHITECTURE.md" at the line of the "## ADR-002" heading

  # ADR-005: lesson-only fields are present-as-"" on an adr, never omitted; area is hard-coded
  # "architecture" for every adr regardless of the source file.
  Scenario: an adr record fixes area to "architecture" and carries lesson-only fields as empty strings
    When the ARCHITECTURE parser indexes milestone "01"
    Then the record with id "ADR-001" has area "architecture"
    And the record with id "ADR-001" has stage "", kind "", and owner "" all present, none omitted

  Scenario: every ADR block in the file produces exactly one adr record
    When the ARCHITECTURE parser indexes milestone "01"
    Then it produces 7 adr records, one per "## ADR-NNN" heading
    And their ids are exactly "ADR-001" through "ADR-007"

  # status is read from the ADR's "**Status:**" line: "Accepted" or "Superseded ...". The real
  # milestone-01 ADRs are all Accepted; the Superseded row is illustrative of the parse rule the
  # frozen shape names (ADR-005), so the parser is exercised on both status values.
  Scenario Outline: an ADR maps to an adr record whose status comes from its Status line
    When the ARCHITECTURE parser indexes an ARCHITECTURE.md whose "<id>" block has "**Status:** <statusLine>"
    Then a record with id "<id>" has recordType "adr", area "architecture", stage "", kind "", owner "", and status "<status>"

    Examples: Accepted ADRs (real milestone-01 blocks)
      | id      | statusLine | status   |
      | ADR-001 | Accepted   | Accepted |
      | ADR-004 | Accepted   | Accepted |
      | ADR-007 | Accepted   | Accepted |

    Examples: a superseded ADR (illustrative — the status string carries forward verbatim)
      | id      | statusLine              | status                  |
      | ADR-009 | Superseded by ADR-014   | Superseded by ADR-014   |
