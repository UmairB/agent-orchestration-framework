@cli @work @distribution @executable
Feature: mesh:status additionally renders who holds what — per lease the item, the holder and live or lapsed — as a pure read
  In order to give an operator one glance at which node holds which item across the fleet
  the mesh:status render gains an ADDITIVE lease section: per held claim the item ref, the holder's nodeId and live|lapsed by the presence clock, in a stable --json shape — zero leases rendering an empty section, an unconfigured mesh rendering byte-identically to today,
  so that the render stays a pure read of git-synced records: it resolves no winner, flips no lapsed claim and mutates nothing.

  # ARCHITECTURE ADR-005 consequences (story 01): the additive lease render rides the
  # EXISTING mesh:status verb (src/commands/mesh-identity.mjs) — no new verb, so no
  # bijection/route gate re-arms (the 22/R1 inverse stays clean). Liveness is task 01's
  # predicate (claims × presence, injected now); ADR-003.4: a third-party reader NEVER
  # resolves the winner — during the transient two-claims window the render reports BOTH
  # claims and crowns nobody. The claim read carries the mesh-store discipline: absence-
  # tolerant (no leases dir ⇒ empty, not an error) and torn-file-skipping.
  #
  # SEAM SPLIT — what is an arch-test vs what is this behaviour feature:
  #  - the write-scope / no-unlink / arbitration-import invariants are fitness #6/#8 —
  #    source assertions, not scenarios here; no NEW fitness arms for the render itself.
  #  - THIS feature asserts the OBSERVABLE render: which leases appear, with which literals,
  #    in which stable --json shape, and that the partition root is byte-unchanged after.
  #
  # QA NOTE (Contract-stage freeze, this seat): the per-lease --json keys are pinned HERE as
  # { itemRef, holder, live } — itemRef/holder straight off the claim record's vocabulary
  # (ADR-003.1), `live` a boolean mirroring the nodes' boolean `stale` (m23), rendering
  # "live"/"lapsed" on the human face. The `leases` key is ADDITIVE beside the m23
  # { nodes: [...] } shape and appears ONLY when mesh is configured (unconfigured ⇒ the key
  # is ABSENT, not empty — byte-identical to today). Developer-amigo: build to these
  # literals or renegotiate them at Contract — do not drift silently.
  # RESOLVED (developer-amigo): the pinned literals are BUILDABLE AS-IS against the
  # existing render idiom — NO renegotiation. mesh:status's run already returns the bare
  # { nodes } object with pass-through json (src/commands/mesh-identity.mjs:221, 239) and
  # already accepts the injected `now` input (lines 155–160, 171–173) over the shared
  # resolveStalenessSeconds/isNodeStale clock (lines 173, 216) — the `leases` key lands as
  # a conditional additive assignment under the config.mesh.nodeId gate (key ABSENT when
  # unconfigured, [] when configured-but-empty), and the human render appends lease lines
  # only when result.leases exists, so the unconfigured face stays byte-identical. The
  # claim read (readLeaseClaims in src/mesh-lease.mjs) mirrors readNodeRecords'
  # absence-tolerant + torn-file-skipping walk (src/mesh-store.mjs:123–140) one level
  # deeper (leases/<item>/<node>.json). `live` is computed per claim record's OWN holder
  # presence via the task-01 predicate — a two-claims window renders two entries, one per
  # claimant, no winner resolution (ADR-003.4).
  Background:
    Given an initialised aof project whose work stream is a fixture I control
    And the mesh commands registered in the command core
    And config.mesh.nodeId is configured (mesh on), except where a scenario says otherwise
    And claim and presence fixtures I write directly, rendered under an injected now

  # THE LEASE LINE — per held claim: item, holder, live|lapsed by THE shared presence clock
  # (task 01's predicate, never a private re-derivation). The at-threshold row is the
  # regression guard: age == threshold renders LIVE (strict >, 60 > 60 is false) — if the
  # render layer ever re-implements the boundary as >=, the age-60 row goes red.
  Scenario Outline: each held claim renders its item, its holder and live or lapsed by the presence clock
    Given the node-staleness threshold is 60 seconds
    And node "node-b" has a claim file for "item-x" reading state "claimed"
    And node "node-b"'s presence heartbeat is <age> seconds before the injected now
    When I invoke mesh:status with that injected now
    Then the lease section lists "item-x" held by "node-b"
    And that lease renders <renders>

    Examples:
      | age | renders |
      | 30  | live    |
      | 60  | live    |
      | 61  | lapsed  |

  # A RELEASED FILE IS HISTORY, NOT A HOLD: the render answers "who HOLDS what", so a
  # state "released" file (a stand-down or a finished run's release — task 00 keeps it on
  # disk deliberately) never renders as a lease. Only "claimed" files are holds.
  Scenario: a released claim is a withdrawal, not a hold — it does not render as a lease
    Given node "node-b"'s claim file for "item-x" reads state "released"
    And node "node-c" has a claim file for "item-y" reading state "claimed", with fresh presence
    When I invoke mesh:status with the injected now
    Then the lease section lists exactly one lease — "item-y" held by "node-c"
    And "item-x" appears in no lease line (a released file is history, not a hold)

  # THE TRANSIENT TWO-CLAIMS WINDOW (ADR-003.4): mid-race, two "claimed" files for one item
  # can coexist until the loser's stand-down syncs. A third-party reader NEVER resolves the
  # winner — the render reports BOTH claims, crowns nobody, and does not error. (Correct by
  # ADR-003.4: at most one claimant will hold; the other is standing down.)
  Scenario: during the transient two-claims window the render reports both claims and resolves no winner
    Given node "node-a" and node "node-b" each have a claim file for "item-x" reading state "claimed" (the pre-convergence race window)
    And both holders' presence is fresh under the injected now
    When I invoke mesh:status with that injected now
    Then the lease section lists "item-x" twice — once per claimant
    And the render crowns no winner (a third-party reader never arbitrates)
    And no error is raised

  # THE STABLE --json SHAPE + THE PURE READ, pinned together (the m23 idiom). The lease
  # section is ADDITIVE: the m23 nodes half is byte-unchanged in shape. And the render is a
  # READ — including over a LAPSED claim, the tempting edit: the render must never
  # "helpfully" flip a lapsed claim to released (the lapse is a rule, task 01; withdrawal is
  # the owner's alone). The partition root is byte-unchanged after the call.
  Scenario: mesh:status renders a stable --json shape with an additive leases key, and writes nothing
    Given node "node-b" has a claim file for "item-x" reading state "claimed", with fresh presence (live)
    And node "node-c" has a claim file for "item-y" reading state "claimed", while node-c's presence is stale (lapsed)
    And I record the partition root's on-disk state
    When I invoke mesh:status with an injected now
    Then the --json result is the stable { nodes: [...], leases: [ { itemRef, holder, live } ] } shape
    And the nodes half is the unchanged m23 { nodeId, presence?, stale } shape (the lease section is additive)
    And the lease for "item-x" carries holder "node-b" and live true
    And the lease for "item-y" carries holder "node-c" and live false (rendered lapsed)
    And node "node-c"'s lapsed claim file is byte-unchanged — still state "claimed" (the render never flips a lapsed claim)
    And the partition root's on-disk state is byte-unchanged (status is a pure read)

  # ABSENCE AND TORN FILES ARE BENIGN (the mesh-store read discipline the claim read
  # inherits): no leases dir at all, an empty one, and a torn claim file beside a healthy
  # one all render cleanly — an empty section is an EMPTY SECTION, never an error, and a
  # torn file is skipped rather than blinding the healthy leases.
  Scenario Outline: zero leases renders an empty section, and a torn claim file is skipped — never an error
    Given the lease tree is <lease-tree>
    When I invoke mesh:status with an injected now
    Then the --json result's leases key carries <leases>
    And no error is raised

    Examples:
      | lease-tree                                                                       | leases                                                |
      | absent (no leases directory at all)                                              | an empty leases list                                  |
      | an empty leases directory                                                        | an empty leases list                                  |
      | one torn/unparseable claim file beside node "node-b"'s healthy claim on "item-x" | exactly the one healthy lease (the torn file skipped) |

  # THE UNCONFIGURED FLOOR: with no config.mesh.nodeId the render is byte-identical to
  # today's — the m23 { nodes: [...] } shape with NO leases key at all (absent, not empty —
  # the distinction from the configured-but-zero-leases case above), even with claim files
  # sitting on disk. The lease section is an overlay an unconfigured install never pays for.
  Scenario: with mesh unconfigured the status render is byte-identical to today — no lease section appears
    Given claim files exist on disk under the lease tree
    And config.mesh.nodeId is absent (mesh unconfigured)
    When I invoke mesh:status with an injected now
    Then the human render and the --json shape are byte-identical to today's (the m23 { nodes: [...] } shape — no leases key)
    And no error is raised
