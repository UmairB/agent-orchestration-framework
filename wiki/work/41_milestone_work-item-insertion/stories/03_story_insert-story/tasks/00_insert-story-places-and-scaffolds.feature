<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — the thin CLI command (ADR-002) `aof work insert-story`: opens a slot
# at local position SS in a target milestone's nested space (via the story-01 engine),
# then scaffolds the new STORY.md (+ empty tasks/) from .aof/templates/work/story/
# with correct identity frontmatter, including `parent = NN`.
# LITMUS: every Then is confirmable from `aof work insert-story --json` stdout plus a
# fresh `aof work find|list|validate --json` read afterward — no source read.
# Ref convention: --at/--under take BARE position/milestone integers (sameNum-
# normalised); a RESOLVED ref is the observable, zero-padded folder ref ("05/01")
# that --json/find echo verbatim (item.ref = "<milestone>/<story>" folder digits).

@cli @work @work-stream @executable
Feature: insert-story places a new story at local position SS under a milestone and scaffolds it from the same template add-story uses
  In order that a story discovered mid-refine lands before its rightful siblings instead of always at the tail
  aof work insert-story must open a slot at SS in the target milestone's stories space, shift every pre-existing sibling story that was >= SS up by one, and scaffold the new story at SS

  Background:
    Given a fixture work stream with milestone "05" having nested stories "05/00" (slug "alpha"), "05/01" (slug "bravo"), and "05/02" (slug "charlie")

  # Headline (PO): the new story lands at SS and every pre-existing sibling >= SS shifts up by one.
  Scenario: insert-story places the new story at SS and every pre-existing sibling story >= SS shifts up by exactly one
    When I run `aof work insert-story "auth-guard" --at 1 --under 5 --json`
    Then the command reports the new item's ref as "05/01"
    And a fresh `aof work find 05/01 --json` resolves a story with slug "auth-guard"
    And a fresh `aof work find 05/02 --json` resolves the story formerly at "05/01" (slug "bravo")
    And a fresh `aof work find 05/03 --json` resolves the story formerly at "05/02" (slug "charlie")

  # The new story is scaffolded from the SAME template add-story uses, with correct
  # identity frontmatter — confirmed through find (type/slug/parent) + validate
  # (number<->folder consistent, created/updated present), never a raw record-doc read.
  Scenario: the new story is scaffolded from the same template add-story uses, with correct identity frontmatter and parent
    When I run `aof work insert-story "auth-guard" --at 1 --under 5 --json`
    Then a fresh `aof work find 05/01 --json` reports type "story", slug "auth-guard", and parent "05"
    And the new story has an empty `tasks/` directory
    And a fresh `aof work validate --json` reports zero findings for the new story's record doc

  # QA Examples — the one-slot shift arithmetic across the boundary: head (SS=0, all
  # three shift), interior (SS=2, exactly one shifts), and append (SS=3, none shift).
  # The shift count is read straight from the --json envelope (ADR-004: `shifted` is
  # always reported), so the exact count is asserted, not inferred.
  Scenario Outline: inserting at SS places the new story at SS and shifts exactly the siblings that were >= SS up by one
    When I run `aof work insert-story "auth-guard" --at <at> --under 5 --json`
    Then a fresh `aof work find 05/<ss> --json` resolves a story with slug "auth-guard"
    And the --json envelope reports it shifted <shifted> sibling stories
    And a fresh `aof work validate --json` over the whole fixture stream reports zero findings

    Examples:
      | at | ss | shifted | case                          |
      | 0  | 00 | 3       | head — every sibling shifts   |
      | 2  | 02 | 1       | interior — one sibling shifts |
      | 3  | 03 | 0       | append — nothing shifts       |
