@ui @work @board
Feature: The RUNS view refreshes by poll in place, without tearing down a live terminal
  In order to watch a run's state advance without a full board reload or losing a live agent session
  the RUNS view re-fetches /api/work/run-status on the board's existing silent-refresh cadence and via a
  quiet "⟳ refreshed Ns ago" affordance, replacing the rendered runs in place — and a refresh never
  unmounts the board subtree or a running terminal, because observability here is poll, not a push stream.

  # Observability is POLL over the read-mostly board (ARCHITECTURE ADR-001; SPEC
  # §Out of scope) — NOT a websocket / live-tail / event stream. The refresh reuses
  # Board.tsx's load({silent}) NON-TEARING idiom (a silent refresh never unmounts the
  # board subtree or a live terminal). The freshness label (Ns ago) is the same pure
  # relative-time formatter the history rows use -> @executable; the in-place,
  # non-tearing refresh and the absence of stream chrome are rendered behaviours
  # -> @manual / @uat.
  Background:
    Given the work board is open with story "21/00" selected on its RUNS tab

  # The "refreshed Ns ago" label is the pure relative-time formatter, surfaced on the
  # poll affordance.
  @executable
  Scenario Outline: the "refreshed Ns ago" label renders the time since the last fetch
    Given the run history was last fetched <ago> ago
    Then the refresh affordance reads "⟳ refreshed <label>"

    Examples:
      | ago        | label  |
      | 8 seconds  | 8s ago |
      | 90 seconds | 1m ago |

  # Pressing the affordance re-fetches and swaps the rendered runs in place — no full
  # board reload — and the freshness label resets.
  @manual
  Scenario: pressing the refresh affordance re-fetches and replaces the runs in place
    Given story "21/00" gains a new run since it was last viewed
    When the operator presses "⟳ refreshed Ns ago"
    Then the RUNS view re-fetches /api/work/run-status and shows the new run
    And the History section updates in place without a full board reload
    And the "refreshed Ns ago" label resets toward "just now"

  # The affordance reads as "a snapshot you can refresh", deliberately NOT a live
  # stream: there is no live-tail / websocket / streaming-log chrome.
  @manual
  Scenario: the RUNS view carries no live-tail or streaming-log chrome
    When the operator views the RUNS tab
    Then the only refresh affordance is the "⟳ refreshed Ns ago" poll control
    And there is no live-tail, websocket, or streaming-log element

  # The load({silent}) idiom is non-tearing: a poll updates run state while a live
  # terminal keeps streaming, unreconnected.
  @uat
  Scenario: a silent poll updates run state without disrupting a live terminal
    Given an agent terminal is running in the dock for story "21/00"
    When a silent refresh polls /api/work/run-status while the terminal is live
    Then the updated run state appears in the RUNS view
    And the live terminal session is not torn down or reconnected
