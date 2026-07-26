@cli @work @distribution @executable @bug @finding-F-3204
Feature: mergePresence reconciles git-disk presence against the FABRIC peer-map liveness (replacing the retired relay cache); Online is the fast pre-filter, a connect-refused is a HANDLED "unreachable" distinct from "offline", and the git record assembly is byte-unchanged
  In order to make peer liveness ride the fabric the VPN already maintains instead of a second aof-run relay bus (ADR-002.1, closing F-3204)
  mesh-presence.mjs's mergePresence reconciles the ≤durable git-disk presence record against the fabric peer-map liveness that resolvePeers supplies (the relay cache the ≤5s fast-path used is retired), a peer's Online is the fast liveness pre-filter, a connect-refused / shields-up / ACL-deny is surfaced as a HANDLED "unreachable (check shields-up/ACL)" outcome DISTINCT from "offline", and the git presence-record assembly/read (assemblePresenceRecord / publishPresenceRecord / readPresenceRecord) is BYTE-UNCHANGED (the durable floor),
  so that "is peer X up" is read from tailscale status --json's Online rather than a relay push, Online-≠-dialable is a first-class handled state rather than a crash (ADR-002.3, RESEARCH §5), and an unconfigured mesh renders byte-identical to today (no fabric read attempted).

  # ARCHITECTURE ADR-002.1 (eliminate the relay as the liveness path; the fabric peer-map is the
  # fast liveness read) + ADR-002.3 (Online ≠ dialable; the connect attempt is ground truth) +
  # ADR-002.4 (git stays the durable authority, UNCHANGED) + RESEARCH §2/§5:
  #   1. mergePresence's FAST SOURCE cuts over from the relay cache (mesh-presence-cache.mjs's
  #      createPresenceCache, retired in task 02) to the fabric peer-map liveness. The signature
  #      the render reconciles is now (diskPresence, fabricLiveness) — disk is the git-durable
  #      record, the second source is the peer's { online } from resolvePeers. The RECONCILE
  #      POSTURE is preserved: git is the authority (a tie / equal signal reconciles to the
  #      durable disk bytes — the cache never became a second system of record, and neither does
  #      the fabric read).
  #   2. Online (Peer[x].Online, RESEARCH §2) is the fast liveness PRE-FILTER the relay cache
  #      used to supply — necessary-but-not-sufficient for dialable (RESEARCH §5).
  #   3. A connect attempt against a peer address is GROUND TRUTH (ADR-002.3): a connect-refused
  #      (shields-up / ACL-deny / a peer that dropped between snapshot and dial, RESEARCH §5) is a
  #      HANDLED, DISTINCT outcome — "unreachable (check shields-up/ACL)" — NOT "offline" and NOT
  #      a crash. Online:true + connect-refused ⇒ unreachable; Online:false ⇒ offline.
  #   4. The git presence RECORD ASSEMBLY/READ is BYTE-UNCHANGED (ADR-002.4): assemblePresenceRecord's
  #      frozen four-key { nodeId, heartbeatAt, activeRuns, aofVersion } order, publishPresenceRecord's
  #      atomic writeText, readPresenceRecord/readPresenceRecords — all untouched. Only the
  #      fast-SOURCE import changes (cache → fabric).
  #   5. UNCONFIGURED MESH ⇒ byte-identical to today: no config.mesh ⇒ no fabric read attempted,
  #      the render is the git-only floor exactly as before.
  #
  # SEAM SPLIT: the arch-test acd-fabric-single-seam (task 02's structural unit) asserts the peer
  #  dial-address resolution lives only in mesh-fabric.mjs — resolvePeers is the ONLY source of the
  #  fabric liveness this feature reconciles; THIS feature asserts the OBSERVABLE reconcile outcomes
  #  (which source wins, the unreachable-vs-offline distinction, the byte-unchanged git assembly).
  #
  # QA FEASIBILITY FLAG (developer-amigo): rows stay @executable ONLY if:
  #  (a) mergePresence stays a PURE projection over its two inputs (it is today — no fs, no clock;
  #      mesh-presence.mjs:152) so the cutover reconcile is exercised by passing a disk record + a
  #      fabric-liveness value directly, NO tailnet — the SAME shape the retired cache test used;
  #  (b) the connect-probe that turns Online-into-dialable is an INJECTED dialer closure (the
  #      mesh-relay-client { connect } injection precedent) so the connect-refused row is reachable
  #      with NO real socket — a scripted dialer that throws ECONNREFUSED drives the unreachable
  #      branch, a dialer that resolves drives the reachable branch;
  #  (c) resolvePeers itself is exercised over the task-00 injected fabric exec (already flagged
  #      there) — this feature consumes its { online } output as a fixture value.
  # RAISED — the connect-probe/dialer MUST be injectable (mirroring ctx.relayClient) for the
  # Online-≠-dialable rows to stay @executable; the developer confirms the reachability probe takes
  # an injected dial closure. See VERIFICATION.
  #
  # RESOLVED (developer-amigo): all three sub-flags CONFIRMED — @executable stands unchanged.
  #  (a) mergePresence STAYS a PURE projection across the cutover — CONFIRMED against the actual
  #      signature. `src/mesh-presence.mjs:152`:
  #        `export function mergePresence(diskPresence, cachedPresence) { … }`
  #      — no fs import, no clock read, no config read anywhere in its body (`:152-163`); it is
  #      a two-argument value-in/value-out function today (reconciling disk vs the RETIRING
  #      relay cache) and the cutover is a CALLER-SIDE re-source of the SECOND argument, not a
  #      signature or purity change: the caller (`src/commands/mesh-identity.mjs:241`,
  #      `mergePresence(diskPresence, cache ? cache.get(id) : null)`) already treats the second
  #      argument as an OPAQUE injected value read off `ctx.presenceCache` (`:214`,
  #      `const cache = ctx?.presenceCache ?? null;` — the doc comment at `:207-213` calls this
  #      "exactly as ctx.relayClient is injected"). Task 01 re-points that ONE call site's second
  #      argument from `cache.get(id)` (the relay-cache lookup) to the fabric peer-map liveness
  #      value `resolvePeers(...)`'s matching `{ online }` entry — `mergePresence` itself needs
  #      ZERO code change, its test suite drives it exactly as today (two plain records in, one
  #      record out), and the "disk/fabric" Scenario Outline here is reachable with NO tailnet,
  #      NO fs — literally two JS object literals passed to the existing exported function.
  #  (b) THE CONNECT-PROBE IS AN INJECTED DIAL CLOSURE — YES, feasible, composing the SAME
  #      precedent class task 00 resolved. `src/mesh-relay-client.mjs`'s `createRelayClient`
  #      (`:121-214`) returns `{ connect(), push(), close() }` where `connect()` is exactly a
  #      Promise-returning dial the caller awaits and whose rejection (`reject(error)` at
  #      `:165`/`:180`) the caller's try/catch handles — this is the load-bearing shape a
  #      reachability-dialer closure copies verbatim: `{ dial(dialAddress) }` (or a bare
  #      `(address) => Promise<void>` closure) INJECTED via a ctx/options key (e.g.
  #      `ctx.reachabilityDialer`, mirroring `ctx.relayClient` at `run-start.mjs:210`), defaulting
  #      to a real `net.connect`/socket probe in production — exercised live ONLY by task 05's
  #      @manual soak. A scripted dialer that rejects with an Error shaped `ECONNREFUSED` (Node's
  #      real socket-refused code — no invention needed, `net`'s own error code) drives the
  #      "unreachable" branch; one that resolves drives "reachable"; "offline" is not-attempted
  #      (no dial call reached at all, gated on `online: false`) — all three rows in the
  #      Scenario Outline are reachable over the injected closure with NO real socket.
  #  (c) resolvePeers CONSUMED AS A FIXTURE VALUE — YES, already covered: task 00's RESOLVED
  #      block confirms resolvePeers is exercised over the injected fabric exec closure; THIS
  #      feature's Background ("resolvePeers reports peer X with online <online>") consumes its
  #      `{ online }` output as a plain fixture value, never re-deriving the fabric read.
  #
  # RESEARCH-GAP FLAG: RESEARCH §5 states shields-up / ACL-deny are SILENT in tailscale status
  #  --json (no dedicated field) — so "unreachable" can ONLY be discovered by a failed dial, never
  #  pre-read. This feature asserts the failed-dial path is HANDLED; WHICH cause (shields-up vs ACL
  #  vs mid-snapshot drop) is indistinguishable at the socket layer (RESEARCH §5) and is NOT
  #  asserted as separable — a gap the operator-guidance (task 04) message closes by naming both,
  #  and the live cause-distinction is task 05's @manual observation.
  #
  # RESEARCH-GAP RESOLVED (developer-amigo): ACCEPTABLE TO DEFER — no retag, no design note
  #  needed now. The behaviour under test here is that a connect-refused is HANDLED as one
  #  distinct "unreachable" outcome, never that its root cause is diagnosed — that distinction
  #  (shields-up vs ACL vs mid-snapshot drop) is genuinely unobservable at the socket layer on
  #  ANY fixture, real or injected (RESEARCH §5 is explicit: no dedicated field surfaces it), so
  #  no amount of additional fixturing closes it — it is not a testability gap, it is a fact
  #  about the fabric. Task 04's guidance message already names BOTH causes in one line
  #  ("if a dial is refused, check `--shields-up`/ACLs"), which is the correct scope for a
  #  design that cannot distinguish them; task 05 is where the real cause is ever observed.

  Background:
    Given an initialised aof project whose config I control
    And config.mesh.fabric is "tailscale"
    And a git-durable disk presence record for peer "umairs-mbp" with heartbeatAt "2026-07-04T10:00:00Z"
    And a reachability probe that is an injected dial closure whose outcome I control

  # THE FAST SOURCE CUTS OVER, THE RECONCILE POSTURE IS PRESERVED (ADR-002.1): mergePresence's
  # second source is the fabric peer-map liveness, not the relay cache — but git still wins a tie
  # and the render reconciles to the durable disk bytes. The fabric read only sharpens liveness;
  # it never becomes a second system of record.
  Scenario Outline: mergePresence reconciles the git-disk record against the fabric peer-map liveness, git authority preserved on a tie
    Given a disk presence record and a fabric-liveness value for the same peer
    When I merge them via mergePresence(diskPresence, fabricLiveness)
    Then the reconciled render's liveness source is <winner>

    Examples:
      | disk_present | fabric_online | fabric_is_strictly_newer | winner   |
      | yes          | yes           | yes                      | fabric   |
      | yes          | yes           | no (equal/older)         | disk     |
      | no           | yes           | n/a                      | fabric   |
      | yes          | no signal     | n/a                      | disk     |

  # ONLINE IS THE FAST PRE-FILTER (ADR-002.1 / RESEARCH §2): a peer's Online out of resolvePeers is
  # the liveness hint that the relay-push cache used to supply — a peer the fabric reports Online is
  # rendered live-candidate without waiting for a git sync.
  Scenario: an Online peer from the fabric peer-map is rendered a live candidate without a git sync
    Given resolvePeers reports peer "umairs-mbp" with online true
    When mesh:status reconciles presence against the fabric peer-map
    Then peer "umairs-mbp" is a live candidate sourced from the fabric Online pre-filter (no git sync required)

  # ONLINE ≠ DIALABLE — THE CONNECT ATTEMPT IS GROUND TRUTH (ADR-002.3 / RESEARCH §5): a peer the
  # fabric reports Online but whose dial is REFUSED (shields-up / ACL / mid-snapshot drop) is a
  # HANDLED "unreachable (check shields-up/ACL)" outcome — DISTINCT from an offline peer and NEVER
  # a crash. An Online peer whose dial succeeds is reachable; an offline peer is offline (no dial
  # asserted needed).
  Scenario Outline: an Online-but-refused dial is a handled "unreachable" outcome distinct from "offline"
    Given resolvePeers reports peer "umairs-mbp" with online <online>
    And the injected dial closure <dial_outcome>
    When the reachability of "umairs-mbp" is resolved
    Then the handled outcome is "<outcome>"
    And no error is thrown

    Examples:
      | online | dial_outcome                          | outcome                          |
      | true   | resolves (connect succeeds)           | reachable                        |
      | true   | rejects with ECONNREFUSED             | unreachable (check shields-up/ACL) |
      | false  | not attempted (peer is offline)       | offline                          |

  # THE GIT RECORD ASSEMBLY/READ IS BYTE-UNCHANGED (ADR-002.4): the durable floor is untouched —
  # assemblePresenceRecord still emits the frozen four keys in order, publishPresenceRecord still
  # writes atomically, and a read-back is byte-equivalent. The cutover changed the fast SOURCE, not
  # the durable record.
  Scenario: the git presence record assembly and read-back are byte-unchanged by the liveness cutover
    Given a node "node-a" with heartbeatAt "2026-07-04T10:05:00Z", activeRuns [], and an aofVersion
    When I assemble and publish its presence record, then read it back
    Then the record carries EXACTLY { nodeId, heartbeatAt, activeRuns, aofVersion } in that key order
    And the read-back is byte-equivalent to the written record (the durable floor unchanged)

  # UNCONFIGURED MESH ⇒ BYTE-IDENTICAL TO TODAY (ADR-002.4 / the no-fabric-read floor): with no
  # config.mesh the render never attempts a fabric read — it is the git-only presence exactly as
  # before the cutover, so an install that never opted into a fabric is unaffected.
  Scenario: an unconfigured mesh renders git-only presence with no fabric read attempted
    Given config has no `mesh` block
    When mesh:status renders presence
    Then no resolvePeers / tailscale exec is attempted
    And the render is the git-only presence floor, byte-identical to the pre-cutover behaviour
