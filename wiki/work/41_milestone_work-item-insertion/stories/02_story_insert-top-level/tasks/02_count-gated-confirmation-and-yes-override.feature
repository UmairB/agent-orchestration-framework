<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — ADR-004's count-gated confirmation guard at the command boundary:
# below a documented threshold the insert proceeds automatically; at/above it, the
# command warns the operator the re-order is costly and requires explicit intent
# (`--yes`, alias `--force`); above-threshold without `--yes` on a non-interactive
# caller FAILS LOUD and coded rather than hanging on an unanswered prompt.
# Pinned default (Three Amigos, this refine): the documented threshold is 5 — a
# couple of shifted items is routine; five or more is the re-order the operator
# should consciously confirm. Resolved from config with a named default, never the
# config-editor whitelist.
# LITMUS: every Then is confirmable from `aof work insert-milestone|insert-uat --json`
# stdout/exit code plus a fresh `aof work find|list --json` read afterward — no
# source read.

@cli @work @work-stream @executable
Feature: an insert whose shift count is below the threshold proceeds automatically; at/above it, the operator must confirm via --yes, and a non-interactive caller without --yes fails loud instead of hanging
  In order that a routine insert is never needlessly interrupted, while a costly re-order is never silently applied without the operator's knowledge
  aof work insert-milestone/insert-uat must compare the engine's shift count to a documented threshold and gate accordingly

  Background:
    Given a fixture work stream with top-level items numbered 00 through 09
    And the configured shift-confirmation threshold is 5

  # Headline: a small shift proceeds automatically, no confirmation needed.
  # (insert at 7 shifts items 07,08,09 = 3 items, below the threshold of 5.)
  Scenario: an insert whose shift count is below the threshold proceeds automatically
    When I run `aof work insert-milestone "widget-support" --at 7 --json`
    Then the command succeeds without requiring `--yes`
    And the new item occupies ref "7"

  # Headline: a large shift on a non-interactive caller without --yes fails loud and
  # coded. (insert at 2 shifts items 02..09 = 8 items, at/above the threshold.)
  Scenario: an insert whose shift count is at/above the threshold, run non-interactively without --yes, fails loud with a coded error
    When I run `aof work insert-milestone "widget-support" --at 2 --json` non-interactively, without `--yes`
    Then the command fails with a coded error naming the number of items the re-order would shift
    And a fresh `aof work list --json` shows every pre-existing item still at its original ref (the aborted insert changed nothing)

  # Headline: --yes asserts intent and proceeds regardless of count.
  Scenario: --yes proceeds with an at/above-threshold insert regardless of count
    When I run `aof work insert-milestone "widget-support" --at 2 --yes --json`
    Then the command succeeds
    And the new item occupies ref "2"
    And every pre-existing item that was >= 2 has shifted up by exactly one

  # --force is a documented alias for --yes.
  Scenario: --force is accepted as an alias for --yes
    When I run `aof work insert-milestone "widget-support" --at 2 --force --json`
    Then the command succeeds without an error about missing confirmation

  # The exact threshold boundary: at the threshold count itself, confirmation is
  # required (>=, not >); one below it is not. Fixture 00-09, threshold 5:
  #   at 6 -> items 06,07,08,09 shift = 4 (< 5) -> proceeds
  #   at 5 -> items 05,06,07,08,09 shift = 5 (>= 5) -> confirmation required
  Scenario Outline: the threshold boundary is inclusive — exactly the threshold count requires confirmation, one fewer does not
    When I run `aof work insert-milestone "widget-support" --at <at> --json` non-interactively, without `--yes`
    Then the command <outcome>

    Examples:
      | at | outcome                                          |
      | 6  | succeeds without requiring --yes (4 items shift) |
      | 5  | fails with a coded error (5 items shift)         |

  # --yes on a below-threshold insert is accepted as a harmless no-op flag — passing
  # intent early never breaks the routine path. (insert at 8 shifts 08,09 = 2 items.)
  Scenario: --yes on a below-threshold insert is accepted without error
    When I run `aof work insert-milestone "widget-support" --at 8 --yes --json`
    Then the command succeeds
