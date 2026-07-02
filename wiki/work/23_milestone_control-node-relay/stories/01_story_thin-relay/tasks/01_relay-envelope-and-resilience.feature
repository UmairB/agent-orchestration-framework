@cli @work @distribution @executable
Feature: The relay envelope is frozen and payload-agnostic, and a bad frame errors the sender without ever crashing the broker
  In order to carry presence today and a new signal class (leasing, m26) tomorrow with ZERO relay change, while never being a SPOF a malformed input can topple
  the relay forwards the { kind, nodeId, signal } envelope routing by frame not by signal content, returns the frozen { type:'error', message } control-frame on a malformed/oversized frame, and survives a bad frame or a peer disconnect without dropping the other peers,
  so that the wire is forward-stable (a new kind rides it unchanged) and resilient (one client's garbage errors only that client — the broker and every other peer carry on).

  # ARCHITECTURE ADR-001: the FROZEN, payload-agnostic envelope { kind, nodeId, signal } where
  # `signal` is an OPAQUE blob the relay forwards WITHOUT parsing (presence is the first `kind`;
  # leasing is m26's), plus the 03/ADR-003 never-crash discipline — a malformed / non-JSON /
  # oversized frame yields the frozen { type:'error', message } control-frame, never a throw.
  # This feature asserts the OBSERVABLE wire behaviour — opaque forwarding across signal shapes,
  # the resilience matrix, and a clean peer-disconnect. The SOURCE-level "envelope-neutral"
  # property (the relay imports neither mesh-presence.mjs nor node-identity.mjs and never
  # JSON.parse-then-branches on signal CONTENT) is the acd-relay-envelope-neutral ARCH-TEST
  # (fitness #2) — NOT a scenario here. This feature pins the BEHAVIOUR that arch-test guards.
  #
  # QA FEASIBILITY FLAG (developer-amigo): the oversized-frame case needs a concrete threshold.
  # (a) Is the max frame size a CONFIG value (config.mesh.relay.maxFrameBytes?) or the ws@8
  #     library default (ws's `maxPayload`, default 100 MiB)? The Examples table below pins the
  #     OBSERVABLE outcome (oversized → the frozen error control-frame, broker alive) but leaves
  #     the literal byte boundary as "<over the configured limit>" because QA must not invent the
  #     number — the developer-amigo fixes it (and whether the limit is set via ws `maxPayload`
  #     vs a hand-rolled length check changes whether the sender gets OUR { type:'error' } frame
  #     or ws's protocol-level 1009 close; the contract here is OUR frozen control-frame).
  # (b) Same in-process-ws-on-Windows reliability question as task 00 (the 22/R3 spawn flake is
  #     avoided by going in-process, but the peers-survive assertions are timing-sensitive).
  # Do NOT silently retag — RAISED for the feasibility call; see VERIFICATION.
  #
  # PRE-AUTH POSTURE (ADR-001, deliberate scope decision): the m23 relay carries NO auth — it
  # binds loopback / a trusted LAN and forwards opaque signals; the group credential / relay
  # auth is milestone 24 (SPEC §Out of scope). NO auth scenarios are authored here, by design.
  Background:
    Given a relay stood up in-process via serveRelay on an ephemeral port
    And two nodes are connected: a sender and a peer

  # Payload-agnostic forwarding: the relay routes by FRAME, never branching on `signal` CONTENT,
  # so EVERY signal shape — a known `kind` (presence), an UNKNOWN `kind` (m26 leasing), a deeply
  # nested opaque blob, and a non-JSON-but-valid-frame signal — is forwarded BYTE-FOR-BYTE
  # unchanged to the peer. This is the "zero relay change for m26" property, proven observably.
  # QA: the matrix deliberately spans known/unknown kind AND JSON/non-JSON signal so "payload-
  # agnostic" is proven to mean "forwards the opaque blob" — not "forwards JSON it recognises".
  # R4: pin the UNAFFECTED side — the envelope reaches the peer with `kind` and `signal` INTACT;
  # the relay neither rewrote the signal nor rejected the unknown kind.
  Scenario Outline: the relay forwards every envelope shape unchanged, never branching on signal content
    Given the sender frames an envelope with kind "<kind>" and signal <signal>
    When the sender publishes that envelope
    Then the peer receives an envelope with kind "<kind>"
    And the peer's envelope signal is byte-identical to "<signal>" (forwarded unparsed)
    And the relay neither rewrote the signal nor rejected the unknown kind (it routed by frame, not by field)

    Examples:
      | kind     | signal                                      |
      | presence | a presence-shaped JSON object               |
      | leasing  | an unknown-kind (m26) opaque JSON payload   |
      | presence | a deeply-nested opaque JSON blob            |
      | presence | a non-JSON but valid-frame string signal    |

  # The resilience matrix: a malformed frame / non-JSON garbage / an oversized frame each yields
  # the FROZEN { type:'error', message } control-frame to the SENDER — and the broker process
  # NEVER crashes (the 03/ADR-003 discipline). R4: pin the UNAFFECTED side on EVERY row — the
  # PEER's connection survives the sender's bad frame, and the broker stays alive and serving.
  # QA: the byte boundary for "<oversized>" is the developer-amigo's call (see the FEASIBILITY
  # FLAG above) — this table pins only the OBSERVABLE outcome, identical across all three inputs.
  Scenario Outline: a malformed, non-JSON, or oversized frame errors the sender with the frozen control-frame and never crashes the broker
    Given the peer's connection is open and healthy
    When the sender sends "<bad-input>"
    Then the sender receives a frozen { type:'error', message } control-frame
    And the broker process does not crash and keeps serving
    And the peer's connection is still open (one client's bad frame did not drop the others)
    And the peer is unaffected — it received no error frame and no forwarded garbage

    Examples:
      | bad-input                                          |
      | a malformed frame that is not the { kind } envelope |
      | non-JSON garbage bytes                              |
      | an oversized frame over the configured limit        |

  # A peer DISCONNECT mid-session is handled gracefully: the disconnecting client leaving does
  # not tear down the broker or drop the OTHER peers — the broker keeps fanning out among the
  # survivors. R4: pin the UNAFFECTED side — after one peer drops, a publish from a survivor
  # still reaches the remaining survivor(s), and the broker is still alive.
  Scenario: a peer disconnecting mid-session leaves the broker and the other peers intact
    Given three nodes A, B, and C are connected
    When node C disconnects mid-session
    Then the broker process stays alive (it did not tear down on the disconnect)
    And node A and node B remain connected
    And a signal published by node A is still fanned out to node B (the survivors carry on)
    And no error frame was raised to A or B by C's departure
