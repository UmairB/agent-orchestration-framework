@cli @work @memory @executable
Feature: brief surfaces the corpus shape — the lesson/adr split and a recent-lessons-by-area digest
  In order to see at a glance what memory holds and how lesson-rich it is yet
  brief must report the lesson/adr counts and a recent-lessons-by-area digest over the fixture index,
  and scope that picture to a single milestone when given --item NN.

  # ADR-007 / FINDINGS F3: the corpus is adr-heavy early (the spike found 17 adrs vs 4 lessons), so the
  # lesson/adr split must be VISIBLE — brief is the situational digest that keeps that reality honest.
  # brief is the seam's convenience composed over recall (ADR-003), so this story produces the digest
  # over a hand-authored FIXTURE INDEX (frozen ADR-005 shape). These are CONCRETE, example-driven cases
  # over a fixture; no CLI/argv parsing here (that is story 00 — the seam parses --item into scope.item).
  Background:
    Given a fixture index of these MemoryRecords:
      | id      | recordType | item | area         |
      | R1      | lesson     | 01   | architecture |
      | R2      | lesson     | 01   | tooling      |
      | R3      | lesson     | 04   | architecture |
      | ADR-002 | adr        | 01   | architecture |
      | ADR-007 | adr        | 01   | architecture |
      | ADR-009 | adr        | 04   | architecture |

  Scenario: brief reports the lesson/adr split for the whole corpus
    Given no item scope
    When brief runs over the fixture index
    Then the lesson count is 3
    And the adr count is 3

  Scenario: brief surfaces a recent-lessons-by-area digest
    Given no item scope
    When brief runs over the fixture index
    Then the recent-lessons digest groups lessons by area
    And area "architecture" lists lessons "R1, R3"
    And area "tooling" lists lessons "R2"

  Scenario: the lesson/adr split makes an adr-heavy corpus visible
    Given a fixture index of 1 lesson and 5 adrs
    And no item scope
    When brief runs over the fixture index
    Then the lesson count is 1
    And the adr count is 5

  Scenario: --item NN scopes the brief to one milestone
    Given an item scope of "01"
    When brief runs over the fixture index
    Then only records from milestone "01" are counted
    And the lesson count is 2
    And the adr count is 2

  Scenario: --item NN scopes the recent-lessons digest to that milestone
    Given an item scope of "04"
    When brief runs over the fixture index
    Then area "architecture" lists lessons "R3"
    And no lesson from another milestone appears in the digest

  # The case matrix — an item scope to the lesson/adr counts brief reports. The empty (whole-corpus)
  # scope shows the adr-heavy split; --item NN restricts the counts to that milestone.
  Scenario Outline: brief reports the lesson/adr counts for the scoped corpus
    Given an item scope of <item>
    When brief runs over the fixture index
    Then the lesson count is <lessons>
    And the adr count is <adrs>

    Examples: whole corpus and per-milestone scoping
      | item    | lessons | adrs |
      | (none)  | 3       | 3    |
      | 01      | 2       | 2    |
      | 04      | 1       | 1    |
