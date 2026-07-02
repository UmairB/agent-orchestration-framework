@cli @work @distribution @executable
Feature: the lease intent rides the relay's second wire kind and a peer hears it in milliseconds — the in-memory lease cache can only add a skip, never unlease, never hold, and never writes durably
  In order to collapse the contested-claim race window from the git cadence (~15–30s) to relay latency (~ms) without ever letting correctness depend on the relay (PRD A2)
  a claiming node broadcasts its intent as the frozen { kind:"lease", nodeId, signal } envelope, the persistent subscriber applies it into an in-memory lease cache (latest-signal-wins per itemRef), and a peer's next overlays that cache to SKIP an intent-claimed item before any git sync has run,
  so that peers defer within relay latency, the cache stays a fast-path projection (no durable write, skip-only influence), and a malformed or unknown frame is ignored — never a crash.

  # ARCHITECTURE ADR-004.1 (the SECOND wire kind — 23/ADR-001's "m26 leasing is the second kind"
  # cashed with ZERO relay change) + ADR-004.2 (the receive side — the 23/ADR-004 in-memory-cache
  # mirror, verbatim discipline) + ADR-005 (the `disk ?? cache` overlay in the command layer — the
  # cache can only ADD a skip, git wins every tie).
  #
  # SEAM SPLIT — what is an arch-test vs what is this behaviour feature:
  #  - fitness #10 (acd-relay-lease-blind) pins that src/mesh-relay.mjs contains NO lease reference
  #    (the broker stays kind-blind while carrying the second kind); fitness #11 (the cache-only
  #    gate extension) pins that the lease apply branch + cache import no persist seam; fitness #8
  #    pins that the hold resolver imports no cache/subscriber/relay module. ARCH-TESTS — never
  #    scenarios here.
  #  - THIS feature asserts the OBSERVABLE fast path: the frozen envelope on the wire, the applied
  #    intent deferring a peer's next BEFORE any git sync, latest-signal-wins per itemRef, zero
  #    durable bytes from any apply, bad frames ignored, and the skip-only direction of influence.
  # The ≤relay-latency figure itself is task 04's @manual measurement — here the MECHANISM is pinned.
  #
  # QA FEASIBILITY FLAG (developer-amigo): the defer rows stay @executable ONLY if
  #  (a) the persistent subscriber takes the INJECTED transport (the m23 lever,
  #      src/mesh-presence-subscriber.mjs — frames delivered synchronously, no real ws server), and
  #  (b) the SAME in-memory lease cache instance the subscriber applied into is REACHABLE by the
  #      work:next invocation under test (an injectable/shared cache seam at the command layer). If
  #      each next invocation builds a fresh empty cache, the before-any-git-sync defer row is not
  #      observable in-process.
  # RAISED — do NOT silently retag or drop the rows.
  # RESOLVED (developer-amigo): every row stays @executable — both seams are confirmed.
  #  (a) CONFIRMED — startPresenceSubscriber({ transport, cache }) already takes the injected
  #      transport (src/mesh-presence-subscriber.mjs:100); frames are delivered SYNCHRONOUSLY via
  #      the captured-handler fake (makeFakeTransport, test/mesh-relay-receive-apply.test.mjs:65–88)
  #      — no real ws server. The lease apply branch rides the SAME injected seam.
  #  (b) CONFIRMED + LOCKED via the ctx-injection seam. Nothing wires a long-lived cache today —
  #      the cache instance is ctx-INJECTED per invocation (mesh:status reads
  #      `ctx?.presenceCache ?? null`, src/commands/mesh-identity.mjs:182; the one-shot CLI face
  #      injects none, so it reads git only). Story 01 has ALREADY frozen the receiving slot:
  #      buildLeaseView(claims, presenceById, { nowMs, thresholdMs, hint }) with
  #      `hint = ctx.leaseCache` composed in commands/next.mjs under the config.mesh.nodeId gate
  #      (01/tasks/02 RESOLVED block). THE LOCKED SHAPE this story builds: a createLeaseCache()
  #      factory beside createPresenceCache (src/mesh-presence-cache.mjs:27 — same closure shape,
  #      keyed by itemRef, latest-signal-wins), the subscriber applying kind:"lease" frames into
  #      the instance HANDED to it, and work:next reading ctx.leaseCache into the hint slot. The
  #      test holds ONE instance: the subscriber applies into it, then
  #      invoke("work:next", …, { workspace, leaseCache }) overlays that same instance — the
  #      defer-before-any-git-sync row is observable in-process (the fixture has no remote and no
  #      sync is invoked, so zero git traffic by construction; the partition root is snapshot-
  #      compared for the no-durable-write rows).
  Background:
    Given an initialised aof project whose work stream is a fixture I control
    And mesh is configured with a stable mesh.nodeId for this node
    And the persistent relay subscriber takes an injected transport whose inbound frames I can deliver
    And the subscriber's in-memory lease cache is the one this node's work:next overlays

  # THE FROZEN WIRE SHAPE (ADR-004.1): the pushed lease intent is EXACTLY { kind, nodeId, signal } —
  # kind the frozen literal "lease", nodeId this node's id, signal the claim record VERBATIM as an
  # opaque blob (the wire never parses it; the broker forwards it byte-for-byte, zero relay change).
  Scenario: the pushed lease intent rides the frozen envelope with the claim record as the opaque signal
    Given the relay is up and this node is about to claim an item
    When this node claims the item and its lease intent is pushed
    Then exactly one envelope was pushed carrying kind "lease"
    And the envelope carries this node's nodeId
    And the envelope's opaque signal is this node's claim record for the item, byte-for-byte

  # THE ≤RELAY-LATENCY DEFER — the fast path's whole point: a peer's intent heard over the relay
  # skips the item in this node's next BEFORE any git sync has run (the race window collapses from
  # the git cadence to relay latency). Zero git traffic produced the skip.
  Scenario: a peer's lease intent heard over the relay defers this node's next before any git sync
    Given an item is ready and unleased on this node's disk
    And no git sync has run
    When the injected transport delivers a fanned-out { kind:"lease" } frame carrying a peer's claim intent for that item
    And I invoke work:next
    Then the intent-claimed item is not offered (it is skipped — deferred to the peer)
    And no git sync was performed to produce the skip (the defer arrived purely over the relay)
    And the next actionable item is offered instead

  # LATEST-SIGNAL-WINS, KEYED BY itemRef (ADR-004.2 — the presence cache's latest-wins discipline
  # applied to leases): one entry per item; a newer signal for the same item supersedes the older;
  # applying one item's intent never touches another item's entry.
  Scenario: a newer lease signal for the same item supersedes the older one — one entry per itemRef
    Given the injected transport delivered a peer's earlier lease intent for an item
    When the transport delivers a newer lease signal for the same item
    Then the in-memory lease view holds exactly one entry for that item, reflecting the newer signal (the latest signal wins)
    And the entries for every other item are untouched by the apply

  # THE CACHE-ONLY INVARIANT (23/ADR-004 verbatim; fitness #11 is the structural gate): applying
  # lease frames performs NO durable write — the partition root is byte-unchanged and the working
  # tree stays clean. The cache is a fast-path projection, never a second system of record.
  Scenario: applying lease frames writes nothing durable — the partition root is byte-unchanged
    Given a clean working tree under the partition root
    When the injected transport delivers several lease frames for different items and peers
    Then every file under the partition root is byte-unchanged after the applies
    And no new lease file appeared on disk (the intents live in memory only)
    And the working tree is still clean

  # NEVER-CRASH on a bad frame (the consumer discipline the subscriber already carries, extended to
  # the lease kind): malformed / kind-less / unknown-kind / oversized / shape-broken lease frames are
  # ignored — the subscriber stays connected and the lease view is not corrupted.
  Scenario Outline: a bad inbound frame is ignored — never a crash, never a corrupted lease view
    Given the subscriber is connected with a peer's valid lease intent already applied
    When the injected transport delivers "<bad frame>"
    Then the subscriber does not crash and the persistent connection is kept
    And the previously-applied lease intent is unchanged

    Examples:
      | bad frame                                    |
      | a malformed non-JSON frame                   |
      | a frame missing the kind field               |
      | a frame with an unknown kind                 |
      | an oversized frame over the byte limit       |
      | a lease frame whose signal is not an object  |
      | a lease frame whose signal has no itemRef    |

  # SKIP-ONLY INFLUENCE, half one (ADR-005's `disk ?? cache` overlay — git wins): a cache entry can
  # never UNLEASE a disk lease. A frame contradicting the durable claim changes nothing — the item
  # stays skipped on the disk evidence.
  Scenario: a cache entry can never unlease a disk lease — the durable claim always wins
    Given a peer's LIVE claim for an item is on this node's disk (git-synced)
    When the injected transport delivers a lease frame for the same item suggesting the claim is gone (a released-state signal)
    And I invoke work:next
    Then the item is still not offered (the disk lease wins — the cache can only add a skip, never remove one)

  # SKIP-ONLY INFLUENCE, half two (ADR-004.3 step 4): a cached intent can never make an item
  # HOLDABLE — it is not a lease of record. With no disk claim, the durable view stays unleased; the
  # cached intent's ONLY effect is the advisory defer. (The hold decision consuming git-read claims
  # only is task 00's rows behaviourally and fitness #8 structurally.)
  Scenario: a cached intent never becomes a lease of record — with no disk claim the durable view stays unleased
    Given the injected transport delivered a peer's lease intent for an item
    And no claim file for that item exists on disk
    When the item's durable lease state is read off disk
    Then the durable view reads unleased (the cached intent granted nothing durable)
    And the cached intent's only effect is the advisory skip in this node's next
