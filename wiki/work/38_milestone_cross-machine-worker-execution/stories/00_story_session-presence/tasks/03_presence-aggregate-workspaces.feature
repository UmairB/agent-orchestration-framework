@executable @cli @work @distribution
Feature: Presence aggregates across ALL the node's registered workspaces, not just the daemon's launch cwd
  In order that a packaged tray app launched from its install dir stops reading permanently `idle` while real
  work happens in the user's actual repos, the presence assembler resolves the node's registered workspaces
  from `global_node_workspaces` and UNIONS active runs + live sessions across EVERY one of them — replacing the
  single `listItems(ws.workDir)` read of the one launch-cwd workspace.

  # ARCHITECTURE 38/ADR-003 — THE "always idle" bug's root fix (traced live in the m36 UAT, STATE.md).
  # assembleCurrentPresenceRecord(ws, nodeId) (mesh-launcher.mjs:71) reads listItems(ws.workDir) for ONE
  # workspace today. The fix: a NAMED seam `resolveNodeWorkspaces(nodeId, options)` reads
  # `global_node_workspaces WHERE node_id = ?` from the node's OWN local global store (same AOF_GLOBAL_HOME the
  # launcher already publishes into — the SAME table localNodeWorkspaceMembership already reads,
  # mesh-worker-execution.mjs:105). For each resolved workspace: readActiveRuns over its items (existing seam)
  # + live sessions (ADR-002, filtered by isStale). activeRuns becomes the UNION across workspaces; `sessions`
  # (ADR-001) is the union of live session records. Mapping workspace_id → workDir reuses the store descriptor
  # + loadWorkspace/listItems (no second enumeration strategy). FAILURE-ISOLATED: a store-read fault degrades
  # to just-the-launch-cwd (never a daemon crash — the never-crash launcher-tick discipline); a workspace whose
  # descriptor no longer resolves on disk is skipped (absence-is-benign). Clock injected. STRUCTURAL:
  # assembleCurrentPresenceRecord consults global_node_workspaces, not a single listItems as its sole source →
  # acd-presence-aggregates-node-workspaces.
  #
  # @qa: complete the Examples — node with two registered workspaces (runs in A, session in B) → presence
  # unions both; the launch-cwd workspace is included; a store-unreachable read degrades to launch-cwd only;
  # a descriptor that no longer resolves is skipped, not a crash; a node registered for zero workspaces.

  Background:
    Given AOF_GLOBAL_HOME points at a fixture global home
    And "node-a" is registered in global_node_workspaces for workspaces "ws-1" and "ws-2"
    And the presence assembler runs with an injected clock

  Scenario: presence unions active runs and live sessions across every registered workspace
    Given a running run in "ws-1" and a live session in "ws-2"
    When the node assembles its presence record
    Then activeRuns includes the "ws-1" run
    And sessions includes the "ws-2" session
    # i.e. work in a NON-cwd workspace is now seen — the tray-app "always idle" case is fixed.

  Scenario: an unreachable global store degrades to the launch-cwd workspace, never a crash
    Given the global store cannot be opened
    Then the assembler falls back to the launch-cwd workspace only
    And the launcher tick does not crash

  Scenario Outline: the presence record is the UNION over the node's resolved workspaces (launch-cwd always in)
    # ws-1 is the launch cwd; ws-2 is a registered non-cwd workspace. Each row pins that activeRuns and sessions
    # are the union across resolved workspaces, that the launch-cwd workspace is always included, and that a
    # non-cwd workspace's work is now surfaced (the root of the "always idle" bug). "resolved" = registered AND
    # its descriptor still maps to a workDir on disk (unresolvable descriptors are covered in the skip scenario).
    Given <ws1-work> in "ws-1" (launch cwd) and <ws2-work> in "ws-2"
    When the node assembles its presence record
    Then activeRuns is <active-runs>
    And sessions is <sessions>
    And the node's overall liveness is <overall>

    Examples:
      | ws1-work         | ws2-work         | active-runs       | sessions          | overall  |
      | nothing          | nothing          | []                | []                | idle     |
      | a running run    | nothing          | [ws-1 run]        | []                | working  |
      | nothing          | a running run    | [ws-2 run]        | []                | working  |
      | nothing          | a live session   | []                | [ws-2 session]    | working  |
      | a running run    | a live session   | [ws-1 run]        | [ws-2 session]    | working  |
      | a live session   | a live session   | []                | [ws-1, ws-2 sess] | working  |
      | a running run    | a running run    | [ws-1, ws-2 runs] | []                | working  |
      | nothing          | an EXPIRED sess  | []                | []                | idle     |

  Scenario Outline: the read is failure-isolated — a degraded workspace never crashes the launcher tick
    # A store fault degrades to just-the-launch-cwd; a workspace whose descriptor no longer resolves on disk is
    # skipped (absence-is-benign); a node registered for zero workspaces reads over the launch cwd only. In no
    # case does the assembler throw out of the launcher tick.
    Given <fault>
    When the node assembles its presence record
    Then the assembler <outcome>
    And the launcher tick does not crash

    Examples:
      | fault                                                | outcome                                                  |
      | the global store cannot be opened                    | reads the launch-cwd workspace only                      |
      | ws-2's descriptor no longer resolves to a workDir     | skips ws-2 and aggregates ws-1 (the resolvable set)      |
      | ws-2's workDir exists but listItems throws            | skips ws-2's items and keeps ws-1 (per-workspace isolate) |
      | "node-a" is registered for zero workspaces            | reads the launch-cwd workspace only                      |
      | global_node_workspaces has ws-1, ws-2, ws-3 (3 rows) | aggregates all three resolvable workspaces               |

  Scenario: a workspace whose descriptor no longer resolves is skipped, not crashed, and the rest still aggregate
    # the concrete absence-is-benign case: ws-2 was registered but its repo/descriptor is gone (repo deleted,
    # drive unmounted). The node must still report ws-1's work rather than crash or fall silent entirely.
    Given "node-a" is registered for "ws-1" (resolvable) and "ws-2" (descriptor missing on disk)
    And a live session in "ws-1"
    When the node assembles its presence record
    Then sessions includes the "ws-1" session
    And "ws-2" contributes nothing (it is skipped, not an error)
    And the launcher tick does not crash
