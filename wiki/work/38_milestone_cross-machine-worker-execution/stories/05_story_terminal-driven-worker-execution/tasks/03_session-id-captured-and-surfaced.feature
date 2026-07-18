@executable @cli @work @distribution
Feature: The session's `session_id` is CAPTURED and surfaced on the assignment/presence record — a run with no id degrades gracefully
  In order that a human can `claude --resume <session_id>` on the worker to answer a `needs-input` session (or keep
  steering a run), the `session_id` the interactive session emits — DISCARDED today at
  mesh-worker-execution.mjs:580-581, where the code reads only `terminal_reason`/`stop_reason` — is captured and
  surfaced on the assignment/presence record; and a run that emits no `session_id` degrades gracefully (surfaced as
  absent, never a crash).

  # ARCHITECTURE 38/ADR-013 (invariant 3: `session_id` is CAPTURED — the code DISCARDS it today,
  # mesh-worker-execution.mjs:580-581 reads only `terminal_reason`/`stop_reason`, never `session_id` — and surfaced
  # on the assignment/presence record so story 06 can route the stream and a human can `claude --resume <session-id>`).
  # RESEARCH §4.3 (MEASURED: the resumed turn returns the SAME session_id with FULL prior context; headless sessions
  # do NOT appear in the interactive `--resume` picker, so the worker MUST surface its id up to the fleet for the
  # "log in and resume" path to be usable — the human must be TOLD the id). Armed by `acd-worker-driver-no-headless-print`.
  #
  # @executable over INJECTED seams — a fake pty whose output can emit (or omit) a `session_id`, and a captured
  # assignment/presence record. No real `claude`, no subscription, no PTY, no network.

  Background:
    Given the worker driver over a fake pty whose output can emit or omit a `session_id`

  Scenario: an emitted `session_id` is captured and surfaced for resume
    Given the interactive session emits `session_id` "sess-abc123"
    When the worker drives the assignment
    Then "sess-abc123" is captured (no longer discarded, mesh-worker-execution.mjs:580-581)
    And it is surfaced on the assignment/presence record so a human can `claude --resume sess-abc123` on the worker

  Scenario: a run with no `session_id` degrades gracefully — absent, not a crash
    Given the interactive session emits NO `session_id`
    When the worker drives the assignment
    Then the session_id is surfaced as ABSENT (null / omitted), not an error
    And the run still completes to its terminal outcome — no crash of the worker's stream loop

  Scenario Outline: session_id capture across emit shapes
    Given the interactive session emits <emission>
    When the worker drives the assignment
    Then the surfaced session_id is <surfaced>
    And the run completes to its terminal outcome (no crash)

    Examples:
      | emission                       | surfaced    |
      | a well-formed id "sess-abc123" | sess-abc123 |
      | no session_id at all           | absent      |
      | an empty-string session_id ""  | absent      |
