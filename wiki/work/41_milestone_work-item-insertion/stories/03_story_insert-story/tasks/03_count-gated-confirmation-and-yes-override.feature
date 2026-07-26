<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — ADR-004's count-gated confirmation guard, on the NESTED axis: the
# same guard shape as story 02's top-level guard (below threshold proceeds
# automatically; at/above requires `--yes`/`--force`; above-threshold without
# `--yes` on a non-interactive caller fails LOUD and coded), but the count is scoped
# to ONE milestone's own sibling stories, not the whole top-level stream.
# Pinned default (Three Amigos, this refine, SAME constant as story 02): 5.
# Gate semantics (ADR-004): shifted < 5 proceeds automatically; shifted >= 5 gates
# (the threshold value itself gates). Boundary pinned below at SS=6 (4 shifts, auto)
# vs SS=5 (5 shifts, gated).
# LITMUS: every Then is confirmable from `aof work insert-story --json` stdout/exit
# code plus a fresh `aof work find|list --json` read afterward — no source read. The
# shift count is ALWAYS in the --json envelope (ADR-004), so the exact count is
# asserted directly rather than inferred.

@cli @work @work-stream @executable
Feature: a nested insert whose sibling-shift count is below the threshold proceeds automatically; at/above it, the operator must confirm via --yes, scoped to the target milestone's own stories
  In order that inserting a story is never needlessly interrupted for a small milestone, while inserting into a large milestone's story list is never silently applied
  aof work insert-story must compare the engine's nested-space shift count (siblings under the target milestone only) to the documented threshold and gate accordingly

  Background:
    Given milestone "05" has nested stories "05/00" through "05/09"
    And the configured shift-confirmation threshold is 5

  # QA Examples — BELOW the threshold proceeds automatically. Boundary pinned at SS=6:
  # siblings >= 6 are {06,07,08,09} = 4 shifts, exactly one below the threshold of 5.
  Scenario Outline: an insert-story whose sibling-shift count is below the threshold proceeds automatically without --yes
    When I run `aof work insert-story "auth-guard" --at <at> --under 5 --json`
    Then the command succeeds without requiring `--yes`
    And a fresh `aof work find 05/<ss> --json` resolves the new story with slug "auth-guard"
    And the --json envelope reports it shifted <shifted> sibling stories

    Examples:
      | at | ss | shifted |
      | 9  | 09 | 1       |
      | 8  | 08 | 2       |
      | 6  | 06 | 4       |

  # QA Examples — AT/ABOVE the threshold, run non-interactively without --yes, fails
  # LOUD and coded, naming the shift count, and mutates NOTHING. Boundary pinned at
  # SS=5: siblings >= 5 are {05,06,07,08,09} = 5 shifts = the threshold (at/above gates).
  Scenario Outline: an insert-story whose sibling-shift count is at/above the threshold, run non-interactively without --yes, fails loud with a coded error naming the count
    When I run `aof work insert-story "auth-guard" --at <at> --under 5 --json` non-interactively, without `--yes`
    Then the command fails with a coded error naming <shifted> as the number of sibling stories the re-order would shift
    And a fresh `aof work list --json` shows milestone "05"'s stories unchanged at refs "05/00" through "05/09"

    Examples:
      | at | shifted |
      | 5  | 5       |
      | 2  | 8       |
      | 0  | 10      |

  # Headline: --yes proceeds regardless of count, and the shift is applied + reported.
  Scenario: --yes proceeds with an at/above-threshold nested insert regardless of count
    When I run `aof work insert-story "auth-guard" --at 2 --yes --under 5 --json`
    Then the command succeeds
    And a fresh `aof work find 05/02 --json` resolves the new story with slug "auth-guard"
    And the --json envelope reports it shifted 8 sibling stories
    And a fresh `aof work list --json` shows milestone "05" now holding eleven stories at refs "05/00" through "05/10"

  # Scoping: the count is the TARGET milestone's OWN siblings — a large sibling count
  # under a DIFFERENT milestone never gates an insert into a small one. Milestone 05
  # has ten stories (would gate); milestone 06 has three, so inserting under 06 shifts
  # only 06's two siblings >= 1 and proceeds automatically even without --yes.
  Scenario: the shift count is scoped to the target milestone's own siblings, not the whole stream
    Given milestone "06" has nested stories "06/00" through "06/02"
    When I run `aof work insert-story "small-fix" --at 1 --under 6 --json` non-interactively, without `--yes`
    Then the command succeeds without requiring `--yes`
    And a fresh `aof work find 06/01 --json` resolves the new story with slug "small-fix"
    And the --json envelope reports it shifted 2 sibling stories, scoped to milestone "06"
