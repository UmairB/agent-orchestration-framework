@cli @work @validate @executable
Feature: Validate the depends graph
  In order to order work safely
  the system must reject a depends edge that points nowhere and any dependency cycle.

  Background:
    Given a work stream whose milestones and uat sessions carry inline "depends" lists

  Scenario: a depends edge that resolves to no item is flagged
    Given a milestone with "depends: [99]" and no item numbered 99
    When I run "aof work validate"
    Then a finding reports that depends "99" does not resolve

  Scenario: a dependency cycle is detected
    Given milestone "00" depends on "01" and milestone "01" depends on "00"
    When I run "aof work validate"
    Then a finding reports a depends cycle

  # A depends edge resolves only to a top-level driver (a milestone OR a uat
  # session) — those are the items that sit at the root and carry depends.
  # Anything else is a dangling edge.
  Scenario Outline: a depends edge resolves only to a top-level driver
    Given a driver with "depends: [<dep>]" in an otherwise acyclic stream
    When I run "aof work validate"
    Then the edge is <verdict>

    Examples:
      | dep | verdict                   |
      | 00  | accepted (milestone)      |
      | 02  | accepted (uat session)    |
      | 99  | flagged: does not resolve |

  # The cycle check is direction-aware and includes the degenerate self-edge.
  Scenario Outline: a cycle in the depends graph is reported
    Given a depends graph shaped as "<shape>"
    When I run "aof work validate"
    Then it is <verdict>

    Examples:
      | shape                                  | verdict                  |
      | 00 → 01, 01 → 00                        | flagged: depends cycle   |
      | 00 → 00 (a driver depending on itself)  | flagged: depends cycle   |
      | 01 → 00, 02 → 00 (a diamond, no loop)   | accepted: acyclic        |

  # Only drivers (milestones, uat sessions) carry depends; the graph never reads
  # a story's frontmatter, so a story's stray "depends" cannot dangle the build.
  Scenario: a story-level depends edge is not part of the graph
    Given a story whose frontmatter carries "depends: [99]" and no item numbered 99
    When I run "aof work validate"
    Then no "does not resolve" finding is reported for that story
    And no depends cycle is reported
