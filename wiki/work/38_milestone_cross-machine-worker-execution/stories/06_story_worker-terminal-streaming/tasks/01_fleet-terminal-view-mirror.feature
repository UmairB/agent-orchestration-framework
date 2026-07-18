@executable @ui @work @board @distribution
Feature: The fleet face gains a READ-ONLY terminal-VIEW route serving an IN-MEMORY EPHEMERAL mirror — multiplexing (nodeId, sessionId) streams, discovering each session's assignment via the surfaced `session_id`
  In order that an operator watches a dispatched run's live terminal from the control node with NO system of record
  (the mesh-presence-subscriber pattern — an in-memory ephemeral tail; kill it and the fleet loses the live VIEW, not
  data), the fleet face feeds a read-only `GET /ws/terminal-view?nodeId=&sessionId=` mirror from an in-memory
  subscription to the relay's terminal-frames, keyed by (nodeId, sessionId), resolving a card's stream from the
  `session_id` ADR-013 surfaced on the assignment record.

  # ARCHITECTURE 38/ADR-014 (carve-out #2 — the read-only terminal-VIEW route; the in-memory ephemeral mirror that writes
  # NO durable record and is NEVER a second system of record; multiplex by (nodeId, sessionId); invariant 3 — in-memory +
  # never a system of record; invariant 4 — a frame with no resolvable (nodeId, sessionId) is DROPPED, never broadcast).
  # ADR-013 (the `session_id` surfaced on the assignment record is the discovery + routing join key). ADR-006/ADR-012 +
  # mesh-ui-serve.mjs:218-227 (the DELIBERATE upgrade-destroy read-only posture this carve-out is the SECOND exception to,
  # after story-04's assign).
  #
  # @executable over INJECTED seams — a FAKE relay feed that replays recorded terminal-frames, an in-memory mirror, and a
  # FAKE terminal-VIEW subscriber. NO real second machine, no real relay socket, no real browser (that is task 03's @manual soak).

  Background:
    Given an in-memory mirror subscribed to a fake relay feed of terminal-frames
    And a fake terminal-VIEW subscriber that can open on a given (nodeId, sessionId)

  Scenario: the mirror is in-memory + EPHEMERAL — it writes no durable record, and a rebuild starts empty
    Given terminal-frames for (node-a, sess-1) have flowed through the mirror
    Then the mirror has written NO durable record — no file, no store row, no persisted transcript (the acd-relay-stateless discipline)
    And discarding and recreating the mirror yields an EMPTY mirror — the live view is lost, the run's data is not (its durable bookkeeping is the run record, its diff is story-07's push)
    And a client that subscribes AFTER frames have flowed is not served a persisted full history — the mirror is a live tail, never a system of record

  Scenario: opening an assignment's card discovers its stream from the surfaced `session_id`
    Given an assignment record surfacing nodeId "node-a" and `session_id` "sess-1" (ADR-013)
    When the fleet opens that assignment's card
    Then it resolves the (nodeId, sessionId) join key from the surfaced `session_id` and subscribes to exactly that stream
    And an assignment with no `session_id` surfaced yet shows no terminal stream — it never subscribes to a guessed or wrong session

  Scenario: a frame with no resolvable (nodeId, sessionId) is DROPPED, never broadcast to an unrelated card
    Given a terminal-VIEW open on (node-a, sess-1)
    When a terminal-frame arrives for (node-z, sess-unknown) that matches no open card
    Then it is dropped by the mirror — never delivered to the (node-a, sess-1) view (ADR-014 invariant 4)
    And the arrival of that unroutable frame does not error nor tear down the existing streams

  # Correct routing across ≥2 concurrent sessions, INCLUDING same-node multiplex (row 3): the sessionId disambiguates
  # within a nodeId, so node-a's two cards never cross-talk.
  Scenario Outline: the mirror MULTIPLEXES — each terminal-VIEW receives only its own (nodeId, sessionId), no cross-talk
    Given concurrent terminal-frames flowing for (node-a, sess-1), (node-b, sess-2), and (node-a, sess-2)
    When a terminal-VIEW subscribes to (<nodeId>, <sessionId>)
    Then it receives every frame whose routing tuple equals (<nodeId>, <sessionId>) — <receives>
    And it receives NO frame for any other (nodeId, sessionId) — no cross-talk between streams

    Examples:
      | nodeId | sessionId | receives                                              |
      | node-a | sess-1    | node-a/sess-1 frames only                             |
      | node-b | sess-2    | node-b/sess-2 frames only                             |
      | node-a | sess-2    | node-a/sess-2 only — same node, session disambiguates |
