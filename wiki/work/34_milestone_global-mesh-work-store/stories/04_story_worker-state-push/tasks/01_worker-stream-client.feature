@executable @cli @work @distribution
Feature: a worker streams its work-state to the control node — a full snapshot first, then deltas, over a self-healing connection
  In order to keep the control node continuously current without losing data across drops, a worker opens a
  persistent connection to the control node, sends a full snapshot before any delta, streams each subsequent
  work-state change as a delta, reconnects with backoff after a drop (re-sending a snapshot first), and
  heartbeats — while a stream outage never blocks or rolls back a local work mutation.

  # ARCHITECTURE ADR-007 (snapshot-then-deltas; reconnect+backoff; heartbeat; a dropped stream never loses
  # truth because the reconnect snapshot reconciles). WebSocket-vs-SSE + the delta schema are ADR-007 refine
  # open questions — NOT asserted here; this feature asserts only the observable FRAME ORDER, reconnect, and
  # failure-isolation. "Never blocks the local write" is the ADR-004 failure posture extended to the stream.
  #
  # RESOLVED (developer-amigo): tested over an INJECTED transport (a fake channel recording sent frames +
  # scriptable to drop) and an INJECTED ticker/clock — both are house precedents (mesh-relay-client.mjs's
  # injected connect, the launcher's injected ticker), so the whole lifecycle is
  # @executable with no real socket and no wall-clock wait. ws@8 (still a dependency) is the production
  # default transport; the real two-machine soak is task 04 (@manual).

  # THE FRAME CONTRACT: the FIRST frame on any (re)connection is a full snapshot; work-state changes after it
  # are deltas — so a fresh reader is never fed a delta against state it has not seen.
  Scenario: the first frame on a connection is a full snapshot, then changes are deltas
    Given a worker with two active work items
    When the worker connects to the control node and then one item advances
    Then the first frame sent is a full snapshot of the worker's work-state
    And the next frame sent is a delta describing only the advanced item

  # SELF-HEALING: a dropped connection reconnects (backoff observable over the injected ticker) and re-sends a
  # snapshot first, so nothing missed while disconnected is applied as an orphan delta.
  Scenario: after a drop the worker reconnects and re-sends a full snapshot before deltas
    Given a worker connected to the control node
    When the connection drops and the reconnect backoff elapses
    Then the worker opens a new connection
    And the first frame on the new connection is a full snapshot

  Scenario Outline: reconnect backoff grows then caps
    Given a worker whose connection has dropped <n> consecutive times
    Then the next reconnect is scheduled after <delay>

    Examples:
      | n | delay |
      | 1 | 1s    |
      | 2 | 2s    |
      | 3 | 4s    |
      | 9 | 30s   |

  # FAILURE ISOLATION (ADR-004 posture): the stream is best-effort; a transport fault must never change a
  # local work command's result or leave its canonical record unwritten.
  Scenario Outline: a stream fault never blocks or rolls back the local work write
    Given a worker whose stream transport is <transport-state>
    When the worker completes a run locally
    Then the local run record is written and the command reports success
    And the stream fault (if any) is surfaced only as a warning

    Examples:
      | transport-state       |
      | connected             |
      | disconnected          |
      | throwing on send      |
