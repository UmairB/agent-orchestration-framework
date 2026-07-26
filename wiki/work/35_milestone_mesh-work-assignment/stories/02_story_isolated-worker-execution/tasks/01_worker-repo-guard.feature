@executable @cli @work @distribution
Feature: the worker's repo-availability guard runs before any worktree — a repo it has proceeds, a repo it lacks streams a coded failure and never a worktree
  In order that "this worker does not have this repo" is always a loud, specific answer and never an opaque
  crash or a half-created worktree, the worker re-checks it actually holds the repo for the directive's
  workspaceId — via `global_node_workspaces` joined to the local `mesh.repo.published` marker — BEFORE any
  `git worktree add`; a repo it has proceeds to materialization, and a repo it lacks streams a coded
  `assignment-repo-unavailable` `failed` up the channel with no worktree ever created.

  # ARCHITECTURE ADR-004 (repo guard FIRST, loud on miss — 34/ADR-008 visibility lesson: a silent miss hides
  # a dispatch that never ran). SECURITY T3a / F3 (acd-unpublished-repo-directive-refused): a directive for a
  # repo NOT mesh.repo.published on the worker is refused with a CLEAR CODED miss, never an opaque throw or a
  # silent no-op. "The guard PRECEDES the git worktree add call site and the coded literal is emitted on the
  # miss branch" is STRUCTURAL → the fitness acd-assignment-repo-availability-loud, not a step; THIS feature
  # asserts the observable proceed/refuse, the emitted code, the streamed failed frame, and the no-worktree
  # consequence. The control-side assign-time gate half is story 00; this is the worker's defensive re-check.
  #
  # RESOLVED (developer-amigo): tested over the worker execution handler in a TEMP fixture repo with the local
  # .aof/aof.config.json mesh.repo.published marker present or absent (src/commands/mesh-repo.mjs:33-50) and a
  # fixture global_node_workspaces mapping, an INJECTED status emitter recording sent assignment-status frames
  # (the task-01 channel seam / sendAssignmentStatus, mirrored by 34's paired fake channel), and an INJECTED
  # clock. No real network, no real agent runtime — the guard's decision is reached before any spawn.

  Background:
    Given an accepted directive naming a workspaceId and a resolvable itemRef
    And an injected status emitter recording every assignment-status frame

  # THE HAVE PATH: the worker holds the repo (global_node_workspaces + local mesh.repo.published) → the guard
  # passes and materialization proceeds; nothing coded is streamed as a failure.
  Scenario: a repo the worker has passes the guard and proceeds to materialization
    Given the worker has the repo published for that workspaceId
    When the worker runs its repo-availability guard
    Then the guard passes
    And the worker proceeds to materialize a worktree for the assignment
    And no "assignment-repo-unavailable" failure is streamed

  # THE MISS IS LOUD (T3a / 34/ADR-008): a repo NOT published on this worker streams a coded failed up the
  # channel — a specific, stable code, never an opaque crash.
  Scenario: a repo the worker lacks streams a coded assignment-repo-unavailable failure
    Given the worker does NOT have the repo published for that workspaceId
    When the worker runs its repo-availability guard
    Then the assignment streams a "failed" assignment-status frame
    And the frame carries the code "assignment-repo-unavailable"
    And the failure is a structured coded miss, not an opaque throw

  # ORDER: the guard runs BEFORE any worktree create — a miss never leaves a half-created worktree behind.
  Scenario: the guard runs before any worktree create and a miss creates no worktree
    Given the worker does NOT have the repo published for that workspaceId
    When the worker runs its repo-availability guard
    Then no worktree is created under ".aof/mesh/worktrees/"
    And the ".aof/mesh/worktrees/" root holds no entry for the assignmentId

  # THE DECISION TABLE: availability is the JOIN of both facts — the node-workspace mapping AND the local
  # published marker; either fact missing is a coded miss, both present is a proceed.
  Scenario Outline: repo availability is the join of the node-workspace mapping and the local published marker
    Given the node-workspace mapping for that workspaceId is <mapping>
    And the local mesh.repo.published marker for that workspaceId is <marker>
    When the worker runs its repo-availability guard
    Then the assignment <outcome>

    Examples:
      | mapping | marker  | outcome                                                          |
      | present | present | proceeds to materialize a worktree                              |
      | present | absent  | streams a "failed" frame coded "assignment-repo-unavailable"    |
      | absent  | present | streams a "failed" frame coded "assignment-repo-unavailable"    |
      | absent  | absent  | streams a "failed" frame coded "assignment-repo-unavailable"    |
