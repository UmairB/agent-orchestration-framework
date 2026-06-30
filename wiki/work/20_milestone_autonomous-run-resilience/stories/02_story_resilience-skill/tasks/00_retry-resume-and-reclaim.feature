@cli @work @work-stream @manual
Feature: autonomous.md reclaims orphaned runs at restart and resumes-on-infra / starts-fresh-on-rejection
  In order that a multi-hour cascade that crashes or hits an infra failure is self-healing rather than silently wedged
  the autonomous loop runs the reclaim scan at restart before asking what's next, resumes an infra-failed run's session via work:run-retry within the existing maxAttempts loop, and starts fresh via work:run-start when an output is rejected,
  so that the operator's unattended cascade recovers orphaned work and replays only the runtime (never poisoned state), consuming story 01's commands rather than re-deriving the mechanics in prose.

  # ARCHITECTURE ADR-004 (reclaim-at-restart) + ADR-003 (resume-vs-fresh, skill side) +
  # ADR-006 (the skill applies the POLICY, the store provides the FACTS). This is
  # skill-layer prompt wiring in src/bundle/commands/autonomous.md (and its generated
  # .claude/ copy), the 11-altitude prompt-wiring this story owns NO fitness function for
  # — asserted by reading the wired markdown + an agent-observed demonstration recorded
  # in VERIFICATION.md with `verifies →` these scenarios (mirroring 11's refine-grounding
  # @manual). The underlying mechanics are @executable in stories 00/01; here we assert
  # the SKILL drives them at the right loop points.
  # LITMUS: the wiring is read in autonomous.md and the behaviour is agent-observed by
  # driving the loop over a fixture — agent-runnable, not a CI unit test → @manual.

  Background:
    Given the autonomous loop in src/bundle/commands/autonomous.md
    And story 01's work:run-retry / work:run-start commands and the reclaim scan exist

  # Reclaim at restart (ADR-004): before the loop asks "what's next", it runs the
  # restart-time reclaim scan so a run orphaned by a previous crash is recovered and its
  # item rolled back into the ready pool — a backstop SCAN at loop start, never a daemon.
  Scenario: the loop runs the reclaim scan at restart before asking what's next
    When the autonomous loop starts (or resumes)
    Then it runs the restart-time reclaim scan over the range's items BEFORE the first "aof work next"
    And an orphaned run from a prior crash is reclaimed and its item rolled back to not-started
    And the reclaimed item is then offered by "aof work next" on the same loop

  # Resume-on-infra (ADR-002/003): inside the per-item build/verify loop, a run that
  # failed on an INFRA reason (runtime_offline / timeout) is resumed with work:run-retry —
  # carrying the prior session — counted against the EXISTING maxAttempts cap, not a new
  # one.
  Scenario Outline: an infra failure is resumed via run-retry within the existing maxAttempts loop
    Given a run for the current item failed with failureReason "<infra-reason>"
    When the loop handles that failure
    Then it invokes "work:run-retry" to resume the prior session
    And the retry counts against work.autonomous.maxAttempts, not a new cap

    Examples:
      | infra-reason    |
      | runtime_offline |
      | timeout         |

  # Fresh-on-rejection (ADR-003): a run rejected for a BAD OUTPUT (agent_error) is NOT
  # retried/resumed — the loop starts FRESH with work:run-start so it never replays the
  # poisoned session. The sharp rule lives in which verb the loop picks.
  Scenario: a rejected (agent_error) output is restarted fresh via run-start, not resumed
    Given a run for the current item failed with failureReason "agent_error"
    When the loop handles that failure
    Then it does NOT invoke "work:run-retry" for that run
    And any rerun it makes uses "work:run-start" (a fresh session, retryOf null)

  # The verb choice is driven by the store's classification, not re-reasoned in prose
  # (ADR-002/006): the loop ASKS the store (shouldRetry / the command's coded result)
  # which path to take, rather than enumerating the failure table itself.
  Scenario: the loop asks the store which path to take rather than re-deriving the table
    When the loop decides between resume and fresh-start for a failed run
    Then the decision follows the command's coded result (retryable → run-retry; not-retryable → fresh)
    And autonomous.md does not restate the retryable/non-retryable classification table in prose

  # The wiring lands in the BUNDLE SOURCE, not only the prototyped .claude/ copy (the
  # 07/ADR-005 source-of-truth discipline), so new aof projects inherit the hardened loop;
  # the derived manifest stays consistent (the existing acd-bundle-manifest-hashes guard,
  # not owned by this story).
  Scenario: the resilience wiring lives in the bundle source and the manifest stays consistent
    When src/bundle/commands/autonomous.md is read
    Then the reclaim-at-restart + run-retry + run-start wiring is present in the bundled source
    And the generated .claude/ copy matches it
    And "acd-bundle-manifest-hashes" passes after the bundle is regenerated
