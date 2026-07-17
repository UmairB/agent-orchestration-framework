<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — the engine's slot-open primitive: renaming every folder >= P up by
# one and bumping each shifted item's frontmatter `number` to match its new folder.
# LITMUS: every Then is confirmable from the fixture's on-disk state after the engine
# call — a fresh `aof work find|list --json` read for the FOLDER rename (folder-derived,
# zero-rebuild — 00/ADR-001), and a fresh `aof work validate --json` for the frontmatter
# `number` bump (validate asserts folder ↔ frontmatter number equality; find/list resolve
# on the FOLDER number ALONE and cannot see the frontmatter value). No source read. Story
# 01 has NO command surface (STORY.md testing note) — the engine is called directly via
# its API, but the OUTCOME is read back through the existing, unmodified `find`/`list`/
# `validate` CLI reads against the fixture on disk.

@cli @work @work-stream @executable
Feature: reindexForInsert opens a slot at P by renaming every item >= P up by exactly one and bumping its frontmatter number to match
  In order that inserting a new item at position P never leaves a gap, a collision, or a stale number
  the engine must rename every folder numbered >= P in the target space up by one and rewrite that item's frontmatter `number` to match its new folder name

  Background:
    Given a fixture work stream with top-level items numbered 00 through 05, each with a valid record doc

  # Headline: opening a slot in the middle of the stream shifts only the items at/after P.
  Scenario: opening a slot at P renames every item >= P up by exactly one, leaving earlier items untouched
    When I open a slot at position 3 in the "top-level" space
    Then the item that was folder "03_milestone_<slug>" is now folder "04_milestone_<slug>"
    And the item that was folder "04_milestone_<slug>" is now folder "05_milestone_<slug>"
    And the item that was folder "05_milestone_<slug>" is now folder "06_milestone_<slug>"
    And the items previously numbered "00", "01", and "02" still occupy their original folders

  # Headline: the frontmatter number is bumped to match the new folder for every shifted
  # item — confirmed by validate, which asserts folder ↔ frontmatter number equality (find
  # resolves on the folder number alone, so it proves the RENAME, not the frontmatter bump).
  Scenario: opening a slot bumps each shifted item's frontmatter number to match its new folder
    When I open a slot at position 3 in the "top-level" space
    Then a fresh `aof work find 4 --json` resolves (by slug) the item that was numbered "03"
    And a fresh `aof work find 6 --json` resolves (by slug) the item that was numbered "05"
    And a fresh `aof work find 3 --json` resolves nothing that predates the insert
    And a fresh `aof work validate --json` reports no folder-vs-frontmatter-number finding for any shifted item

  # The shift is exact — no gap is left at P, no item is double-shifted, and no two
  # items collide on the same number afterward.
  Scenario Outline: the shift is exactly one slot — no gaps, no collisions, no double-shift
    When I open a slot at position <at> in the "top-level" space
    Then every item that was numbered <at> or higher is now numbered exactly one higher than before
    And no two items in the space share the same number
    And slot <at> is empty, ready for the new item to occupy
    And a fresh `aof work validate --json` reports zero findings across the fixture stream

    Examples:
      | at |
      | 0  |
      | 3  |
      | 5  |
      | 6  |

  # Inserting past the end of the stream (P greater than every existing number) is a
  # well-defined no-op shift — nothing renames, and the new item simply lands at P.
  Scenario: opening a slot beyond the highest existing number shifts nothing
    When I open a slot at position 9 in the "top-level" space
    Then no existing item's folder or frontmatter number changes
    And slot 9 is empty, ready for the new item to occupy
