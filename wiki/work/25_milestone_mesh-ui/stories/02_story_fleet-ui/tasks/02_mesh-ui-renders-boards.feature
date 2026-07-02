@ui @work @distribution
Feature: the BOARDS region renders every registered board with its owner and its m21 run-state chip
  In order to see every board being worked on across the group and which are running right now,
  the fleet view's BOARDS region renders one tile per registered board — its name, its quiet
  "on <nodeId>" owner label, and its current run rendered through milestone 21's run-state chip —
  under a summary line counting boards and running,
  so that run-state reads fleet-wide exactly as m21 built it per board (one chip vocabulary, never
  merged with the presence ramp), an actively running board is visible at a glance by its pulse,
  and a group with nodes but no boards yet reads as absent, not an error.

  # DESIGN surface 1 (binding checklist items 4, 5): the board tile anatomy + the run-state
  # ramp REUSED from m21 verbatim — queued grey · running teal + pulse · done teal + ✓ ·
  # failed red · cancelled grey, colour and label together. The chip renders the board's
  # current/in-flight run from the aggregate's per-board active runs (task 00; the m21
  # work:run-status read underneath) — the fleet face re-derives nothing. The three-ramp
  # separation (presence ≠ run-state ≠ glyph-ring, which stays one level down) is the
  # load-bearing design rail. Rendered-view scenarios are @manual (the m21 convention).
  #
  # BROWSER LANE (QA-owned): scenarios marked [toHaveScreenshot candidate] join the
  # visual-regression set once mocks/mesh-ui.png is committed and the designer judges the
  # render CONFORMS — the approved render becomes the Playwright toHaveScreenshot baseline.
  # Tags stay @manual; the lane is a QA regression behind the judgement, not a re-tag. The
  # running pulse is MOTION: the screenshot locks the dot's presence; the pulse animation
  # itself is a functional harness check (animation class/state), not a pixel assert.
  Background:
    Given a fleet server running against records I plant
    And the operator opens the fleet view

  # The headline: one tile per registered board, the checklist anatomy (item 4), under the
  # summary line — the two-board fixture pins the summary literal and the terminal chip's
  # relative age (the "done · 2d ago" shape, item 4 row 2).
  # [toHaveScreenshot candidate]
  @manual
  Scenario: every registered board renders as a tile with the checklist anatomy
    Given a registry with two boards on two different nodes, one running and one finished
    When the BOARDS region renders
    Then the region shows the uppercase BOARDS label and the summary line "2 boards · 1 running"
    And each board renders one tile: its name, its quiet "on <nodeId>" owner label, its run-state chip, and its drill-in affordance
    And the finished board's terminal chip carries its relative age (the "done · 2d ago" shape)

  # The run-state chip is m21's, verbatim (checklist item 5) — the SAME closed five-state
  # vocabulary run-store.mjs admits (queued|running|done|failed|cancelled; done/failed/
  # cancelled terminal) and the SAME token mapping m21 locked (21/00 task 01's chip outline:
  # queued=muted, running=primary+pulse, done=primary+✓, failed=destructive,
  # cancelled=secondary — queued and cancelled are BOTH grey but carry distinct tokens).
  # The fleet surfaces that vocabulary; it never mints a fleet-local one.
  # [toHaveScreenshot candidate]
  @manual
  Scenario Outline: a board's current run renders through the m21 run-state chip
    Given a registered board whose current run is in state "<state>"
    When its tile renders
    Then its chip shows the label "<state>" on <chip>
    And the chip's colour token is "<token>" — the m21 mapping, never a fleet-local one

    Examples:
      | state     | chip                | token       |
      | queued    | a grey dot          | muted       |
      | running   | a pulsing teal dot  | primary     |
      | done      | a teal dot with a ✓ | primary     |
      | failed    | a red dot           | destructive |
      | cancelled | a grey dot          | secondary   |

  # A running board is the one motion on screen: the pulse + the in-flight details
  # (♥ age, #attempt, truncated session) — the m21 in-flight treatment at group level
  # (checklist item 4 row 2).
  # [toHaveScreenshot candidate — dot presence; the pulse animation is a functional check]
  @manual
  Scenario: a running board's tile carries the in-flight pulse and run details
    Given a registered board with a run in state "running"
    When its tile renders
    Then the tile carries the pulsing teal dot
    And the chip carries the heartbeat age, the attempt number, and the truncated "sess·…" id

  # A board can be registered before it has ever run — zero run records is ABSENT, not an
  # error, and never a fabricated chip (the m21 "No runs yet" discipline at tile scale; the
  # run store's ENOENT→[] read means the aggregate simply carries no runs for it).
  #
  # DEV (never-run tile literal — flag resolved): PINNED to the m21 family literal "No runs
  # yet" — the exact string m21's per-item empty-runs card renders (ui/src/board/DetailPanel.tsx:671,
  # a dashed-border muted placeholder). At tile scale the fleet reuses that same "No runs yet"
  # copy in the muted/quiet treatment IN PLACE OF the run-state chip — no chip token (queued/
  # running/done/failed/cancelled) is minted for a board that has never run, so the never-run
  # state stays visibly distinct from a real queued/cancelled grey chip. This is a build-time
  # copy choice; "No runs yet" is pinned so the family reads as one product.
  @manual
  Scenario: a registered board that has never run renders quiet, not an error
    Given a registered board with no run records at all
    When its tile renders
    Then the tile still renders its name, its owner label, and its drill-in affordance
    And it shows the quiet "No runs yet" state in place of the run-state chip — no chip state is fabricated
    And no error state is shown

  # Nodes-but-no-boards is absent, not an error (checklist item 6): the Nodes region stays
  # populated while the Boards region shows its dashed placeholder.
  # [toHaveScreenshot candidate]
  @manual
  Scenario: a group with nodes but no registered boards shows the dashed boards placeholder
    Given a roster with live nodes and a registry with no registered boards
    When the fleet view renders
    Then the NODES region renders its cards as usual
    And the BOARDS region shows the dashed "No boards registered in the group yet" placeholder
    And no error state is shown
