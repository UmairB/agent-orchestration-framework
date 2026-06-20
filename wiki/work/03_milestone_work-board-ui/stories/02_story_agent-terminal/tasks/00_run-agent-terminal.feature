@ui @work @board
Feature: Run agent on the selected item opens the terminal dock and streams the live agent loop
  In order to drive the agent CLI against the item I am reading without leaving the board
  the operator presses Run agent on the selected item and watches the dock spawn the chosen
  provider against that item's directory and walk idle → connecting → running → exited, with
  keystrokes echoing and the pane reflowing on resize.

  # This story's value is a LIVE agent loop — a real node-pty spawn, a real agent CLI on PATH,
  # and a rendered xterm dock — so most scenarios here are @manual/@uat per RESEARCH A2/A4: the
  # only honest @executable coverage is the protocol SHAPE on the wire (the dock-state effect of a
  # control-frame), not the spawn-and-stream itself. The wire envelope (raw PTY frames, JSON
  # {resize}/{exit}/{error}) is ADR-003 STRUCTURE; here we assert only its observable EFFECT on the
  # dock state — never the frame bytes as spec. The node-pty/ws server-only confinement and the MIT
  # attribution are acd-terminal-server-only / acd-vibeyard-attribution fitness functions, NOT
  # scenarios here.

  Background:
    Given the work board is open with a board item selected
    And the terminal dock is present beneath the board and detail columns

  # A2 build-time confirmation (RESEARCH §2 / Assumptions): the bundled win32-x64 pty.node actually
  # loads and forks a child on THIS machine/Node. The developer's pty.spawn smoke at build resolves
  # it; it is observed here as "the dock reaches running", which is impossible if the prebuilt does
  # not load. A real native spawn, so @manual, not CI.
  @manual
  Scenario: pressing Run agent spawns the chosen provider bound to the item's directory
    Given the selected item is "03/02" and its provider is "claude"
    When I press Run agent on the selected item
    Then the terminal dock opens and focuses
    And the dock header echoes the target ref "03/02"
    And the agent runs with its working directory set to that item's directory
    And the dock reaches the running state

  # A4 live end-to-end stream (RESEARCH Assumptions): a human watches the dock walk the designed
  # connection-state ramp (DESIGN §4) with a real provider on PATH. The states must appear in order;
  # the human confirms the loop, not a snapshot.
  @uat
  Scenario: the dock walks idle → connecting → running while the agent starts up
    Given the dock is idle with no session
    When I press Run agent on the selected item with provider "claude" present
    Then the dock shows connecting while the session is being established
    And the dock then shows running once the agent is streaming
    And the agent's output is visible in the xterm viewport

  # A4 live: input echo is the heart of an interactive agent loop — only a human at a real terminal
  # can confirm a typed character round-trips and renders.
  @uat
  Scenario: keystrokes typed into the running pane echo back in the viewport
    Given the dock is running an agent against the selected item
    When I type a line into the terminal pane and press Enter
    Then the characters I typed appear in the xterm viewport
    And the agent receives the input I sent

  # A4 live: resize reflow needs a real rendered pane being dragged and a real PTY honouring the new
  # geometry — a human resize, observed.
  @uat
  Scenario: resizing the dock reflows the running agent's output
    Given the dock is running an agent against the selected item
    When I drag the dock taller so the pane has more rows
    Then the agent's output reflows to the new pane size with no clipped or wrapped-wrong lines

  # A4 live, clean exit: a human confirms a real provider that finishes shows the designed
  # exited(0) state (DESIGN §4 connection-state ramp). The {exit,exitCode:0} envelope is ADR-003
  # structure; the observable effect is the dock's exited (code 0) state.
  @uat
  Scenario: when the agent finishes cleanly the dock shows exited with code 0
    Given the dock is running an agent against the selected item
    When the agent process ends normally
    Then the dock shows the exited state reporting code 0
    And the final scrollback remains visible in the viewport
    And a way to restart the session is offered

  # A4 live, non-zero exit: the ramp's red branch (exited ≠ 0 → destructive/accent, DESIGN §4).
  # A human runs an agent that exits non-zero and confirms the dock distinguishes it from a clean exit.
  @uat
  Scenario: when the agent ends with a non-zero status the dock shows the failing exit code
    Given the dock is running an agent against the selected item
    When the agent process ends with status 1
    Then the dock shows the exited state reporting code 1
    And the exited state reads as a failure, distinct from a clean exit

  # @executable protocol-shape: the dock's state machine maps the server→client control-frame to the
  # rendered connection-state, headlessly, with NO real PTY. A node test drives the dock state reducer
  # with a stubbed exit control message and asserts the resulting observable state — this is the wire
  # EFFECT, not a live spawn. The exact frame fields are ADR-003 structure; here we assert the
  # state-from-frame mapping that the dock is contracted to honour.
  @executable
  Scenario Outline: an exit control message drives the dock to the matching exited state
    Given the dock is in the running state
    When the server reports the session exited with code <code>
    Then the dock shows the exited state reporting code <code>
    And the exited state reads as "<reads-as>"

    Examples:
      | code | reads-as |
      | 0    | clean    |
      | 1    | failure  |
      | 130  | failure  |

  # @executable protocol-shape: a resize gesture must produce the client→server resize signal so the
  # PTY can be told the new geometry. Headlessly, a fit-to-container of N rows/cols emits exactly one
  # resize with those dimensions — asserted as the observable "the session is told it is now C×R",
  # not the JSON literal.
  @executable
  Scenario Outline: fitting the pane to <cols>x<rows> tells the session the new size exactly once
    Given the dock has an open session
    When the pane is fitted to <cols> columns and <rows> rows
    Then the session is told to resize to <cols> columns and <rows> rows
    And exactly one resize is sent for that fit

    Examples:
      | cols | rows |
      | 80   | 24   |
      | 120  | 30   |
      | 200  | 50   |
