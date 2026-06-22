@ui @work @board @executable
Feature: The board's read-vs-write resolver distinction survives the migration because it lives in the commands
  In order that the milestone-03 write-isolation invariant cannot be weakened by the re-home
  the board's read routes (doc / tasks) still tolerate a slug fallback while the feedback write still resolves exact-only — now because the resolver moved INTO the commands, not because board-ui re-implements it,
  so that a typo'd or partial ref appends nothing on the write path through the board, exactly as before, and neither face can drift the distinction.

  # ADR-003: the resolver choice moves into the commands — work:doc / work:tasks
  # resolve with resolveItem (slug-fallback tolerated), work:feedback with
  # resolveItemExact (no fallback). The board inherits both; it can no longer
  # weaken the write's exactness from the face. This is the observable side of the
  # milestone-03 write-isolation invariant (the structural net is the existing
  # test/arch/acd-board-write-isolation.test.mjs, kept green). This feature proves
  # the distinction holds over the migrated seam.
  Background:
    Given a fixtured work stream served by a stood-up board over /api/work*
    And a milestone "08" whose folder slug is "cli-command-core"

  # The READ routes tolerate a free-text slug — a non-exact ref still resolves to
  # the matching item (the read behaviour milestone 03 allowed).
  Scenario Outline: a read route resolves a free-text slug to the matching item
    When the board receives "<request>"
    Then the response status is 200
    And the response resolves to the "08" milestone

    Examples:
      | request                                          |
      | GET /api/work/doc?ref=cli-command-core&doc=SPEC  |
      | GET /api/work/tasks?ref=cli-command-core         |

  # The WRITE route resolves exact-only: a partial/typo'd ref that a read would
  # slug-match must 404 and append nothing.
  Scenario: the feedback write rejects a non-exact ref and appends nothing
    Given a snapshot of the work stream before the request
    When the board posts feedback "should not land" for "cli-command"
    Then the response status is 404
    And the body is { ok:false } with code "ref-not-found"
    And no STATE.md in the work stream gained a bullet

  # The contrast in one place: the SAME non-exact ref reads fine but cannot write —
  # the distinction is real and observable through the board.
  Scenario: the same non-exact ref reads but does not write
    When the board receives "GET /api/work/doc?ref=cli-command-core&doc=SPEC"
    Then the read succeeds with status 200
    When the board posts feedback "a note" for "cli-command-core"
    Then the write fails with status 404
