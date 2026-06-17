@cli @work @validate @executable
Feature: Validate folder name against the frontmatter record
  In order to trust the folder index as a faithful view of the record
  the system must fail when an item's folder identity and its frontmatter disagree, with a CI exit code.

  Background:
    Given a work stream under validation

  Scenario: a well-formed stream passes with a clean report and exits 0
    Given every item's folder name agrees with its frontmatter record
    When I run "aof work validate"
    Then no findings are reported
    And the command exits 0

  Scenario: a malformed stream reports findings and exits non-zero for CI
    Given an item whose frontmatter slug differs from its folder slug
    When I run "aof work validate"
    Then at least one finding is reported
    And the command exits non-zero

  # The case matrix — one row per check-1 rule the validator emits, plus the
  # whole-record case (a record doc with no parseable frontmatter at all).
  Scenario Outline: a folder/frontmatter disagreement is flagged
    Given an item whose frontmatter <field> <condition>
    When I run "aof work validate"
    Then a finding reports "<problem>"

    Examples:
      | field   | condition                      | problem                                |
      | type    | differs from the folder type   | type ≠ folder type                     |
      | number  | differs from the folder number | number ≠ folder                        |
      | slug    | differs from the folder slug   | slug ≠ folder                          |
      | status  | is not a valid status value    | invalid status                         |
      | created | is missing                     | missing created date                   |
      | updated | is missing                     | missing updated date                   |
      | parent  | names a non-milestone          | parent does not resolve to a milestone |

  Scenario: a record doc with no parseable frontmatter is flagged whole
    Given a milestone whose "SPEC.md" carries no frontmatter block
    When I run "aof work validate"
    Then a finding reports "missing or empty record doc (SPEC.md)"
    And no per-field findings are reported for that item
