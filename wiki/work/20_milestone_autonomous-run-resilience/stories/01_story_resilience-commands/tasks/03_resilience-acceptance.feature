@cli @work @work-stream @executable
Feature: The resilience mechanics hold end-to-end through the real CLI and survive a restart
  In order that the milestone objective is outsider-verifiable on the real seam, not just in-process
  the resume-on-infra / fresh-on-rejection / ceiling-halt / reclaim-and-rollback mechanics are driven entirely through the registered CLI commands over the real filesystem, and the recorded lineage survives a fresh process,
  so that an outsider can verify each SPEC §Objective claim directly: a cascade interrupted by infra resumes its session and completes, a rejection starts fresh, the ceiling halts a failing item, and a crashed run is reclaimed (not wedged) on the next start.

  # This is the milestone's OUTSIDER-VERIFIABLE acceptance (SPEC §Objective), driven
  # ENTIRELY through the registered CLI over the REAL filesystem and a fresh process —
  # mirroring 19's "lifecycle-survives-restart is a .feature, not a fitness function".
  # These exercise the seam stories 00/01 build; the SKILL driving them within the loop
  # is story 02 (@manual). Behaviour over the real CLI → @executable.
  # LITMUS: every line is the observable state of a run/item read back through a fresh
  # `aof work ...` process → @executable.
  Background:
    Given an initialised aof project whose work stream is a fixture I control

  # Resume-on-infra, end-to-end (ADR-002/003): a run fails with an infra reason (timeout),
  # run-retry resumes its SESSION on the same lineage, and the resumed run completes —
  # the "cascade interrupted by an infra failure resumes its session and completes"
  # acceptance, over the real CLI.
  Scenario: an infra-failed run resumes its session through run-retry and completes
    When I run "aof work run-start 20 --session sess-e2e"
    And I run "aof work run-complete 20 --outcome failed --reason timeout"
    And I run "aof work run-retry 20 --json"
    Then the resumed run's "sessionId" is "sess-e2e"
    And the resumed run's "attempt" is 2
    And the resumed run's "retryOf" is the failed run's runId
    When I run "aof work run-complete 20 --outcome done"
    And I run a fresh "aof work run-status 20 --json" process
    Then the history shows the failed run and the resumed run done with outcome done

  # Fresh-on-rejection, end-to-end (ADR-003): an agent_error failure ("you judged the
  # output bad") is NOT retryable — the operator starts FRESH with run-start, which mints
  # a new lineage (retryOf null) and does not carry the poisoned session.
  Scenario: a rejected (agent_error) run is not retried — a fresh start mints a new lineage
    When I run "aof work run-start 20 --session sess-bad"
    And I run "aof work run-complete 20 --outcome failed --reason agent_error"
    And I run "aof work run-retry 20 --json"
    Then stdout is a single error envelope with code "not-retryable"
    When I run "aof work run-start 20 --session sess-fresh --json"
    Then the new run's "retryOf" is null
    And the new run's "attempt" is 1
    And the new run's "sessionId" is "sess-fresh"

  # The ceiling halts, end-to-end (ADR-002): retrying a timeout lineage up to the
  # configured maxAttempts eventually refuses with attempts-exhausted — the failing item
  # halts instead of looping. Driven over the real CLI with an explicit --max-attempts.
  Scenario: the attempt ceiling halts a genuinely-failing item instead of looping
    Given item "20" has a failed timeout run at attempt 1
    When I run "aof work run-retry 20 --max-attempts 2 --json"
    Then the resumed run's "attempt" is 2
    When I run "aof work run-complete 20 --outcome failed --reason timeout"
    And I run "aof work run-retry 20 --max-attempts 2 --json"
    Then stdout is a single error envelope with code "attempts-exhausted"
    And no further run is minted for item "20"

  # Reclaim-and-rollback, end-to-end (ADR-004/005): a run left running by a crash (a
  # stale heartbeat) is reclaimed on the next start — force-failed runtime_offline — and
  # its item is rolled back to not-started, so a fresh process sees the run failed and the
  # item re-offered by next. "Reclaimed, not left wedged" (SPEC §Objective).
  Scenario: a run orphaned by a crash is reclaimed on the next start and its item rolled back
    Given item "20" has a running run whose heartbeat is stale past the threshold, item status "in-progress"
    When the restart-time reclaim scan runs
    And I run a fresh "aof work run-status 20 --json" process
    Then the orphaned run shows state "failed" with failureReason "runtime_offline" and a reclaimedAt stamp
    And item "20" frontmatter status is "not-started"
    When I run "aof work next"
    Then item "20" is among the offered actionable items

  # A reclaimed run is itself retryable (ADR-004 → ADR-002): because reclaim force-fails
  # as runtime_offline (infra, retryable), the recovered run can RESUME — the whole point
  # of reclaiming rather than cancelling. End-to-end, the reclaimed run resumes its
  # session and completes.
  Scenario: a reclaimed run is retryable and resumes its session to completion
    Given item "20" had a running run with session "sess-crash" reclaimed as runtime_offline
    When I run "aof work run-retry 20 --json"
    Then the resumed run's "sessionId" is "sess-crash"
    And the resumed run's "retryOf" is the reclaimed run's runId
    When I run "aof work run-complete 20 --outcome done"
    And I run a fresh "aof work run-status 20 --json" process
    Then the history shows the resumed run done with outcome done

  # Dedup, end-to-end (ADR-006): the "no duplicate non-terminal run per item" guard is an
  # in-scope mechanic — proven over the real CLI with the same outsider-verifiable shape
  # as the others. A second run-start while a run is in flight emits duplicate-run and
  # mints no second run.
  Scenario: a second run-start while a run is in flight is refused duplicate-run over the CLI
    When I run "aof work run-start 20"
    And I run "aof work run-start 20 --json"
    Then stdout is a single error envelope with code "duplicate-run"
    And a fresh "aof work run-status 20 --json" process shows exactly one run in flight
