<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — the Tier 1 (ADR-003) guarantee: after a top-level slot-open, every
# stored `depends` and nested-story `parent` that pointed at a shifted item now
# points at its NEW number, the depends graph stays acyclic, and `aof work validate`
# is green with no manual repair.
# LITMUS: every Then is confirmable from the fixture's on-disk state after the engine
# call — a fresh `aof work validate --json` (it asserts every `depends`/`parent`
# RESOLVES and the graph is acyclic), a fresh `aof work find --json` (folder-derived
# resolution of a shifted ref), or reading the referencing item's record-doc frontmatter
# line (the exact rewritten `depends`/`parent` VALUE — which find/list --json do NOT
# expose). No read of the engine's own source.

@cli @work @work-stream @executable
Feature: opening a slot in the top-level space rewrites every depends/parent reference that pointed at a shifted item, and leaves the stream validate-green
  In order that an insert never leaves a dangling reference or a validate regression
  the engine must rewrite every stored `depends` and nested-story `parent` value that pointed at a shifted top-level item to that item's new number

  Background:
    Given a fixture work stream with top-level items numbered 00 through 05
    And item "04" is a milestone with nested story "04/00"
    And item "05" declares `depends: [2]`

  # Headline: a depends edge that pointed at a shifted driver now points at its new number.
  Scenario: a depends value pointing at a shifted top-level item is rewritten to the item's new number
    When I open a slot at position 2 in the "top-level" space
    Then the item that was "05" (now renumbered) still declares a depends value equal to the new number of the item that was "02"
    And a fresh `aof work validate --json` reports zero findings for that item's record doc

  # Headline: a nested story's parent is rewritten when its owning milestone shifts.
  Scenario: a nested story's parent is rewritten when its owning milestone shifts
    When I open a slot at position 2 in the "top-level" space
    Then the story that was "04/00" now resolves under its milestone's new number
    And a fresh `aof work find` for that story's new ref returns exactly one result
    And a fresh `aof work validate --json` reports zero findings for that story's record doc

  # A depends/parent value that did NOT point at a shifted item is left untouched —
  # the rewrite is surgical, targeting only references that actually moved.
  Scenario: a depends or parent value that did not point at a shifted item is left unchanged
    Given item "05" declares `depends: [0]`
    When I open a slot at position 3 in the "top-level" space
    Then the item that was "05" still declares a depends value equal to "0" unchanged

  # A depends LIST with some entries pointing at a shifted driver and some not: only the
  # shifted entries are rewritten, the rest are left as-is — the rewrite is per-reference,
  # not a whole-list replace (a classic partial-rewrite / off-by-one surface). Insert at 2
  # shifts the driver that was "4" to "5"; the entry "1" (below P) is untouched.
  Scenario: a multi-entry depends list rewrites only the entries that pointed at a shifted driver
    Given item "05" declares `depends: [1, 4]`
    When I open a slot at position 2 in the "top-level" space
    Then the item that was "05" now declares a depends value listing "1" (unchanged) and "5" (the new number of the item that was "4")
    And a fresh `aof work validate --json` reports zero findings for that item's record doc

  # The whole-stream payoff (ADR-003 Tier 1, the acceptance bar): after any insert,
  # aof work validate is green with no manual repair.
  Scenario: aof work validate is green across the whole fixture stream after an insert, with no manual repair
    When I open a slot at position 2 in the "top-level" space
    Then a fresh `aof work validate --json` over the whole fixture stream reports zero findings

  # The depends graph stays acyclic — a renumber is a bijective relabel, asserted not assumed.
  Scenario: the depends graph stays acyclic after a top-level insert
    Given item "03" declares `depends: [1]`
    And item "01" declares `depends: [0]`
    When I open a slot at position 2 in the "top-level" space
    Then a fresh `aof work validate --json` reports no depends-cycle finding

  # The nested space does NOT touch depends or parent — ADR-005 scopes reference
  # rewriting to the top-level axis only; a nested insert's parent is unchanged
  # because the owning milestone itself did not move.
  Scenario: opening a slot in the nested space rewrites no depends and no parent
    Given item "04" is a milestone with nested stories "04/00" and "04/01"
    When I open a slot at position 1 in the "nested" space under milestone "04"
    Then the story that was "04/00" still declares parent "04"
    And no top-level item's depends value changes
