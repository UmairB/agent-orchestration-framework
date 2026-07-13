@executable @cli @work @distribution
Feature: `aof mesh assign <ref> --withdraw` revokes an assignment as a state write, never a row delete
  In order to revoke a dispatch and free an item for re-assignment without erasing its audit trail,
  the operator runs `aof mesh assign <ref> --withdraw`: it flips the active assignment's state to `withdrawn`
  in place, is safe to repeat, fabricates nothing on a never-assigned ref, and leaves the item re-assignable.

  # ARCHITECTURE 35/ADR-001 (withdraw is a STATE WRITE, never a delete: it flips `state → withdrawn`, the row
  # retained for audit — the sole producer of `withdrawn` is this withdraw verb) and 35/ADR-003 (a `withdrawn`
  # assignment is TERMINAL, so the item passes the store uniqueness check and is re-assignable). Mines the
  # retired `mesh-issue-withdraw` SEMANTICS onto the store: withdraw flips without deleting; the other keys stay
  # byte-unchanged; idempotent-safe on an already-withdrawn one; a never-issued ref yields a benign null and
  # fabricates nothing — the git-bus MECHANISM (per-node directive files, git-sync) is discarded. "No snapshot
  # statement touches the row" is STRUCTURAL → acd-assignments-survive-snapshot; THIS feature asserts the
  # observable state flip, key preservation, idempotence, the benign null, and the post-withdraw re-assignability.
  #
  # RESOLVED (developer-amigo): tested over a hermetic AOF_GLOBAL_HOME opening a v3 store + an injected clock.
  # Pure store + CLI, no network. The `--withdraw` flag is the same `aof mesh assign` verb as task 01.

  Background:
    Given AOF_GLOBAL_HOME points at a fixture global home
    And the global work projection store is opened at schema version 3
    And this control node's id is "control-a"

  # THE STATE FLIP (ADR-001): withdraw flips state to `withdrawn` in place; every other key stays byte-unchanged.
  Scenario: withdrawing an active assignment flips its state to withdrawn and preserves every other key
    Given an active "assigned" assignment on item "35/00" targeting "worker-a"
    When the operator runs `aof mesh assign 35/00 --withdraw`
    Then that assignment's state is "withdrawn"
    And its updatedAt is restamped
    And its assignmentId, itemRef, workspaceId, targetNodeId, issuer, runId, assignedAt, and reclaimedAt are byte-unchanged
    And the row was updated in place, never deleted

  # IDEMPOTENT-SAFE (mining mesh-issue-withdraw): withdrawing an already-withdrawn assignment re-writes withdrawn.
  Scenario: withdrawing an already-withdrawn assignment re-writes withdrawn without deleting the row
    Given an assignment on item "35/00" already in state "withdrawn"
    When the operator runs `aof mesh assign 35/00 --withdraw`
    Then that assignment's state is still "withdrawn"
    And the row still exists
    And no second assignment row was created

  # BENIGN NULL ON A NEVER-ASSIGNED REF (mining mesh-issue-withdraw): nothing is fabricated for an absent ref.
  Scenario: withdrawing a never-assigned ref yields a benign null and fabricates nothing
    Given no assignment exists for item "35/00"
    When the operator runs `aof mesh assign 35/00 --withdraw`
    Then the result is a benign null
    And no assignment row is fabricated for that item
    And the operation is not an error

  # RE-ASSIGNABLE AFTER WITHDRAW (ADR-003): a withdrawn assignment is terminal, so a fresh assign passes uniqueness.
  Scenario: after withdraw a fresh assign on the same item passes the uniqueness check
    Given an active "running" assignment on item "35/00" held by "worker-a"
    When the operator runs `aof mesh assign 35/00 --withdraw`
    And the operator then runs `aof mesh assign 35/00 --to worker-b`
    Then the second assign succeeds
    And a fresh "assigned" record targeting "worker-b" is minted
    And the withdrawn assignment row is retained alongside it
