@manual @ui @work @distribution
Feature: (soak) An operator dispatches real work entirely from the REAL fleet/board UI — picks a REAL worker node from the live roster, clicks assign, and a REAL global_assignments record is minted with the `assigned` chip appearing — NO CLI touched
  In order that the earned lesson holds — a green suite is not evidence a feature works; only a REAL-producer, real-outsider path
  is (ADR-008) — an operator opens a REAL milestone/story in the REAL fleet/board UI, picks a REAL worker node from the live
  roster, and clicks assign, and the whole flow originates in the UI where the terminal lives (RESEARCH §4.5), never the CLI: a
  REAL global_assignments `assigned` record is minted and the `assigned` chip appears in the UI.

  # ARCHITECTURE 38/ADR-012 producer-fed conformance — "a REAL POST from the REAL built UI hitting the REAL route and producing
  # a REAL global_assignments record read back through the REAL store"; ADR-008 (the milestone's earned lesson — the real-outsider
  # check, no injected seam). SECURITY T13 residual (the fully-local attacker boundary is inherited, not widened) + the operator's
  # R5 attestation of the LIVE loopback bind interface (no CI test asserts the running bind). RESEARCH §4.5 (the operator's
  # requirement: "go [to] the milestone and assign a milestone/story/etc to a worker node" from the UI).
  #
  # @manual — the DEFERRED human gate, closed at `aof:verify 38`. Outsider-observable steps ONLY: a real browser, the real built
  # fleet UI, a real enrolled worker node, the real store — NO injected store seam, NO fixture, and critically NO CLI. This is
  # the one check no @executable can stand in for (it proves the built UI's real POST reaches the real route on a real deploy).
  # Migrates DOWN to @executable/@manual only once the record-minting loop no longer needs a human at the browser.

  Scenario: an operator assigns a milestone/story to a worker node entirely from the UI, no CLI
    Given the REAL fleet UI is open in a browser on the control host (aof mesh ui — the ?mode=fleet surface)
    And a REAL worker node is enrolled and live in the roster, holding the workspace's published repo
    When the operator opens a REAL milestone/story card and picks that worker node from the live picker
    And clicks assign — touching NO CLI
    Then a REAL global_assignments `assigned` record is minted (observable both in the fleet view and in the store)
    And the milestone/story card shows the `assigned` chip naming that worker node
    And the operator attests the live serve-face is bound to loopback only (the R5 bind attestation — 127.0.0.1, never 0.0.0.0)
    And NO `aof mesh assign` CLI command was run to produce the record
    # deferred human gate — closed at aof:verify 38 (ADR-008 real-producer outsider check); verifiable BEFORE story 05's
    # terminal execution consumes the assignment — the dispatch path is proven by the record it mints, not by a green suite
