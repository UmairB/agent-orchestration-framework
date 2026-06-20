@ui @work @board
Feature: Next surfaces the next actionable item and reveals it on the board
  In order to know what to work on next without running a CLI command
  Next calls the in-process work-stream resolver and surfaces its answer — a ready item it reveals and selects on the board, a blocked item naming what it waits on, or a "stream complete" line when nothing is left.

  # Next is an in-process call to nextWork(workDir, scopeRef) (work.mjs:377),
  # never a CLI shell-out (ADR-004). It returns one of three states:
  #   ready  → { state:'ready', ref, type, slug, status, path }  (the next item)
  #   blocked → { state:'blocked', ref, …, waitingOn:[<driver numbers>] }
  #   done   → { state:'done' }                                  (stream complete)
  # The board exposes this at "/api/work/next" and maps each state onto the
  # DESIGN §3 result ramp; a ready item is revealed/selected on the board. The
  # endpoint is @executable; the rendered result is @manual.
  Background:
    Given a fixtured work stream the board can query via "/api/work/next"

  # --- the next endpoint (server-side) --------------------------------------

  # The endpoint returns the three nextWork states from the corresponding stream
  # shapes. A ready item carries its ref; a blocked item carries waitingOn; a
  # fully-done stream returns done with no ref.
  @executable
  Scenario Outline: the next endpoint returns nextWork's state for the stream shape
    Given a stream that is "<stream-shape>"
    When the board requests "/api/work/next"
    Then the response state is "<state>"
    And the response "<carries>"

    Examples:
      | stream-shape                                              | state   | carries                       |
      | has an actionable item ready to work                     | ready   | the next item's ref           |
      | has only a blocked driver with an unmet dependency       | blocked | a waitingOn list of what it needs |
      | has every driver marked done                             | done    | no ref                        |

  # A blocked result names the specific drivers it waits on (nextWork's
  # waitingOn array of unmet dependency numbers).
  @executable
  Scenario: a blocked result names the unmet dependencies it waits on
    Given milestone "04" depends on milestone "03" and "03" is not done
    When the board requests "/api/work/next"
    Then the response state is "blocked"
    And the waitingOn list contains "03"

  # Next is read-only — it resolves the next item and mutates nothing.
  @executable
  Scenario: next changes no files
    Given a snapshot of the fixtured work stream before asking for next
    When the board requests "/api/work/next"
    Then no file in the work stream is changed

  # --- the rendered result (browser) ----------------------------------------

  # The three states map onto the result ramp (DESIGN §3): ready reveals/selects
  # and highlights the item; blocked shows a line naming the wait; done shows a
  # positive complete line. We assert the observable outcome per state.
  @manual
  Scenario Outline: the result region renders the right outcome for each state
    Given asking for next returns the "<state>" state
    When the operator presses "Next"
    Then the result region shows "<outcome>"

    Examples:
      | state   | outcome                                        |
      | ready   | the next item's ref with a reveal-in-board affordance |
      | blocked | a line naming what the item waits on           |
      | done    | a positive "Stream complete" line              |

  # A ready result's reveal affordance selects and scrolls to the returned item
  # on the board, making it the new selection that drives the detail panel.
  @manual
  Scenario: revealing a ready item selects it on the board
    Given asking for next returns a ready item "03/01"
    When the operator presses "Next" and then "Reveal in board"
    Then story "03/01" is selected on the board
    And the detail panel reflects story "03/01"

  # While resolving, the button shows a busy state; a failed next call surfaces
  # an error line rather than a silent success.
  @manual
  Scenario: a failed next call surfaces an error line
    Given the "/api/work/next" request fails
    When the operator presses "Next"
    Then the result region shows an error line
