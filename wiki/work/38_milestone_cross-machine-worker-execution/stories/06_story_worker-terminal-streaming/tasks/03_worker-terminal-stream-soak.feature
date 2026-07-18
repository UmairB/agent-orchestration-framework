@manual @ui @work @board @distribution
Feature: SOAK — a REAL worker's LIVE terminal appears in the REAL control-node fleet view, routed to the correct node/session, and a fleet keystroke does NOT reach the worker (read-only confirmed live)
  In order that the un-fakeable property is proven by a REAL producer — a live PTY streamed cross-machine cannot be
  faked by a green hermetic suite (ADR-008, the milestone's earned lesson) — a REAL worker runs a REAL interactive
  `claude` session whose LIVE output must appear in the REAL control-node fleet view within the heartbeat window, routed
  to the correct (nodeId, sessionId); and a keystroke typed into the fleet view must NOT reach the worker (read-only IN
  FACT, live).

  # ARCHITECTURE 38/ADR-008 (the real-producer outsider check — only a producer-fed path is evidence; a green suite is not),
  # 38/ADR-014 (the cross-machine terminal bridge + read-only mirror + (nodeId, sessionId) routing). SECURITY T14 (residual —
  # the on-screen secret inspection: no credential/token/key visible in the mirrored stream on a real run).
  #
  # @manual — the REAL cross-machine stream (a real worker, a real relay socket, a real control-node fleet view). The
  # hermetic bridge/mirror seams are tasks 00-02; THIS is the exclusive real-second-machine gate. Deferred human gate,
  # closed at `aof:verify 38`. Outsider-observable steps only — NO implementation internals inspected (black-box).

  Background:
    Given a REAL worker node running a REAL interactive `claude` terminal session for a dispatched assignment (story 05)
    And a REAL control node showing the fleet view, with the worker's `session_id` surfaced on the assignment card (ADR-013)

  Scenario: the worker's LIVE output appears in the control-node fleet view within the heartbeat window, routed to its own card
    When the worker's session produces live output (the agent prints progress, or a `NEEDS_INPUT` question, to its own terminal)
    Then that output appears in the control-node fleet view's terminal panel for THIS assignment within the heartbeat window
    And it is routed to the CORRECT node/session — this assignment's card shows THIS worker's stream, not another worker's
    And no credential, token, or key appears on-screen in the mirrored stream at any point during the run (T14 residual inspection)

  Scenario: a keystroke typed into the fleet view does NOT reach the worker — read-only confirmed LIVE
    When the operator types a keystroke into the fleet-view terminal panel for the assignment
    Then it produces NO effect on the worker's session — no echo, no input consumed, the worker PTY is untouched
    And the worker-local terminal (a human logged INTO the worker) remains the ONLY way to type into that session — Phase-2 read-write is out of scope

  Scenario: two concurrent workers stream two DISTINCT sessions — multiplex confirmed live
    Given a SECOND real worker running its own real session for a second dispatched assignment
    When both workers produce live output at once
    Then each assignment's card shows ITS OWN worker's stream — the two live streams never cross-talk
    And closing one card's view does not disturb the other's live stream
