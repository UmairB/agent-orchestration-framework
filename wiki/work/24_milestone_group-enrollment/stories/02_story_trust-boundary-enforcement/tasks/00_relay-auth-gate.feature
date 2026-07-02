@cli @work @distribution @executable
Feature: serveRelay's ws upgrade handler CHECKS a connecting node's credential against the LIVE roster/revocation before brokering — absent / invalid / not-in-roster / revoked is rejected, loopback stays the local default
  In order to turn milestone 23's pre-auth loopback relay into a real credential-gated group boundary — the 22/R6 "the credential is actually USED" guard
  serveRelay's server.on("upgrade") handler gains an ADDITIVE gate that, for a group (non-loopback) connection, reads the presented relayAuth token and verifies it against the LIVE roster AND revocation list via verifyCredential(readRegistry(workspace), token) before the socket joins the clients fan-out set,
  so that a VALID credential is admitted and receives brokered frames, an absent / invalid / not-in-roster / REVOKED one is destroyed upstream of the broker (the same reject shape the pathname mismatch uses — no ws emitted), and a same-host loopback connection keeps working with no credential.

  # ARCHITECTURE ADR-003 (move 2 — the relay auth-gate additive to serveRelay's upgrade
  # handler) + ADR-004 (a revoked credential is rejected at the SAME gate). SECURITY T1
  # (the m23 pre-auth spoofing window) + T6 (a revoked node loses relay access). The gate
  # is ADDITIVE to the handler that today routes by pathname to RELAY_PATH and
  # socket.destroy()s everything else (23/ADR-001) — it reads the credential seam
  # verifyCredential(registry, token) (a pure READ imported from src/mesh-registry.mjs that
  # checks the LIVE roster AND revocation list) and rejects with the SAME socket.destroy()
  # shape the pathname mismatch uses. This feature asserts the OBSERVABLE ADMIT/REJECT
  # behaviour — a valid credential joins the fan-out and receives frames; an absent /
  # invalid / not-in-roster / revoked one is destroyed BEFORE clients.add; loopback stays
  # the local default; the relay persists NOTHING at the gate. The SOURCE-LEVEL invariant —
  # that the upgrade admission CALLS a credential-verify seam AND rejects on failure reading
  # the LIVE revocation/roster before clients.add — is the security-owned
  # acd-relay-auth-gate-checked ARCH-TEST, NOT a scenario here; the relay stays a stateless
  # READ (no durable write) so m23's acd-relay-stateless / acd-relay-envelope-neutral stay
  # GREEN (arch-tests, not scenarios). The relayAuth token is treated as an OPAQUE string —
  # its entropy + the constant-time compare are the security fitness, NOT asserted here.
  #
  # QA FEASIBILITY FLAG (developer-amigo): every scenario drives an IN-PROCESS ws client (the
  # m03 terminal-ws / 23-story-01 pattern) against an in-process serveRelay on an EPHEMERAL
  # port (port: 0) — no spawned CLI, no network. The registry roster/revocation is seeded via
  # story 00's writeRegistry over a workspace fixture; the revoked-denied case writes a
  # revocation via writeRegistry then reconnects. The client presents its relayAuth token on
  # the upgrade via the `ws` client options (a Sec-WebSocket-Protocol subprotocol OR an auth
  # header — the client CAN set either in-process). RAISED — a genuine developer-contract
  # decision: the EXACT credential carrier on the ws upgrade (Sec-WebSocket-Protocol
  # subprotocol vs. an Authorization / custom header) is a contract detail the auth-gate and
  # the mesh-relay-client MUST agree on; it needs a decision so the step defs bind the same
  # carrier the client sets. This does NOT block @executable (the in-process ws client can
  # set either), so the tag STAYS @executable — the carrier is noted for the developer, NOT a
  # retag. Loopback vs group is distinguished by the connection's remote address
  # (same-host → loopback default, non-loopback → credential required); the fixture drives
  # both. The token-compare constant-time is the security fitness, not asserted here.
  # Buildable @executable; the ws credential-carrier decision RAISED (not a blocker).
  Background:
    Given a relay stood up in-process via serveRelay on an ephemeral port (port 0)
    And a workspace fixture whose registry I seed via story 00's writeRegistry (roster + revocation)
    And in-process ws clients can present a relayAuth token on the upgrade (via the ws client options)
    And the relay is reachable as a group (non-loopback) connection except where a loopback connection is stated

  # The admit case: a VALID credential — a relayAuth token whose nodeId is in the roster and
  # NOT in the revocation list — presented on the upgrade is ADMITTED. The socket joins the
  # clients fan-out set and receives frames a peer publishes (the credential is load-bearing:
  # a valid one buys a working relay peer, the receive-side of story 01's issuance).
  Scenario: a valid credential (nodeId in the roster, not revoked) presented on the upgrade is admitted and receives brokered frames
    Given the roster admits node "node-ok" and the revocation list is empty
    And node "node-ok" presents its valid relayAuth token on a group upgrade
    When node "node-ok"'s upgrade is handled
    Then the upgrade is accepted and the socket joins the clients fan-out set
    And when another connected peer publishes a signal frame, node "node-ok" receives it

  # The reject matrix — the admit/reject truth table QA owns (SECURITY T1/T6). For a group
  # (non-loopback) connection: an ABSENT credential, an INVALID token, a not-in-roster
  # nodeId, and a REVOKED nodeId are each REJECTED — socket.destroy(), the SAME reject shape
  # the pathname mismatch uses (no ws is emitted; the socket never joins clients). Only a
  # valid, admitted, un-revoked credential is admitted.
  # R4: on every reject row, pin the UNAFFECTED side hard — the rejected socket NEVER reaches
  # clients.add, so the clients fan-out set is unchanged by a rejected upgrade.
  Scenario Outline: the reject matrix — absent / invalid / not-in-roster / revoked is destroyed, only a valid credential is admitted
    Given a group upgrade presenting <credential>
    When that upgrade is handled by the auth-gate
    Then the upgrade is <admitted>
    And when it is rejected the socket is destroyed (the same shape the pathname mismatch uses, no ws emitted)
    And when it is rejected the socket never joins the clients fan-out set

    Examples:
      | credential                                       | admitted     |
      | a valid token (in roster, not revoked)           | admitted     |
      | no credential (absent)                           | rejected     |
      | an invalid / unrecognised token                  | rejected     |
      | a token whose nodeId is not in the roster        | rejected     |
      | a token whose nodeId is in the revocation list   | rejected     |

  # The check reads the LIVE roster + revocation list AT upgrade time (via verifyCredential /
  # story 00's readRegistry), not a snapshot cached at serve-start: a node admitted, then
  # REVOKED via writeRegistry AFTER its credential was issued, is rejected on its NEXT connect
  # — the 22/R6 "the credential is actually USED" loop closes here (issue in 01 → check the
  # live state in 02). R4: pin BOTH halves — the same token that was admitted BEFORE the
  # revocation is rejected AFTER it (the gate re-reads; a revocation is not a serve-restart).
  Scenario: the gate reads the LIVE roster + revocation at upgrade time — a node revoked after issuance is rejected on its next connect
    Given node "node-live" is admitted in the roster and connects with a valid token (admitted)
    When a revocation for "node-live" is appended via writeRegistry after that first connect
    And node "node-live" reconnects with the SAME token
    Then the reconnect is rejected (the gate re-read the live revocation list, not a serve-start snapshot)
    And the still-admitted peer "node-ok" connecting with its valid token is still admitted (the gate rejects only the revoked nodeId)

  # Loopback stays the local default (ADR-003 move 2; A3 "the relay binds loopback by
  # default"): a same-host loopback connection needs NO credential and is admitted — the gate
  # is ADDITIVE to that posture, not a rewrite. A group (non-loopback) connection with no
  # credential is rejected. R4: pin BOTH halves — the loopback-no-credential admit AND the
  # group-no-credential reject, so "admitted with no credential" is the loopback default, not
  # the gate being absent.
  Scenario: loopback stays the local default (no credential, admitted) while a group connection with no credential is rejected
    Given a loopback (same-host) connection presenting NO credential
    When that loopback upgrade is handled
    Then it is admitted (loopback stays the m23 local default — no credential needed)
    And a group (non-loopback) connection presenting NO credential is rejected (a group connection requires a valid credential)

  # The gate gates BEFORE any signal is brokered (R4 — the reject is UPSTREAM of the broker):
  # an uncredentialed group connection never reaches clients.add, so it never receives a
  # fanned-out frame. R4: pin the UNAFFECTED side — a valid peer's publish reaches the OTHER
  # admitted peers but NOT the rejected socket (which was destroyed before it could join).
  Scenario: an uncredentialed connection never reaches clients.add and never receives a fanned-out frame (the gate is upstream of the broker)
    Given an admitted valid peer "node-ok" and an uncredentialed group connection that was rejected
    When peer "node-ok" publishes a signal frame
    Then the rejected connection received no frame (it never joined the clients fan-out set)
    And no signal was brokered to the rejected socket (the gate is upstream of clients.add)

  # R4 pin: the relay persists NOTHING at the gate — the auth-gate is a READ of the registry
  # + a reject/admit decision, never a durable write. The filesystem under the workspace is
  # BYTE-UNCHANGED across BOTH a rejected upgrade AND an accepted one (no relay log, no
  # .mesh/ record written by the gate) — so m23's acd-relay-stateless stays GREEN (the gate
  # reads the registry, it does not write one).
  Scenario: the auth-gate persists nothing — the filesystem is byte-unchanged across a rejected AND an accepted upgrade
    Given I record the filesystem state under the workspace
    When a group upgrade with no credential is rejected
    And a group upgrade with a valid credential is admitted
    Then no file was created, modified, or deleted on disk for either upgrade
    And no relay log and no .mesh/ record was written by the gate (it is a READ + a decision)
    And the filesystem under the workspace is byte-unchanged from before both upgrades (acd-relay-stateless stays GREEN)
