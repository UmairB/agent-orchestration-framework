@cli @work @distribution @executable
Feature: work:next honours leases through an optional injected view — a live peer's item is skipped, a stale peer's item surfaces reclaimable, and without the view nothing changes
  In order to keep two nodes off one item while never wedging the fleet behind a crashed peer — and never taxing a single-node install
  the next walk accepts an optional pre-computed lease view: absent ⇒ the result is byte-identical to today (the single-node floor); an item leased by a LIVE peer is skipped exactly as not-actionable; an item leased by a STALE peer is offered ready carrying reclaimable + the holder; the command builds the view ONLY when mesh is configured; and a cache-shaped hint can only ADD a skip,
  so that next stays a pure read (reclaiming is the claim path's job, story 02), git wins over any hint, and an unconfigured install renders byte-identically to today.

  # ARCHITECTURE ADR-005 (story 01): nextWork(workDir, scopeRef, { leaseView }) — an
  # OPTIONAL third argument, absent by default (the mergePresence(disk, null) === disk idiom
  # applied to next). leased-live ⇒ skip exactly as a done story is skipped; leased-stale ⇒
  # ready + { reclaimable: true, leasedBy } (next is a READ — the claim path reclaims). The
  # COMMAND (commands/next.mjs) builds the view only under the config.mesh.nodeId gate,
  # overlaying the cache-shaped hint as disk ?? cache — git wins, the hint can only ADD a
  # skip, never unlease (23/ADR-004's overlay discipline; the real subscriber cache wires in
  # story 02 — here the hint is injected as plain DATA). ADR-003.4: a third-party reader
  # never resolves the winner — next only ever asks "is there a live claim here".
  #
  # SEAM SPLIT — what is an arch-test vs what is this behaviour feature:
  #  - fitness #7 (acd-next-lease-injected): work.mjs imports NO mesh module, the lease view
  #    is an OPTIONAL argument defaulting absent, the command gates the view on config —
  #    import/signature/source assertions, NOT scenarios here.
  #  - THIS feature asserts the OBSERVABLE walk outcomes: which item is offered, which is
  #    passed over, what annotations the result carries, and that the render is byte-
  #    identical when the view is absent or the mesh unconfigured.
  #
  # QA FEASIBILITY FLAG (developer-amigo): the view-driven rows stay @executable ONLY if the
  # lease view crosses the seam as PLAIN DATA (per item ref: unleased | leased-live |
  # leased-stale + holder nodeId — the ADR-frozen concept; the concrete shape is the
  # developer's to freeze at build) so the core walk can be driven with a hand-built view,
  # AND the command-level rows can drive the SAME outcomes from disk fixtures (claim +
  # presence + injected now) through the config gate. If the view can only be built inside
  # the command, the core-walk rows fall back to command-level drives — keep them
  # @executable either way; do not silently retag. See VERIFICATION.
  # RESOLVED (developer-amigo): PLAIN DATA confirmed on both halves — all rows stay
  # @executable, core-walk rows driven with hand-built views, command rows from disk.
  #  - THE VIEW SHAPE (frozen here, the ADR-005 vocabulary): a Map keyed by item ref (the
  #    SAME ref strings nextWork's items carry, e.g. "00/01" — taken from the claim
  #    RECORD's itemRef, never from the flatLeaf'd directory name), value
  #    { state: "leased-live" | "leased-stale", holder: <nodeId> }; a ref ABSENT from the
  #    map (or a nullish/absent map) is unleased. nextWork touches ONLY leaseView.get(ref)
  #    — no method beyond get, so a test hand-builds `new Map([["00/00", { state:
  #    "leased-live", holder: "node-b" }]])`.
  #  - THE NO-PRESENCE MAPPING (the task-01 PO lock applied here): a "claimed" record
  #    whose holder has NO presence record maps to the SKIP bucket — state "leased-live",
  #    NO reclaimable annotation — NEVER "leased-stale". The two features agree; no edit
  #    was needed.
  #  - THE BUILDER: a PURE buildLeaseView(claims, presenceById, { nowMs, thresholdMs,
  #    hint }) exported from src/mesh-lease.mjs; commands/next.mjs composes it from the
  #    disk reads under the config.mesh.nodeId gate, hint = ctx.leaseCache (absent in
  #    story 01 — the hint rows inject it as data). Overlay direction locked: disk-first;
  #    the hint may only ADD an entry for a ref the disk left unleased (state
  #    "leased-live", holder from the hint) — it never removes, downgrades, or marks
  #    reclaimable (git wins; skip-only is the fail-safe direction).
  #  - THE COMMAND-ROW CLOCK: commands/next.mjs gains an OPTIONAL `now` input property
  #    (the mesh:status white-box idiom, src/commands/mesh-identity.mjs:155–160) read only
  #    inside the configured branch — the unconfigured floor never touches it, keeping the
  #    unconfigured render byte-identical.
  Background:
    Given an initialised aof project whose work stream is a fixture I control
    And lease and presence fixtures I write directly, read under an injected now
    And unless a scenario says otherwise, the work tree holds one milestone whose not-done stories walk "story-a" then "story-b"

  # THE SINGLE-NODE FLOOR (ADR-005; SPEC §Scope "single-node installs keep working
  # UNCHANGED"): with NO lease view the walk is byte-identical to today for the same tree —
  # across ALL THREE result states, and with zero lease-derived keys leaking into the shape.
  # This is the contract every other scenario builds on: mesh-awareness is an overlay, never
  # a rewrite.
  Scenario Outline: with no lease view the next result is byte-identical to today for the same tree
    Given a work tree shaped so that today's next answers "<today>"
    When next is asked with NO lease view
    Then the result is byte-identical to today's "<today>" result for that tree
    And the result carries no lease-derived key (no reclaimable, no leasedBy)

    Examples:
      | today   |
      | ready   |
      | blocked |
      | done    |

  # LEASED-LIVE ⇒ SKIP (ADR-005): an item leased by a live peer is being worked — just not
  # here — so the walk passes it over exactly as not-actionable and offers the FOLLOWING
  # candidate. The offered item carries no reclaim annotation (nothing to reclaim from a
  # live peer).
  Scenario: an item leased by a live peer is skipped and the following candidate is offered
    Given "story-a" is leased by peer "node-b" whose presence is fresh (leased-live)
    And "story-b" is unleased
    When next is asked with the lease view
    Then the offered item is "story-b"
    And "story-a" was passed over exactly as a not-actionable item
    And the offered result carries no reclaimable annotation

  # ALL LEASED ⇒ THE SHAPE STAYS HONEST. The hazard: leased-live skips "exactly as a done
  # story is skipped" — but a milestone whose every not-done story is lease-skipped must NOT
  # fall through to the all-stories-done branch and offer the MILESTONE as ready-for-
  # acceptance (a false ready — the stories are being worked elsewhere, not done). The
  # honest answer when everything actionable is leased by live peers is the nothing-
  # actionable shape.
  Scenario: with every actionable story leased by live peers next offers nothing — never a false milestone-accept
    Given "story-a" and "story-b" are both leased by live peers
    And they are the milestone's only not-done stories
    When next is asked with the lease view
    Then no leased item is offered
    And the milestone is NOT offered as ready-for-acceptance (its stories are being worked, not done)
    And the result is the honest nothing-actionable shape

  # LEASED-STALE ⇒ READY + RECLAIMABLE (ADR-005; SPEC §Objective "reclaimed by a peer rather
  # than left stuck"): a stale peer's item is OFFERED — first, in its normal walk position (a
  # stale lease never demotes priority) — annotated { reclaimable: true, leasedBy } so the
  # caller knows a claim-path reclaim stands between it and the work. And next is a READ:
  # surfacing a reclaimable item writes nothing — no lease flip, no presence touch (the
  # actual reclaim is the claim path's, story 02).
  Scenario: an item leased by a stale peer is offered ready and reclaimable, naming the holder — and next writes nothing
    Given "story-a" is leased by peer "node-b" whose presence is stale (leased-stale)
    And I record the on-disk state of the lease and presence tree
    When next is asked with the lease view
    Then the offered item is "story-a" (a stale lease never demotes the walk order)
    And the result carries reclaimable true and leasedBy "node-b"
    And the lease and presence tree is byte-unchanged (next is a read — the claim path reclaims, never next)

  # THE HINT CAN ONLY ADD A SKIP (ADR-005; 23/ADR-004's git-wins overlay): the cache-shaped
  # hint is injected as plain DATA here (the real subscriber cache wires in story 02). Three
  # rows close the overlay matrix:
  #   row 1 — the hint's SILENCE never unleases: an item leased-live on DISK but absent from
  #           the hint is STILL skipped (git wins; a cache miss means nothing);
  #   row 2 — the hint ADDS a skip: an item unleased on disk but named by the hint is
  #           skipped (the ≤relay-latency defer window);
  #   row 3 — the null row: unleased on disk, absent from the hint ⇒ offered.
  # The hint can therefore only ever move an item toward SKIP, never toward HOLD/offer —
  # the fail-safe direction (the cache-can-never-cause-a-HOLD rule is fitness #8's).
  Scenario Outline: a cache-shaped hint can only add a skip — git wins and the hint never unleases an item
    Given "story-a" is <on-disk> on disk
    And the lease view is built with a cache-shaped hint, injected as data, that <hint>
    And "story-b" is unleased and next in walk order
    When next is asked with the lease view
    Then the offered item is "<offered>"

    Examples:
      | on-disk                 | hint                                   | offered |
      | leased-live by "node-b" | does not mention "story-a" at all      | story-b |
      | unleased                | names "story-a" as claimed by "node-b" | story-b |
      | unleased                | does not mention "story-a" at all      | story-a |

  # THE CONFIG GATE, unconfigured half (ADR-005): with no config.mesh.nodeId the command
  # builds NO view — lease files sitting on disk are INVISIBLE to next, and the human render
  # and --json are byte-identical to today's for that tree. This is the sharp assertion of
  # the single-node floor at the COMMAND face: the same bytes that skip an item under a
  # configured mesh do nothing at all under an unconfigured one.
  Scenario: with mesh unconfigured the command builds no view — lease files on disk are invisible and the render is byte-identical to today
    Given "story-a" is leased-live on disk by peer "node-b"
    And config.mesh.nodeId is absent (mesh unconfigured)
    When the next command is invoked
    Then the offered item is "story-a" (the lease was never read)
    And the human render and the --json result are byte-identical to today's for that tree

  # THE CONFIG GATE, configured half: the SAME tree, now with mesh configured — the command
  # builds the view and the leased item is skipped. Together with the previous scenario this
  # pins the gate as the ONLY difference between the two behaviours.
  Scenario: with mesh configured the same tree's leased item is skipped by the command
    Given "story-a" is leased-live on disk by peer "node-b"
    And config.mesh.nodeId is "node-a" (mesh configured)
    When the next command is invoked
    Then the offered item is "story-b" ("story-a" is leased by a live peer)
