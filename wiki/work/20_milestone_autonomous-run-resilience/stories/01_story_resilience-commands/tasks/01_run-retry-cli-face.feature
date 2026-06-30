@cli @work @work-stream @executable
Feature: aof work run-retry renders the resumed run and emits a stable --json envelope
  In order that a human and a CI step can resume a retryable failed run through the CLI face
  the aof work run-retry command maps argv to the registered work:run-retry input, renders a human line, and under --json emits one parseable envelope (the resumed record, or { ok:false, error, code }),
  so that resume is surfaced through the CLI with the milestone-08 face discipline — thin argv -> invoke -> render/--json, one envelope per call — and the argsFor("run-retry") bijection case is satisfied.

  # The CLI is a thin FACE over the registered work:run-retry command (ADR-003), mirroring
  # 19's run-* face idiom: a single parseable envelope on stdout (success OR a structured
  # error). The bijection (cli adapter + dispatch + --json clean + the argsFor("run-retry")
  # case the test's switch THROWS on if unmapped — 19/R1) is the EXTENDED
  # acd-work-command-cli-bijection arch-test this story owns, NOT a scenario here; this
  # feature asserts the face behaviour.
  # LITMUS: argv mapping, the human render, and the single --json envelope are observable
  # by running the real CLI → @executable.
  Background:
    Given an initialised aof project whose work stream is a fixture I control

  # run-retry: argv -> input, a human confirmation line, and the resumed record under
  # --json carrying the lineage (sessionId carried, attempt incremented, retryOf linked).
  Scenario: aof work run-retry resumes a retryable failed run and renders a confirmation
    Given item "20" has a failed timeout run with sessionId "sess-1" and attempt 1
    When I run "aof work run-retry 20"
    Then the output confirms a run resumed for "20" in state running
    When I run "aof work run-retry 20 --json"
    Then the JSON is a run record with "state" running, "attempt" 2, and "sessionId" "sess-1"
    And the JSON run record "retryOf" is the prior run's runId

  # --run selects an explicit prior run when more than one failed run exists (argv --run
  # -> input.runId), mirroring run-complete's --run disambiguator.
  Scenario: aof work run-retry with --run resumes the named prior run
    Given item "20" has two failed timeout runs
    When I run "aof work run-retry 20 --run <the older runId> --json"
    Then the JSON run record "retryOf" is that older runId

  # --max-attempts overrides the ceiling on the face (argv -> input.maxAttempts), the
  # same control the autonomous skill passes; at the ceiling the retry is refused.
  Scenario: aof work run-retry honours --max-attempts at the ceiling
    Given item "20" has a failed timeout run at attempt 2
    When I run "aof work run-retry 20 --max-attempts 2 --json"
    Then stdout is a single parseable JSON envelope "{ ok:false, error, code:attempts-exhausted }"
    And the process exits non-zero

  # The error envelope (08/ADR-003 discipline): every failure the face can emit renders
  # ONE structured { ok:false, error, code } envelope under --json and exits non-zero.
  # The matrix covers each code run-retry surfaces.
  Scenario Outline: a bad run-retry invocation emits one structured error envelope and exits non-zero
    Given <precondition>
    When I run "aof work run-retry <invocation> --json"
    Then stdout is a single parseable JSON envelope "{ ok:false, error, code:<code> }"
    And the process exits non-zero

    Examples:
      | precondition                                        | invocation | code               |
      | item "20" has a retryable failed run                | 99         | ref-not-found      |
      | item "20" has a retryable failed run                | 20/99      | ref-not-found      |
      | item "20" has a failed agent_error run at attempt 1 | 20         | not-retryable      |
      | item "20" has a failed timeout run at attempt 3     | 20         | attempts-exhausted |
      | item "20" has no failed run                         | 20         | no-retryable-run   |

  # The single-envelope discipline: --json prints exactly one parseable JSON document on
  # stdout for run-retry too (success and error alike) — never a human line plus JSON.
  Scenario: every run-retry --json invocation prints exactly one parseable JSON document
    When I run any "aof work run-retry ... --json" command
    Then stdout parses as exactly one JSON document
    And no human-rendered line precedes or follows it
