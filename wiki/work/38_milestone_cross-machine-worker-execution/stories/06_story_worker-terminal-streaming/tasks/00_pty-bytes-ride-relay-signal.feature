@executable @cli @work @distribution
Feature: The worker's `/ws/terminal` PTY byte stream rides the FROZEN `mesh-relay.mjs` envelope as a NEW opaque `signal` kind, routed by (nodeId, sessionId), with ZERO relay change
  In order that a worker's live terminal reaches the control node WITHOUT touching the relay (preserving the
  m26-leasing / frozen-envelope property — a new `kind` rides the wire with zero relay change), the bridge wraps the
  worker's `term.onData` PTY output as the OPAQUE `signal` blob of a NEW `kind` (e.g. `"terminal-frame"`), carries
  `sessionId` INSIDE that signal beside the envelope's existing `nodeId`, and hands each frame to the relay — whose
  `parseEnvelope` reads ONLY `{ kind, nodeId }` and fans the original bytes out unparsed.

  # ARCHITECTURE 38/ADR-014 (the bridge: PTY bytes ride the FROZEN relay envelope as a NEW opaque `signal` kind, routed
  # by (nodeId, sessionId) with sessionId carried INSIDE the signal; invariant 2 — the relay's `parseEnvelope` still reads
  # only `{ kind, nodeId }` and forwards `signal` unparsed; invariant 4 — routing is by (nodeId, sessionId)). ADR-013 (the
  # `session_id` captured on the assignment/presence record is the routing join key). mesh-relay.mjs:285-298 (`parseEnvelope`
  # reads only `{ kind, nodeId }`), :592-602 (fan-out re-emits the ORIGINAL frame bytes — opaque signal, unknown kind
  # forwarded, the m26 leasing property). terminal-ws.mjs:257-263 (the `term.onData` PTY→client OUTPUT the bridge wraps).
  #
  # @executable over INJECTED seams — a FAKE relay transport that records every routed envelope, a FAKE PTY byte source, and
  # an in-memory bridge. NO real second machine, no real relay socket, no real PTY (that is task 03's @manual soak).

  Background:
    Given a fake PTY byte source emitting output frames for a worker session
    And a fake relay transport that records every routed envelope
    And the bridge wrapping the PTY output onto the relay

  Scenario: the PTY output rides a NEW kind as the opaque signal, routed by (nodeId, sessionId)
    Given the PTY source emits bytes for node "node-a", session "sess-1"
    When the bridge wraps that output and hands it to the relay
    Then each recorded envelope's `kind` is the NEW terminal-frame kind, never `presence` nor a mutated existing kind
    And the envelope's `nodeId` is "node-a" (the routing field the relay reads)
    And the `sessionId` "sess-1" rides INSIDE the opaque `signal`, never added as a new top-level envelope key
    And the PTY bytes are carried in `signal` byte-for-byte — unmodified from what `term.onData` emitted

  Scenario: the relay envelope shape is UNBROKEN — a new kind rides with zero relay change
    Given a recorded terminal-frame envelope produced by the bridge
    Then it has EXACTLY the frozen envelope keys `{ kind, nodeId, signal }` — no fourth top-level key
    And `parseEnvelope` accepts it by reading ONLY `{ kind, nodeId }`, never `JSON.parse`-branching on `signal` content
    And the relay fans the ORIGINAL frame bytes out unparsed — no rewrite, no re-serialization of the `signal`
    And an unknown `kind` is forwarded, never rejected (the m26 leasing property the bridge relies on)

  # The routing tuple = envelope `nodeId` + the `sessionId` read out of the opaque `signal`. Row 3 (node-a again, a second
  # session) proves ONE node multiplexes sessions — the sessionId disambiguates within a nodeId (ADR-014 invariant 4).
  Scenario Outline: the routing key is (nodeId, sessionId) — the envelope's nodeId plus the sessionId inside the signal
    Given the PTY source emits bytes for node <nodeId>, session <sessionId>
    When the bridge wraps that output
    Then the recorded envelope's `nodeId` is <nodeId>
    And the sessionId extracted from inside the `signal` is <sessionId>
    And the stream's routing tuple is exactly (<nodeId>, <sessionId>) — the join key ADR-013 surfaces on the assignment record

    Examples:
      | nodeId | sessionId                            |
      | node-a | 5f3c1e00-ab90-4d21-9f7a-0011223344aa |
      | node-b | 7e21aa10-cd34-4a55-8b0c-99887766ddee |
      | node-a | 0c14bb20-ef56-4c66-7d1e-1122aabbccdd |
