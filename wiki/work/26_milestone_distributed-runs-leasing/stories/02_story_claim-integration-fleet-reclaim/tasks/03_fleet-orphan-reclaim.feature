@cli @work @distribution @executable
Feature: a crashed peer's orphaned run is reclaimed at the claim path under the dual-staleness guard — presence precedence, the lease lapses by rule, and the reclaimed lineage retries
  In order to free a crashed node's in-flight work for the fleet without ever yanking a live peer's run out from under it (the double-execution direction KR2 forbids)
  any node seeking work sweeps peer-owned running runs at work:run-start: a peer stale in BOTH presence and run heartbeat is force-failed retryable and its item offered again, while a fresh-presence peer is hands-off unconditionally,
  so that a wedged fleet self-heals the next time any node seeks work, a live peer is never reclaimed, and an unconfigured install keeps today's local scan byte-identically.

  # ARCHITECTURE ADR-006: the m20 scan generalised BY ARGUMENT at the EXISTING claim path (no new
  # verb, no daemon); the DUAL-staleness guard with fixed precedence — presence wins; the foreign
  # force-fail is the ONE sanctioned foreign-path write (a documented refinement of 22/ADR-002,
  # through the legal running→failed transition only); the dead peer's LEASE lapses by RULE (live
  # iff presence fresh, ADR-003.2 — no foreign lease write, ever); status rollback rides the
  # existing 20/ADR-005 writer verbatim.
  #
  # SEAM SPLIT — what is an arch-test vs what is this behaviour feature:
  #  - fitness #12 (acd-fleet-reclaim-guarded) pins structurally that the fleet item set is built
  #    only inside the mesh-configured branch and filtered through the presence predicate BEFORE
  #    the scan, with the store's signature/mesh-blindness unchanged and rollback still routed
  #    through the status writer. An ARCH-TEST — never a scenario here.
  #  - THIS feature asserts the OBSERVABLE decision table and its consequences: which runs are
  #    reclaimed, which are hands-off, what the reclaimed record/item/lineage look like, and that
  #    the dead peer's claim file is never touched.
  # BOUNDARY LITERALS (both predicates are the EXISTING ones — one staleness definition, strict >):
  #   presence stale  : age > the presence threshold (documented default 90 seconds);
  #                     age EXACTLY AT the threshold is still LIVE (strict >).
  #   heartbeat stale : age > the run-heartbeat threshold (documented default 15 minutes);
  #                     a run that never beat falls back to its last update stamp.
  #
  # QA FEASIBILITY FLAG (developer-amigo): the decision-table rows stay @executable ONLY if
  # staleness is computed over INJECTABLE instants/thresholds (the inject-the-clock discipline):
  # fixture presence records + peer-partitioned run records with controlled heartbeat stamps, and
  # thresholds resolvable from fixture config. If the claim path can only read the wall clock, the
  # exactly-at-threshold boundary row is not deterministically assertable. RAISED — do not drop the
  # boundary row.
  # RESOLVED (developer-amigo): every row (including exactly-at-threshold) stays @executable —
  # BOTH predicates are pure over passed-in instants with config-resolved thresholds at this site.
  #  - run-heartbeat half: reclaimStaleRuns takes { now, stalenessThreshold } (src/run-store.mjs:407)
  #    and run-start already resolves the threshold from work.autonomous.heartbeatStaleMs
  #    (src/commands/run-start.mjs:49, default 15m at :21). Today's call omits `now`
  #    (run-start.mjs:50) — the build THREADS run-start's new optional white-box `now` input
  #    (locked in task 00's resolution) into the scan, so one injected instant drives it.
  #  - presence half: isNodeStale(presence, nowMs, thresholdMs) is pure (src/mesh-presence.mjs:176–178,
  #    delegating to run-store isStale — ONE staleness definition) with the threshold from
  #    resolveStalenessSeconds(config) (src/mesh-presence.mjs:187–193, documented default 90s) —
  #    fixture config sets mesh.presence.stalenessSeconds; the prefilter computes nowMs from the
  #    SAME injected `now`.
  #  - the boundary row is deterministic: isStale is strict `>` (src/run-store.mjs:390–394 —
  #    "a run exactly AT the threshold is still live"), so presence heartbeatAt = now − 90s with a
  #    90s threshold reads LIVE, byte-stably. Fixture presence records + peer-partitioned run
  #    records with controlled heartbeatAt stamps are plain writes under presenceRecordPath /
  #    runNodeRecordPath (the story-00 union read attributes each run via its `node` key).
  Background:
    Given an initialised aof project whose work stream is a fixture I control
    And the work run-lifecycle commands registered in the command core
    And mesh is configured with a stable mesh.nodeId for this node
    And a peer node's presence record and node-partitioned run records exist as fixtures whose stamps I control

  # THE DUAL-STALENESS DECISION TABLE (ADR-006.2) — presence × run-heartbeat, with FIXED PRECEDENCE:
  # presence wins. The fresh-presence row is THE row that guards KR2: a live node's wedged run is
  # its OWN restart scan's business — a peer reclaiming it is the double-execution direction. The
  # stale-presence + fresh-heartbeat row waits (conservative — a truly dead run crosses its own
  # threshold shortly). The at-threshold row pins the strict-> boundary.
  Scenario Outline: a peer's running run is reclaimed only under dual staleness — presence precedence
    Given a peer owns a running run for an item, persisted under the peer's node partition
    And the peer's presence is "<peer presence>"
    And the peer run's heartbeat is "<run heartbeat>"
    When this node seeks work and invokes work:run-start (the claim path — the only reclaim trigger)
    Then the peer's running run is "<peer-run outcome>"
    And the item's status is "<item status>"

    Examples:
      | peer presence                                  | run heartbeat                        | peer-run outcome                                          | item status                 |
      | stale (age > the 90s presence threshold)       | stale (age > the 15m run threshold)  | force-failed "runtime_offline" with a reclaimedAt stamp   | rolled back (offered again) |
      | fresh (age within the presence threshold)      | stale (age > the 15m run threshold)  | left byte-unchanged (hands off — presence precedence)     | untouched                   |
      | stale (age > the 90s presence threshold)       | fresh (heartbeat within threshold)   | left byte-unchanged (wait — conservative)                 | untouched                   |
      | fresh (age within the presence threshold)      | fresh (heartbeat within threshold)   | left byte-unchanged                                       | untouched                   |
      | exactly AT the presence threshold (age == 90s) | stale (age > the 15m run threshold)  | left byte-unchanged (AT the threshold is still LIVE)      | untouched                   |

  # THE RECLAIM, IN FULL (the stale+stale row expanded): the force-fail is the ONE sanctioned
  # foreign-path write (ADR-006.4 — through the legal running→failed transition only), the failure
  # is retryable by design (a crashed host is infra), the rollback rides the existing status writer
  # (20/ADR-005), and the item is offered again to the next seeker.
  Scenario: the reclaimed run is force-failed retryable, its item rolled back and offered again
    Given a peer stale in both presence and run heartbeat owns a running run for an in-progress item
    When this node seeks work and invokes work:run-start
    Then the peer's run reads failed with failureReason "runtime_offline" and a reclaimedAt stamp
    And the reclaimed failure is retryable (a crashed host is infra, never an agent fault)
    And the item's status is rolled back so the stream reads honest
    And the item is offered again to the next seeker
    And every other record of the peer's is left byte-unchanged (only the legal transition was written)

  # THE RECLAIMED LINEAGE RETRIES (the retryOf tie + ADR-001's node key): the reclaiming winner's
  # NEW run carries retryOf → the reclaimed run and lands under the WINNER's own partition — the
  # crash is visible in the lineage, not erased by it.
  Scenario: the reclaiming winner's new run carries the retry lineage to the reclaimed run
    Given a peer's run was reclaimed (force-failed "runtime_offline") and its item is offered again
    When this node claims the item, wins the lease, and starts the new run
    Then the new run's retryOf links the reclaimed run's runId
    And the new run carries THIS node's id and lands under this node's partition
    And the reclaimed run record itself stays terminal and byte-unchanged by the retry

  # THE LEASE LAPSES BY RULE (ADR-003.2 / ADR-006.4): a claim is live iff its holder's presence is
  # fresh, so the dead peer's claim simply stops counting — NO foreign lease write, ever. The
  # reclaimer acquires its OWN lease under its own id.
  Scenario: the dead peer's lease lapses by rule — its claim file is byte-unchanged and the reclaimer acquires its own
    Given the dual-stale peer holds a claim file for the item in state "claimed"
    When this node reclaims the item and claims it for itself
    Then the peer's claim file is byte-unchanged (no foreign lease write, ever)
    And the peer's lapsed claim did not block this node's claim (live iff presence fresh — the rule)
    And this node holds its OWN claim file for the item (a separate file under this node's id)

  # THIS NODE'S OWN RUNS follow the LOCAL scan's existing rules — heartbeat staleness alone;
  # presence is NOT consulted for oneself (the presence-precedence guard is for PEERS). The
  # observable contrast with the fresh-peer row above: an identical fresh-presence + stale-heartbeat
  # shape IS reclaimed when it is this node's own.
  Scenario: this node's own stale run is reclaimed under the local rules even though its own presence is fresh
    Given THIS node's presence is fresh (it is alive) and it owns a running run whose heartbeat is stale for the item being started
    When I invoke work:run-start for that item
    Then this node's own stale run is force-failed "runtime_offline" (today's restart-time reclaim, unchanged)
    And the item's status is rolled back and the new start proceeds

  # THE FLEET SWEEP RUNS WHEN ANY NODE SEEKS WORK (ADR-006.1 — no daemon, no new verb): starting
  # item A also sweeps a crashed peer's orphan on item B — "reclaimed the next time any node seeks
  # work", not only when someone starts that exact item.
  Scenario: seeking work on one item reclaims a crashed peer's orphan on another item
    Given a dual-stale peer owns a running run for one item
    And this node is starting a different, unrelated item
    When I invoke work:run-start for the unrelated item
    Then the peer's orphaned run on the other item is force-failed "runtime_offline" with a reclaimedAt stamp
    And the other item's status is rolled back so it is offered again
    And the unrelated item's own start proceeds normally

  # THE UNCONFIGURED FLOOR (ADR-006.1: "[item] — today's local scan — UNCHANGED, and the whole of it
  # when mesh is unconfigured"): no mesh ⇒ no fleet sweep, no presence dependency — byte-identical
  # to today's single-item scan.
  Scenario: with no mesh configured only the started item's stale runs are scanned — byte-identical to today
    Given an install with no mesh configured
    And the item being started has a stale running run
    And a different item also has a stale running run
    When I invoke work:run-start for the first item
    Then the first item's stale run is force-failed "runtime_offline" (today's restart-time reclaim)
    And the other item's stale run is left byte-unchanged (no fleet sweep without mesh)
    And no presence record was read or required for the decision
