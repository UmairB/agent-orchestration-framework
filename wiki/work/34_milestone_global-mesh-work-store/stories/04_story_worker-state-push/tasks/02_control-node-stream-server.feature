@executable @cli @work @distribution
Feature: the control node's always-on server ingests worker streams into the global store, tailnet-only and redacted
  In order to present a real-time machine-wide view, the control node runs a server that admits only tailnet
  peers, applies each worker's snapshot-then-deltas into the global store (with secrets redacted before they
  land), and tracks each worker's stream as live, stale, or disconnected.

  # ARCHITECTURE ADR-007 (always-on server on the control-node launcher; tailnet is the admission boundary,
  # 33/ADR-002 — no token/device-code; apply through the SAME publisher + redaction path as ADR-004/ADR-005;
  # per-worker stream liveness). "Admits only tailnet peers" + "no other module writes the global store" are
  # structural → the fitnesses acd-control-stream-tailnet-only / acd-global-publisher-single-seam, not steps;
  # THIS feature asserts the observable admit/refuse, the resulting store state, redaction, and liveness label.
  #
  # RESOLVED (developer-amigo): tested over the INJECTED transport of task 01 (the paired fake channel) + an
  # injected peer-identity signal (the fabric "is this a tailnet peer" fact, mirroring mesh-fabric's injected
  # exec) + an injected clock for the staleness window. The server shape adapts the parked serveRelay's ws
  # accept loop (mesh-relay.mjs) — re-implemented against the redacting publisher, not resurrected verbatim
  # (ADR-007 open Q4). No live tailnet; the real ingest is task 04 (@manual).

  # ADMISSION: the fabric is the boundary — a tailnet peer connects; a non-peer is refused with no store write.
  Scenario Outline: the server admits a tailnet peer and refuses a non-peer
    Given an inbound stream connection whose origin is <origin>
    When the control-node server evaluates admission
    Then the connection is <outcome>
    And a refused connection writes nothing to the global store

    Examples:
      | origin           | outcome  |
      | a tailnet peer   | accepted |
      | a non-peer host  | refused  |

  # INGEST: an admitted worker's snapshot then deltas make the global store reflect that worker's work-state.
  Scenario: an admitted worker's snapshot and deltas are applied to the global store
    Given an admitted worker streaming a snapshot of two work items, one running
    When a delta reports the running item completed
    Then the control node's global store shows both items for that worker
    And that item's state is "done"

  # REDACTION (ADR-005): a secret-shaped field in a streamed frame never lands in the global store/descriptor.
  Scenario: secret-shaped fields are redacted before entering the global store
    Given an admitted worker whose streamed frame includes a field that looks like a relay credential
    When the server applies the frame
    Then the stored worker descriptor does not contain the credential value

  # LIVENESS: the server labels each worker's stream so the UI can tell current from stale from gone.
  Scenario Outline: a worker's stream liveness label follows its connection and heartbeat
    Given a worker whose stream is <condition>
    Then the control node labels that worker's stream "<label>"

    Examples:
      | condition                                   | label        |
      | connected and heartbeating                  | live         |
      | connected but no heartbeat within the window| stale        |
      | disconnected                                | disconnected |
