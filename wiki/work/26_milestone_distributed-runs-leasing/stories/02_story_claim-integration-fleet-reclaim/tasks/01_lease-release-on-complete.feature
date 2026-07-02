@cli @work @distribution @executable
Feature: work:run-complete releases the holder's lease and work:run-retry carries the node through the retry lineage — an unconfigured install completes byte-identically to today
  In order to hand a finished item back to the fleet the moment its run terminates (the lease lifecycle behind the EXISTING verbs — zero new commands)
  work:run-complete flips the holder's OWN claim file to state "released" (never deleted, never a foreign write) and work:run-retry mints the retried run under the same node partition with its lineage linked,
  so that a completed item reads claimable again, a retried run stays attributable to its node, and a single-node install never reads, writes, or needs a lease.

  # ARCHITECTURE ADR-003.2 (release is an OWN-PATH STATE write — the holder sets state:"released" on
  # ITS OWN file; a delete was rejected as a path-resurrection race that also loses the stand-down
  # trail) + ADR-004 consequences (the release is wired at work:run-complete; the node pass-through
  # rides work:run-retry) + ADR-001 (the additive `node` record key the lineage carries).
  #
  # SEAM SPLIT — what is an arch-test vs what is this behaviour feature:
  #  - fitness #6 (acd-lease-write-scope) pins structurally that release is a state write routed
  #    through the atomic write seam, never an unlink — an ARCH-TEST, not a scenario.
  #  - THIS feature asserts the OBSERVABLE lifecycle: every terminal outcome releases; the released
  #    item reads claimable again; the retry lineage keeps its node; the unconfigured install is
  #    byte-identical to today.
  # NOTE on "no lease read": a NO-READ is not directly observable black-box. The scenarios below pin
  # the observable half — no lease path is ever created or modified and the results are byte-identical
  # to a pre-mesh fixture; the structural no-read half is fitness #4/#7-style arch material.
  Background:
    Given an initialised aof project whose work stream is a fixture I control
    And the work run-lifecycle commands registered in the command core

  # THE RELEASE — on EVERY terminal outcome, not just done (a failed or cancelled run must hand the
  # item back too, or a crash-free failure would wedge the item exactly like a crash). The holder's
  # OWN file flips state:"released" — a STATE write, never a delete (ADR-003: delete + a concurrent
  # re-claim is a path-resurrection race). The outcome set is the closed done|failed|cancelled.
  Scenario Outline: completing a run with any terminal outcome flips the holder's own claim file to released
    Given mesh is configured and this node holds the lease for an item with a running run (its claim file reads state "claimed" and carries the run's runId)
    When I invoke work:run-complete with outcome "<outcome>"
    Then the run reaches state "<outcome>"
    And this node's claim file for the item flips to state "released"
    And the claim file still exists on disk (release is a state write, never a delete)
    And no other contender's claim file was touched (an own-path write only)

    Examples:
      | outcome   |
      | done      |
      | failed    |
      | cancelled |

  # After completion the item reads CLAIMABLE again (ADR-003.4 — the converged steady state): a
  # released claim is not a live claim, so it neither skips the item in any seeker's view nor blocks
  # a fresh claim on the item.
  Scenario: after completion the item's lease reads released and the item is claimable again
    Given mesh is configured and this node completed its run for an item (its claim file reads "released")
    When any node reads the item's lease state
    Then no live claim remains on the item (the item reads claimable again)
    And a subsequent claim for the item is not blocked by the released file

  # THE RETRY LINEAGE keeps its node (ADR-001's node key + the existing retryOf lineage): the
  # retried run is a NEW record under the SAME node partition, attempt incremented, retryOf linking
  # the prior run — a run read in isolation still knows its owner.
  Scenario: work:run-retry carries the node through the retry lineage
    Given mesh is configured and this node owns a failed run with a retryable failure reason, persisted under its node partition
    When I invoke work:run-retry for the item
    Then a new run is minted in state running with the attempt incremented by one
    And the new run's retryOf links the failed run's runId
    And the new run carries the same node id and lands under the same node partition
    And the prior failed run record is left byte-unchanged

  # THE UNCONFIGURED FLOOR (SPEC §Scope: single-node installs keep working UNCHANGED): with no mesh
  # configured, complete and retry behave byte-identically to today — flat records, no node key, and
  # the lease seam never appears on disk.
  Scenario: an unconfigured-mesh install completes and retries byte-identically to today — no lease write anywhere
    Given an install with no mesh configured and a running run for an item (a flat record, node null)
    When I invoke work:run-complete with outcome failed and then work:run-retry for the item
    Then the completion and the retry behave byte-identically to today's unconfigured install
    And no lease file exists anywhere under the partition root (the lease seam was never written)
    And the completed and retried run records stay flat with no node partition appearing
