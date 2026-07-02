@cli @work @work-stream @executable
Feature: aof work run-start/run-complete/run-status renders the run lifecycle and emits a stable --json envelope
  In order to let a human and a CI step drive and read a run's lifecycle through the CLI face
  the aof work run-start / run-complete / run-status commands map argv to the registered command's input, render a human line, and under --json emit one parseable envelope (success or { ok:false, error, code }),
  so that the same lifecycle the commands' run produces is surfaced through the CLI with the milestone-08 face discipline — thin argv -> invoke -> render/--json, one envelope per call.

  # The CLI is a thin FACE over the registered work:run-* commands (ADR-003), mirroring
  # the projectProvisionCli / graph-verb --json idiom: a single parseable envelope on
  # stdout (success OR a structured error), never a half-printed result. Run records
  # carry refs, not absolute paths, so there is no path-projection face adapter in play
  # here. This feature asserts the face: argv mapping, the human render, the --json
  # envelope, and the error envelope. The bijection (cli adapter + dispatch + --json
  # clean) is the acd-work-command-cli-bijection ARCH-TEST (fitness #4), not a scenario
  # here.
  Background:
    Given an initialised aof project whose work stream is a fixture I control

  # run-start: argv -> input, a human confirmation line, and the run record under --json.
  Scenario: aof work run-start starts a run and renders a confirmation
    When I run "aof work run-start 19"
    Then the output confirms a run started for "19" in state running
    When I run "aof work run-start 19 --json"
    Then the JSON is a run record with "state" running and "outcome" null

  # The --session and --brief options map through argv -> the command input -> the
  # persisted record (the session id is recorded; the brief is carried opaque).
  Scenario: aof work run-start maps --session and --brief onto the run record
    When I run "aof work run-start 19 --session sess-7 --brief '{\"initiator\":\"operator\"}' --json"
    Then the JSON run record "sessionId" is "sess-7"
    And the JSON run record "brief" carries the initiator field I passed

  # run-complete: --outcome drives the terminal transition; --json emits the updated
  # record. (QA: cover the three legal outcomes.)
  Scenario Outline: aof work run-complete transitions the running run to the chosen outcome
    Given item "19" has a single running run
    When I run "aof work run-complete 19 --outcome <outcome> --json"
    Then the JSON run record "state" is "<outcome>"
    And the JSON run record "outcome" is "<outcome>"

    Examples:
      | outcome   |
      | done      |
      | failed    |
      | cancelled |

  # run-complete: --run selects an explicit run when more than one is in flight (the
  # runId disambiguator on the face, mapping argv --run -> input.runId).
  Scenario: aof work run-complete with --run completes the named run when several are in flight
    Given item "19" has two running runs
    When I run "aof work run-complete 19 --run <the first runId> --outcome done --json"
    Then the JSON run record "runId" is that first runId
    And the JSON run record "state" is "done"

  # run-status: renders the item's run history; --json emits { ref, runs:[...] }.
  Scenario: aof work run-status renders the item's run history
    Given item "19" has 2 persisted runs
    When I run "aof work run-status 19 --json"
    Then the JSON has "ref" "19" and a "runs" array carrying both runs
    When I run "aof work run-status 19"
    Then the output lists each run with its runId and state

  # The error envelope (08/ADR-003 discipline): every failure the face can emit renders
  # ONE structured { ok:false, error, code } envelope under --json and exits non-zero.
  # The matrix covers each code the face surfaces:
  #   - ref-not-found    : a bad ref on run-start AND on run-complete (the write resolver
  #                        rejects exact-misses on both write verbs);
  #   - invalid-outcome  : a --outcome outside the closed done|failed|cancelled set;
  #   - no-running-run   : run-complete with nothing in flight to complete;
  #   - illegal-transition: run-complete on an already-terminal run.
  Scenario Outline: a bad invocation emits one structured error envelope and exits non-zero
    Given <precondition>
    When I run "aof work <invocation> --json"
    Then stdout is a single parseable JSON envelope "{ ok:false, error, code:<code> }"
    And the process exits non-zero

    Examples:
      | precondition                                   | invocation                                   | code                |
      | item "19" has no runs                          | run-start 99                                 | ref-not-found       |
      | item "19" has a single running run             | run-complete 99 --outcome done               | ref-not-found       |
      | item "19" has a single running run             | run-complete 19 --outcome bogus              | invalid-outcome     |
      | item "19" has a single running run             | run-complete 19 --outcome ""                 | invalid-outcome     |
      | item "19" has no running run                   | run-complete 19 --outcome done               | no-running-run      |
      | item "19" has a run already in state "done"    | run-complete 19 --run <that runId> --outcome failed | illegal-transition |

  # The single-envelope discipline: --json prints exactly one parseable JSON document on
  # stdout for every command (success and error alike) — never a human line plus JSON.
  Scenario: every --json invocation prints exactly one parseable JSON document
    When I run any "aof work run-* ... --json" command
    Then stdout parses as exactly one JSON document
    And no human-rendered line precedes or follows it
