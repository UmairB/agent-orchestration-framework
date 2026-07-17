<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — ADR-004's envelope guarantee: `--json` always carries the shifted
# count (`{ shifted: N, at: P, space, ... }`), whether or not confirmation was
# required, so a caller (or a review step) can see the blast radius of an insert
# without parsing human output.
# LITMUS: every Then is confirmable from `aof work insert-milestone|insert-uat --json`
# stdout, plus a fresh `aof work list --json` read to count what actually moved — no
# source read.

@cli @work @work-stream @executable
Feature: the --json envelope always reports the shifted count, at, and space, whether the insert proceeded silently or via --yes
  In order that an automated caller can see the blast radius of an insert without parsing human-readable output
  aof work insert-milestone/insert-uat's --json envelope must always report the number of items shifted, the target position, and the number space

  Background:
    Given a fixture work stream with top-level items numbered 00 through 09
    And the configured shift-confirmation threshold is 5

  # Headline: a below-threshold insert still reports the exact shifted count.
  # (insert at 8 shifts items 08,09 = 2 items — below the threshold of 5.)
  Scenario: a below-threshold insert reports the exact shifted count in the json envelope
    When I run `aof work insert-milestone "widget-support" --at 8 --json`
    Then the json envelope includes `shifted: 2`
    And the json envelope includes `at: 8`
    And the json envelope includes the top-level space identifier

  # Headline: an above-threshold insert run with --yes still reports the exact shifted
  # count. (insert at 2 shifts items 02..09 = 8 items.)
  Scenario: an above-threshold insert run with --yes reports the exact shifted count in the json envelope
    When I run `aof work insert-milestone "widget-support" --at 2 --yes --json`
    Then the json envelope includes `shifted: 8`

  # The reported count matches the number of items actually renamed — the operator
  # is never told a different number than the one that moved (ADR-004's
  # one-source-of-truth guarantee, carried through to the command's own output).
  # (insert at 4 shifts items 04..09 = 6 items.)
  Scenario: the reported shifted count equals the number of items actually renamed
    When I run `aof work insert-milestone "widget-support" --at 4 --yes --json`
    Then the json envelope's `shifted` value equals the number of pre-existing items whose ref changed as a result
