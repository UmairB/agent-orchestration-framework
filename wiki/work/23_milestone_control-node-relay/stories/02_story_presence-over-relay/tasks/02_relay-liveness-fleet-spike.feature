@cli @work @distribution @manual
Feature: On a 3-node fleet a peer's change is reflected ≤5s over the relay and ≤30s with the relay killed, and killing the relay loses liveness not data
  In order to verify the milestone's load-bearing objective an outsider can check — push-for-liveness, poll-for-durability (PRD A1/A5; KR1; the liveness half of KR5)
  a 3-node fleet on a shared git remote with one control node running the relay measures a peer's change reflected ≤5s over the relay AND ≤30s with the relay killed, then kills the relay (or the control node) mid-fleet and confirms the fleet degrades to git-only sync with 0 lost records,
  so that an outsider confirms the live substrate works: sub-5s with the relay, ≤30s without it, and a relay/control-node death loses LIVENESS, not DATA — every signal has a durable git counterpart.

  # ARCHITECTURE ADR-003 — this is BOTH the outsider-verifiable headline acceptance AND the A1/A5
  # LATENCY MEASUREMENT SPIKE (the verification-time deliverable, mirroring 22/ADR-004's A1 note).
  # @manual: an agent stands up a real 3-node fleet (a shared bare remote + one control node running
  # serveRelay) and drives the registered aof mesh commands — NEVER hand-editing files. The measured
  # evidence (the ≤5s relay latency, the ≤30s git-killed latency, the 0-lost-records under relay
  # kill) is recorded in the milestone VERIFICATION.md.
  #
  # SEAM SPLIT — why this is @manual and not @executable (do NOT silently turn it into an assert):
  #  - The STRUCTURE (git written unconditionally, the relay push caught-never-thrown, the
  #    degradation clean, the loop a thin timer) is proven WITHOUT a fleet by:
  #      * tasks 00/01 @executable (the two-publish path + degradation + the cadence loop, over an
  #        injected relay client + an injected ticker + a local git fixture), and
  #      * fitness #4 (acd-presence-relay-independent — the source control-flow arch-test).
  #  - The LATENCY BOUNDS (≤5s / ≤30s) are MEASURED here on a real fleet under real concurrency —
  #    they are NOT unit-CI asserts. A wall-clock latency bound is not deterministically assertable
  #    in CI; it is a measured observation on real hardware + a real ws relay + real git push/pull.
  # QA FEASIBILITY FLAG (developer-amigo): the ≤5s / ≤30s figures are MEASURED here, not asserted in
  # unit CI. Keep this @manual — do NOT collapse the latency measurement into an @executable assert
  # (a flaky wall-clock bound). The developer-amigo owns the @manual scope: standing up the fleet,
  # running the measurement, and recording the numbers in VERIFICATION.md. The arch-test #4 + the
  # 00/01 @executable scenarios are green WITHOUT a fleet; only the latency + the live degradation
  # measurement needs one. See VERIFICATION.
  Background:
    Given a shared bare git remote all three nodes can push/pull
    And three aof installs ("node A", "node B", "node C") each cloned from that remote, each a node
    And node A is the nominated control node running the relay (config.mesh.relay.controlNode = A, config.mesh.relay.url = A's endpoint)
    And node B and node C are configured to push presence to node A's relay
    And all three installs drive only the registered aof mesh commands (no hand-edited files)

  # KR1 — the relay accelerator: with the relay UP, a peer's presence change is reflected to the
  # other nodes in ≤5s (the sub-5s liveness the relay exists to provide). This is the MEASUREMENT:
  # the agent records the observed latency in VERIFICATION.md.
  Scenario: a peer's presence change is reflected to the fleet in ≤5s over the relay
    Given the relay is up on the control node and all nodes are connected to it
    When node B publishes a presence change (a new heartbeat with a changed activeRuns set)
    Then node A and node C reflect node B's presence change in ≤5s (over the relay)
    And the measured relay latency is recorded in VERIFICATION.md

  # KR1 — the git floor: with the relay KILLED, the same peer change still reaches the fleet over
  # git (the m22 ≤30s sync engine) — slower, but never lost. This is the MEASUREMENT of the
  # poll-for-durability half: the agent records the observed git-fallback latency.
  Scenario: with the relay killed a peer's presence change still reaches the fleet in ≤30s over git
    Given the relay on the control node has been killed
    When node B publishes a presence change and the fleet syncs over git
    Then node A and node C reflect node B's presence change in ≤30s (over git, no relay)
    And the change was carried purely by git (no relay transported it)
    And the measured git-fallback latency is recorded in VERIFICATION.md

  # THE LIVENESS HALF OF KR5 — killing the relay (or the control node) mid-fleet loses LIVENESS,
  # not DATA: the fleet degrades to git-only sync with 0 lost records. This is the headline "you
  # still own the data" acceptance, measured live. The agent kills the relay while heartbeats are in
  # flight and confirms every durable presence record is intact + still syncing over git.
  # R4: pin BOTH sides — the LIVENESS path is gone (no sub-5s relay delivery) AND the DATA path is
  # intact (every presence record still present + delivered over git, 0 lost).
  Scenario: killing the relay mid-fleet loses liveness not data — the fleet degrades to git-only with 0 lost records
    Given all three nodes are heartbeating with the relay up
    When the relay (or the whole control node) is killed mid-fleet
    Then no further presence is delivered over the relay (liveness is lost)
    And every node's durable presence record is intact on the git remote (data is safe)
    And the fleet continues to exchange presence over git-only sync (the m22 engine)
    And 0 presence records were lost across the kill (the liveness half of KR5)
    And the 0-lost-records evidence under the relay kill is recorded in VERIFICATION.md

  # Re-nomination recovers liveness with no data event: standing the relay up on a DIFFERENT node
  # (re-pointing config.mesh.relay.* — no election protocol, ADR-001) restores sub-5s liveness, and
  # the durable records were never touched by the control-node death. Confirms losing the control
  # node pauses liveness, never data (ADR-001's "not a durability SPOF").
  Scenario: re-nominating the control node restores sub-5s liveness with no change to the durable records
    Given the original control node A and its relay have been killed (liveness paused, data intact)
    When node B is re-nominated as the control node (relay stood up on B, config re-pointed) and the fleet reconnects
    Then sub-5s liveness over the relay resumes across the fleet
    And every node's durable presence record is byte-identical to before the control-node death (no data event)
    And the re-nomination required only a config re-point and a relay restart (no election protocol)
    And the re-nomination + recovered-liveness evidence is recorded in VERIFICATION.md
