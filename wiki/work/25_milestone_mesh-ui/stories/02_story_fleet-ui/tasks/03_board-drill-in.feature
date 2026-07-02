@ui @work @distribution
Feature: a board tile drills into that board's own aof work ui — a link out, never an embed or a proxy
  In order to go from the fleet's mission-control view down into one work stream's detail,
  each board tile carries an "Open board →" drill-in that hands off to that board's own
  aof work ui surface,
  so that the fleet view stays a thin read-only roster on top of the work UIs — it never embeds a
  board, never proxies a board's /api/work, and never becomes a liveness middleman for streams it
  does not own.

  # ARCHITECTURE ADR-003 decision 4 + DESIGN's "drill-in is a link, never an embed" rail:
  # the drill target is the board's own renamed verb (story 00 — the ONE coupling back to
  # ADR-001). Each board keeps its own git + its own serve-face (PRD §7.3); the fleet face
  # proxying /api/work was explicitly rejected (a durability SPOF).
  #
  # DEV (peer drill target — flag resolved, feasibility CONFIRMED): no peer serve-URL exists
  # anywhere on the tree to link to. The registry roster entry is exactly
  # { nodeId, admittedAt, boards } (mesh-registry.mjs:127) and registerBoard appends a flat
  # board NAME (mesh-registry.mjs:134-140) — no address/host/port/url field. The presence
  # record is exactly { nodeId, heartbeatAt, activeRuns, aofVersion } (mesh-presence.mjs:78-84)
  # — again no address field. And a peer board's own aof work ui binds ITS 127.0.0.1
  # (serveBoard → serveSetupUi listens "127.0.0.1", setup-ui.mjs:150), unreachable from here.
  # So the honest-locality affordance is the ONLY feasible design; there is nothing to
  # construct a peer serve-URL from. LOCKED literal shape: a board whose stream is locally
  # present renders a real navigating "Open board →" link/launch to the LOCAL aof work ui; a
  # board only reachable on its owner node renders NOT a link but a copyable command hint —
  # "aof work ui" (the renamed verb, story 01) — attributed to the owner node (e.g. the "on
  # <nodeId>" owner label the tile already carries, DESIGN surface 1 board-tile row 1). It is
  # NEVER an href that would dead-end on this machine. The two-case split (locally-served vs
  # peer-only) is decided from the records the aggregate carries — locality is the ONE axis —
  # never by probing a peer's port.
  #
  # QA case split (test design): locality is the ONE axis that changes the affordance, so the
  # matrix is exactly two cases — locally-served (navigates) vs peer-only (honest hint). The
  # split is decided by the records the aggregate carries, never by probing a peer's port.
  #
  # BROWSER LANE (QA-owned): the local drill-in click-through is a Playwright harness
  # (functional) candidate — click "Open board →", assert navigation out and no in-page
  # panel. The @executable wire scenario runs under the same harness via request
  # interception. Tags stay as written; the lane is how QA runs them, not a re-tag.
  Background:
    Given a fleet server running against records I plant
    And the operator opens the fleet view

  # The headline: the drill-in navigates out to the board's own surface — the fleet page
  # does not open a panel, does not embed the board.
  @manual
  Scenario: Open board hands off to that board's own aof work ui
    Given a registered board whose work stream is served on this machine
    When the operator follows its "Open board →" drill-in
    Then the operator lands on that board's own aof work ui surface
    And the fleet page opened no in-page panel and embedded no board

  # A board that cannot be reached from this machine gets an honest affordance, never a
  # dead link (the locked outcome of the feasibility flag above). The affordance is
  # attributed: it names WHICH node owns the board, so the operator knows where to go.
  @manual
  Scenario: a board only reachable on its owner node drills as an honest affordance
    Given a registered board owned by a peer node and not served on this machine
    When the operator inspects its drill-in affordance
    Then the affordance presents the copyable "aof work ui" command to open that board on its owner node
    And the affordance names the owner node
    And it is not a link that would dead-end on this machine

  # The fleet face never fetches board data on drill-in's behalf: opening the fleet view
  # and following a drill-in issues no /api/work request through the fleet server.
  @executable
  Scenario: the fleet face issues no /api/work request for a drill-in
    Given the fleet server is running with registered boards
    When the fleet page is loaded and a drill-in is followed
    Then the fleet server received no /api/work request
    And every board fact on the page came from the one /api/mesh/status read
