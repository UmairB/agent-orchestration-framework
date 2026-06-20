@cli @work @validate @executable
Feature: Validate the closed tag vocabulary on task features
  In order to keep the contract queryable (one spelling per concept)
  the system must reject any scenario tag outside the closed vocabulary and any scenario without exactly one verification lane.

  Background:
    Given a story with a task ".feature" file under validation
    And the project config enumerates the allowed layer, refinement, and domain tags

  Scenario: a tag outside the closed vocabulary is flagged
    Given a scenario tagged "@bogus"
    When I run "aof work validate"
    Then a finding reports an unknown tag "@bogus"

  Scenario: a milestone-membership tag is rejected as structural
    Given a scenario tagged "@milestone-03"
    When I run "aof work validate"
    Then a finding reports that milestone membership is structural, not a tag

  # Which tags pass the vocabulary gate at all (closed vocab + universal lifecycle
  # tags + a @finding-<id> lineage tag). This is the "is this token allowed" gate,
  # separate from the verification-count rule below.
  Scenario Outline: a tag is accepted or rejected by the closed vocabulary
    Given a scenario carrying the tag "<tag>"
    When I run "aof work validate"
    Then the tag is <verdict>

    Examples:
      | tag           | verdict                                      |
      | @validate     | accepted (a configured domain tag)           |
      | @bug          | accepted (a universal lifecycle tag)         |
      | @wip          | accepted (a universal lifecycle tag)         |
      | @finding-K12  | accepted (a finding-lineage tag)             |
      | @bogus        | flagged: unknown tag outside the vocabulary  |
      | @milestone-03 | flagged: milestone membership is structural  |

  # The verification-count rule: a scenario's EFFECTIVE tags (feature-level tags
  # plus its own) must contain exactly one of @executable/@manual/@uat. The
  # universal lifecycle tags @bug/@wip are allowed vocabulary but are NOT
  # verification lanes — they never satisfy this rule on their own.
  Scenario Outline: a scenario must carry exactly one verification tag
    Given a scenario whose effective tags are "<tags>"
    When I run "aof work validate"
    Then it is <verdict>

    Examples:
      | tags                | verdict                          |
      | @executable         | accepted                         |
      | @manual             | accepted                         |
      | @uat                | accepted                         |
      | @executable @bug    | accepted                         |
      | @uat @finding-K12   | accepted                         |
      | (none)              | flagged: needs exactly 1, has 0  |
      | @bug                | flagged: needs exactly 1, has 0  |
      | @wip                | flagged: needs exactly 1, has 0  |
      | @executable @manual | flagged: needs exactly 1, has 2  |
      | @manual @uat        | flagged: needs exactly 1, has 2  |

  # Feature-level and scenario-level tags are summed into the "effective" set
  # before counting verification lanes.
  Scenario: a feature-level verification tag is inherited by a bare scenario
    Given a feature tagged "@executable" and a scenario carrying no tags of its own
    When I run "aof work validate"
    Then the scenario's effective verification tags are exactly one
    And no verification-count finding is reported for it

  Scenario: a feature lane plus a scenario lane sums to two and is flagged
    Given a feature tagged "@executable" and a scenario tagged "@manual"
    When I run "aof work validate"
    Then a finding reports that the scenario carries 2 verification tags
