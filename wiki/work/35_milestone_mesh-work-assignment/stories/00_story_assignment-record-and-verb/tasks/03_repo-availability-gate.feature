@executable @cli @work @distribution
Feature: The control-side assign gate refuses a target that lacks the repo, loudly and with a code
  In order that an operator never assigns work to a node that cannot run it, and never gets a silent miss,
  the assign verb checks at write time that `<nodeId>` actually HAS the repo — resolved through
  `global_node_workspaces` plus the node's `mesh.repo.published` marker — and refuses with a coded, loud miss.

  # ARCHITECTURE 35/ADR-001 (this gate is CHECKED control-side at assign time; the worker re-checks defensively
  # at execution, task-in-story-02) resolving availability via `global_node_workspaces` + the node's
  # `mesh.repo.published` marker (34/ADR-010). The loud-miss discipline is 34/ADR-008: a degraded state emits an
  # operator-visible signal — silence is the defect; a miss is a coded refusal (`assignment-repo-unavailable`
  # for a held-but-repo-absent target, a coded unknown-target for a never-seen node), never a silent success.
  # "Every miss branch emits the code, never a silent return" is STRUCTURAL →
  # acd-assignment-target-not-connected-loud (control half); THIS feature asserts the observable succeed/refuse
  # split by availability, the unknown-target refusal, that nothing is minted on a miss, and that no miss is quiet.
  # SECURITY: T3 (repo-availability is a security control — a directive for a repo the node lacks is refused
  # with a clear coded miss, never opaque) and T6 (the record's issuer/targetNodeId provenance).
  #
  # RESOLVED (developer-amigo): tested over a hermetic AOF_GLOBAL_HOME opening a v3 store seeded with
  # `global_node_workspaces` rows + per-node `mesh.repo.published` state (the m34 repo-publish fixture shape).
  # Pure store + CLI, no network.

  Background:
    Given AOF_GLOBAL_HOME points at a fixture global home
    And the global work projection store is opened at schema version 3
    And this control node's id is "control-a"
    And a resolvable work item ref "35/00" on workspace "ws-1"

  # THE AVAILABILITY GATE (ADR-001 / 34/ADR-010): assign succeeds only when the target HAS the repo, else refused.
  Scenario Outline: assigning to a node succeeds when it holds the repo and is refused when it does not
    Given node "<node>" <availability> for workspace "ws-1"
    When the operator runs `aof mesh assign 35/00 --to <node>`
    Then the assign <result>

    Examples:
      # Present in global_node_workspaces for ws-1 AND mesh.repo.published — the node can run it, so the mint lands.
      | node     | availability                                                     | result                                                          |
      | worker-a | holds the workspace and has mesh.repo.published                  | succeeds, minting an assigned record targeting "worker-a"       |
      # Known node, but NOT holding this workspace's published repo — refused loudly, nothing minted.
      | worker-b | is a known node but does not hold the published repo            | is refused with code "assignment-repo-unavailable", minting nothing |

  # UNKNOWN TARGET (34/ADR-008): an unknown/never-seen nodeId is a coded refusal, not an opaque success.
  Scenario: assigning to an unknown, never-seen nodeId is a coded unknown-target refusal, minting nothing
    Given no node "ghost-node" has ever appeared in the global store
    When the operator runs `aof mesh assign 35/00 --to ghost-node`
    Then the operation fails with a coded unknown-target refusal
    And the error names the unknown target "ghost-node"
    And no assignment is minted

  # EVERY MISS IS LOUD (34/ADR-008): a repo-availability miss surfaces a coded, operator-visible refusal envelope.
  Scenario: a repo-availability miss surfaces a loud coded refusal, never a silent success
    Given node "worker-b" does not hold the published repo for workspace "ws-1"
    When the operator runs `aof mesh assign 35/00 --to worker-b --json`
    Then the JSON envelope is ok:false with error and code "assignment-repo-unavailable"
    And the command exits non-zero
    And no assignment row exists for that item
