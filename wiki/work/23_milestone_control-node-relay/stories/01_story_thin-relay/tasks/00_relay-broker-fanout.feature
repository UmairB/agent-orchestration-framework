@cli @work @distribution @executable
Feature: serveRelay stands up a stateless ws@8 broker that fans one node's signal out to the OTHER nodes and persists nothing
  In order to give the fleet a live coordination layer git can't provide cheaply — without ever becoming a second source of truth
  serveRelay({ port }) returns { server, url, stop }, fans a signal frame from one connected node out to the others (never echoing the sender), holds the in-flight signal in memory only, and tears down cleanly on stop(),
  so that the relay is the lightest possible accelerator: a frame in is a frame out to the peers, nothing touches disk, and killing it loses liveness, not data.

  # ARCHITECTURE ADR-001: serveRelay is the one-shot serve core — one http.createServer +
  # a ws@8 WebSocketServer via noServer + server.on('upgrade') on a single relay pathname
  # (the src/terminal-ws.mjs attachTerminalWebSocket precedent), returning the { server, url,
  # stop } serve-unit shape src/board-serve.mjs's serveBoard mirrors. This feature asserts the
  # OBSERVABLE broker behaviour — fan-out to peers, NO echo to the sender, in-memory-only (no
  # durable artifact), a clean stop(), and the ephemeral (not-a-log) property. The relay's
  # source-level statelessness (no writeText/writeFile of a record, no record-schema import) is
  # the acd-relay-stateless ARCH-TEST (fitness #1) — NOT a scenario here.
  #
  # QA FEASIBILITY FLAG (developer-amigo): every scenario drives an IN-PROCESS ws client (the
  # m03 terminal-ws test pattern) over an EPHEMERAL port (port: 0) — no spawned CLI, no network.
  # Confirm an in-process ws round-trip is reliable in CI on Windows: the 22/R3 retro flagged a
  # spawnCliSync flake — this lane avoids spawn entirely (in-process serveRelay + an in-process
  # `ws` client), which should sidestep it, but the fan-out assertions are ORDERING/TIMING
  # sensitive (B and C must have completed their connect handshake BEFORE A publishes, or they
  # miss the frame — see the late-joiner scenario, which is the same property inverted). The
  # contract is "await each peer's open event before publishing"; flag if a deterministic
  # barrier (e.g. an ack-on-connect) is needed rather than a raw open await. Do NOT silently
  # retag to @manual — RAISED for the feasibility call; see VERIFICATION.
  Background:
    Given a relay stood up in-process via serveRelay on an ephemeral port (port 0)
    And the serve unit exposes { server, url, stop }
    And in-process ws clients can connect to the relay url

  # The serve-unit shape: serveRelay returns the same { server, url, stop } trio serveBoard does,
  # and url is a reachable ws endpoint on the assigned ephemeral port.
  Scenario: serveRelay returns a { server, url, stop } serve unit on a live ephemeral port
    When I read the serve unit serveRelay returned
    Then it exposes a server, a url, and a stop function
    And the url carries the actual assigned port (not the requested port 0)
    And a ws client can complete a connection handshake against that url

  # The headline: ONE node publishes, the OTHERS receive, the SENDER does not. A 3-client case
  # (A, B, C all connected) pins BOTH who-gets-it (B and C) AND who-doesn't (A — no self-echo).
  # R4: the unaffected side is the SENDER's own inbound stream — it must stay empty of its own
  # signal (the relay fans out, it does not loop back).
  Scenario: a signal published by one node is fanned out to the other nodes and never echoed to the sender
    Given three nodes A, B, and C are connected and their handshakes have completed
    When node A publishes a signal frame
    Then node B receives node A's signal frame
    And node C receives node A's signal frame
    And node A receives no frame for its own signal (the relay does not echo the sender)

  # In-memory-only: brokering a signal writes NO durable artifact. R4: pin the UNAFFECTED side
  # hard — the filesystem is BYTE-UNCHANGED across the publish (no file created, modified, or
  # deleted anywhere the relay could write; in particular no .mesh/ record and no relay log).
  Scenario: brokering a signal writes no durable artifact — the filesystem is untouched
    Given two nodes are connected and I record the filesystem state under the workspace
    When one node publishes a signal frame and the other receives it
    Then no file was created, modified, or deleted on disk for that signal
    And no presence record or relay log was written (the relay holds the in-flight signal in memory only)
    And the filesystem under the workspace is byte-unchanged from before the publish

  # The relay is an ephemeral BROKER, not a log/replay: a node that joins AFTER a signal was
  # published does not receive it — only signals published while it is connected reach it.
  # R4: pin BOTH halves — the late joiner misses the BEFORE signal AND receives the AFTER signal
  # (so "missed it" is the broker being ephemeral, not the broker being broken).
  Scenario: a late-joining node receives only signals published after it connects (the relay is not a replay log)
    Given node A is connected and publishes a signal frame "early" with no other node present
    When node B connects after "early" was published
    And node A then publishes a signal frame "late"
    Then node B does not receive the "early" frame (it was not connected when "early" was published)
    And node B receives the "late" frame (published while B was connected)

  # stop() tears the server down cleanly: the port frees and a subsequent connect fails — the
  # serve unit is genuinely disposable (the serveBoard/serveSetupUi teardown discipline).
  # R4: pin the UNAFFECTED side — a connection that was already open at stop() time is closed,
  # not left dangling against a dead server.
  Scenario: stop() tears the broker down cleanly so the port frees and new connects fail
    Given a node is connected to the relay
    When I call stop() on the serve unit
    Then the server stops listening and the port is freed
    And a fresh ws client connecting to the same url fails
    And the previously-open connection is closed (not left dangling)
