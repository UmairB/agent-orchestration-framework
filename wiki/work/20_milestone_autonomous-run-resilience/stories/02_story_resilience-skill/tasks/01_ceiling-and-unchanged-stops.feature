@cli @work @work-stream @manual
Feature: The attempt ceiling feeds the EXISTING maxAttempts stop and the loop adds no new stop condition
  In order that resilience makes the existing hand-backs reliable without fragmenting the operator's mental model of when the cascade stops
  the hardened loop maps the attempt ceiling onto the existing "maxAttempts exhausted" stop and leaves its <stop_conditions> set unchanged — still handing back only on a @uat gate, a blocker, a wrong/infeasible contract, an undefaultable decision, or maxAttempts exhausted,
  so that a genuinely-failing item halts instead of looping (the existing stop, now reliable) while no resilience mechanic silently invents a new hand-back (ADR-008).

  # ARCHITECTURE ADR-008 (no new stop — a CONSTRAINT over autonomous.md prose) + ADR-002
  # (the ceiling feeds the EXISTING maxAttempts stop). Story 02 owns NO fitness function;
  # this is review-asserted conformance + an agent-observed demonstration recorded in
  # VERIFICATION.md. The stop-set is read from autonomous.md <stop_conditions>; the
  # ceiling-halt behaviour is observed by driving the loop.
  # LITMUS: the <stop_conditions> set is read from the markdown; the halt is agent-observed
  # by driving the loop to the ceiling — agent-runnable, not a CI unit test → @manual.

  Background:
    Given the autonomous loop in src/bundle/commands/autonomous.md

  # The ceiling halt maps onto the EXISTING stop (ADR-002 → ADR-008): a retryable lineage
  # that keeps failing reaches work.autonomous.maxAttempts, and the loop hands back via
  # the EXISTING "maxAttempts exhausted" stop — it does not loop forever and does not
  # invent a new "ceiling hit" stop.
  Scenario: a lineage that exhausts maxAttempts halts via the existing maxAttempts-exhausted stop
    Given a retryable run for the current item that keeps failing on infra
    When the loop has resumed it up to work.autonomous.maxAttempts times
    Then the next run-retry returns "attempts-exhausted"
    And the loop hands back on the EXISTING "maxAttempts exhausted" stop
    And it does not add a new "ceiling hit" or "run reclaimed" stop

  # A reclaim is a RECOVERY, not a stop (ADR-008): reclaiming an orphaned run lets the
  # loop RESUME — it must not be added to <stop_conditions>. Status rollback likewise
  # feeds the existing next/blocked machinery, not a new stop.
  Scenario: reclaim and rollback recover the loop rather than stopping it
    Given the reclaim scan recovered an orphaned run and rolled its item back
    When the loop continues
    Then it resumes work via "aof work next" without handing back
    And neither reclaim nor rollback appears as a <stop_conditions> entry

  # The stop set is UNCHANGED (ADR-008): autonomous.md's <stop_conditions> still lists
  # exactly the five existing stops — this milestone adds none. The table enumerates the
  # frozen set so a stray addition is caught by review.
  # QA: one row per existing stop; "present and unchanged" = the entry is in
  # <stop_conditions> with its pre-milestone-20 meaning.
  Scenario Outline: the <stop_conditions> set is exactly the existing five, with no milestone-20 addition
    When the autonomous.md <stop_conditions> section is read
    Then the stop "<existing-stop>" is present and unchanged
    And no stop condition was added by milestone 20

    Examples: the five existing stops (ADR-008 — the frozen hand-back set)
      | existing-stop                            |
      | a @uat human-acceptance gate             |
      | a blocked result from aof work next      |
      | a wrong or infeasible locked contract    |
      | an undefaultable open decision           |
      | maxAttempts exhausted on the validate gate |

  # The closed-set bound (ADR-008): not only is each of the five present — the section
  # contains EXACTLY five and no sixth. The positive enumeration (five present, above) plus
  # this negative count bound is the 19-style closed-table discipline that catches a stray
  # milestone-20 addition.
  Scenario: the <stop_conditions> section contains exactly the five existing stops and no sixth
    When the autonomous.md <stop_conditions> section is read
    Then it lists exactly five stop conditions
    And every one is a pre-milestone-20 stop (no entry was added by this milestone)

  # The hardened loop still stops ONLY on those gates (ADR-008, the SPEC §Objective
  # conformance): a resilience event that is NOT one of the five (an infra retry, a
  # reclaim, a dedup rejection) is handled in-loop and never triggers a hand-back.
  Scenario Outline: a resilience event that is not one of the five gates is handled in-loop, never a hand-back
    Given the loop encounters "<event>"
    When it handles the event
    Then it does NOT hand control back
    And it continues the cascade

    Examples:
      | event                                   |
      | an infra failure resumed via run-retry  |
      | an orphaned run reclaimed at restart     |
      | a duplicate-run rejection from the store |
      | a self-trigger skipped by the anti-loop guard |
