@manual @cli @work @distribution
Feature: the live worker→control stream over a real tailnet — the control-node UI updates in real time, survives a drop, and marks a stopped worker stale
  In order to prove the real-time promise on the fabric the fixtured lanes stand in for, a real worker
  (macOS) holds a live stream to a real control node (Windows) over Tailscale, and the control node's
  `aof mesh ui` reflects the worker's work as it happens, recovers after the connection is severed, and marks
  the worker stale when it stops.

  # ARCHITECTURE ADR-007 — the live-stream soak. @manual BECAUSE the connection lifecycle (real WebSocket over
  # real NAT-traversed Tailscale, real reconnect timing, real heartbeat/staleness latency) only manifests
  # across two live machines; the @executable 00–03 lanes prove the seam over injected transports, THIS lane
  # proves it against the real fabric. Recorded as a VERIFICATION-time observation, not a CI assert. It is the
  # lane ADR-007 flags as the testability cost of choosing a live stream (budget for it — the 33/F-3302 lesson).
  #
  # NO Examples table: a single narrative run over two specific real hosts.

  Background:
    Given a real control node (Windows, `umairs-msi`) running the always-on stream server on `mesh serve`
    And a real worker (macOS, `umairs-mac-mini`) on the SAME Tailscale tailnet, config.mesh.relay.controlNode = umairs-msi
    And `aof mesh ui` open on the control node

  # REAL-TIME: work done on the worker appears on the control node's UI within a small, recorded latency —
  # no manual refresh, no git pull.
  Scenario: work run on the worker appears on the control node UI in real time
    Given the worker opens its stream to the control node
    When the operator runs a work item to completion on the worker
    Then the control node's `aof mesh ui` shows that item advancing to done WITHOUT a manual refresh
    And the observed stream latency (change → visible on control) is recorded

  # SURVIVES A DROP: sever the link, change work on the worker, restore the link — the control node converges.
  Scenario: the stream recovers after the connection is severed and the control node reconciles
    Given the worker is streaming and the control node shows it live
    When the worker's connection to the control node is severed
    And the operator advances a work item on the worker while disconnected
    And connectivity is restored
    Then the worker reconnects on its own
    And the control node's view converges to include the item advanced during the outage
    And the observed reconnect latency is recorded

  # STALE MARKING: a stopped worker is visibly stale, never silently frozen as if current.
  Scenario: a stopped worker is marked stale on the control node
    Given the worker is streaming and shown live on the control node
    When the operator stops the worker (its stream ends and heartbeats cease)
    Then the control node marks that worker's stream stale within the staleness window
    And the observed time-to-stale is recorded
