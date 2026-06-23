@ui @work @board @executable
Feature: Every /api/work route routes through the registry and returns the milestone-03 success envelope byte-for-byte
  In order to prove the command contract end-to-end on a real surface without changing what the board returns
  each /api/work* route is reduced to a thin HTTP -> invoke -> board-projection adapter, with the board projecting the basis-neutral command result against projectRoot with forward slashes,
  so that the board returns byte-for-byte what it did at milestone 03 while carrying zero operation logic of its own — it only invokes registered commands.

  # ADR-002/003: each route maps query/body -> the command input, calls
  # invoke(id, input, { workspace }), and renders through the BOARD face projection
  # (relativise-to-projectRoot + forward-slash + compact JSON). By ADR-002's
  # basis-neutral result this reproduces the milestone-03 success bodies exactly.
  # The existing test/board-api.test.mjs is the free regression net (it must stay
  # green); this feature asserts the observable end-to-end over the migrated seam
  # via a stood-up serveSetupUi. The STRUCTURAL "no operation logic / no core
  # import left in board-ui.mjs" guarantee is the ADR-004 arch-test (story 03),
  # NOT a scenario here.
  Background:
    Given a fixtured work stream served by a stood-up board over /api/work*

  # The read routes each answer via the registry with the milestone-03 success body
  # (the committed test/board-api.test.mjs is the reachable byte-for-byte oracle).
  # The feedback POST has its own scenario below (it needs a body + a seeded STATE).
  Scenario Outline: each /api/work read route returns its milestone-03 success envelope
    When the board receives "<request>"
    Then the response status is "<status>"
    And the response body matches the milestone-03 board contract for that route

    Examples:
      | request                          | status |
      | GET /api/work/list               | 200    |
      | GET /api/work/doc?ref=08&doc=SPEC| 200    |
      | GET /api/work/tasks?ref=08/00    | 200    |
      | GET /api/work/validate           | 200    |
      | GET /api/work/next               | 200    |

  # The validate route projects the command's raw-absolute finding paths against
  # projectRoot and forward-slashes them — the milestone-03 board wire.
  Scenario: the validate route projects finding paths to projectRoot-relative forward-slashed
    Given the fixtured stream has one malformed item
    When the board receives "GET /api/work/validate"
    Then the response is a { findings } envelope
    And each finding path is relative to the project root and forward-slashed

  # The next route projects the command's raw-absolute path to projectRoot-relative
  # forward-slashed, exactly as milestone 03 did.
  Scenario: the next route projects the next item's path to projectRoot-relative forward-slashed
    When the board receives "GET /api/work/next"
    Then the response carries the next item with its path relative to the project root and forward-slashed

  # A doc absent on disk is present:false with a 200 — the board inherits the
  # command's absent-not-error path unchanged.
  Scenario: an absent doc returns present:false with a 200, unchanged
    When the board receives "GET /api/work/doc?ref=08&doc=RETROSPECTIVE"
    Then the response status is 200
    And the body reports present false with an empty body

  # An absent tasks dir is an empty tasks list with a 200 — the same absent-not-error
  # path as doc, preserved through the migration (ADR-003 mapping: absent tasks/ -> []).
  Scenario: an absent tasks dir returns an empty tasks list with a 200, unchanged
    Given a story "08/01" with no tasks dir
    When the board receives "GET /api/work/tasks?ref=08/01"
    Then the response status is 200
    And the body reports an empty tasks list

  # The feedback POST returns the milestone-03 { ok:true, bullet } body and the
  # bullet lands in the target STATE.md — the write surfaces through the command.
  Scenario: the feedback route returns { ok:true, bullet } and appends one bullet
    Given the story "08/00" STATE.md has a "## Feedback (for retro)" heading
    When the board posts feedback "a note" for "08/00"
    Then the response body is { ok: true } carrying the appended bullet
    And exactly one bullet is appended under "## Feedback (for retro)"
