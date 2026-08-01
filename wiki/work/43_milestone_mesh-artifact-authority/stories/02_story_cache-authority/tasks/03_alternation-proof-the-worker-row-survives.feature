<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — AC6, the CENTREPIECE: the alternation ends structurally, and it is proven
# behaviourally exactly as ADR-004 states its own fitness criterion — publish, stream a worker
# delta, publish again, assert the WORKER'S ROW SURVIVES. Its sibling is the case that today
# fails PERMANENTLY: an item settled by a worker still reads correctly on the control after the
# worker deletes its worktree (`mesh-worker-execution.mjs:2664`) and stops ticking forever, so
# the control's stale disk would otherwise win for good.
# LITMUS: every Then is a fresh read of the workspace's cached rows through the store's public
# read surface (`readWorkspaceItems` — the rows `/api/mesh/status` renders as `items[]`, and the
# board's `aof work list --mesh` overlay reads), plus the publish tick's own result counts. No
# source read, and no assertion about cadence, sleep or timing: the proof is that N further
# control ticks against an UNCHANGED control disk never move the worker's row.
# THE ONE AMBIGUITY THIS FILE PINS (raised to the architect/PO at refine, and deliberately
# written as the OUTCOME the ADR demands rather than the mechanism): ADR-004 says contention is
# decided by the ADR-003 lock and that "outside a lock, last-write-wins by `syncedAt`". Taken
# literally, once a settled assignment releases the lock the control's automatic tick would
# upsert the same ref from its own stale disk with a FRESHER `syncedAt` and win — reverting the
# item, which is precisely the disease. These scenarios therefore assert AC6's outcome (the
# worker's row survives) and, in the skip-count Thens, the reading QA took: an AUTOMATIC tick is
# authoritative only over rows it authored, and skips-and-counts the rest (ADR-003's
# automatic-vs-operator rule). An OPERATOR-initiated control-side write at a gate is a different
# door and is task 04's subject.
# 43/04 dependency: nothing here reads `node_id`/`updated_at` — survival-vs-revert is the whole
# observation, and it is column-free.

@executable @cli @work @distribution @round-trip
Feature: the worker's row survives every later control publish — the alternation ends, including after the worktree is gone
  In order that an operator watching a work item a remote worker is building never sees it revert to its pre-run scaffold
  the control's periodic publish must leave rows another node authored exactly as that node reported them, on this tick and on every tick after it

  Background:
    Given a fresh mesh cache with the workspace "acme" registered
    And the control node "control-1", whose own disk carries "43/02" as the pre-run scaffold with status "not-started" and title "The authority cut"
    And a worker node "worker-a" whose stream connection to the control is authenticated as "worker-a"
    And the control's disk never changes for the duration of each scenario below

  # THE ALTERNATION PROOF — ADR-004's own prose fitness criterion, made executable:
  # publish -> stream a worker delta -> publish again -> the worker's row is still there.
  Scenario: publish, stream a worker delta, publish again — the worker's row survives
    Given the control has published, so "43/02" is cached with the control's scaffold status "not-started"
    When "worker-a" streams a delta reporting "43/02" with status "in-progress" and title "The authority cut — WIP"
    Then a fresh read of the cached rows reports "43/02" with status "in-progress"
    When the control's periodic publish tick runs again against its unchanged disk
    Then a fresh read of the cached rows still reports "43/02" with status "in-progress" and title "The authority cut — WIP"
    And that tick's result counts "43/02" among the refs it skipped rather than wrote

  # It is not a race that one more tick resolves — it is settled. Ten ticks, a hundred: the
  # worker's row does not move, because the control never had the authority to move it.
  Scenario Outline: however many control ticks follow the worker's report, the row does not move
    Given "worker-a" has reported "43/02" with status "in-progress"
    When the control's publish tick runs <ticks> more times against its unchanged disk
    Then a fresh read of the cached rows still reports "43/02" with status "in-progress"
    And every one of those ticks counted "43/02" among its skipped refs

    Examples: the cadence cannot decide the outcome
      | ticks |
      | 1     |
      | 2     |
      | 10    |

  # THE SIBLING CASE — the one that fails PERMANENTLY today. After a successful push the worker
  # removes its worktree and never ticks again; only the control keeps publishing, from a disk
  # that still holds the pre-run scaffold. The settled item must still read as the worker left it.
  Scenario: an item settled by a worker still reads correctly after the worktree is deleted and the worker stops ticking
    Given "worker-a" has reported "43/02" as status "done" with the title it settled on
    And "worker-a"'s worktree has been removed and it reports nothing further
    And the control's own disk still holds "43/02" as the pre-run scaffold with status "not-started"
    When the control's publish tick runs repeatedly over the following period
    Then every fresh read of the cached rows reports "43/02" with status "done" and the worker's settled title
    And the cached rows never report "43/02" back at the control's scaffold status
    And the streamed record-doc bodies cached for "43/02" still answer, so the row and its artifacts agree

  # The cure must not be "the control tick does nothing". Rows the control authored still track
  # the control's own disk on every tick — the two writers own disjoint rows, and both keep working.
  Scenario: the control's own rows still refresh on every tick while the worker's row is left alone
    Given "worker-a" has reported "43/02" with status "in-progress"
    When the control's disk changes "43/01" to status "done" and the control publishes again
    Then a fresh read of the cached rows reports "43/01" with status "done"
    And it still reports "43/02" with status "in-progress"

  # The interleaving matrix: whatever order the two writers publish in, each ref ends up carrying
  # the last report from the node that authored it. C = a control publish tick, W = a worker
  # report for "43/02" only. "43/05" is a ref only the control ever carries.
  Scenario Outline: whatever the interleaving, each ref carries its own author's latest report
    Given the control's disk carries "43/02" as the scaffold and "43/05" as its own item
    When the sequence <sequence> is applied, where C is a control publish and W is a worker report for "43/02"
    Then a fresh read of the cached rows reports "43/02" as <ref_43_02>
    And it reports "43/05" as <ref_43_05>

    Examples: the two writers alternate and NEITHER wins by being last
      | sequence  | ref_43_02                    | ref_43_05                  |
      | C,W,C     | the worker's reported status | the control's disk status  |
      | W,C       | the worker's reported status | the control's disk status  |
      | C,W,C,C,C | the worker's reported status | the control's disk status  |
      | C,W,W,C   | the worker's LATEST report   | the control's disk status  |
      | C,C,C     | the control's disk status    | the control's disk status  |
