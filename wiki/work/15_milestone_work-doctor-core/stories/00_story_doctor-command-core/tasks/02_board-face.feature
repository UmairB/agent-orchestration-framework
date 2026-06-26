@cli @work @work-stream @board @executable
Feature: GET /api/work/doctor answers the doctor envelope through the registry as a thin, ungated pass-through
  In order to surface the work stream's health on the board through the SAME registered command the CLI uses (no new door)
  the board serves GET /api/work/doctor by invoking work:doctor through the registry and projecting each finding's path projectRoot-relative + forward-slashed,
  so that the board returns the SAME finding set the command's run produces — just face-projected — never gating and never running operation logic of its own.

  # The board route is the FACE over work:doctor (ADR-001/002), a sibling of the
  # existing /api/work/validate route: invoke through the registry, then project each
  # raw-absolute finding.path to projectRoot-relative + forward-slashed via the
  # board's displayPath convention. This feature stands up a fixture board (the
  # acd-board-single-server idiom) and asserts OBSERVABLE route behaviour. It does
  # NOT assert the registry-derived route BIJECTION (every work:* command has a
  # route / every route has a command) — that is the route-coverage ARCH-TEST. Here:
  # the route answers the envelope, paths are board-projected, the set matches the
  # command's run, and the board never gates.
  Background:
    Given a fixture aof project with a work stream I control
    And the board UI stood up over that project on an ephemeral port

  # The route answers a JSON doctor envelope — a served route through the registry,
  # not an unrouted 404 — carrying the findings array.
  Scenario: GET /api/work/doctor answers a JSON findings envelope
    When I GET "/api/work/doctor"
    Then the response is 200 with a JSON content type
    And the body carries a "findings" array

  # Path projection is the BOARD convention (ADR-002 face adapter): each finding.path
  # is projectRoot-relative AND forward-slashed — never a raw absolute, never with OS
  # backslashes (the displayPath wire validate's route already uses).
  Scenario: each finding path is projectRoot-relative and forward-slashed
    Given the fixture stream has a seeded finding
    When I GET "/api/work/doctor"
    Then every finding "path" in the body is relative to the project root
    And every finding "path" uses forward slashes
    And no finding "path" is an absolute OS path

  # Thin pass-through: the route runs NO operation logic of its own — the served
  # finding SET (codes + messages) equals what invoking work:doctor's run produces
  # over the same stream; only the path BASIS differs (the face projection).
  Scenario: the served finding set equals the command's run, only path-projected
    Given the fixture stream has seeded findings
    When I GET "/api/work/doctor"
    And I invoke "work:doctor" in-process over the same workspace
    Then the body's finding codes and messages match the run's findings one-for-one
    And only the finding paths differ (board-projected vs raw absolute)

  # The board NEVER gates: there is no --strict on the board (a board cannot fail CI).
  # A ?strict query param is inert — the route answers the same advisory envelope
  # with or without it, and the response carries no exit/gate signal.
  Scenario Outline: the board never gates — a strict query param does not change the answer
    Given the fixture stream has warn findings only
    When I GET "/api/work/doctor<query>"
    Then the response is 200 with a JSON content type
    And the body carries the same warn findings
    And the body carries no exit-code or gate field

    Examples:
      | query         |
      |               |
      | ?strict=1     |

  # Scope-as-filter is honoured through the route the SAME way as the command: a
  # scope query restricts the served findings to that subtree; an unresolved scope is
  # an empty findings envelope, NOT an error response.
  Scenario Outline: a scope query filters the served findings; an unresolved scope is empty, not an error
    Given the fixture stream has a seeded finding under milestone "07"
    When I GET "/api/work/doctor?scope=<scope>"
    Then the response is 200 with a JSON content type
    And the body's findings are "<finding-set>"

    Examples:
      | scope      | finding-set                           |
      | 07         | only the subtree's findings           |
      | 08         | empty (out-of-scope subtree)          |
      | 99/no-such | empty (unresolved scope, no error)    |
