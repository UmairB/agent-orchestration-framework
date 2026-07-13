@manual @cli @work @distribution
Feature: the real control→worker assignment over a live tailnet — a story dispatched from the control node runs in the worker's own worktree, advances assigned → running → done live, and is reclaimed when the worker is killed mid-run
  In order to prove the assignment-dispatch promise on the fabric the fixtured lanes stand in for, an operator
  on a real control node (Windows) assigns a story to a real worker (macOS) over Tailscale; the worker
  auto-accepts within the tailnet boundary, materializes the ref in its OWN git worktree without colliding
  with its local work, and drives it to done; the control node's fleet view advances `assigned → running →
  done` live; and when the worker is killed mid-run, the assignment converges to `reclaimed`.

  # ARCHITECTURE ADR-004 (worktree-per-assignment + run-lifecycle bracketing), ADR-005 (dual-staleness
  # reclaim), ADR-006 (auto-accept within the tailnet boundary). @manual BECAUSE the cross-machine dispatch —
  # a real control→worker WS directive over real NAT-traversed Tailscale, a REAL `git worktree add` on the
  # second machine, real headless-runtime execution, real presence + heartbeat staleness latency on a real
  # kill — only manifests across two live machines; the @executable 00–04 lanes prove each seam over injected
  # transports, injected runtime spawns, and injected clocks, THIS lane proves them together against the real
  # fabric. Recorded as a VERIFICATION-time observation with recorded latencies, not a CI assert — the
  # deferred human gate the milestone budgets for (34/F-3302 lesson; SECURITY residue T1/T4/T5). It is the
  # only part not covered by the @executable lanes and SPANS stories 01 (channel) / 02 (execution) / 03 (UI);
  # validated at aof:verify.
  #
  # NO Examples table: a single narrative run over two specific real hosts.

  Background:
    Given a real control node (Windows, `umairs-msi`) running the mesh control-stream server on `mesh serve`
    And a real worker (macOS, `umairs-mac-mini`) on the SAME Tailscale tailnet, admitted as a live peer with its own local work in progress
    And the worker has the target repo published (`mesh.repo.published`) for the assigned workspace
    And `aof mesh ui` open on the control node

  # DISPATCH + ISOLATED RUN: assign a story from control; the worker auto-accepts and runs it in its OWN
  # worktree, never touching its local working tree, and drives it to done.
  Scenario: a story assigned from the control node runs in the worker's own worktree without colliding with its local work
    Given the operator runs `aof mesh assign <story-ref> --to umairs-mac-mini` on the control node
    When the worker receives the directive over its live admitted stream
    Then the worker auto-accepts within the tailnet boundary (no local confirm)
    And the worker materializes the ref in a dedicated worktree under `.aof/mesh/worktrees/<assignmentId>/`
    And the assignment runs to done without disturbing the worker's own local working tree
    And the observed dispatch-to-accept latency (assign issued → accepted on control) is recorded

  # LIVE ADVANCE: the fleet view on the control node advances assigned → running → done as it happens, within
  # the m34 poll bound — no manual refresh, no git pull.
  Scenario: the fleet view advances assigned → running → done live on the control node
    Given the worker is running the assignment
    When the assignment advances through its lifecycle on the worker
    Then the control node's `aof mesh ui` shows the assignment advancing `assigned → running → done` WITHOUT a manual refresh
    And the observed lifecycle latency (each transition → visible on control) is recorded

  # RECLAIM ON KILL: kill the worker mid-run; once both presence and run heartbeat go stale, the assignment
  # converges to reclaimed and the item is offered again.
  Scenario: killing the worker mid-run converges the assignment to reclaimed
    Given the worker is running the assignment and shown running on the control node
    When the operator kills the worker process mid-run (its presence and run heartbeat cease)
    Then the control node converges the assignment to `reclaimed` once BOTH the presence and run heartbeat are stale
    And the item becomes assignable again
    And the observed time-to-reclaim (kill → reclaimed on control) is recorded
