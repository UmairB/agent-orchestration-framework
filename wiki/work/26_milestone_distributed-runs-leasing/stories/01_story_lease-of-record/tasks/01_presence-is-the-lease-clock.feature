@cli @work @distribution @executable
Feature: A claim is live only while its holder's presence is fresh — presence is the lease clock, and a lapse is a rule, not an edit
  In order to let a crashed holder's item come free without any peer ever touching the dead node's files, over ONE staleness definition
  a claim reads LIVE exactly when its state is "claimed" AND its holder's presence heartbeat is fresh under the shared node-staleness threshold (strict >, at-threshold still fresh) — a stale holder's claim reads lapsed/reclaimable with zero writes anywhere, and only the returning owner ever flips its own lapsed file to "released",
  so that there is no per-lease TTL, no expiry stamp and no second clock: the presence heartbeat that already answers "is this node alive" is the one and only lease clock.

  # ARCHITECTURE ADR-003.2 (story 01): a claim is LIVE iff state === "claimed" AND its
  # holder's presence is FRESH — the m23 node-staleness predicate applied verbatim
  # (23/ADR-002: isNodeStale over presence/<node>.json, strict `>`, threshold from
  # resolveStalenessSeconds with the documented 90s default). Presence IS the lease
  # heartbeat; the LAPSE is a RULE readers apply, never a byte anybody writes; the returning
  # owner withdraws its own lapsed claims (own-path hygiene — nobody else ever touches them).
  #
  # SEAM SPLIT — what is an arch-test vs what is this behaviour feature:
  #  - fitness #6 (acd-lease-write-scope): own-path writes only, atomic writeText, no unlink
  #    — SOURCE assertions, not scenarios here.
  #  - the reuse-not-duplicate of the staleness predicate (imported, never re-derived) is an
  #    inherited structural seam (23/ADR-002); THIS feature asserts its OBSERVABLE face: the
  #    same threshold knob and the same strict-> boundary govern claim liveness.
  #  - THIS feature drives presence freshness through written presence fixtures + an
  #    injected now (the 22/R2 inject-the-clock discipline) — never wall-clock.
  #
  # QA CONTRACT FLAG (developer-amigo / PO — RAISED, unresolved): the claimed + NO-presence
  # row. ADR-003.2 defines LIVE (claimed AND fresh) and m23 LOCKED "never-beat ⇒ NOT stale"
  # (no-presence is unknown liveness, not staleness). A claim whose holder has NO presence
  # record is therefore NOT LIVE (no fresh heartbeat exists to earn live) — yet its holder is
  # NOT affirmatively STALE either, so the lapsed/reclaimable bucket is not obviously earned.
  # The scenario below asserts the SAFE reading (the KR2 direction — readers may only ever
  # add a skip; reclaim requires an AFFIRMATIVELY stale holder, generalising ADR-006's
  # "presence fresh ⇒ hands off" precedence to "not affirmatively stale ⇒ hands off"):
  #   claimed + no presence ⇒ NOT live AND NOT reclaimable — readers treat the item as
  #   leased (skip). Real window: a claim can sync before its holder's first heartbeat does.
  # If the amigos lock the opposite reading (no presence ⇒ reclaimable), flip the literals
  # HERE and re-check task 02's view mapping — the two features must never disagree.
  # RESOLVED (developer-amigo, applying the PRODUCT-OWNER's Contract-lock): the KR2-SAFE
  # reading STANDS as written — claimed + no-presence is LEASED (readers skip) and NOT
  # reclaimable. Never lapse a claim whose holder we have simply never heard from:
  # over-skipping is a liveness hiccup; reclaiming a possibly-live node's work is the
  # double-execution KR2 forbids (consistent with the m23 lock "never-beat ≠ stale",
  # src/commands/mesh-identity.mjs:210–214, and generalising ADR-006's presence-precedence
  # to "not affirmatively stale ⇒ hands off"). The literals below are FINAL — do not flip.
  # Cross-feature consistency CHECKED against task 02: its view vocabulary maps a
  # no-presence holder to the SKIP bucket (leased-live-shaped, no reclaimable annotation,
  # never leased-stale) — no row in 02_mesh-aware-next.feature offers a no-presence
  # holder's item as reclaimable, so the two features already agree; NO feature edit was
  # needed beyond this lock (see the task-02 flag resolution for the frozen view shape).
  #
  # QA FEASIBILITY FLAG (developer-amigo): the returning-owner scenario stays @executable
  # ONLY if the own-lapsed-claim withdrawal has a drivable entry point (a hygiene call, or a
  # documented side-effect of the owner's next claim-path engagement). The scenario asserts
  # the OUTCOME (own-path flip to "released", zero foreign write) whatever the entry point —
  # the developer picks the seam; do not silently retag. See VERIFICATION.
  # RESOLVED (developer-amigo): the seam is a STANDALONE EXPORTED withdrawOwnLapsedClaims(
  # workspace, nodeId, { nowMs, thresholdMs }) in src/mesh-lease.mjs, which acquireLease
  # ALSO calls as its FIRST own-path step (before the step-a competitor read) — so the
  # scenario drives the hygiene call directly under an injected now, and the claim path
  # gets the same hygiene for free (with the grain of ADR-003.2's "own-path hygiene").
  # Semantics: it reads THIS node's own claims (state "claimed" only) and its OWN on-disk
  # presence; when that presence is STALE under the injected now (isNodeStale — i.e. the
  # fleet has been reading these claims as lapsed), it flips each own claim to "released"
  # via writeText at leaseClaimPath(workspace, item, nodeId) — own paths only, a state
  # write never a delete; fresh own presence ⇒ a zero-write no-op. Ordering: hygiene runs
  # BEFORE the returning node publishes its fresh heartbeat (the scenario's "returns with
  # fresh presence" is the subsequent beat) — the scenario asserts only the outcome.
  Background:
    Given an initialised aof project whose work stream is a fixture I control
    And claim files and presence records are fixtures I write directly
    And claim liveness is read under an injected now (never wall-clock)

  # THE TRUTH TABLE — liveness is state × holder-presence, and ONLY claimed-and-fresh earns
  # live (ADR-003.2). A released file is a withdrawal: it holds nothing whatever its owner's
  # presence does — released rows are "not live" for fresh, stale AND absent presence (the
  # released half of the table is presence-blind). Threshold fixed at 60s; fresh = 30s old,
  # stale = 61s old (the boundary itself is the next outline's job).
  Scenario Outline: claim liveness is state times holder-presence — only claimed-and-fresh reads live
    Given the node-staleness threshold is 60 seconds
    And node "node-a"'s claim file for "item-x" reads state "<state>"
    And node "node-a"'s presence is <presence>
    When the claim's liveness is read with the injected now
    Then the claim reads <reads>

    Examples:
      | state    | presence                         | reads                |
      | claimed  | fresh (heartbeat 30s before now) | live                 |
      | claimed  | stale (heartbeat 61s before now) | lapsed (reclaimable) |
      | released | fresh (heartbeat 30s before now) | not live (no hold)   |
      | released | stale (heartbeat 61s before now) | not live (no hold)   |
      | released | absent (no presence record)      | not live (no hold)   |

  # THE BOUNDARY — the m23 strict-> shape applied to the lease clock, with the at-threshold
  # literal pinned (the 22/R2 get-the-boundary-literal-right discipline): age == threshold is
  # STILL FRESH (60 > 60 is false), so the claim is STILL LIVE at exactly the threshold. If
  # the lease layer ever re-implements the predicate as >=, the age-60 row goes red.
  Scenario Outline: the lease clock is strict — a holder exactly at the threshold is still fresh, so its claim is still live
    Given the node-staleness threshold is 60 seconds
    And node "node-a"'s claim file for "item-x" reads state "claimed"
    And node "node-a"'s presence heartbeat is <age> seconds before the injected now
    When the claim's liveness is read with the injected now
    Then the claim reads <reads>

    Examples:
      | age | reads  |
      | 0   | live   |
      | 59  | live   |
      | 60  | live   |
      | 61  | lapsed |
      | 600 | lapsed |

  # ONE THRESHOLD KNOB — the lease clock reads the SAME config.mesh.presence.stalenessSeconds
  # the m23 status render reads, through the SAME resolver with the SAME documented 90s
  # default (the full malformed-value matrix is already pinned by m23's staleness feature —
  # here we assert the lease layer is governed by THAT resolver, not a private copy or a
  # private default). A malformed value falls back to the default, so age 91 lapses under
  # "not-a-number" exactly as under absent.
  Scenario Outline: claim liveness is governed by the same configured staleness threshold, with the documented default fallback
    Given config.mesh.presence.stalenessSeconds is <configured>
    And node "node-a"'s claim file for "item-x" reads state "claimed"
    And node "node-a"'s presence heartbeat is <age> seconds before the injected now
    When the claim's liveness is read with the injected now
    Then the claim reads <reads>

    Examples:
      | configured     | age | reads  |
      | 30             | 30  | live   |
      | 30             | 31  | lapsed |
      | absent (unset) | 90  | live   |
      | absent (unset) | 91  | lapsed |
      | "not-a-number" | 91  | lapsed |

  # THE LAPSE IS A RULE, NOT AN EDIT (ADR-003.2): a stale holder's claim reads lapsed with
  # ZERO writes — the stale holder's own file still says "claimed" byte-for-byte (nobody
  # flipped it; the lapse exists only in the reading), and nothing else moved either. This is
  # the zero-foreign-write half of the reclaim story: the dead peer's claim file is never
  # touched by anyone but the (possibly returning) owner.
  Scenario: a lapse is a rule, not an edit — reading a stale holder's claim writes nothing anywhere
    Given node "node-a"'s claim file for "item-x" reads state "claimed"
    And node "node-a"'s presence is stale under the injected now
    And I record the on-disk state of the whole lease and presence tree
    When the claim's liveness is read with the injected now
    Then the claim reads lapsed (reclaimable)
    And the stale holder's claim file is byte-unchanged — it still reads state "claimed"
    And the whole lease and presence tree is byte-unchanged (the lapse exists only in the reading)

  # OWN-PATH HYGIENE (ADR-003.2): the ONE writer a lapsed claim ever has is its returning
  # owner — back with fresh presence, it withdraws its own lapsed claim by flipping ITS OWN
  # file to "released" (a state write, not a delete — the task-00 discipline). A bystander's
  # live claim on another item is byte-untouched: hygiene never crosses a path boundary.
  # Entry point: see the QA FEASIBILITY FLAG above.
  Scenario: an owner returning from staleness withdraws its own lapsed claim — an own-path flip to released
    Given node "node-a"'s claim file for "item-x" reads state "claimed" while node-a's presence is stale (the claim has lapsed)
    And node "node-b" holds a live claim on "item-y"
    When node "node-a" returns with fresh presence and its own-claim hygiene runs
    Then node "node-a"'s claim file for "item-x" reads state "released"
    And that file still exists at its own path (withdrawal is a state write, not a delete)
    And node "node-b"'s claim file for "item-y" is byte-untouched (hygiene is own-path only)

  # NO SECOND CLOCK (ADR-003.2; the rejected TTL alternative): the SAME claim bytes read live
  # and then lapsed as ONLY the injected now advances past the holder's heartbeat — nothing
  # in the claim record participates in the timing, and the record carries no field that
  # could (the frozen six keys, no TTL, no expiry stamp). Presence is the one clock.
  Scenario: the same claim bytes read live then lapsed as only the presence ages — no clock lives in the claim
    Given the node-staleness threshold is 60 seconds
    And node "node-a"'s claim file for "item-x" reads state "claimed", its bytes fixed for the whole scenario
    And node "node-a"'s presence heartbeat is fixed at one instant
    When the claim's liveness is read with an injected now 30 seconds after that heartbeat
    Then the claim reads live
    When the claim's liveness is read again with an injected now 120 seconds after that heartbeat, the claim bytes untouched
    Then the same claim reads lapsed
    And the persisted claim record carries no TTL and no expiry key — exactly the frozen six keys (presence is the one clock)

  # THE FLAGGED ROW (see the QA CONTRACT FLAG above — asserted explicitly, not guessed
  # silently): claimed + NO presence record. Not live (no fresh heartbeat exists), and NOT
  # reclaimable (the holder is not affirmatively stale — never-beat is unknown liveness, the
  # m23 lock). Readers treat the item as leased: the skip direction, because a claim can
  # reach a peer's tree before its holder's first heartbeat does, and offering it for
  # reclaim would open the double-execution door KR2 forbids.
  Scenario: a claimed item whose holder has never published presence is leased but not reclaimable — the safe reading
    Given node "node-a"'s claim file for "item-x" reads state "claimed"
    And node "node-a" has NO presence record at all
    When the claim's liveness is read with the injected now
    Then the claim does NOT read live (no fresh heartbeat exists to earn live)
    And the claim does NOT read lapsed/reclaimable (its holder is not affirmatively stale)
    And a reader treats "item-x" as leased (the skip direction — KR2-safe)
    And no error is raised (a missing presence record is benign)
