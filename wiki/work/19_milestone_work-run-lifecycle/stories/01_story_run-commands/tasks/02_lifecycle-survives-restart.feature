@cli @work @work-stream @executable
Feature: A run's lifecycle is driven entirely through the registered commands and the recorded state survives a restart
  In order that the arc's "resumable" and "observable" claims finally rest on durable state instead of an empty promise
  a run's whole lifecycle is driven through the registered work:run-* commands and the recorded run state is re-loaded intact by a fresh process,
  so that an outsider can verify the objective end-to-end: the lifecycle flows through the one registry door and the run record survives a restart.

  # This is the milestone's OUTSIDER-VERIFIABLE acceptance (SPEC §Objective): the
  # lifecycle is driven ENTIRELY through the registered commands (no side channel), and
  # the recorded run state SURVIVES A RESTART. These are behaviours over the REAL seam
  # (the real filesystem, a fresh CLI process), so they live here as @executable
  # scenarios, NOT as fitness functions (ARCHITECTURE closing note, mirroring 08's
  # structural-vs-behavioural split).
  Background:
    Given an initialised aof project whose work stream is a fixture I control

  # The full lifecycle, driven only through work:run-* — start (running), observe via
  # status, complete (terminal), observe the terminal state — with nothing touching the
  # run record except the registered commands.
  Scenario: the full run lifecycle is driven entirely through the registered commands
    When I run "aof work run-start 19"
    And I run "aof work run-status 19 --json"
    Then the status shows one run in state running
    And that run's "outcome" is null
    When I run "aof work run-complete 19 --outcome done"
    And I run "aof work run-status 19 --json"
    Then the status shows that run in state done with outcome done
    And the run keeps the same runId across the start, status and complete calls
    And no item record doc was edited to record any of this

  # The durable-state proof: a run started in one process is re-loaded INTACT by a
  # SEPARATE, fresh process (the run record persisted to runs/ — not held in memory).
  # This is what makes "resumable" rest on durable state. The assertion pins EVERY
  # frozen ADR-003 field that must survive the restart byte-for-byte, not just "the run
  # is there": the identity (runId), the state machine position (state), the lineage
  # (attempt), and the AS-PASSED inputs (sessionId, the opaque brief, createdAt).
  Scenario: the recorded run state survives a restart with every frozen field intact
    Given I started a run for item "19" in one process with session "sess-9" and a brief
    And that process has exited
    When I run a fresh "aof work run-status 19 --json" process
    Then the JSON "runs" array carries exactly one run
    And that run's "runId" is exactly the runId the start process minted
    And that run's "state" is "running" and its "outcome" is null
    And that run's "attempt" is 1
    And that run's "sessionId" is "sess-9"
    And that run's "brief" is byte-equal to the brief first passed
    And that run's "createdAt" equals the value first recorded
    And that run's "itemRef" is "19"

  # The terminal record also survives intact: a completed run re-loads with outcome and
  # the bumped updatedAt persisted, proving the transition was written to runs/, not
  # merely returned by the completing process.
  Scenario: a completed run survives a restart with its terminal outcome and bumped updatedAt
    Given I started then completed a run for item "19" with outcome "failed" in one process
    And that process has exited
    When I run a fresh "aof work run-status 19 --json" process
    Then the JSON "runs" array carries that run in state "failed"
    And that run's "outcome" is "failed"
    And that run's "updatedAt" is at or after its "createdAt"

  # Observability after a terminal run + a prune: status reflects the live runs/ on
  # disk, and pruning a run is visible on the next status read — the read is a pure
  # projection of the derived log, never a cache.
  Scenario: run-status reflects the on-disk runs/ including after a prune
    Given item "19" has 2 persisted runs, one done and one running
    When I run "aof work run-status 19 --json"
    Then the JSON "runs" array carries both runs with their states
    When the done run's record file is pruned
    And I run a fresh "aof work run-status 19 --json" process
    Then the JSON "runs" array carries only the running run
    And pruning the done run changed item "19" frontmatter status not at all
