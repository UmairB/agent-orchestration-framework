@executable @cli @work @distribution
Feature: The assignment record is a first-class, snapshot-immune entity with a named producer for every lifecycle state
  In order to record who was told to run what as a durable fact that survives every converge tick,
  the global store gains an additive `global_assignments` table whose rows carry a frozen ten-key record,
  are mutated only through dedicated single-row writers, and are never swept by the projection snapshot cycle.

  # ARCHITECTURE 35/ADR-001 (the frozen 10-key record + the state→SOLE-producer enum + the additive v2→v3
  # `global_assignments` table + dedicated single-row writers, NEVER the snapshot seam). The record is
  # operator/worker-CREATED state, not a projection of any doc, so it must NOT live where
  # `publishWorkspaceSnapshot`'s DELETE-ALL-then-reinsert cycle (`global-work-store.mjs:204`) can wipe it.
  # The frozen-key order + the no-producerless-state enum are STRUCTURAL invariants → the fitnesses
  # acd-assignment-record-frozen / acd-assignment-state-has-producer / acd-assignments-survive-snapshot,
  # not steps; THIS feature asserts the observable record shape, the defaults, the producer map as behaviour,
  # the additive migration, snapshot survival, and that withdraw/reclaim are state writes never row deletes.
  #
  # RESOLVED (developer-amigo): tested over a hermetic AOF_GLOBAL_HOME opening a v3 store (the m34
  # global-store test convention) + an injected clock for the ISO-8601-Z stamps. No network — pure store.
  # Mines the retired `acd-issuance-record-frozen` (frozen record + default state) and
  # `mesh-issue-withdraw` (withdraw = state write, never delete) SEMANTICS; the git-bus mechanism is discarded.

  Background:
    Given AOF_GLOBAL_HOME points at a fixture global home
    And the global work projection store is opened at schema version 3

  # THE FROZEN RECORD: the assembler returns EXACTLY the ten keys, in order — the milestone's data contract.
  Scenario: the assignment assembler returns exactly the ten frozen keys, in order
    Given an assignment assembled for item ref "35/00" targeting node "worker-a" issued by "control-a"
    When the assembled record's keys are read in order
    Then the keys are exactly assignmentId, itemRef, workspaceId, targetNodeId, issuer, state, runId, assignedAt, updatedAt, reclaimedAt
    And no other key is present

  # DEFAULTS: an unspecified state means a freshly-minted assignment; runId and reclaimedAt begin absent.
  Scenario: the record defaults state to assigned and runId and reclaimedAt to null
    Given an assignment assembled without an explicit state, runId, or reclaimedAt
    Then state is "assigned"
    And runId is null
    And reclaimedAt is null

  # THE STATE→PRODUCER MAP (ADR-001 / R2·m20): the single source-of-truth enum — every state has exactly ONE
  # named producer, and no producerless state exists. This is the behavioural face of the enum a fitness asserts.
  Scenario Outline: each lifecycle state maps to exactly one named producer
    Given the single source-of-truth assignment-state enum
    When the sole producer of "<state>" is resolved
    Then it is "<producer>"
    And "<state>" is classified "<classification>"

    Examples:
      | state     | producer         | classification         |
      | assigned  | assign verb      | control-created        |
      | accepted  | the worker       | worker-reported        |
      | running   | the worker       | worker-reported        |
      | done      | the worker       | worker-reported term   |
      | failed    | the worker       | worker-reported term   |
      | withdrawn | withdraw verb    | control-created term   |
      | reclaimed | reclaim path     | control-created term   |

  # NO PRODUCERLESS STATE: the enum's key set is closed — a value outside it has no producer and is not valid.
  Scenario: the state enum admits no state without a producer
    Given the single source-of-truth assignment-state enum
    Then its states are exactly assigned, accepted, running, done, failed, withdrawn, and reclaimed
    And every one of those states resolves to a non-empty producer

  # THE ADDITIVE MIGRATION (ADR-001): a v2 store opened by a v3 build gains ONLY the new table; the seven v2
  # tables are untouched, the schema version becomes 3, and a v2 build still refuses a v3 store (existing guard).
  Scenario: opening a v2 store with a v3 build adds global_assignments and leaves the v2 tables unchanged
    Given a projection database at schema version 2 containing one projected workspace row
    When the global work projection store is opened by a v3 build
    Then the schema version is upgraded to 3
    And the database contains a global_assignments table
    And the seven v2 tables workspaces, work_items, projection_metadata, projection_errors, global_nodes, global_workspace_descriptors, and global_node_workspaces are present and unchanged
    And the existing projected workspace row is still queryable

  # DEDICATED WRITERS: assignment mutations are atomic single-row writes keyed by assignmentId, never a bulk seam.
  Scenario: an assignment is inserted and mutated only through dedicated single-row writers keyed by assignmentId
    Given an assignment record for item ref "35/00" on workspace "ws-1" targeting node "worker-a"
    When the record is inserted through the dedicated assignment writer
    Then exactly one global_assignments row exists for that assignmentId
    When the assignment's state is advanced to "accepted" through the dedicated state writer
    Then that single row now reads state "accepted"
    And its updatedAt is restamped
    And no other global_assignments row is touched

  # SNAPSHOT SURVIVAL (ADR-001): the load-bearing data contract — the DELETE-ALL-then-reinsert snapshot cycle
  # touches no global_assignments row, so an inserted assignment survives a full publish byte-identical.
  Scenario: an inserted assignment survives a full publishWorkspaceSnapshot cycle byte-identical
    Given an assignment inserted for workspace "ws-1" in state "running" with a runId
    When a full workspace snapshot is published for "ws-1"
    Then the assignment row reads back byte-identical to before the publish
    And the snapshot write path touches no global_assignments row

  # WITHDRAW / RECLAIM ARE STATE WRITES, NEVER DELETES (mining mesh-issue-withdraw): the row is retained for audit.
  Scenario Outline: a terminal control transition flips state and stamps but never deletes the row
    Given an assignment inserted for workspace "ws-1" in state "assigned"
    When the assignment is transitioned to "<terminal>" through its control producer
    Then the row still exists with state "<terminal>"
    And <stamp>
    And the row was updated in place, never deleted

    Examples:
      | terminal  | stamp                                          |
      | withdrawn | reclaimedAt remains null                       |
      | reclaimed | reclaimedAt is stamped with the reclaim time   |
