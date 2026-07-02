@cli @work @work-stream @executable
Feature: rollbackItemStatus is the first item-status writer, bounded in-progress to not-started or blocked, never to done
  In order that a failed or reclaimed run leaves the work stream honest rather than parked in-progress over abandoned work
  work.mjs gains its first item-frontmatter writer — rollbackItemStatus — bounded to set status only from in-progress to not-started or blocked, touching only the status field, via the atomic writeText; wired into the failed-run and reclaim paths so a rolled-back item re-enters the ready pool,
  so that the PRD's "in_progress → todo" rollback (g) is realised in aof's vocabulary (todo ≡ not-started) as the one narrowly-bounded status write, never a path to falsely accepting un-done work as done.

  # ARCHITECTURE ADR-005: rollbackItemStatus(item, toStatus, { now }) in src/work.mjs —
  # the FIRST programmatic item-status mutation in the codebase (work.mjs exported only
  # readers). It is a deliberate, acknowledged departure from 03/ADR-004 (the board never
  # writes status) — a different, non-board actor — so it carries its OWN bounding fitness
  # function (acd-status-rollback-bounded, this story owns it). The STRUCTURAL bounding +
  # the "only item-status writer" family-grep is that arch-test; this feature is the
  # OBSERVABLE behaviour.
  # LITMUS: the written status, the byte-unchanged body/other-frontmatter, the rejection,
  # and the aof-work-next re-offer are all observable over a controlled fixture →
  # @executable.
  Background:
    Given an initialised aof project whose work stream is a fixture I control
    And item "20" whose record doc frontmatter status is "in-progress"

  # The two legal rollback targets (ADR-005): from in-progress, a transient reclaim rolls
  # to not-started (the todo map — re-offered by next); a genuine blocker rolls to
  # blocked. Each writes ONLY the status field — the record-doc body and every other
  # frontmatter key are byte-unchanged.
  Scenario Outline: rollback sets status from in-progress to a legal target, touching only the status field
    When I roll back item "20" to "<target>"
    Then item "20" frontmatter status is "<target>"
    And item "20" record-doc body is byte-unchanged
    And every other frontmatter key of item "20" is byte-unchanged

    Examples:
      | target      |
      | not-started |
      | blocked     |

  # The forbidden TARGETS (ADR-005): from in-progress, the ONLY legal targets are
  # not-started / blocked — so every OTHER target in the closed status vocabulary
  # (not-started | in-progress | blocked | in-review | done) is rejected forbidden-rollback,
  # writing nothing. done is the emphatic case (rolling forward would falsely accept
  # un-done work); in-review is forward too; in-progress is a no-op self-loop, not a
  # rollback. The outline pins the whole forbidden-target set, not only done.
  Scenario Outline: rolling back to any non-legal target is forbidden and writes nothing
    When I roll back item "20" to "<target>"
    Then the store raises a "forbidden-rollback" error
    And item "20" frontmatter status is still "in-progress"

    Examples:
      | target      |
      | done        |
      | in-review   |
      | in-progress |

  # The from-state is bounded too (ADR-005): rollback fires only FROM in-progress. An item
  # not in-progress (already not-started, blocked, in-review, or done) is rejected and
  # left byte-unchanged — the writer is the narrow reclaim/failure seam, not a general
  # status mutator.
  Scenario Outline: rollback fires only from in-progress, rejecting any other from-state
    Given item "20" frontmatter status is "<from>"
    When I roll back item "20" to "not-started"
    Then the store raises a "rollback-not-applicable" error
    And item "20" frontmatter status is still "<from>"

    Examples:
      | from        |
      | not-started |
      | blocked     |
      | in-review   |
      | done        |

  # The write is atomic (ADR-005 + ADR-007): the status rewrite routes through the
  # src/fs.mjs:writeText temp+rename seam, so the record doc is never left half-written
  # and no .tmp- artifact remains — the one frontmatter write resilience makes is durable.
  Scenario: the rollback writes the record doc atomically, leaving no torn or temp file
    When I roll back item "20" to "not-started"
    Then item "20" record doc reloads as a complete, parseable document
    And no .tmp- artifact remains beside the record doc

  # The failed-run wiring (ADR-005): completing a run as failed rolls its in-progress item
  # back to not-started so the stream is left honest — the failed path CALLS the writer,
  # it does not write frontmatter itself.
  Scenario: a run completed as failed rolls its in-progress item back to not-started
    Given item "20" has a single running run and frontmatter status "in-progress"
    When I run "aof work run-complete 20 --outcome failed"
    Then item "20" frontmatter status is "not-started"

  # The reclaim wiring (ADR-004 → ADR-005): a reclaimed stale run (force-failed
  # runtime_offline) rolls its in-progress item back too — reclaim ORCHESTRATES, the
  # work.mjs writer WRITES (the store never writes frontmatter, the write-scope guard).
  Scenario: a reclaimed stale run rolls its in-progress item back to not-started
    Given item "20" has a stale running run and frontmatter status "in-progress"
    When the restart-time reclaim scan force-fails that run
    Then item "20" frontmatter status is "not-started"

  # The honest-stream payoff (ADR-005 → the existing next machinery, ADR-008): a
  # rolled-back not-started item re-enters the ready pool, so aof work next re-offers it —
  # the rollback feeds the EXISTING next/blocked machinery, adding no new stop.
  Scenario: a rolled-back item is re-offered by aof work next
    Given item "20" was rolled back to "not-started" and its dependencies are satisfied
    When I run "aof work next"
    Then item "20" is among the offered actionable items
