@cli @work @distribution @manual
Feature: presence reaches a peer purely over git — the poll-for-durability floor, no relay, with the payload-agnostic sync engine unchanged
  In order to prove the fleet's live activity is visible with the relay killed (the ≤30s git-fallback half of KR1, the poll-for-durability floor)
  one node publishes its presence and syncs over a shared git remote while a second node syncs and renders that node's presence plus the correct stale flag,
  so that presence moves to a peer through git ALONE — the milestone-22 sync engine carries the new record type with zero engine change, the add-only merge lands the file unchanged under the peer's partition, and correctness never depends on a relay.

  # ARCHITECTURE ADR-002 + ADR-003 (the poll-for-durability half): presence is written to
  # git UNCONDITIONALLY (ADR-003) and moved by milestone 22's PAYLOAD-AGNOSTIC sync engine
  # (22/ADR-004) with ZERO engine change — the engine moves whatever lands under meshDir
  # without parsing it, so the presence record (a NEW record type) syncs unchanged. This
  # task is the OUTSIDER-VERIFIABLE poll-for-durability acceptance: two clones over a shared
  # bare remote, presence published + synced by node A, read + rendered by node B — purely
  # over git, NO relay. The relay (story 01) and the ≤5s push half (story 02 of the milestone)
  # are out of scope here; this is the GIT-ONLY floor. Agent-run; evidence in VERIFICATION.md.
  # Ties to the ≤30s git-fallback half of KR1.
  #
  # QA FEASIBILITY FLAG — RESOLVED (developer-amigo seat, Contract): STAYS @manual. Every
  # scenario here drives REAL git over a bare-remote fixture (init / commit / pull / push + a
  # real second clone) and needs a committable identity (user.name / user.email) in CI. It ALSO
  # crosses the line-ending hazard (22/R5): node B's checked-out presence record may arrive CRLF
  # under autocrlf=true on a mixed-OS fleet, which would break the "byte-identical under the
  # peer's partition" assertion. RESOLUTION: the .gitattributes `.mesh/** text eol=lf` pin
  # (ADR-002, fitness #6) is the STRUCTURAL fix that makes the byte-identity assertions SOUND
  # (it forces LF on the checked-out record regardless of autocrlf, so the "byte-for-byte as
  # node A wrote it" assertions hold) — but the pin does NOT make the genuine two-clone fleet
  # render reliably @executable: it stays @manual, mirroring the milestone-22 / story-02 / task-02
  # precedent (the real over-remote end-to-end render stayed @manual there; the add-only merge was
  # proven @executable in the transport task) and honouring the 22/R3 Windows-spawn-flake caution.
  # What this @manual feature MEASURES is the ≤30s git-fallback half of KR1 (the poll-for-durability
  # floor, relay killed). Agent-run; evidence in VERIFICATION.md. Tag UNCHANGED at @manual.
  Background:
    Given two clones — node A and node B — of one work stream over a shared bare git remote I control
    And the mesh commands registered in the command core on both clones
    And node A and node B each have a stable, distinct mesh.nodeId
    And no relay is configured or running (the git-only floor)

  # The poll-for-durability acceptance: node A publishes presence + syncs; node B syncs and
  # renders node A's presence with the correct stale flag — purely over git, no relay.
  Scenario: node B renders node A's presence and the correct stale flag purely over git
    Given node A has a running run "run-a1" in its run records
    When node A publishes its presence via mesh:heartbeat and runs mesh:sync
    And node B runs mesh:sync
    And node B runs mesh:status against a now within the staleness threshold of node A's heartbeat
    Then node B's status lists node A with its presence
    And node A's presence on node B lists activeRuns "run-a1"
    And node A is rendered stale false (its heartbeat is within the threshold)
    And no relay was used (the read was purely over git)

  # The stale flag is correct over git too: when node B reads at a `now` past the threshold
  # of node A's last synced heartbeat, node A renders STALE — the staleness rule (task 01)
  # holds across the git seam, not just locally.
  Scenario: node B renders node A stale when A's last synced heartbeat is past the threshold
    When node A publishes its presence via mesh:heartbeat and runs mesh:sync
    And node B runs mesh:sync
    And node B runs mesh:status against a now past the staleness threshold of node A's heartbeat
    Then node B's status lists node A with its presence
    And node A is rendered stale true (its last synced heartbeat is past the threshold)

  # The m22 sync engine moves the NEW presence record with ZERO engine change — the
  # payload-agnostic property (22/ADR-004) re-confirmed end-to-end: presence is a record
  # type the engine has never seen, yet it syncs byte-for-byte and the engine was neither
  # changed nor needed any presence-specific code path.
  Scenario: the milestone-22 sync engine carries the presence record with zero engine change
    When node A publishes its presence via mesh:heartbeat and runs mesh:sync
    And node B runs mesh:sync
    Then node A's presence record is present under node B's partition root
    And the sync engine was not modified to carry presence (it moved the new record type unchanged)
    And node A's presence record under node B's partition is byte-identical to what node A wrote (subject to the .gitattributes EOL pin, fitness #6)

  # Add-only-merge safety: A's presence file lands under B's partition root with no
  # three-way content merge — the partition convention (22/ADR-002) guarantees A and B
  # wrote different paths, so a concurrent publish merges add-only.
  # R4: pin BOTH that A's record lands AND that B's own presence record is untouched by the
  # pull (add-only means each file arrives intact, not three-way-merged).
  Scenario: a concurrent presence publish by both nodes merges add-only with no conflict and no content rewrite
    Given node A and node B each publish their own distinct presence record concurrently
    And I record the on-disk bytes of node B's own presence record
    When both run mesh:sync and node B pulls
    Then both presence records are present under node B's partition root
    And the merge completed add-only with no conflict
    And node B's own presence record is byte-identical to before the pull
    And node A's presence record arrived byte-for-byte as node A wrote it (subject to the .gitattributes EOL pin, fitness #6)
