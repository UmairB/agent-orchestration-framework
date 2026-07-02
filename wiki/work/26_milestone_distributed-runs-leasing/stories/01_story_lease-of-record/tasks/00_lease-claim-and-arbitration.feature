@cli @work @distribution @executable
Feature: A node claims an item by writing its own claim file and wins or stands down purely by remote-history order over git
  In order to guarantee that of two contested claims exactly one node executes (KR2) with correctness resting on git alone — no relay, no invented clock
  a claimant writes its OWN per-contender claim file and syncs, and the shared remote's push serialization decides the winner: the later claimant's pull surfaces the earlier remote claim and it stands down by flipping its OWN file to "released", while a claimant that cannot establish it won stands down too (ambiguity fails closed),
  so that two losers is only a liveness hiccup, two winners never happens, no timestamp ever arbitrates, and the whole protocol is provable over plain local git fixtures.

  # ARCHITECTURE ADR-003 (story 01): the acquire protocol (ADR-003.3 a–e) over per-contender
  # claim files .mesh/leases/<item>/<node>.json (ADR-003.1 — the frozen six-key schema
  # { itemRef, nodeId, state, claimedAt, runId, aofVersion }); arbitration is REMOTE-HISTORY
  # ORDER observed through the sync engine's honest envelopes — the push-failed envelope IS
  # the race signal (ADR-003.3 d); ambiguity fails CLOSED (ADR-003.3 e); release/stand-down
  # is an own-path STATE WRITE, never a delete, never a foreign write (ADR-003.2). The sync
  # runner (runSync) is INJECTED — a closure over the engine — so scenarios drive real git
  # fixtures OR a scripted envelope sequence.
  #
  # SEAM SPLIT — what is an arch-test vs what is this behaviour feature:
  #  - fitness #6 (acd-lease-write-scope): every lease write joins the leaseClaimPath/meshDir
  #    seam via atomic writeText, own-path only, no unlink of a claim — a SOURCE assertion
  #    over src/mesh-lease.mjs, NOT a scenario here.
  #  - fitness #8 (acd-lease-arbitration-git-observed): the hold/stand-down resolver imports
  #    NO cache/subscriber/relay module — an import grep, NOT a scenario here.
  #  - THIS feature asserts the OBSERVABLE protocol outcomes those structures produce: who
  #    holds, who stood down, which claim bytes exist at which path on which clone, and what
  #    the result tells the caller to do (mint or mint nothing).
  #
  # QA FEASIBILITY FLAG (developer-amigo): the race rows stay @executable ONLY if
  #  (a) the acquire seam is WORKSPACE-scoped — two clones of one shared bare remote, each
  #      its own workspace fixture, driven SEQUENTIALLY in one test process (A completes
  #      before B starts; the deterministic interleave needs no real concurrency). Any
  #      global/singleton state (one cwd, one config) breaks the two-claimant rows; and
  #  (b) the injected sync runner accepts a SCRIPTED fake returning the engine's frozen
  #      envelopes ({ committed, pushed, pulled, noop } and { synced:false,
  #      reason:"push-failed"|"pull-failed", ... }) call-by-call, with the test placing the
  #      competitor's claim bytes on the local tree between calls to stand in for the pull —
  #      the push-rejected and ambiguity rows depend on this shape.
  # RAISED — do NOT silently retag to @manual or drop a row; see VERIFICATION.
  # RESOLVED (developer-amigo): BOTH conditions hold in the codebase — all rows stay @executable.
  #  (a) CONFIRMED workspace-scoped: every seam function takes the workspace as an argument and
  #      holds no module-level cwd/config state — meshDir(workspace) (src/mesh-store.mjs:46),
  #      presenceRecordPath/readPresenceRecord(s)/publishPresenceRecord(workspace, …)
  #      (src/mesh-presence.mjs:93–133), syncMesh(workspace, …) with repoRootFor walking from
  #      workspace.workDir (src/mesh-sync.mjs:54–68, 114). The two-clones-of-one-bare-remote,
  #      sequential-in-one-process fixture ALREADY EXISTS and passes (test/mesh-git-sync-
  #      transport.test.mjs buildFixture:70 + clonePeer:106 + the add-only race at 287–336).
  #  (b) LOCKED — the scripted runSync fake's contract: acquireLease takes runSync INJECTED
  #      (per-call, no shared state) and after EVERY runSync return it RE-READS the item's
  #      claims off the local tree; the fake returns ONE pre-scripted envelope per call, in
  #      order, drawn from the engine's frozen shapes — success { committed, pushed, pulled,
  #      noop } (src/mesh-sync.mjs:101–111, 197) or failure { synced:false, reason:
  #      "push-failed"|"pull-failed", … } (src/mesh-sync.mjs:169, 188) — and the TEST plants
  #      the competitor's claim bytes on the local tree between calls to stand in for the
  #      pull. Hold/stand-down is decided ONLY from (re-read claims × presence) + the
  #      envelope's synced/reason; retries are bounded by a frozen exported constant in
  #      mesh-lease.mjs (MAX_CLAIM_SYNC_ATTEMPTS) the ambiguity rows count against.
  Background:
    Given an initialised aof project whose work stream is a fixture I control
    And a shared bare git remote with one clone per contender node, each clone a workspace fixture of its own
    And every contender node has a fresh presence record under an injected now, so a competing claim reads LIVE (the liveness boundary itself is task 01's)
    And the claim path takes an injected sync runner I can point at real git or at a scripted envelope sequence

  # The unopposed floor (ADR-003.3 b–d happy path): write own claim, sync clean, the pull
  # surfaced no live competitor ⇒ HELD, and the claim file reached the shared remote. The
  # frozen six-key schema is pinned HERE (the one place the persisted claim bytes are the
  # subject): exactly { itemRef, nodeId, state, claimedAt, runId, aofVersion } — no TTL, no
  # expiry key (presence is the only clock, task 01) — runId null at claim (the run tie is
  # story 02's), claimedAt ISO-8601 UTC-Z (provenance ONLY, never the arbitration key).
  Scenario: an unopposed claim is held and its claim file reaches the remote with state "claimed"
    Given no other node has a claim on item "item-x"
    When node "node-a" claims "item-x" over a real git sync
    Then node "node-a"'s claim result is held
    And node "node-a"'s own claim file for "item-x" reads state "claimed"
    And that claim file has reached the shared remote (a fresh clone of the remote sees it)
    And the persisted claim record carries exactly the frozen keys itemRef, nodeId, state, claimedAt, runId and aofVersion — no TTL and no expiry key
    And the record's runId is null at claim time (the run tie is set later)
    And the record's claimedAt is an ISO-8601 UTC-Z instant

  # THE RACE — the KR2 mechanism, driven deterministically over real git fixtures: A writes
  # its claim and syncs FIRST (its push lands on the remote); B then writes its OWN claim and
  # B's sync pulls A's earlier claim before B's push can land. Remote-history order says A
  # won. Pin every observable edge of the stand-down: B's OWN file flips "released"; A's file
  # is byte-untouched by B (zero foreign write); exactly ONE "claimed" file exists on the
  # converged tree; B's result says held:false + heldBy=A and directs its caller to mint
  # nothing (ADR-003.3 d).
  Scenario: of two claimants racing one item exactly one holds — the later claimant stands down on observing the earlier remote claim
    Given node "node-a" has claimed "item-x" and its claim has reached the shared remote
    When node "node-b" claims "item-x" and its sync pulls node-a's earlier claim
    Then node "node-a"'s claim result is held
    And node "node-b"'s claim result is not held and names "node-a" as the holder
    And node "node-b"'s OWN claim file for "item-x" reads state "released" (the stand-down)
    And node "node-a"'s claim file is byte-untouched by node "node-b" (zero foreign write)
    And exactly one claim file for "item-x" reads state "claimed" across the converged tree
    And node "node-b"'s not-held result directs its caller to mint nothing

  # The push-rejected path (ADR-003.3 d): a rejected push means the remote moved mid-race —
  # the engine's honest "push-failed" envelope IS the signal. The claimant re-syncs (bounded)
  # and RE-OBSERVES: what the re-sync surfaced decides the outcome. Two rows close the
  # branch: a live competing claim that was on the remote before ours ⇒ the competitor won ⇒
  # stand down; the remote moved for an UNRELATED reason (e.g. a presence record landed) and
  # the clean re-sync surfaces no competitor ⇒ our claim reached the remote first ⇒ held.
  # Driven by the scripted envelope sequence (see the feasibility flag).
  Scenario Outline: a rejected push triggers a bounded re-sync and the re-observation decides hold or stand-down
    Given node "node-b" has written its own claim for "item-x"
    And the injected sync runner first reports "push-failed" because the remote moved mid-race
    And the re-sync then completes cleanly having surfaced <re-sync surfaced>
    When node "node-b"'s claim attempt runs to completion
    Then node "node-b"'s claim result is <result>
    And node "node-b"'s own claim file for "item-x" reads state "<own-file-state>"

    Examples:
      | re-sync surfaced                                            | result                                 | own-file-state |
      | a live competing claim for "item-x" that landed before ours | not held, naming the competing holder  | released       |
      | no competing claim (an unrelated record moved the remote)   | held                                   | claimed        |

  # AMBIGUITY FAILS CLOSED (ADR-003.3 e): a claimant that cannot establish it won — the sync
  # keeps failing, on either half — stands down, even though NO competitor is visible. Two
  # losers is a liveness hiccup (retry later); two winners is the KR2 violation. Bounded is
  # observable: the attempt completes after a bounded number of sync attempts (the scripted
  # runner counts its calls) — it never spins forever and never returns held on hope.
  Scenario Outline: a claimant whose sync keeps failing cannot establish it won and stands down — ambiguity fails closed
    Given node "node-b" has written its own claim for "item-x"
    And no competing claim is visible anywhere
    And the injected sync runner reports "<failure>" on every attempt
    When node "node-b"'s claim attempt runs to completion
    Then the claim attempt completed after a bounded number of sync attempts (never unbounded retry)
    And node "node-b"'s claim result is not held
    And node "node-b"'s own claim file for "item-x" reads state "released"
    And node "node-b"'s not-held result directs its caller to mint nothing

    Examples:
      | failure     |
      | push-failed |
      | pull-failed |

  # CLOCK SKEW MUST NOT ARBITRATE (ADR-003.3 e, alternatives: the rejected (claimedAt,
  # nodeId) tie-break): the winner is decided by REMOTE-HISTORY order, so a claim stamped
  # LATER (its node's clock runs ahead) that reached the remote FIRST still wins — and the
  # earlier-stamped loser still stands down. If an implementation ever compares claimedAt,
  # this row goes red.
  Scenario: a later-stamped claim that reached the remote first still wins — claimedAt never arbitrates
    Given node "node-a"'s clock runs ahead, so its claim for "item-x" carries a claimedAt LATER than node "node-b"'s stamp
    And node "node-a"'s claim reached the shared remote first
    When node "node-b" claims "item-x" and its sync pulls node-a's earlier-landed claim
    Then node "node-a"'s claim result is held
    And node "node-b"'s claim result is not held and names "node-a" as the holder
    And the earlier claimedAt stamp lost (remote-history order decided, not timestamp order)

  # Release is an own-path STATE WRITE — never a delete, never a foreign write (ADR-003.2;
  # the rejected delete-on-release alternative: a delete + a concurrent re-claim is a path
  # resurrection race, and history loses the stand-down trail). The released file remains at
  # its own path as the audit trail; nobody else's file moves.
  Scenario: release is an own-path state write, never a delete — the released file remains with its history
    Given node "node-a" holds the lease on "item-x"
    And node "node-b" holds a live claim on "item-y"
    When node "node-a" releases its claim on "item-x"
    Then node "node-a"'s claim file for "item-x" STILL EXISTS at its own path
    And it reads state "released"
    And no claim file was deleted anywhere under the lease tree
    And node "node-b"'s claim file for "item-y" is byte-untouched (release writes only the releaser's own path)

  # The git-cadence skip (ADR-003.3 a): a LIVE competing claim ALREADY on the local tree
  # means the race is over before it starts — the claimant does not claim at all: no own
  # claim file is minted, the result names the visible holder. This is the cheap fast-exit
  # the protocol takes when the ~15–30s sync cadence has already delivered the verdict.
  Scenario: a live competing claim already visible locally means no claim is even attempted — the git-cadence skip
    Given node "node-a"'s live claim for "item-x" is already on node "node-b"'s local tree
    When node "node-b" attempts to claim "item-x"
    Then node "node-b"'s claim result is not held and names "node-a" as the holder
    And node "node-b" wrote NO claim file of its own for "item-x" (it never entered the race)
    And node "node-b"'s not-held result directs its caller to mint nothing
