@cli @work @distribution @bug @finding-F1
Feature: A node-side persistent relay subscriber applies fanned-out presence signals so a peer's change surfaces in mesh:status ≤5s over the relay
  In order to deliver KR1's headline ≤5s-over-relay half (the sub-5s liveness git can't give — the milestone's load-bearing objective)
  a node holds a persistent connection to the control node's relay and, on each fanned-out { kind:"presence" } frame, applies the signal into the store mesh:status reads,
  so that a peer's pushed presence change surfaces in mesh:status ≤5s over the relay WITHOUT waiting for a ≤30s git sync — while git stays the durable authority and a relay loss degrades cleanly to the git floor.

  # F1 (VERIFICATION.md, blocker — user/PO decision at aof:verify 23): m23 built the PUSH half
  # (mesh:heartbeat's best-effort relay push), the BROKER (serveRelay fans a frame out to connected
  # peers), and the GIT-READ status render (mesh:status reads .mesh/presence off disk, ≤30s) — but no
  # node-side CONSUMER. createRelayClient is push-only (connect → push one frame → dispose; its only
  # on("message") handler resolves the join-ack then ignores everything), so a fanned-out signal reaches
  # nobody and mesh:status only ever changes after a git sync. This task closes the missing hop of the
  # observable's data-path: producer → transport → **consumer** → render.
  #
  # ARCHITECTURE ADR-003 (the push-for-liveness half, now with a receiver) + ADR-001 (the frozen
  # payload-agnostic envelope the subscriber consumes) + ADR-002 (git the durable authority). The
  # subscriber consumes the SAME frozen { kind, nodeId, signal } envelope story 01's broker fans out; it
  # reads kind==="presence" and applies the opaque signal (the presence record) into what mesh:status
  # renders. It is the mirror of the push seam: the push accelerates writes; this accelerates reads.
  #
  # THE DURABLE-AUTHORITY INVARIANT (do NOT make the relay a second system of record — ADR-001/ADR-002,
  # fitness #1): the applied relay signal is a LIVENESS CACHE (a fast-path projection), never the source
  # of truth. Git remains authoritative: a later git sync of the same node's record must reconcile to the
  # git-durable bytes, and the subscriber must never write a NEW durable record the git bus did not
  # already carry. The architect should confirm whether this warrants a new fitness function (the
  # "applied signal is not a durable authority" invariant) at aof:continue/refine time.
  #
  # SEAM SPLIT — @executable vs @manual: the RECEIVE-AND-APPLY MECHANISM (a delivered frame updates what
  # mesh:status reflects; a bad frame is ignored; relay-down degrades to git) is unit-provable in-process
  # with an INJECTED subscriber transport (mirroring task 00's injected relay client) — NO real ws server,
  # NO wall-clock. The ≤5s LATENCY BOUND stays @manual (a measured wall-clock observation on a real fleet,
  # the task-02 spike) — do NOT collapse it into a flaky CI assert.
  #
  # QA FEASIBILITY FLAG (developer-amigo): every @executable scenario stays @executable ONLY if the
  # subscriber takes an INJECTED transport { connect, onMessage } (or an injected frame source) so a
  # fanned-out frame can be delivered synchronously in CI, and the "store mesh:status reads" is the same
  # presence read surface (readPresenceRecord/the presence dimension) the git path writes — so an applied
  # signal and a git-synced record are observed through ONE render path. If the subscriber can only receive
  # over a real socket, the apply/ignore/degrade rows are not reliably @executable — RAISED, do NOT retag.
  Background:
    Given an initialised aof project whose work stream is a fixture I control
    And the mesh commands registered in the command core
    And this node has a stable mesh.nodeId and a relay configured (config.mesh.relay.url)
    And a node-side relay subscriber that takes an injected transport whose inbound frames I can deliver

  # The headline (F1 close-out): a fanned-out presence signal for a PEER is applied so mesh:status
  # reflects the peer's change — with NO git sync. This is the ≤5s-over-relay reflection the milestone
  # exists for; here the MECHANISM is asserted (the ≤5s LATENCY is task 02's @manual re-measurement).
  @executable
  Scenario: a delivered peer presence signal surfaces in mesh:status without a git sync
    Given the subscriber is connected to the relay and no git sync has run
    And a peer node has no presence yet in this node's view
    When the relay delivers a fanned-out { kind:"presence" } frame carrying the peer's presence record
    Then mesh:status lists the peer with its presence and activeRuns from the delivered signal
    And no git sync was performed to surface it (it arrived purely over the relay)

  # A newer heartbeat for a peer supersedes an older applied one (the liveness cache tracks the latest
  # signal, keyed by nodeId — the ADR-002 one-node-per-partition discipline, applied in memory).
  @executable
  Scenario: a newer delivered heartbeat supersedes an older one for the same peer
    Given the subscriber has applied an earlier presence signal for a peer
    When the relay delivers a newer { kind:"presence" } frame for the same peer (a changed activeRuns / later heartbeatAt)
    Then mesh:status reflects the newer heartbeat for that peer (the latest signal wins)
    And this node's own presence record is untouched by applying a peer's signal

  # Git stays the durable authority — the applied relay signal is a liveness cache, never a second system
  # of record (ADR-001/ADR-002, fitness #1). A subsequent git sync reconciles to the git-durable bytes.
  @executable
  Scenario: the applied relay signal is a liveness cache — git remains the source of truth
    Given the subscriber has applied a peer's presence signal over the relay
    When a git sync later pulls that peer's durable presence record
    Then the peer's presence in mesh:status reconciles to the git-durable record bytes
    And the subscriber wrote no new durable record the git bus did not already carry

  # Never-crash on a bad frame (the 03/ADR-003 discipline, consumer-side): a malformed / non-JSON /
  # oversized / unknown-kind inbound frame is ignored — the subscriber does not crash and the presence
  # view is not corrupted.
  @executable
  Scenario Outline: a bad inbound frame is ignored, never crashing the subscriber or corrupting the view
    Given the subscriber is connected with a valid peer presence already applied
    When the relay delivers "<bad frame>"
    Then the subscriber does not crash and the previously-applied peer presence is unchanged

    Examples:
      | bad frame                               |
      | a malformed non-JSON frame              |
      | a frame missing the kind field          |
      | an oversized frame over the limit       |
      | an unknown-kind (m26 leasing) frame     |

  # Correctness independent of the relay (the mirror of fitness #4, read-side): with the relay down or
  # unconfigured, the subscriber degrades cleanly and mesh:status still renders the ≤30s git-synced
  # records — no crash, no dependency on the relay for correctness.
  @executable
  Scenario: with the relay down the subscriber degrades cleanly to the git floor
    Given the relay is unreachable (or no relay is configured)
    When the subscriber attempts to connect and fails
    Then mesh:status still renders the git-synced presence records (the ≤30s floor)
    And the subscriber neither crashes nor blocks the heartbeat/status path

  # The subscriber is PERSISTENT (not one-shot): it holds the connection across multiple fanned-out
  # signals and applies each — the exact property createRelayClient (connect → push → dispose) lacked.
  @executable
  Scenario: the subscriber holds a persistent connection and applies successive signals
    Given the subscriber is connected to the relay
    When the relay delivers three successive { kind:"presence" } frames for different peers
    Then mesh:status reflects all three peers' presence
    And the connection was not torn down between frames (it is persistent, not one-shot)

  # THE ≤5s RE-MEASUREMENT (F1 close-out on a real fleet): task 02's ≤5s-over-relay half, now runnable
  # with the subscriber. On the 3-node fleet, a peer's change surfaces in the other nodes' mesh:status
  # ≤5s over the relay (no git sync). Agent-run; latency recorded in VERIFICATION.md.
  @manual
  Scenario: on the 3-node fleet a peer's change reflects in mesh:status ≤5s over the relay
    Given the 3-node fleet of task 02 with the relay up and all nodes subscribed
    When node B publishes a presence change
    Then node A and node C reflect node B's change in mesh:status in ≤5s over the relay (no git sync)
    And the measured ≤5s relay-reflection latency is recorded in VERIFICATION.md
