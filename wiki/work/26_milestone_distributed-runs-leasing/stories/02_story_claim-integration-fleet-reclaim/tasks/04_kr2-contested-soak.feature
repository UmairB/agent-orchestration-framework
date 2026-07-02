@cli @work @distribution @manual
Feature: KR2 on a real two-node fleet — 100 contested claims, 0 cases of both executing; the relay-killed half arbitrates at the git cadence; a crashed node's in-flight run is reclaimed by its peer
  In order to verify the milestone's headline acceptance an outsider can check — KR2 "100 contested claims, 0 double-executions" (PRD A2)
  a real two-node fleet over a shared bare remote races 100 contested claims — 50 with the relay up, 50 with the relay killed — and then crashes one node mid-run,
  so that an outsider confirms exactly one node ever executes a contested item, killing the relay only slows arbitration to the git cadence — never breaks it, and a crashed node's in-flight run is reclaimed rather than left wedged.

  # ARCHITECTURE ADR-004.4 — KR2 is MEASURED at verification, never asserted in CI wall-clock: a
  # race soak under real concurrency is a measurement, not a refine-time assert (the m23
  # fleet-spike discipline). WHAT THIS TASK MEASURES, explicitly:
  #   (1) 100 contested claims across the two nodes / 0 cases of both nodes executing the same
  #       item — the KR2 headline counts;
  #   (2) the relay-killed HALF of the soak (50 claims) observed arbitrating at the GIT CADENCE —
  #       correct, only slower (PRD A2's degradation direction);
  #   (3) a crashed node's in-flight run observed RECLAIMED by the peer (force-failed
  #       "runtime_offline", item re-offered, retryOf lineage) — the ADR-006 path, live.
  # @manual: an agent stands up the real two-node fleet at aof:verify and drives ONLY the
  # registered aof work/mesh commands — never hand-editing files. All measured evidence lands in
  # the milestone VERIFICATION.md.
  #
  # SEAM SPLIT — why this is @manual and not @executable (do NOT silently turn it into an assert):
  #  - The MECHANISM is already @executable in tasks 00–03 (the frozen sequence over injected relay
  #    states, two in-process contenders over a bare remote, the cache defer, the dual-staleness
  #    reclaim) plus the fitness #9–#12 arch-tests — all green WITHOUT a fleet.
  #  - The SOAK is real concurrency on real hardware: two OS processes, a real ws relay, real git
  #    push/pull racing — counts and cadences are MEASURED observations, not deterministic CI
  #    asserts (a wall-clock race soak in CI is flaky by construction).
  # QA FEASIBILITY FLAG (developer-amigo): keep this @manual — do NOT collapse the soak into an
  # @executable assert. The developer-amigo owns the @manual scope: standing up the fleet, driving
  # the 100 contested claims, killing the relay for the second half, crashing a node for the
  # reclaim observation, and recording every measured count in VERIFICATION.md. RAISED.
  # RESOLVED (developer-amigo): CONFIRMED — this task stays @manual, exactly as designed. The
  # MECHANISM is fully @executable in tasks 00–03 (the injected relay states, the in-process
  # two-clone arbitration over a bare remote, the cache defer, the dual-staleness table) plus
  # fitness #9–#12; the soak itself is wall-clock counts/cadences over REAL concurrency (two OS
  # processes, a real ws relay, real racing pushes) — a CI assert of a race is flaky by
  # construction (ADR-004.4, the m23 fleet-spike discipline). The developer-amigo runs it at
  # aof:verify, driving only registered aof work/mesh commands, and records the three
  # measurements (100/0 counts, git-cadence arbitration, the kill→stale→reclaim→retry chain)
  # in the milestone VERIFICATION.md.
  Background:
    Given a shared bare git remote both nodes can push and pull
    And two aof installs ("node A", "node B") each cloned from that remote, each a mesh node with its own nodeId
    And node A runs the relay as the nominated control node and both nodes push and subscribe to it
    And a pool of ready items both nodes contend for
    And both installs drive only the registered aof work and mesh commands (no hand-edited files)

  # THE RELAY-UP HALF (50 of the 100): with the relay up, every contested item is executed by
  # exactly one node, losers stand down, and peers are observed deferring on heard intents before
  # any git sync — the fast path at relay latency, measured live.
  Scenario: 50 contested claims with the relay up — exactly one winner per item and peers defer within relay latency
    Given the relay is up and both nodes are connected to it
    When both nodes contest the same 50 items through next and run-start until every item is claimed
    Then every contested item was executed by exactly one node (0 double-executions in the relay-up half)
    And every contested loser stood down with no run minted, naming the winner
    And peers were observed deferring on heard lease intents before any git sync (the fast path at relay latency)
    And the relay-up half's counts (50 contested / 0 double-executions) and the observed defer latency are recorded in VERIFICATION.md

  # THE RELAY-KILLED HALF (the other 50): killing the relay removes only the intent broadcast —
  # arbitration falls to the git cadence and STAYS CORRECT (slower, never broken; no claim is
  # blocked). This is measurement (2): the degradation direction PRD A2 demands.
  Scenario: 50 contested claims with the relay killed — arbitration stays correct at the git cadence
    Given the relay has been killed mid-fleet
    When both nodes contest a further 50 items through next and run-start until every item is claimed
    Then every contested item was executed by exactly one node (0 double-executions in the relay-killed half)
    And arbitration was observed at the git cadence — slower, never broken (losers stood down on git evidence alone)
    And no claim was blocked by the relay's absence
    And the relay-killed half's counts (50 contested / 0 double-executions) and the observed git-cadence arbitration are recorded in VERIFICATION.md

  # THE KR2 HEADLINE — the aggregate over both halves, audited from the durable records on the
  # shared remote (the single system of record): 100 contested claims, 0 cases of both executing.
  Scenario: across all 100 contested claims zero cases of both nodes executing the same item
    Given the relay-up half and the relay-killed half of the soak have both run
    When the run records across both nodes are audited over the shared remote
    Then across all 100 contested claims there are 0 cases of both nodes executing the same item (KR2)
    And every contested item's winning run carries the winner's node id under the winner's partition
    And the KR2 measurement (100 contested / 0 double-executions) is recorded in VERIFICATION.md

  # THE CRASHED-NODE RECLAIM, OBSERVED LIVE (measurement 3 — the ADR-006 path on a real fleet): a
  # node killed mid-run goes presence-stale; the surviving peer's next seek reclaims the orphan,
  # re-offers the item, and carries the lineage. The dead node's claim file is never touched (the
  # lease lapses by rule).
  Scenario: a crashed node's in-flight run is observed reclaimed by the peer
    Given node B is executing a claimed item and is killed mid-run (its presence and run heartbeat go stale past their thresholds)
    When node A next seeks work after both staleness thresholds have lapsed
    Then node B's orphaned run is force-failed "runtime_offline" with a reclaimedAt stamp
    And the item is offered again and node A's new run carries retryOf linking the reclaimed run
    And node B's claim file was never touched by node A (the lease lapsed by rule)
    And the observed reclaim chain (kill → stale → reclaim → retry lineage) is recorded in VERIFICATION.md
