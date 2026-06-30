@cli @work @work-stream @executable
Feature: The work:run-* commands drive the run lifecycle through the registered core with the read/write resolver split
  In order that the run lifecycle is controlled through the one command-registry door every face couples through (the milestone-08 bijection)
  the work:run-start / work:run-complete / work:run-status commands register into the same core, each a thin wrapper over the run store, with writes resolving exact and the read tolerating slug fallback,
  so that the CLI is a thin face today and the board and MCP inherit execution control for free in milestones 20/21 — and a typo'd ref can never write a run to the wrong item.

  # ARCHITECTURE ADR-003: three commands, each a thin wrapper over story 00's
  # src/run-store.mjs (the next.mjs-over-nextWork idiom), carrying the frozen
  # {id,input,run,cli} shape. The read/write resolver distinction is inherited from
  # 08/ADR-003: WRITES (run-start/run-complete) resolve with resolveItemExact (no slug
  # fallback); the READ (run-status) tolerates resolveItem slug-fallback. This feature
  # invokes the commands in-process through the registry; the CLI face is task 01, the
  # restart acceptance is task 02.
  Background:
    Given a work-stream fixture with a milestone "19" and a story "19/00"
    And the command registry loaded in-process from src/command-core.mjs

  # The three run commands are registered into the SAME core (additive, ADR-003), each
  # carrying the frozen shape the bijection arch-test asserts structurally.
  Scenario: the registry exposes the three work:run-* commands with the frozen shape
    When I list the registered command ids
    Then the ids include "work:run-start", "work:run-complete", and "work:run-status"
    And each carries an "input" schema, an async "run", and a "cli" adapter with argv + render

  # work:run-start creates a running run for the resolved item and returns the record.
  # The record carries the full frozen ADR-003 schema, minted in `running` with a
  # null outcome and attempt 1.
  Scenario: work:run-start creates a running run and returns the record
    When I invoke "work:run-start" with ref "19" and sessionId "sess-1"
    Then the result is a run record with "state" running and "outcome" null
    And the result run record "attempt" is 1
    And the result run record "itemRef" is "19"
    And the result run record "sessionId" is "sess-1"
    And the result run record "createdAt" equals its "updatedAt"
    And a runs/<run-id>.json file exists under item "19"

  # The WRITE resolves EXACT (08/ADR-003 write-isolation): an exact ref writes; a
  # typo'd / unresolvable ref returns ref-not-found and writes NO run. The matrix
  # covers both an exact MILESTONE ref ("19") and an exact STORY ref ("19/00") writing,
  # against an unresolvable NUMBER ("99"), a non-exact SLUG FRAGMENT, and a partial
  # numeric prefix ("1") — each rejected with ref-not-found and leaving runs/ empty.
  Scenario Outline: work:run-start resolves exact — a typo writes no run to the wrong item
    When I invoke "work:run-start" with ref "<ref>"
    Then the outcome is "<outcome>"

    Examples:
      | ref                 | outcome                              |
      | 19                  | creates a running run                |
      | 19/00               | creates a running run                |
      | 99                  | ref-not-found error, no run written  |
      | 19/99               | ref-not-found error, no run written  |
      | run-stor            | ref-not-found error, no run written  |
      | work-run-lifecycle  | ref-not-found error, no run written  |
      | 1                   | ref-not-found error, no run written  |

  # work:run-complete performs the terminal transition on the in-flight running run;
  # with runId omitted it defaults to the item's single running run; returns the
  # updated record with state==outcome and outcome set. updatedAt is bumped past the
  # createdAt the start recorded (a persisted transition, ADR-003 schema note).
  Scenario Outline: work:run-complete performs the terminal transition on the running run
    Given item "19" has a single running run
    When I invoke "work:run-complete" with ref "19" and outcome "<outcome>"
    Then the result run record "state" is "<outcome>"
    And the result run record "outcome" is "<outcome>"
    And the result run record "updatedAt" is at or after its "createdAt"

    Examples:
      | outcome   |
      | done      |
      | failed    |
      | cancelled |

  # work:run-complete rejects an illegal transition (re-completing an already-terminal
  # run) with illegal-transition, writing nothing (the store's authority surfaced
  # through the command). The matrix covers every terminal FROM-state — done, failed
  # and cancelled are all terminal (ADR-001's frozen table), so completing any of them
  # again is rejected and the persisted record stays byte-identical.
  Scenario Outline: work:run-complete rejects completing an already-terminal run
    Given item "19" has a run already in state "<terminal>"
    When I invoke "work:run-complete" with ref "19" and that run's runId and outcome "<retry>"
    Then invoke raises an "illegal-transition" error
    And the persisted run record is unchanged

    Examples:
      | terminal  | retry  |
      | done      | failed |
      | failed    | done   |
      | cancelled | done   |

  # work:run-complete needs an unambiguous target: no running run, or several running
  # runs with no runId, is a structured error rather than a guessed write; an explicit
  # runId resolves unambiguously even when more than one run is in flight.
  Scenario Outline: work:run-complete requires an unambiguous target run
    Given item "19" is in state "<situation>"
    When I invoke "work:run-complete" with ref "19" and <runId> and outcome "done"
    Then the outcome is "<result>"

    Examples:
      | situation                          | runId            | result                       |
      | no running run                     | no runId         | no-running-run error         |
      | two running runs                   | no runId         | ambiguous-run error          |
      | two running runs                   | the first runId  | completes that run as done   |
      | one running run                    | no runId         | completes that run as done   |

  # work:run-complete is a WRITE — it resolves EXACT too (a typo'd / partial ref never
  # completes a run on the wrong item, mirroring run-start's write-isolation).
  Scenario Outline: work:run-complete resolves exact and rejects a typo'd ref
    Given item "19" has a single running run
    When I invoke "work:run-complete" with ref "<ref>" and outcome "done"
    Then invoke raises a "ref-not-found" error
    And item "19" running run is still running

    Examples:
      | ref                 |
      | 99                  |
      | 19/99               |
      | work-run-lifecycle  |

  # work:run-status is the READ: it returns the item's run history { ref, runs:[...] }
  # and tolerates the slug-fallback resolver (like work:doc / work:tasks).
  Scenario: work:run-status returns the item's run history
    Given item "19" has 2 persisted runs
    When I invoke "work:run-status" with ref "19"
    Then the result is "{ ref: 19, runs: [...] }" carrying both runs

  # The READ tolerates the slug-fallback resolveItem: an exact slug AND a free-text
  # fragment both resolve to item "19" (the read is forgiving where the write is not).
  Scenario Outline: work:run-status tolerates the slug-fallback resolver
    Given item "19" (slug "work-run-lifecycle") has persisted runs
    When I invoke "work:run-status" with ref "<ref>"
    Then the result resolves to item "19" and returns its runs

    Examples:
      | ref                 |
      | work-run-lifecycle  |
      | run-lifecycle       |

  # The READ on an item with NO runs is absent-not-error: an empty runs array, never a
  # thrown error (mirroring work:doc's ENOENT → present:false, body:"" discipline).
  Scenario: work:run-status returns an empty history for an item with no runs
    Given item "19" has no persisted runs
    When I invoke "work:run-status" with ref "19"
    Then the result is "{ ref: 19, runs: [] }"
    And invoke raises no error

  # The derived split, observed through the commands (ADR-001/002): a run command never
  # mutates the item's frontmatter status — status rollback is milestone 20. (The
  # structural guarantee is the acd-run-write-scope arch-test; here we observe it.)
  Scenario: a run command leaves the item's frontmatter status untouched
    Given item "19" has frontmatter status "in-progress"
    When I invoke "work:run-start" with ref "19"
    And I invoke "work:run-complete" with ref "19" and outcome "failed"
    Then item "19" frontmatter status is still "in-progress"
