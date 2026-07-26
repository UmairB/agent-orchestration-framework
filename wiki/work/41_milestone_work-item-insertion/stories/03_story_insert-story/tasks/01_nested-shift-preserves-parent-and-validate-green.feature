<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — ADR-003 Tier 1 on the nested axis (STORY.md AC3): after a nested
# insert, the new story occupies SS, every pre-existing sibling that was >= SS moved
# up by exactly one, each shifted story's frontmatter `number` matches its new
# folder, `parent` still resolves to the (unchanged) milestone, and `aof work
# validate` is green — with near-zero cost since a story carries no `depends` and
# its milestone did not move (ADR-005).
# LITMUS: every Then is confirmable from a fresh `aof work find|list|validate --json`
# read of the fixture stream after the command runs — no source read. A story's
# frontmatter number<->folder and parent are asserted THROUGH validate + find's
# ref/parent fields (their observable projections). NOTE: `depends` values are NOT
# echoed by find|list|validate, so scenario 4 asserts the no-rewrite invariant via
# the observable proxy "no top-level ref moved + validate green" (see report).

@cli @work @work-stream @executable
Feature: a nested insert leaves every shifted sibling's parent resolving to the same milestone and the stream validate-green
  In order that inserting a story never disturbs its milestone's identity or the stream's correctness bar
  aof work insert-story must leave every shifted sibling story's parent unchanged and every frontmatter number matching its new folder, with aof work validate green afterward

  Background:
    Given a fixture work stream with milestone "05" having nested stories "05/00" (slug "alpha"), "05/01" (slug "bravo"), and "05/02" (slug "charlie")

  # Headline: every shifted sibling's parent is unchanged — the milestone itself did not move.
  Scenario: every shifted sibling story's parent still resolves to the same, unchanged milestone
    When I run `aof work insert-story "auth-guard" --at 1 --under 5 --json`
    Then a fresh `aof work find 05/02 --json` resolves the story formerly at "05/01" (slug "bravo") with parent "05"
    And a fresh `aof work find 05/03 --json` resolves the story formerly at "05/02" (slug "charlie") with parent "05"

  # Headline: each shifted sibling's frontmatter number matches its new folder — the
  # exact folder<->number consistency validate enforces (ADR-003 Tier 1).
  Scenario: each shifted sibling story's frontmatter number matches its new folder name
    When I run `aof work insert-story "auth-guard" --at 1 --under 5 --json`
    Then a fresh `aof work find 05/02 --json` resolves slug "bravo" at its new folder slot "02"
    And a fresh `aof work find 05/03 --json` resolves slug "charlie" at its new folder slot "03"
    And a fresh `aof work validate --json` reports no folder-vs-number finding for either shifted sibling

  # The acceptance bar: aof work validate is green over the whole stream, no manual repair.
  Scenario: aof work validate is green over the whole stream after a nested insert, with no manual repair
    When I run `aof work insert-story "auth-guard" --at 1 --under 5 --json`
    Then a fresh `aof work validate --json` over the whole fixture stream reports zero findings

  # The near-zero-cost claim made concrete: a nested insert touches no top-level
  # item's number and rewrites no depends edge anywhere in the stream. Observable
  # proxy: no top-level ref moves in `list`, and validate stays green — so no depends
  # TARGET moved and none dangles (depends values themselves are not echoed by find|list).
  Scenario: a nested insert changes no top-level item's number and rewrites no depends edge
    Given the fixture stream also has top-level items "00" through "04" and item "03" declares `depends: [01]`
    When I run `aof work insert-story "auth-guard" --at 1 --under 5 --json`
    Then a fresh `aof work list --json` shows every top-level item's ref unchanged at "00" through "04"
    And a fresh `aof work validate --json` over the whole stream reports zero findings and no dangling depends
