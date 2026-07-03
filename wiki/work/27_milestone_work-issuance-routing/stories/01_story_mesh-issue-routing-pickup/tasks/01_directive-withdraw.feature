@cli @work @distribution @executable
Feature: withdrawing an issued directive is an own-path state flip to "withdrawn" (never a delete) and stops the item being offered by routing
  In order to un-issue work I issued without ever unlinking a fleet-reachable record (the 26/ADR-003.2 release idiom)
  the issuer withdraws its OWN directive by flipping its own-partition record's state to "withdrawn" — never a delete, never a foreign write — and a withdrawn directive is CONSUMED by the routing read as spent (the pickup offers only non-withdrawn directives),
  so that un-issuing is an add-only git event that propagates like any other .mesh/ write, a peer's directive is never touched, and a withdrawn item stops being offered by a mesh-aware next.

  # ARCHITECTURE ADR-001.3 (the lifecycle — issued → withdrawn | fulfilled, own-path state
  # writes only, the 26/ADR-003.2 release idiom NEVER a delete) + ADR-004.2 (the routing read
  # consumes only non-withdrawn directives):
  #   - withdrawDirective(ws, ownNodeId, itemRef) re-reads THIS node's own directive at
  #     issuanceDirectivePath(ws, ownNodeId, ref) and writes it back with state "withdrawn"
  #     (atomic writeText — an own-path flip, never unlink/rm);
  #   - a withdrawn directive is a spent hint: the routing filter (story 02 / commands/next.mjs)
  #     treats a withdrawn directive as if it were not there — the item is no longer targeted by it.
  #
  # SEAM SPLIT — what is an arch-test vs what is this behaviour feature:
  #  - fitness #1 (acd-issuance-write-scope): withdrawal is a STATE write never a delete (no
  #    unlink/rm of a directive), own-issuer-partitioned, joining issuanceDirectivePath via
  #    writeText — SOURCE assertions over mesh-issuance.mjs, NOT scenarios here.
  #  - THIS feature asserts the OBSERVABLE lifecycle: the state flips to "withdrawn", the file
  #    still exists (no delete), a peer's directive is untouched, and a mesh-aware next no longer
  #    offers a withdrawn item.
  #
  # QA FEASIBILITY FLAG (developer-amigo): the rows stay @executable ONLY if the routing read
  # (story 02's commands/next.mjs candidacy view) is DRIVABLE from disk directive fixtures under
  # the config gate — i.e. a withdrawn directive file on disk yields a candidacy view that no
  # longer skips-or-targets the item, drivable in-process with a planted directive tree. This is
  # the SAME injected-candidacy-view lever task 02 depends on; if that lever holds there, the
  # withdraw-then-not-offered row rides it. RAISED — flagged jointly with task 02's routing lever.
  #
  # RESOLVED (developer-amigo): CONFIRMED — @executable stands unchanged, no retag. The lever this
  # row rides is task 02's UNIFIED candidacy view (resolved there in full: the view crosses the
  # `commands/next.mjs` seam as PLAIN DATA, a Map keyed by item ref, built OUTSIDE `work.mjs` from
  # `readIssuanceDirectives` + `nodeSatisfiesTarget` + this node's descriptor — exactly the shape
  # `buildLeaseView` already proves at `src/mesh-lease.mjs:401-428` for the lease half, and
  # `commands/next.mjs:33-61` already proves for the config-gated injection point). A withdrawn
  # directive is filtered by `readIssuanceDirectives`'s STATE FILTER (story 00's read, ADR-001.3 —
  # "the routing filter consumes only non-withdrawn directives") BEFORE it ever reaches the matcher,
  # so a withdraw-then-not-offered row is driven by: (1) plant a directive file on disk with
  # `state:"withdrawn"` (or call `withdrawDirective` against a planted `"issued"` file — both are
  # in-process fixture writes, no CLI/no live fleet), (2) build the candidacy view the same way
  # `commands/next.mjs` does under the config gate, (3) assert the ref carries no routing verdict.
  # This is a pure-fixture, in-process drive — identical in shape to how
  # `test/mesh-lease-claim-arbitration.test.mjs` drives `standDown`'s state-flip-not-delete rows
  # today. No harness lever beyond task 02's is needed.
  Background:
    Given an initialised aof project whose work stream is a fixture I control
    And the mesh commands registered in the command core
    And mesh is configured with a stable config.mesh.nodeId "node-a" for this node
    And a synced roster and a descriptor for this node I write directly
    And this node has already issued a directive for "27/00" (state "issued") under its own partition

  # WITHDRAW IS AN OWN-PATH STATE FLIP, NEVER A DELETE (ADR-001.3 / 26/ADR-003.2): the file at
  # this node's own issuance path still EXISTS after withdrawal — its state is flipped to
  # "withdrawn". The remaining five keys (itemRef, issuer, target, issuedAt, aofVersion) are
  # unchanged; only state moves. No unlink, no rm — a withdrawal is a git-durable state write.
  Scenario: withdrawing flips the own directive's state to "withdrawn" without deleting the file
    Given the on-disk byte-state of this node's directive is recorded
    When I invoke the withdraw of this node's directive for "27/00"
    Then the directive file at this node's issuance path STILL EXISTS (no delete, no unlink)
    And its state is now "withdrawn"
    And its itemRef, issuer, target, issuedAt, and aofVersion are unchanged from before the flip

  # A WITHDRAWN DIRECTIVE IS SPENT — THE PICKUP STOPS OFFERING THE ITEM (ADR-004.2): the routing
  # read consumes only NON-withdrawn directives. Once withdrawn, the directive no longer targets
  # the item — a mesh-aware next behaves as if it were never issued (the item returns to its
  # normal walk position with no routing verdict from the spent directive).
  Scenario: a withdrawn directive no longer targets the item — routing offers it in its normal walk position
    Given this node's directive for "27/00" targeted it at a capability this node does NOT advertise
    And before withdrawal a mesh-aware next SKIPPED "27/00" here (targeted elsewhere)
    When I invoke the withdraw of this node's directive for "27/00"
    And a mesh-aware next is asked again with the current directive tree
    Then the withdrawn directive contributes no routing verdict (it is spent)
    And "27/00" is no longer skipped by the spent directive

  # OWN-PATH ONLY — A PEER'S DIRECTIVE IS NEVER TOUCHED (ADR-001.1/.3): withdrawal writes ONLY
  # under THIS node's issuer partition. If a peer independently issued the SAME item, the peer's
  # directive is left byte-unchanged — this node withdraws only what it issued (per-issuer
  # partitioning makes the withdrawal a clean own-path event).
  Scenario: withdrawing this node's directive leaves a peer's directive for the same item untouched
    Given a peer "build-server" has also issued a directive for "27/00" under its own partition
    When I invoke the withdraw of this node's directive for "27/00"
    Then this node's directive under the "node-a" partition is now "withdrawn"
    And the peer's directive under the "build-server" partition is byte-unchanged (never a foreign write)

  # WITHDRAW IS IDEMPOTENT-SAFE AND ABSENCE-TOLERANT (ADR-001.3, the state-write discipline):
  # withdrawing an already-withdrawn directive re-writes state "withdrawn" (a no-op flip, never a
  # crash); withdrawing an item this node never issued surfaces a benign not-issued signal (no
  # file is fabricated, nothing is deleted) — the read-side hint is a HINT, never an authority.
  Scenario Outline: withdraw is safe on an already-withdrawn or a never-issued directive
    Given this node's directive for "27/00" is currently "<current>"
    When I invoke the withdraw of this node's directive for "27/00"
    Then the outcome is "<outcome>"
    And no directive file was deleted or unlinked

    Examples:
      | current              | outcome                                          |
      | issued               | flipped to "withdrawn"                           |
      | withdrawn            | re-written "withdrawn" (idempotent no-op flip)   |
      | never issued (absent)| a benign not-issued signal (nothing fabricated)  |
