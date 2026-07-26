<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — countShiftedByInsert(workDir, { at, space }): a pure projection over
# listItems returning how many items in the target space have number >= P, reading no
# config and prompting nothing (ADR-004). The slot-open reuses this SAME primitive, so
# the count the command warns/reports (stories 02/03) is always the count that actually shifts.
# LITMUS: every Then is confirmable from the primitive's returned count, cross-checked
# against a fresh `aof work list --json` count of items actually renamed after a slot-open
# — no source read.

@cli @work @work-stream @executable
Feature: countShiftedByInsert deterministically reports how many items a slot-open at P would shift, before anything is renamed
  In order that a caller can know the blast radius of an insert before committing to it
  the engine must expose a pure count primitive that returns exactly how many items in the target space have number >= P, without renaming anything

  Background:
    Given a fixture work stream with top-level items numbered 00 through 05
    And item "02" is a milestone with nested stories "02/00", "02/01", and "02/02"

  # Headline: the count matches the number of top-level items that would actually shift
  # (count = 6 - at for the 00-05 fixture). Boundaries: at 0 (all six shift), at 5 (only
  # the last item shifts), at 6 = max+1 (nothing shifts).
  Scenario Outline: the count primitive reports exactly the number of top-level items at/after P
    When I ask how many items would shift for an insert at position <at> in the "top-level" space
    Then the reported count is <count>
    And no folder or frontmatter number has changed

    Examples:
      | at | count |
      | 0  | 6     |
      | 3  | 3     |
      | 5  | 1     |
      | 6  | 0     |

  # The count is SPACE-scoped: a nested count under a milestone counts ONLY that
  # milestone's own stories/SS items, never the top-level stream — proving the `{ space }`
  # selector filters correctly. Milestone "02" has three nested stories (02/00, 02/01,
  # 02/02); two are >= SS 1, so the count is 2, not 2 + any top-level items.
  Scenario: a nested count counts only the target milestone's own stories, not top-level items
    When I ask how many items would shift for an insert at position 1 in the "nested" space under milestone "02"
    Then the reported count is 2
    And no folder or frontmatter number has changed

  # The count is read-only — calling it never mutates the fixture stream.
  Scenario: calling the count primitive mutates nothing
    When I ask how many items would shift for an insert at position 2 in the "top-level" space
    Then a fresh `aof work list --json` over the fixture stream is unchanged from before the call

  # The one-source-of-truth guarantee (ADR-004): the count the primitive reports for a
  # given P equals the number of items the slot-open at that same P actually renames.
  Scenario: the count primitive's answer equals the number of items a slot-open at the same P actually shifts
    Given I ask how many items would shift for an insert at position 3 in the "top-level" space, and record the reported count
    When I open a slot at position 3 in the "top-level" space
    Then the number of items actually renamed equals the previously recorded count
