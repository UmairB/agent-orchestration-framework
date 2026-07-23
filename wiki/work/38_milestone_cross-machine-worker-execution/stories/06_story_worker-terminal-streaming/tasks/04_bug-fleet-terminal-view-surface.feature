@bug @finding-F-38-06c @executable @ui @work @board @distribution
Feature: The fleet RENDERS the terminal-view — the (nodeId, sessionId) join key reaches the browser, and an assignment's card mirrors its worker's live PTY as a READ-ONLY monitor
  In order that SPEC objective (the operator watches a dispatched run progress in real time FROM the control
  node) actually holds on screen — today the transport is wired (F-38.06 closed) but the mirror has NO consumer:
  `terminal-view` has ZERO matches under `ui/`, so there is no panel to watch and story 06's `@manual` soak is
  structurally unrunnable — the fleet gains a read-only terminal-VIEW on the assignment's card, fed by the
  `/ws/terminal-view?nodeId=&sessionId=` route, resolving its stream from the ADR-013 `session_id`.

  # BLOCKER F-38.06c (raised at `aof:verify 38`, 2026-07-23). The milestone's OWN recurring class, advanced one
  # seam: F-38.05 was a consumer with no producer; F-38.06 was a producer on an unreachable transport; F-38.06c
  # is a reachable producer with NO CONSUMER SURFACE.
  #
  # CONFIRMED AT SOURCE at build time — the break is a THREE-LINK chain, not merely a missing component. ADR-013
  # says the `session_id` is "surfaced on the assignment record"; it is NOT, anywhere a browser can read it:
  #   (1) PERSIST — the worker DOES send it (`worker-stream-client.mjs` `sendAssignmentStatus(..., { sessionId })`,
  #       a literal production call site), but the control side reads ONLY `runId` off that frame
  #       (`control-stream-server.mjs:231-232`) and `global_assignments` has NO session_id column
  #       (`global-work-store.mjs:175-186`) — the join key is dropped on the floor at the control node.
  #   (2) SURFACE — `projectAssignment` (`global-mesh-query.mjs`) carries eight keys, none of them the session id,
  #       so `/api/mesh/status` cannot express which stream an assignment's card should open.
  #   (3) RENDER — no `ui/` terminal-view component exists (grep `terminal-view` in `ui/` = 0 matches).
  # DESIGN §Surface 3 (V1-V9 + the States table) is the binding conformance baseline, authored 2026-07-19.
  # ADR-014 (read-only mirror, multiplex by (nodeId, sessionId), unresolvable-dropped, ephemeral live tail).
  # SECURITY T14 (read-only IN FACT — no mesh->PTY input path; the view must read as a MONITOR, never an
  # attachable shell).
  #
  # PRODUCER-FED OR IT IS NOT EVIDENCE (ADR-008 — this milestone's defining lesson, earned SEVEN times). The
  # persist+surface lanes drive the REAL `control-stream-server` frame handler over a REAL store and read the
  # REAL `/api/mesh/status` shaping — never a hand-built assignment row. The render lanes drive the
  # framework-free `.mjs` view helpers the `.tsx` itself imports (the `ui/src/board/terminal/` +
  # `test/terminal-dock.test.mjs` house precedent) — headless, no browser. The ON-SCREEN render is judged at the
  # design-conformance gate against §Surface 3, and the live cross-machine stream stays task 03's `@manual` soak.

  Background:
    Given a REAL global work store and the REAL control-stream-server assignment-status frame handler
    And the REAL `/api/mesh/status` shaping over that store

  # LINK 1 — PERSIST. The join key the worker already sends must survive at the control node.
  Scenario: the session_id a worker reports on its assignment-status frame is PERSISTED on the assignment record
    Given an assignment row held by node "node-a"
    When the worker sends an assignment-status frame carrying its captured session id "sess-1"
    Then the stored assignment row carries that session id — it is no longer dropped at the frame handler
    And re-reading the row returns it verbatim, so the join key survives a control-node restart
    And a pre-existing database WITHOUT the column is migrated in place (idempotent), never recreated nor wiped
    And a frame carrying NO session id leaves any previously-captured value intact — absent is not a clear

  # LINK 2 — SURFACE. The persisted key must reach the browser through the read shape.
  Scenario: the assignment projection SURFACES the session id, so a card can resolve its stream
    Given an assignment row whose session id has been captured
    When the fleet status payload is shaped
    Then that assignment's projected row carries the session id alongside its target node id
    And every pre-existing projected key keeps its meaning byte-for-byte — this is ADDITIVE only
    And an assignment with no session id yet carries no fabricated placeholder — absent, not an empty string

  # LINK 3 — RENDER. Resolution + the state ramp, over the helpers the component itself imports.
  Scenario Outline: a card resolves its stream from the surfaced session_id — or honestly declines to subscribe
    Given an assignment projected with target node <nodeId> and session id <sessionId>
    When the card resolves its terminal stream
    Then the resolution is <outcome>
    And it NEVER subscribes to a guessed, defaulted, or sibling session (ADR-014 invariant 4)

    Examples:
      | nodeId | sessionId | outcome                                                        |
      | node-a | sess-1    | the (node-a, sess-1) stream                                    |
      | node-b | sess-2    | the (node-b, sess-2) stream                                    |
      | node-a | absent    | NO stream — the card shows no terminal, and opens no socket    |
      | absent | sess-1    | NO stream — an unresolvable tuple never opens a socket         |

  # V7/V9 — the honest state axis. An empty mirror is the DESIGNED normal, not a failure; a dead stream must
  # never masquerade as a live one.
  Scenario Outline: the terminal-view state reads honestly at every point in its life
    Given a terminal-view subscribed to (node-a, sess-1)
    When <event>
    Then the view state reads <reads>
    And a NORMAL empty or ended state is never rendered as an error nor as an endless spinner (V7/V9)

    Examples:
      | event                                          | reads                                    |
      | it has subscribed but no byte has arrived      | an honest waiting/empty state            |
      | the first PTY bytes arrive                     | streaming live                           |
      | the stream closes cleanly                      | ended — not a frozen pretend-live frame  |
      | the transport fails                            | a disconnected/error state, legibly      |

  # V2/V5/V6 — read-only IN FACT and IN LOOK, asserted STRUCTURALLY over the real component source (the
  # `acd-fleet-terminal-mirror-read-only` plant-and-trip precedent), not merely "we did not type in a test".
  Scenario: the fleet terminal-view is a MONITOR — no input affordance exists in the component
    Then the fleet terminal-view component opens its socket read-only and registers NO handler that sends a
      browser-originated frame up the terminal-view socket (server->browser only, ADR-014 invariant 1)
    And it wires NO terminal input source — no `onData`-to-socket path, the direction the board dock DOES wire
    And the read-only posture is carried by an explicit LABEL, never by colour or the absence of a box alone (V2/V6)
    And the fitness TRIPS when an input-forwarding path is planted into the fleet view, so ADDING one FAILS CI
    And its self-check confirms the real component is asserted CLEAN first (each plant differs from the baseline)

  # V1/V8 — the view always names its stream, and two streams never cross-wire.
  Scenario: the view NAMES its stream, and multiplexed cards never cross-wire
    Given two assignments streaming — (node-a, sess-1) and (node-b, sess-2)
    Then each view's header identifies its OWN (nodeId, sessionId), resolved to the assignment ref it belongs to
    And neither view is ever handed the other's bytes — the subscription key is the full tuple, not the node alone
    And a terminal with no visible owner is never rendered (V1)

  # V3 — reuse the board's terminal idiom; the UI build must stay green (the milestone's own craft lesson:
  # `node scripts/test.mjs` does NOT type-check the fleet TS, so a `.mjs` helper consumed from `.tsx` needs its
  # `.d.mts` companion or `tsc -b` breaks while the node suite stays green).
  Scenario: the view reuses the existing terminal rendering, and the typed UI build stays green
    Then the bytes render through the same xterm terminal idiom the board dock already uses — no fleet-local
      terminal chrome, colour, frame, or "streaming" accent is invented (V3/S5)
    And every new framework-free `.mjs` view helper ships its `.d.mts` companion, so `tsc -b && vite build` passes
