@ui @work @board
Feature: The detail panel renders an item's prior runs read through work:run-status
  In order to see what the agent has actually run on a work item without reading run records by hand
  the RUNS tab fetches the item's run history through the registered work:run-status command (the new
  /api/work/run-status?ref= route) and renders each prior run newest-first as a scannable bordered row —
  its attempt number, its run-state chip, its truncated session id, and when it ran — while an item that
  has never run shows a dashed "No runs yet" card, not an error.

  # The read path is ONE additive thin face route (ARCHITECTURE ADR-001): HTTP →
  # invoke("work:run-status",{ref}) → the { ref, runs[] } envelope, with ZERO
  # operation logic and no path projection (the records carry refs, not absolute
  # paths). That the route is the registry's (the route<->command bijection
  # re-tightens), adds no run-core import, and writes nothing are STRUCTURAL
  # invariants owned by the fitness functions (acd-work-command-route-coverage /
  # acd-work-ui-no-core-import / acd-board-write-isolation), NOT re-asserted here.
  # This feature asserts only the observable read: the endpoint returns the history,
  # and the panel renders it. The route is @executable; the rendered rows / tabs /
  # states are @manual. The board treats `brief` as opaque and never renders it.
  Background:
    Given a story "21/00" whose runs/ log holds three runs (attempts #1, #2, #3)
    And a story "21/01" that has never been run (no runs/ log)

  # --- the read route (server-side) -----------------------------------------

  # The headline: the board reaches run history ONLY through the registered
  # work:run-status command, surfaced on the new /api/work/run-status route; the
  # response is its { ref, runs[] } envelope unchanged.
  @executable
  Scenario: the run-status route returns the item's runs through the registry
    When the board requests "/api/work/run-status" for "21/00"
    Then the response carries the ref "21/00" and a list of that item's runs
    And the runs are exactly the records work:run-status returns for "21/00"

  # An item that has never run is ABSENT, not broken: readRuns returns [] (the
  # store's ENOENT->[] discipline), so the route reports an empty history, never an
  # error (DESIGN documented-default 5).
  @executable
  Scenario: an item with no runs is reported as an empty history, not an error
    When the board requests "/api/work/run-status" for "21/01"
    Then the response carries the ref "21/01" and an empty list of runs
    And the response is not an error

  # A ref that resolves to no item is the registry's ref-not-found, surfaced as a
  # 404 by the face — not an unrouted crash.
  @executable
  Scenario: a ref that resolves to no item is a not-found, not a crash
    When the board requests "/api/work/run-status" for "99/99"
    Then the response reports the ref could not be resolved
    And the response is a not-found, not a server error

  # The read is a read: surfacing run history mutates nothing on disk.
  @executable
  Scenario: reading the run history changes no files
    Given a snapshot of the work stream before the request
    When the board requests "/api/work/run-status" for "21/00"
    Then no file in the work stream is changed

  # --- the rendered RUNS view (browser) -------------------------------------

  # Each run is a bordered row carrying exactly its four scannable tokens, newest
  # first; the runId and the opaque brief are NOT shown (DESIGN surface 1).
  @manual
  Scenario: the RUNS tab lists an item's prior runs newest-first
    When the operator opens story "21/00" and views its RUNS tab
    Then the History section lists one bordered row per run, newest run first
    And each row shows its attempt number, its run-state chip, a truncated "sess·…" id, and a relative timestamp
    And neither the runId nor the opaque brief is shown in any row

  # The chip IS the outcome — a terminal run reads its outcome through its state
  # chip, with no second outcome badge added (DESIGN documented-default 6).
  @manual
  Scenario: a terminal run's outcome reads through its state chip, with no second outcome badge
    Given story "21/00"'s newest run finished "done" and an earlier run finished "failed"
    When the operator views the RUNS tab
    Then the "done" run shows the teal done chip and the "failed" run shows the red failed chip
    And no separate outcome token is added beside the chip

  # The empty state mirrors the m03 doc-absent convention: a dashed-border
  # placeholder, NOT an error.
  @manual
  Scenario: an item that has never run shows the dashed empty-state card, not an error
    When the operator opens story "21/01" and views its RUNS tab
    Then the body shows a dashed-border "No runs yet" card reading "This item hasn't been run."
    And no error state is shown

  # Loading and failure reuse the panel's existing idioms (the TASKS-tab loading
  # line + accent error line).
  @manual
  Scenario: the RUNS view shows the panel's loading and error idioms
    Given the RUNS tab is fetching the run history
    Then it shows the panel's "Loading runs…" line
    When the "/api/work/run-status" request fails
    Then it shows a "Could not load runs: …" line in the accent colour

  # The RUNS tab is offered at the level that owns a runs/ log — both milestones and
  # stories — and never on a uat gate, slotting into the m03 type-aware tab set in
  # its designed position (DESIGN surface 1).
  @manual
  Scenario Outline: the RUNS tab joins the tab set per the item type
    Given a selected "<type>" item
    Then the doc switcher offers the tabs "<tabs>"

    Examples:
      | type      | tabs                                              |
      | milestone | SPEC, VERIFICATION, RETROSPECTIVE, RUNS, Findings |
      | story     | STORY, TASKS, RUNS                                |
      | uat       | Findings                                          |

  # The relative-time rendering (createdAt -> "12m ago") is a pure formatter, tested
  # headlessly (the dock-state / action.mjs pure-module convention). The exact
  # rounding thresholds are the implementer's; these rows are representative.
  @executable
  Scenario Outline: a run's createdAt renders as a human relative timestamp
    Given a run created <ago> before now
    Then its history-row timestamp reads "<label>"

    Examples:
      | ago        | label     |
      | 12 minutes | 12m ago   |
      | 90 minutes | 1h ago    |
      | 1 day      | yesterday |
      | 2 days     | 2d ago    |
