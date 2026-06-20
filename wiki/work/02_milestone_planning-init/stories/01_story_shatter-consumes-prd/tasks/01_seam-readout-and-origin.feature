@cli @adapter @planning
Feature: The seam read-out is consumable and shatter stamps origin back to the PRD
  In order to prove the planning→delivery seam carries a real PRD into framed milestones, one-directional
  the read-out (objective / scope / milestone chunks) must be extractable from a PRD, and each produced SPEC must trace back to it.

  # ACD owns the CONTRACT of the seam, not the PRD's format (wiki/planning.md, "What the seam
  # requires"). This feature mixes lanes, so the verification tag is per-scenario (no feature-level
  # lane to inherit): the @executable scenarios pin what "a PRD the seam can consume" means against the
  # fixture (the read-out is present and extractable); the actual shatter (PRD → SPECs) is agent
  # behaviour run from src/bundle/commands/shatter.md, so it is @manual, verified by procedure in
  # UAT.md (which points back here with `verifies →`), not asserted as if aof CLI code produced it.

  Background:
    Given the representative "PRD-acme-notify.md" fixture in this story's "fixtures/" folder

  # --- The seam read-out: what makes a PRD consumable (A4 / wiki/planning.md). @executable: the
  #     fixture is parsed and the three read-out elements are asserted present and extractable.
  @executable
  Scenario: the PRD exposes an objective the read-out can extract
    When the seam read-out is taken from the fixture
    Then it yields a non-empty objective statement

  @executable
  Scenario: the PRD exposes a scope with both an in-list and an out-list
    When the seam read-out is taken from the fixture
    Then it yields a scope with at least one in-scope item and at least one out-of-scope item

  @executable
  Scenario: the PRD exposes at least two milestone-sized chunks
    When the seam read-out is taken from the fixture
    Then it yields two or more distinct milestone-sized chunks

  # The three read-out elements the seam requires, each asserted present in the fixture. A row absent
  # from the read-out means the PRD is NOT consumable — that is the contract this table pins.
  @executable
  Scenario Outline: the seam read-out surfaces each required element
    When the seam read-out is taken from the fixture
    Then <element> is present and extractable

    Examples:
      | element                                  |
      | the initiative objective (the "why")     |
      | the in-scope list                        |
      | the out-of-scope list                    |
      | two or more milestone-sized chunks       |

  # --- Shatter producing SPECs with origin: agent-run behaviour, so @manual. The procedure lives in
  #     the milestone UAT.md, which points back here with `verifies →`.
  @manual
  Scenario: shatter produces one milestone SPEC per identified chunk
    Given the fixture exposes a read-out with two or more milestone-sized chunks
    When "aof:shatter" is run over the fixture
    Then one milestone "SPEC.md" is written per identified chunk
    And each SPEC carries an objective and an in/out scope

  @manual
  Scenario: each produced SPEC stamps origin back to the PRD it was shattered from
    When "aof:shatter" is run over the fixture
    Then each produced milestone "SPEC.md" frontmatter carries an "origin:" pointing at the consumed PRD

  @manual
  Scenario: the seam is one-directional — the PRD is not edited back
    When "aof:shatter" is run over the fixture
    Then the consumed PRD's contents are unchanged after the shatter
    And the SPECs reference the PRD as origin without restating it
