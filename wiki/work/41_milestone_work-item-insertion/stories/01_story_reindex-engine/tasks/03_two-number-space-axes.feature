<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — ADR-005's two number-space axes selected by `{ space }`: "top-level"
# (milestone/uat/spike/chore share one space; a shift there drags depends + nested-story
# parent rewrites) vs "nested" (a milestone's own stories/SS space; a shift there is
# local to that milestone, touches no depends, and leaves parent unchanged).
# LITMUS: every Then is confirmable from a fresh `aof work find|list --json` read of
# the fixture stream after the engine call — no source read.

@cli @work @work-stream @executable
Feature: the engine selects between the top-level and nested number spaces, each shifting only its own items
  In order that a nested-story insert never disturbs unrelated milestones and a top-level insert never disturbs a milestone's internal story order
  the engine must confine a "top-level" slot-open to top-level items and a "nested" slot-open to one milestone's own stories/SS space

  Background:
    Given a fixture work stream with top-level items numbered 00 through 03
    And item "02" is a milestone with nested stories "02/00", "02/01", and "02/02"
    And item "03" is a milestone with nested stories "03/00" and "03/01"

  # Headline: a top-level slot-open shifts top-level items only, leaving every
  # milestone's own nested numbering exactly as it was.
  Scenario: a top-level slot-open shifts only top-level items, leaving every milestone's nested story numbers untouched
    When I open a slot at position 2 in the "top-level" space
    Then the milestone that was "02" is now renumbered, but its nested stories are still locally numbered "00", "01", and "02"
    And the milestone that was "03" is now renumbered, but its nested stories are still locally numbered "00" and "01"

  # Headline: a nested slot-open shifts only the target milestone's own stories,
  # leaving every other milestone and every top-level item untouched.
  Scenario: a nested slot-open shifts only the target milestone's own stories, leaving other milestones and top-level items untouched
    When I open a slot at position 1 in the "nested" space under milestone "02"
    Then story "02/01" is now "02/02" and story "02/02" is now "02/03"
    And story "02/00" is still "02/00"
    And milestone "03" and its nested stories "03/00" and "03/01" are unchanged
    And no top-level item's number changes

  # The two axes are independent — a nested insert under one milestone does not
  # interact with a nested insert under a sibling milestone.
  Scenario: nested slot-opens under different milestones are independent of each other
    When I open a slot at position 1 in the "nested" space under milestone "02"
    Then milestone "03"'s nested stories "03/00" and "03/01" are unchanged
