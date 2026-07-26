@manual @cli @work @distribution
Feature: A REAL worker drives a REAL command as interactive `claude` on SUBSCRIPTION — asks a human mid-run, retains the worktree, and resumes with full context
  In order to prove the two facts NO injected test can — that the worker runs interactive `claude` on the worker's
  SUBSCRIPTION (not per-token API), and that a human can answer a mid-run question by resuming the SAME session on the
  worker — an operator dispatches a REAL command to a REAL subscription-logged-in worker. The worker runs interactive
  `claude` in a PTY (no `-p`, no `ANTHROPIC_API_KEY`); a genuine judgment call ends NON-terminally as `needs-input`
  with the worktree RETAINED and the `session_id` surfaced to the fleet; a human logs into the worker, runs
  `claude --resume <session_id>`, answers, and the same session continues with full context.

  # The story-05 DEFERRED HUMAN GATE. Closed at `aof:verify 38`. ARCHITECTURE 38/ADR-013 (the @manual soak proves
  # subscription-billing + native ask, which no @executable test can) + ADR-008 (the real-producer outsider check — a
  # green suite is not evidence a feature works; only a producer-fed path is). RESEARCH §4.3 is explicit that ONLY a
  # real interactive session proves the subscription / ask-a-human behaviour: `claude -p` was MEASURED unable to pause
  # (it returned the question as its final message with `terminal_reason: "completed"`); interactive `claude` runs on
  # subscription and `claude --resume <session-id>` continues the SAME session with FULL prior context — both
  # measurable only live. The Agent SDK path that COULD ask forces per-token API billing OFF subscription (§4.3) —
  # this soak confirms the CLI path stays ON subscription.
  #
  # @qa: run only after story-05 @executable lanes 00–03 are green AND a worker exists whose user has logged into
  # `claude` on a Pro/Max subscription (no `ANTHROPIC_API_KEY`). Each spot-check below names an OUTSIDER-observable
  # fact an injected fake cannot produce — concrete pass/fail, not a vibe.

  Scenario: a real worker runs a real command as interactive `claude` on subscription
    Given a worker enrolled in the mesh whose user has logged into `claude` on a Pro/Max subscription, with NO `ANTHROPIC_API_KEY` in the worker (or agent-child) environment
    And an assignment dispatched from the control node carrying a real command (e.g. `/aof:refine <ref> --autonomous`)
    When the worker drives the assignment
    Then the worker spawns interactive `claude` in a REAL PTY with cwd = the worktree — no `-p`, no `--output-format json`
    And the command was typed into the PTY stdin as a whole line, not baked as a `-p` prompt argv
    And the run bills against the worker's SUBSCRIPTION — the subscription usage reflects it and the API console shows no per-token spend (no `ANTHROPIC_API_KEY` was present)

  Scenario: a mid-run judgment call ends `needs-input`, retains the worktree, and surfaces the session_id
    Given the driven command hits a genuine judgment call the agent cannot resolve on its own
    Then the agent STOPS and ends its turn emitting the `NEEDS_INPUT` sentinel, rather than guessing
    And the worker records the outcome as `needs-input`, NOT `done` (the §4.3 mis-read this story closes)
    And the worktree is RETAINED on the worker (a live directory on disk), never force-removed
    And the `session_id` is surfaced to the fleet on the assignment/presence record

  Scenario: a human resumes the SAME session on the worker and it continues with full context
    Given the `session_id` surfaced to the fleet above
    When a human logs into the worker (SSH / remote desktop) and runs `claude --resume <session_id>` in the retained worktree
    Then the SAME session resumes with FULL prior context — it references the exact question it asked before it paused
    And the human answers, and that same session continues driving the assignment — no lost context, no re-clone
    # OUTSIDER-observable spot-checks the hermetic lanes cannot give: the subscription dashboard shows the usage (the
    # API console shows none); the retained worktree is present on the worker's disk; the session_id renders on the
    # fleet card; and the resumed conversation demonstrably carries the pre-pause context.
