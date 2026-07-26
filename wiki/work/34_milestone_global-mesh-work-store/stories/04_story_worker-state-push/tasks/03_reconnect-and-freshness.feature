@executable @cli @work @distribution
Feature: reconnect snapshots reconcile missed stream changes and freshness labels expose gaps
  In order that a stream outage costs freshness but never corrupts local truth, the worker keeps its canonical
  work records locally, the control-node global store remains stale until the WebSocket stream reconnects,
  and the reconnect snapshot converges the control-node projection to the worker's true state.

  # ARCHITECTURE ADR-007: WebSockets are the cross-machine mesh sync path. There is no git-bus fallback, no
  # lease bus, and no per-workspace mesh sync. When the stream is unavailable, the correct behavior is a
  # visible stale/never-connected state plus retry; convergence happens through the reconnect snapshot.

  Scenario: with the stream down, the control-node projection is stale until reconnect
    Given a worker whose stream to the control node is unavailable
    And the worker has completed a run locally
    When the control node reads its global store before the worker reconnects
    Then the control node still shows the last streamed state for that worker
    And the worker is labelled stale or never-connected

  Scenario: a change missed during a disconnect is reconciled by the reconnect snapshot
    Given a worker connected to the control node
    When the connection drops, the worker advances an item, and the worker then reconnects
    Then the reconnect snapshot includes the advanced item
    And the control node's global store matches the worker's current state

  Scenario Outline: the control-node view labels each worker's freshness
    Given a worker that is <situation>
    Then the control-node view labels it "<freshness>"

    Examples:
      | situation                                           | freshness       |
      | streaming and heartbeating now                      | live            |
      | previously streamed but its stream has dropped      | stale           |
      | visible on the fabric but has never opened a stream | never-connected |