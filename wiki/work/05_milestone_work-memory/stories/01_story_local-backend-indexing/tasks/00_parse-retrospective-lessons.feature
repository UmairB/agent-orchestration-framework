@cli @work @memory @executable
Feature: A RETROSPECTIVE R-entry becomes a lesson MemoryRecord
  In order to recall the distilled lessons of a prior milestone at decision time
  the local backend must turn each RETROSPECTIVE "R<n>" entry into a lesson record with the frozen
  fields populated and a source back-reference that resolves to the entry's line.

  # Scope: the RETROSPECTIVE parser only (ADR-007 — "R<n>" entries -> lesson records). Field values
  # below are grounded in the real milestone-01 RETROSPECTIVE.md (R1-R4), whose entries carry a meta
  # line "**Kind:** · **Area:** · **Stage:** · **Owner:** · **Raised by:**" followed by What/Why/Lesson.
  # Every record is the frozen MemoryRecord (ADR-005): adr-only fields (status) are present as "",
  # never omitted, so retrieval filters uniformly. The universal "source resolves to live text /
  # reindex is idempotent" guarantee is the acd-memory-derived-index fitness function, NOT a scenario
  # here — these scenarios assert the concrete field mapping for representative entries.

  Background:
    Given the work stream's milestone "01" (slug "acd-asset-bundle") with a RETROSPECTIVE.md holding entries R1 through R4

  Scenario: a near-miss R-entry becomes a lesson record with its meta fields populated
    When the RETROSPECTIVE parser indexes milestone "01"
    Then a record exists with recordType "lesson" and id "R2"
    And its item is "01" and its itemSlug is "acd-asset-bundle"
    And its title is "Content-addressed artifacts must pin line endings or cross-platform CI hashes diverge"
    And its area is "architecture", its stage is "build", its kind is "near-miss", and its owner is "developer"
    And its summary is the entry's one-line lesson gist
    And its text is the searchable blob covering the entry's title, what, why, and lesson
    And its source resolves to "01_milestone_acd-asset-bundle/RETROSPECTIVE.md" at the line of the "## R2" heading

  # ADR-005: fields that belong only to adr records are present-as-"" on a lesson, never omitted.
  Scenario: a lesson record carries the adr-only field as an empty string
    When the RETROSPECTIVE parser indexes milestone "01"
    Then the record with id "R1" has a status field present with the value ""
    And the record with id "R1" does not omit the status field

  Scenario: every R-entry in the file produces exactly one lesson record
    When the RETROSPECTIVE parser indexes milestone "01"
    Then it produces 4 lesson records, one per "R<n>" heading
    And their ids are exactly "R1", "R2", "R3", "R4"

  # The meta line drives area/stage/kind/owner; the heading drives id and title. These rows map
  # the real R1-R4 entries to their parsed field values (grounded in milestone-01 RETROSPECTIVE.md).
  Scenario Outline: an R-entry maps to a lesson record's fields
    When the RETROSPECTIVE parser indexes milestone "01"
    Then a record with id "<id>" has recordType "lesson", area "<area>", stage "<stage>", kind "<kind>", owner "<owner>", and status ""

    Examples: the four real lessons of milestone 01
      | id | area         | stage         | kind            | owner   |
      | R1 | architecture | build→verify  | near-miss       | architect |
      | R2 | architecture | build         | near-miss       | developer |
      | R3 | contract     | refine→build  | misunderstanding | contract authors (Three Amigos) |
      | R4 | contract     | build         | near-miss       | developer |
