@bug @finding-F11 @executable @cli @work @distribution
Feature: A registered workspace's work dir is resolvable from ANY cwd, so presence genuinely aggregates across workspaces
  In order that ADR-003's cross-workspace aggregation — the milestone's ROOT FIX for the "always idle" bug —
  actually works, every `global_workspace_descriptors.work_dir` must be an ABSOLUTE path. Today it stores the raw
  relative `config.work.dir` (`"./wiki/work"`), so the presence publisher resolves EVERY workspace against its own
  launch cwd: it re-reads one workspace N times, inflates run counts N×, subsumes every live session, and — from a
  packaged tray app's install dir — resolves ZERO workspaces and reads permanently `idle`. The exact bug this
  milestone exists to kill.

  # FINDING F11 (aof:verify 38, BLOCKER — found by the live task-06 soak; the most consequential finding of the
  # milestone, because it falsifies the milestone's OWN headline claim).
  #
  # MEASURED LIVE (not inferred):
  #   resolveNodeWorkspaces("umairs-msi") from the repo cwd returns:
  #     8aa19edbaf8b3d92 (pay-guard-portal)  workDir: "./wiki/work"   <-- RELATIVE
  #     9db1fd84f5895e38 (aof)               workDir: "./wiki/work"   <-- RELATIVE, and IDENTICAL
  #   Each then reads `listItems("./wiki/work")` against the DAEMON's cwd, so BOTH yield the SAME 154 items (aof's).
  #   With ONE running run present, the aggregate produced `activeRuns: [<id>, <id>]` (the same id TWICE) and the
  #   card rendered `running 2 runs`; and because BOTH workspaceIds were flagged as having runs, EVERY live session
  #   was subsumed — the second repo's session vanished from the wire entirely.
  #   Re-running the SAME resolution with cwd = the install dir (`C:\Users\Umair\.aof\bin`) returns **ZERO
  #   workspaces** (every descriptor's `stat("./wiki/work")` fails, and the loop `continue`s past it) — so a
  #   packaged tray app reflects NO repo's work and reads permanently `idle`.
  #
  # ROOT CAUSE: `upsertGlobalRegistryRows` (src/global-node-registry.mjs:187) writes `workspace.workDir` VERBATIM,
  # and that value is the raw unresolved `config.work.dir`. The descriptor DOES already carry an absolute
  # `project_root` alongside it — the information needed to resolve is present and simply unused. The `stat()` guard
  # in `resolveNodeWorkspaces` (src/mesh-presence.mjs:146-150) does not catch it, because a relative path
  # ACCIDENTALLY resolves when the daemon happens to run from that very repo — which is exactly how every test and
  # every dev run was performed. It fails only where it matters: any other cwd.
  #
  # WHY IT SHIPPED GREEN (the sixth instance of this milestone's defect class): ADR-003's `@executable` tests INJECT
  # workspace objects carrying ABSOLUTE `workDir`s — a fixture shaped to the consumer's convenience. The fitness
  # function `acd-presence-aggregates-node-workspaces` asserts the assembler READS `global_node_workspaces` (it
  # does) but never that the paths it gets back are USABLE FROM AN ARBITRARY CWD. Nobody fed the aggregation the
  # shape the REAL registry actually returns.
  #
  # @qa: the assertion whose absence let this ship is "resolve the node's workspaces FROM A FOREIGN CWD and still
  # read each workspace's real items". Every test here must exercise the REAL descriptor store, never an injected
  # workspace list.

  Background:
    Given a node with TWO registered workspaces whose project roots are different absolute directories
    And the presence publisher may be launched from ANY cwd (a packaged tray app runs from its install dir)

  Scenario: a published workspace descriptor stores an ABSOLUTE work dir
    When a workspace is published to the global registry
    Then its `global_workspace_descriptors.work_dir` is an ABSOLUTE path
    And it equals the work dir resolved against that workspace's own `project_root` (never the publisher's cwd)
    And a `config.work.dir` of `"./wiki/work"` is stored resolved, not verbatim

  Scenario: presence aggregation reads each workspace's OWN items, from a foreign cwd (the root fix, for real)
    # THE headline regression. It must fail against today's code and pass after the fix.
    Given two registered workspaces with genuinely different work dirs
    When the presence record is assembled with the process cwd set to a directory that is NEITHER workspace (e.g. an install dir)
    Then each workspace's items are read from its OWN absolute work dir
    And the aggregate is the UNION across the two DISTINCT workspaces — never the same workspace counted twice
    And a workspace whose items include a running run contributes that run EXACTLY ONCE

  Scenario: one running run is reported once, not once per registered workspace
    Given exactly ONE running run exists, in ONE of the node's workspaces
    When presence is assembled
    Then `activeRuns` contains that run id EXACTLY ONCE (no duplicate)
    And the fleet card reads `running 1 run` — never `running N runs` scaled by the workspace count

  Scenario: a run in one workspace does NOT subsume a live session in a DIFFERENT workspace (ADR-004 integrity)
    # The over-subsumption F11 caused: every workspace looked like it had the run, so every session was dropped.
    Given a running run in workspace A and a live coding-assistant session in workspace B (no run in B)
    When presence is assembled
    Then workspace A's own same-workspace session (if any) IS subsumed by its run
    And workspace B's session SURVIVES onto the wire
    And the card shows BOTH the run line and `working · <repoB> (session)`

  Scenario: a packaged tray app launched from its install dir reflects real work (the SPEC's motivating case)
    # SPEC objective (a)'s stated failure mode, asserted directly.
    Given the presence publisher's cwd is an install directory that is NOT any registered workspace
    When it resolves this node's workspaces
    Then it resolves the node's registered workspaces (a NON-EMPTY set — never silently zero)
    And it reads their real items and surfaces their runs and live sessions
    And the node does NOT read `idle` while a registered workspace is genuinely being worked on

  Scenario: an existing descriptor row holding a legacy RELATIVE work dir is tolerated, not trusted
    # Rows already on disk (written before this fix) carry `./wiki/work`. Reading must not blindly stat them against
    # the reader's cwd — that is precisely the bug.
    Given a descriptor row whose stored `work_dir` is the legacy relative `"./wiki/work"`
    When the node's workspaces are resolved from a foreign cwd
    Then the relative value is resolved against that row's own absolute `project_root` (never the reader's cwd)
    And the workspace is NOT silently skipped

  Scenario: a workspace whose work dir genuinely does not exist is skipped LOUDLY, not silently
    # Today an unresolvable descriptor is `continue`d past with no signal — which is how a zero-workspace
    # aggregation (permanently `idle`) looked healthy.
    Given a descriptor whose resolved absolute work dir does not exist on disk
    When the node's workspaces are resolved
    Then that workspace is skipped
    And the skip is surfaced (a diagnostic/count), never an unexplained empty aggregate
