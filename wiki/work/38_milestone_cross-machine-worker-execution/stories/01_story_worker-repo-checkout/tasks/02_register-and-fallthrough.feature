@executable @cli @work @distribution
Feature: After a successful clone the worker registers the workspace and falls through to the existing m35 flow
  In order that clone-on-miss is a PREFIX to the existing worker-execution path — not a rewrite of it — a
  successful clone writes the local `mesh.repo.published` marker and inserts the node's own
  `global_node_workspaces (nodeId, workspaceId)` row (the two facts `workerHasRepo` joins), re-checks
  `workerHasRepo` (now true), and falls through to the UNCHANGED m35 worktree+run flow.

  # ARCHITECTURE 38/ADR-005 + ADR-006. workerHasRepo (mesh-worker-execution.mjs:135) joins the local
  # mesh.repo.published marker AND global_node_workspaces membership — both false before the clone. After the
  # clone the worker writes the marker (writeRepoPublishedMarker seam) for this workspaceId AND inserts its own
  # membership row, then RE-CHECKS workerHasRepo (now true) and FALLS THROUGH to the existing sequence:
  # addWorktree → resolveRefInWorktree → startRun → spawnRuntime → completeRun → cleanup (35/ADR-004), reused
  # VERBATIM. STRUCTURAL: no SECOND `git worktree add` call site outside the mesh-worktree.mjs addWorktree seam
  # → acd-worker-checkout-reuses-worktree (re-arms the m35 worktree-scope invariant). The clone is the only new
  # step before the guard passes; everything after is m35 unchanged.
  #
  # @qa: complete the Examples — before clone workerHasRepo is false (both facts absent); after a successful
  # clone both facts are written and workerHasRepo is true; the handler then reaches addWorktree (the existing
  # seam, no new call site); a clone FAILURE does NOT register the workspace and streams a loud coded failed
  # (never a half-registered state); re-dispatch of an already-provisioned assignment is idempotent (m35 ADR-008
  # dispatch-once still holds).

  Background:
    Given a worker handling an accepted directive for workspace "ws-1" it lacks the repo for
    And a resolvable cloneUrl for "ws-1"

  Scenario: a successful clone registers both repo-availability facts and the guard then passes
    When the worker clones the repo for "ws-1"
    Then the local mesh.repo.published marker is written for "ws-1"
    And a global_node_workspaces row exists for (this node, "ws-1")
    And a re-check of workerHasRepo returns true
    And the handler proceeds into the existing addWorktree → startRun flow (no new worktree call site)

  Scenario: a failed clone registers nothing and streams a loud coded failed
    Given the clone fails
    Then neither repo-availability fact is written
    And the worker streams a coded `failed`

  # BEFORE THE CLONE — the guard is false because BOTH facts are absent (the m35 join, mesh-worker-execution.mjs:135).
  Scenario: before any clone the worker lacks both facts and workerHasRepo is false
    Given no mesh.repo.published marker and no global_node_workspaces row exist for "ws-1"
    When the worker checks workerHasRepo for "ws-1" before cloning
    Then workerHasRepo returns false
    And the worker enters the clone-on-miss prefix rather than refusing outright

  # THE GUARD TRANSITION (ADR-005): workerHasRepo is the JOIN of the two facts, so both must be written by the
  # successful clone for the re-check to pass. Any state where only ONE fact is present must NOT read as
  # available — this table pins the join semantics across the clone's write of both facts.
  Scenario Outline: the re-checked guard reflects exactly which repo-availability facts the clone wrote
    Given after the clone the mesh.repo.published marker is <marker> and the global_node_workspaces row is <row>
    When the worker re-checks workerHasRepo for "ws-1"
    Then workerHasRepo returns <result>

    Examples:
      | marker  | row     | result                                                    |
      | written | written | true (a successful clone wrote both; the handler proceeds) |
      | written | absent  | false (a half-registered state never reads as available)  |
      | absent  | written | false (a half-registered state never reads as available)  |
      | absent  | absent  | false (nothing was registered; the clone did not succeed) |

  # AFTER A SUCCESSFUL CLONE THE HANDLER REACHES THE EXISTING SEAM (ADR-006 / acd-worker-checkout-reuses-worktree):
  # once the guard passes, execution falls through to the UNCHANGED m35 bracket — the clone introduces NO second
  # `git worktree add` call site; the one addWorktree seam is reached exactly as a worker that already had the repo.
  Scenario: after registration the handler reaches the existing addWorktree seam, not a new worktree call site
    When the worker clones "ws-1", registers both facts, and continues
    Then the worker streams "accepted" then "running" as the m35 flow does
    And the worktree is materialized via the existing mesh-worktree.mjs addWorktree seam
    And no second `git worktree add` call site outside that seam is introduced

  # A FAILED CLONE LEAVES NO HALF-STATE (ADR-005): a clone failure writes NEITHER fact — never a marker without a
  # row or a row without a marker — and streams a loud coded `failed`, so a later re-check still reads false and
  # a re-dispatch would re-attempt cleanly rather than proceed on a partial registration.
  Scenario Outline: a clone that fails at any stage registers neither fact and streams a loud coded failed
    Given the clone <failureMode>
    When the worker attempts to provision "ws-1"
    Then neither the mesh.repo.published marker nor the global_node_workspaces row is written
    And the worker streams a "failed" frame with a code
    And a subsequent workerHasRepo re-check for "ws-1" returns false

    Examples:
      | failureMode                                    |
      | fails with a non-zero git exit                 |
      | fails because the clone spawn cannot start     |
      | fails on an authenticated-URL / auth error     |

  # DISPATCH-ONCE STILL HOLDS (m35/ADR-008): a re-dispatch of an assignmentId the worker already acted on is
  # ignored outright by the seenAssignmentIds guard (which is added BEFORE the repo guard) — so clone-on-miss
  # never re-clones, re-registers, or re-runs on a re-dispatch; the prefix logic sits inside the dispatch-once bracket.
  Scenario: a re-dispatch of an already-provisioned assignment re-clones nothing and re-runs nothing
    Given the worker has already provisioned and run assignment "asg-1" for "ws-1"
    When the control node re-dispatches the same assignment "asg-1"
    Then the directive is ignored by the dispatch-once guard (no re-sent "accepted")
    And no second clone is attempted
    And no second global_node_workspaces row or run is created for "asg-1"
