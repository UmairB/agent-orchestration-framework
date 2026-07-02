@cli @work @distribution @executable
Feature: mesh:heartbeat assembles and publishes this node's presence record over git, a derived projection of the clock and the run records
  In order to make "what this node is working on right now" a durable, git-tracked fleet signal that extends milestone 20's single-node liveness
  the mesh:heartbeat command assembles this node's presence record (its id, the heartbeat instant, its in-flight run ids, its aof version) and publishes it through the store's reserved presence seam,
  so that the record is the complete frozen schema, byte-equivalent on read-back, rebuildable from the clock and run records, and a republish bumps only this node's heartbeat while leaving every peer's record untouched — git alone, no relay.

  # ARCHITECTURE ADR-002: src/mesh-presence.mjs assembles the presence record + the
  # activeRuns read of the run records (m20/19), persisted through src/mesh-store.mjs's
  # RESERVED presenceRecordPath via the atomic writeText seam, registered AS the one-shot
  # mesh:heartbeat command (the testable unit). This feature asserts the COMMAND's
  # run-surface: the frozen schema {nodeId, heartbeatAt, activeRuns[], aofVersion}, the
  # activeRuns READ (not a re-scan, not a run-record mutation), byte-equivalence on
  # read-back, rebuildability, and the republish-bumps-self / leaves-peer-untouched shape.
  # The presence WRITE-SCOPE discipline (every write joins presenceRecordPath/meshDir +
  # routes through writeText + references zero record-doc filename) is the
  # acd-presence-write-scope ARCH-TEST (fitness #3) — NOT a scenario here. The EOL pin is
  # the acd-mesh-eol-pinned ARCH-TEST (fitness #6). The over-git peer render is task 02
  # (@manual). This feature works over the local filesystem; it never invokes the sync
  # engine (story 02 moves the records) and never imports a relay (story 01 is parallel).
  Background:
    Given an initialised aof project whose work stream is a fixture I control
    And the mesh commands registered in the command core
    And this node has a stable mesh.nodeId (the same id its node record carries)

  # mesh:heartbeat with no in-flight runs publishes THIS node's presence record carrying
  # the COMPLETE frozen schema, all keys present and correctly typed, and persists it
  # under the reserved presence seam — the publish path.
  Scenario: mesh:heartbeat publishes this node's presence record with the complete frozen schema
    Given this node has no running runs
    When I invoke mesh:heartbeat to publish this node's presence
    Then a presence record for this node's id is persisted under the partition root's presence seam
    And the returned record carries "nodeId" equal to this node's mesh.nodeId
    And the returned record carries "heartbeatAt" as an ISO-8601 UTC-Z instant
    And the returned record carries "activeRuns" as an empty list
    And the returned record carries "aofVersion" as a non-empty string
    And the returned record carries no keys beyond the frozen schema
    And the persisted record is byte-equivalent to the returned record

  # activeRuns is READ from the run records (m20/19): a node with N running runs lists
  # EXACTLY those run ids — no extras, none dropped — and only RUNNING runs appear (a
  # queued or terminal run is not "in flight").
  Scenario: mesh:heartbeat reads activeRuns from the run records and lists exactly the in-flight run ids
    Given this node has running runs "run-a1", "run-b2" and "run-c3" in its run records
    And this node has a queued run "run-q0" and a terminal run "run-z9" in its run records
    When I invoke mesh:heartbeat to publish this node's presence
    Then "activeRuns" lists exactly "run-a1", "run-b2" and "run-c3" (no extras, none dropped)
    And "activeRuns" does not list the queued run "run-q0"
    And "activeRuns" does not list the terminal run "run-z9"

  # The activeRuns read is a READ, not a write: publishing presence MUST NOT mutate a run
  # record (presence reads the run dimension and publishes to the presence dimension).
  # R4: pin the UNAFFECTED side — a run record this node reads is byte-unchanged by the
  # heartbeat.
  Scenario: publishing presence reads the run records without mutating them
    Given this node has a running run "run-a1" in its run records
    And I record the on-disk bytes of the "run-a1" run record
    When I invoke mesh:heartbeat to publish this node's presence
    Then "activeRuns" lists "run-a1"
    And the "run-a1" run record on disk is byte-identical to before the heartbeat

  # The presence record is a DERIVED projection of the clock + the run records — rebuildable,
  # never a second authority. Re-deriving it from the same inputs (same injected clock + the
  # same run records) yields a content-equivalent record.
  Scenario: the presence record is a rebuildable projection of the clock and the run records
    Given this node has a running run "run-a1" in its run records
    And I invoke mesh:heartbeat with an injected heartbeat instant
    When I invoke mesh:heartbeat again with the same injected heartbeat instant and the same run records
    Then the second record is content-equivalent to the first (a deterministic projection of clock and runs)

  # Republishing bumps heartbeatAt and keeps nodeId stable — presence is a CURRENT-STATE
  # record updated in place, not a log.
  # R4: pin BOTH the targeted change (heartbeatAt bumped, nodeId stable, still one own
  # presence file) AND the UNAFFECTED side — a PEER's presence record in the tree is
  # byte-unchanged by this node republishing its own presence (the m22 republish-untouched-peer
  # shape).
  Scenario: republishing presence bumps heartbeatAt, keeps nodeId stable, and leaves a peer's presence record byte-untouched
    Given this node has already published its presence record
    And a peer presence record for "umair-mbp" exists in the tree
    And I record the on-disk bytes of the "umair-mbp" presence record
    And I record this node's previous heartbeatAt
    When I invoke mesh:heartbeat to publish this node's presence again with a later injected instant
    Then "nodeId" is unchanged
    And "heartbeatAt" is strictly after the previous heartbeatAt
    And there is still exactly one presence record file for this node's id
    And the "umair-mbp" presence record on disk is byte-identical to before the republish
