<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — the REAL-PRODUCER soak for the authority cut: two real machines, a real
# assignment, a real settle, a real worktree deletion, and the control's cache read afterwards.
# Tasks 00-07 are hermetic — they drive the seam and the frame appliers directly against a real
# SQLite cache, which is the right altitude for the rules but cannot reach the three facts that
# only a live mesh produces: (1) a CONNECTION-authenticated node id arriving over the real
# fabric rather than being passed in, (2) a real worktree deletion after a successful push
# (`mesh-worker-execution.mjs:2664`) followed by the worker genuinely never ticking again, and
# (3) the control launcher's real publish cadence (`mesh-launcher.mjs:732`) running unattended
# against a control disk that is genuinely stale.
# LITMUS: every Then is an outsider read, on the control node, AFTER the run — `aof mesh status
# --json` (the fleet payload's `items[]`) and the board's view of the same item. Nothing here
# reads worker state over SSH, opens a database by hand, or inspects source; the whole point is
# that an operator sitting at the control node sees the worker's work.
# LANE: `@manual` and not `@uat` — every check below is an unambiguous machine-checkable
# comparison (the cached row's status/title against what the worker settled), so it needs an
# operator to DRIVE it, not to JUDGE it. The human-judged surface for this milestone (the stale
# badge and the Resync affordance) is `04_story_staleness-and-resync`'s, per DESIGN.md.
# Run per the repo's mesh operating rules: the WSL worker node is the cheapest real second
# machine; never start or restart a worker daemon over SSH (an SSH-spawned daemon has no login
# session, so `claude` is unauthenticated and the run burns).

@manual @cli @work @distribution @round-trip
Feature: on two real machines, a worker's item still reads correctly on the control long after the worktree is gone
  In order to prove the milestone's headline against a real fabric rather than a hermetic fixture — the operator watching a remote item never sees it revert to its pre-run scaffold
  a real worker must drive a real assignment to settle, delete its worktree and stop reporting, while the control's real publish cadence keeps running against a genuinely stale disk

  Background:
    Given a control node and a real second node enrolled in the same mesh (the WSL worker is sufficient)
    And the control node's own checkout carries the target item as its pre-run scaffold
    And the control launcher's periodic publish is running on its normal cadence

  # The alternation, live: while the run is in flight the operator reads the WORKER's view on the
  # control, and the control's cadence never takes it back.
  Scenario: while the run is live, the control keeps reporting the worker's view across many publish ticks
    Given the item is assigned to the worker node and the run is in flight
    When the operator reads `aof mesh status --json` on the control node repeatedly over several minutes
    Then every read reports the item with the status and title the worker is reporting
    And no read reports the item back at the control's pre-run scaffold values
    And the control node's own checkout is confirmed to still hold the pre-run scaffold (the cache is not being fed by a git fetch)

  # The permanent-failure case, live: after settle the worker deletes its worktree and stops
  # ticking forever. This is the read that today reverts and never recovers.
  Scenario: after the run settles and the worktree is deleted, the item still reads as the worker left it
    Given the worker has driven the assignment to `done`, pushed its branch, and its worktree has been removed
    And the worker node reports nothing further for that item
    When the operator reads `aof mesh status --json` on the control node, then again after the publish cadence has run many more times
    Then every read reports the item with the status the worker settled on
    And the item's streamed record docs are still readable on the control for the same item
    And a restart of the control daemons does not change either answer (the cache is durable, not in-memory)

  # The deliberate-removal path, live: the one sanctioned way a workspace's rows leave the cache.
  Scenario: the named removal path is the only thing that clears a forgotten workspace, and it clears all of it
    Given a workspace whose cache carries rows authored by both the control and the worker
    When the operator invokes the named removal path for that workspace
    Then `aof mesh status --json` on the control node reports no items for that workspace
    And every other workspace's items are unchanged
    And no publish tick, before or after, removed those rows
