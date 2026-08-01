<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — STORY AC7: ONE predicate, TWO renderings, and the choice between
# them is decided here rather than at each call site. An OPERATOR VERB (a mint, a
# second assignment, a control-side mutation) is refused — coded, loud, non-zero: a
# human asked and gets an answer. An AUTOMATIC PERIODIC TICK (the control node's
# publish, ADR-004) SKIPS the rows it does not own, COUNTS the skips in its result,
# and emits no refusal at all — a coded refusal per held item per tick is log spam,
# and the tick asked nothing.
#
# LITMUS. The operator half is read from a command's exit status and `--json`
# envelope. The automatic half is read from two places an outsider can reach without
# any source: (a) the publish result envelope the tick returns — asserted through the
# global mesh status read for the row values and through the launcher's own reported
# propagation result for the counter; (b) the node log, `aof mesh logs --node <control>`,
# which must contain ZERO lines carrying `item-locked-by-assignment` however many
# ticks elapse. The "log spam" claim is only falsifiable as a count over several
# ticks, which is why the third scenario runs three of them.
#
# FEASIBILITY / SEAM NOTE — read before building.
#  1. The publish tick's own wiring lives in `global-work-store.mjs` /
#     `mesh-launcher.mjs`, which belong to `02_story_cache-authority` (ADR-004's
#     contention paragraph; the two wave-1 stories touch disjoint modules — ADR-009).
#     THIS story owns the predicate and the operator-vs-automatic DECISION; the tick
#     is its first consumer. If the two stories land out of order, the automatic-half
#     scenarios here are the acceptance contract cache-authority builds against, and
#     should be run at that story's verify rather than duplicated there.
#  2. NAME COLLISION, measured at HEAD: `publishWorkspaceSnapshot` already returns
#     `{ workspaceId, itemCount, skipped, publishedAt }` where `skipped` counts
#     PROJECTION ERRORS. A lock-skip counter must NOT reuse that key — two different
#     skips summed into one number is a defect, not a variant. An additive, distinctly
#     named counter is required (indicatively `heldSkipped`, with the held refs listed
#     beside it so the count is explainable). The scenarios below name it as such.
#  3. There is no fabricated surface here: every operator command used already exists.

@executable @cli @work @distribution
Feature: an operator asking is refused loudly; an automatic tick skips quietly and counts
  In order that a human who asks about a held item always gets an answer, while a background loop that asked nothing never fills the log with refusals it cannot act on
  the one lock predicate must render as a coded, non-zero refusal for an operator verb and as a counted, silent skip for the control node's periodic publish

  Background:
    Given an isolated global mesh store (a fresh AOF_GLOBAL_HOME) holding one published workspace
    And that workspace's work stream contains milestones "42", "43" and "44", with stories "42/01", "42/02" and "42/03"
    And ACTIVE assignments held by node "aof-wsl" for "42" and "43", both in state "running"
    And milestone "44" is held by nobody
    And a second registered, eligible worker node "worker-b" that holds the workspace's published repo

  # Headline, the operator half: a human asked, so a human gets an answer.
  Scenario Outline: an operator verb against a held item is refused, coded and loud
    When I run <command>
    Then the process exit status is non-zero
    And the envelope reports code "item-locked-by-assignment" naming holder "aof-wsl"
    And the refusal is reported exactly ONCE for the one command

    Examples:
      | verb                    | command                                                           |
      | a mint                  | `aof work run-start 42/03 --json`                                 |
      | a second assignment     | `aof mesh assign 42/03 --to worker-b --json`                      |
      | a control-side mutation | `aof work insert-story lock-probe --at 1 --under 42 --yes --json` |

  # Headline, the automatic half: the tick did not ask, so it is not answered — it
  # steps over what it does not own, counts it, and finishes successfully.
  Scenario: the control node's periodic publish skips the held rows, counts them, and succeeds
    When the control node's periodic publish tick runs once
    Then the tick completes successfully — it is not refused and it does not fail
    And its result counts 2 held rows skipped, naming "42" and "43"
    And that count is reported separately from the tick's pre-existing projection-error count
    And no line carrying "item-locked-by-assignment" appears in `aof mesh logs --node <the control node>`

  # The skip is SURGICAL: one held row does not stop the tick doing its job for every
  # other row. This is the difference between a skip and an abort.
  Scenario: the same tick still publishes every unheld row
    Given milestone "44"'s local record doc has just been edited on the control node
    When the control node's periodic publish tick runs once
    Then the row for "44" read back through the global mesh status read reflects the edit
    And the rows for "42" and "43" are unchanged by that tick
    And the tick's held-skip count is 2

  # The log-spam property, which is the whole reason the two renderings differ, is a
  # property of REPEATED ticks and can only be falsified by running several.
  Scenario: three consecutive ticks produce three counted results and zero refusal log lines
    When the control node's periodic publish tick runs three times
    Then each of the three results counts 2 held rows skipped
    And the count does not accumulate across ticks — it is per-tick, never a running total
    And `aof mesh logs --node <the control node>` contains ZERO lines carrying "item-locked-by-assignment"
    And an operator running `aof work run-start 42 --json` at any point during those ticks still gets exactly one coded refusal

  # "Refused mid-phase, allowed at a gate" (STATE, settled 2026-08-01) made observable
  # from both renderings at once.
  Scenario: when the phase ends, the operator verb succeeds and the tick stops counting a skip
    Given `aof work insert-story lock-probe --at 1 --under 42 --yes --json` has been refused with "item-locked-by-assignment"
    When the assignment holding "42" settles to state "done"
    And the control node's periodic publish tick runs once
    Then the tick's held-skip count is 1 — only "43" remains held
    And re-running `aof work insert-story lock-probe --at 1 --under 42 --yes --json` now succeeds
    And a fresh `aof work validate --json` reports zero findings

  # No regression: with nothing held, the tick's result is shaped exactly as it is at
  # HEAD, and its pre-existing counter still counts what it always counted.
  Scenario: with no active assignment, the tick's result is shaped exactly as it was before the lock existed
    Given no rows at all in global_assignments for this workspace
    When the control node's periodic publish tick runs once
    Then its held-skip count is 0 and it names no held refs
    And its pre-existing projection-error count still reports the projection errors, unchanged
    And every row in the workspace is published
