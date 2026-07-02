@ui @work @board
Feature: ↻ Rerun re-launches the agent terminal on the item, resolving to a fresh work:run-start
  In order to run a failed or stale item again in one click without leaving the board
  the operator presses the quiet ↻ Rerun affordance in the Current-run strip; it spawns or reveals the
  agent terminal bound to the item and delivers the fresh run verb (work:run-start) as typed PTY input —
  the agent's session runs it — and the new run then appears in the item's RUNS history on the next poll.

  # The rerun REUSES the m03 ADR-006 state-aware terminal launch (ARCHITECTURE
  # ADR-002): it is a NEW CALLER of the existing runAgent(ref, command) ->
  # TerminalDock path on the disjoint /ws/terminal namespace — not a new mechanism
  # and not a board HTTP route. The verb reaches the agent as ordinary typed PTY
  # input; the board server runs nothing itself and observes the result only via
  # story 00's poll. That the board adds NO new write and NO command-CLI shell-out is
  # the STRUCTURAL invariant owned by acd-board-write-isolation (fitness #1), NOT
  # re-asserted here. m21 ships the FRESH path; m20's resume verb is a later additive
  # delta that slots into the same affordance. The verb RESOLUTION is pure (the
  # action.mjs primaryAction convention) -> @executable; the spawn-type-and-appear
  # loop is @manual / @uat.
  Background:
    Given the work board is open with story "21/00" selected on its RUNS tab
    And no run is currently in flight for "21/00"

  # The rerun resolves, for the selected ref, to a FRESH work:run-start verb — the
  # m21 default; m20's resume is a later additive delta (not resolved here).
  @executable
  Scenario Outline: the rerun resolves to a fresh run-start verb for the selected ref
    Given the selected item is "<ref>"
    Then the rerun affordance resolves to a fresh "work:run-start" run on "<ref>"

    Examples:
      | ref   |
      | 21/00 |
      | 21    |

  # Pressing ↻ Rerun spawns/reveals the bound agent terminal and types the run verb
  # as ordinary input; the panel edits no item data inline.
  @manual
  Scenario: pressing ↻ Rerun spawns/reveals the bound agent terminal and types the run verb
    When the operator presses "↻ Rerun" on story "21/00"
    Then the agent terminal dock opens bound to ref "21/00"
    And the fresh run verb is delivered to the agent session as typed input
    And the detail panel edits no item data inline

  # The launch and its observation are DECOUPLED: the agent's session mints the run;
  # the board sees it on the next /api/work/run-status poll (ADR-002).
  @uat
  Scenario: a rerun mints a fresh run that shows up in the history via the next poll
    Given a real agent provider is available for story "21/00"
    When the operator presses "↻ Rerun" and the agent session runs the verb
    Then a new attempt is minted as a fresh "running" run for "21/00"
    And the new run appears in the RUNS history on the next /api/work/run-status poll
