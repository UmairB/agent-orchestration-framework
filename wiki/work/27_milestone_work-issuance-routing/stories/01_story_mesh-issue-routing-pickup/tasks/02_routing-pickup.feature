@cli @work @distribution @executable
Feature: mesh-aware next routes on the directive — a targeted-elsewhere item is skipped, a targeted-here/untargeted item is offered, and the m26 lease then arbitrates the claim
  In order to route issued work to an eligible node and pick it up over next without ever manufacturing a double-grant (KR3 with KR2 held)
  next composes the routing filter into the SAME m26-injected candidacy view (routing narrows, the lease arbitrates): a directive TARGETED-ELSEWHERE (a node/capability this node does not satisfy) is skipped exactly as a leased-live item is skipped; a TARGETED-HERE or UNTARGETED directive is offered in its normal walk position and then the m26 lease decides who runs; and with no config.mesh.nodeId the walk is BYTE-IDENTICAL to today (routing invisible),
  so that routing can only NARROW candidacy (skip), never widen it — two eligible nodes both offered a targeted-here item still contend the lease and exactly ONE runs, and a single-node install is untaxed and unchanged.

  # ARCHITECTURE ADR-004 (the mesh-aware next — routing UNIFIED with the m26 lease into ONE
  # injected candidacy view; work.mjs stays mesh-free) + ADR-003 (the pure matcher
  # nodeSatisfiesTarget) + ADR-001 (the directive HINT):
  #   1. commands/next.mjs composes ONE candidacyView keyed by item ref, carrying BOTH the lease
  #      state (leased-live|leased-stale, m26 unchanged) AND a routing verdict
  #      (targeted-elsewhere|offer). The routing filter runs FIRST — skip a targeted-elsewhere
  #      item before consulting its lease; an offered item then obeys the lease rule.
  #   2. the routing verdict per candidate, against THIS node's descriptor (read once, as data):
  #      TARGETED-ELSEWHERE (a node/capability target this node does NOT satisfy) ⇒ SKIP;
  #      TARGETED-HERE (satisfies) or UNTARGETED (any, or no directive) ⇒ OFFER, then the m26
  #      lease arbitrates. A directive can only make next offer to FEWER nodes, never MORE —
  #      the m26/ADR-007 fail-safe direction preserved (no verdict manufactures a double-offer).
  #   3. work.mjs imports NO mesh module (fitness #4, extending m26/#7): the unified view is
  #      plain data built OUTSIDE it, under the config.mesh.nodeId gate.
  #
  # SEAM SPLIT — what is an arch-test vs what is this behaviour feature:
  #  - fitness #4 (acd-next-candidacy-injected): work.mjs imports NO mesh module; nextWork's
  #    candidacy view is the OPTIONAL argument defaulting absent (byte-identical without it);
  #    commands/next.mjs builds the UNIFIED view (lease + routing filter) ONLY under the config
  #    gate — import/signature/source assertions, NOT scenarios here.
  #  - fitness #3 (acd-targeting-matcher-descriptor-pure, story 00): the matcher reads only the
  #    frozen descriptor fields + imports no node-identity mechanic — a SOURCE assertion.
  #  - THIS feature asserts the OBSERVABLE walk outcomes: which item is offered/skipped for a
  #    node/capability/any directive, that two eligible nodes still resolve to exactly one runner
  #    via the lease, and that the unconfigured render is byte-identical.
  #
  # QA FEASIBILITY FLAG (developer-amigo): the view-driven rows stay @executable ONLY if — as
  # for the m26 lease view — the UNIFIED candidacy view crosses the seam as PLAIN DATA (per item
  # ref: a routing verdict targeted-elsewhere|offer FOLDED with the m26 lease state, keyed by
  # ref) so the core walk can be driven with a hand-built view, AND the command-level rows can
  # drive the SAME outcomes from disk fixtures (directive tree + this node's descriptor + lease/
  # presence, injected now) through the config gate. If the routing verdict can only be computed
  # INSIDE the command, the core-walk rows fall back to command-level drives — keep them
  # @executable either way; do not silently retag. Two open questions for the developer wave:
  #   (i) does the unified view fold routing + lease into ONE Map value (verdict + lease state)
  #       cleanly, or does the story-loop code need two lookups? The ADR wants one view;
  #  (ii) can the two-eligible-nodes row be driven with two in-process clones over a shared bare
  #       remote (the m26 buildFixture/clonePeer idiom) so the lease arbitration is REAL git, not
  #       a mocked winner? The m26 lease tests proved two contenders in one process — this row
  #       needs the same lever plus the routing view on both.
  # RAISED — do NOT silently retag to @manual; the routing walk (not the wall-clock) must stay
  # unit-testable. See VERIFICATION.
  #
  # RESOLVED (developer-amigo): both open questions CONFIRMED — @executable stands unchanged.
  #  (i) ONE Map value, cleanly. `buildLeaseView` (`src/mesh-lease.mjs:401-428`) already returns
  #      `Map<ref, { state, holder }>`; the routing verdict is an ADDITIVE key on the SAME entry
  #      shape — `Map<ref, { state?, holder?, routed? }>` where `routed ∈ { "elsewhere", "offer" }`
  #      (absent ⇒ "offer", matching the "no directive at all" ADR-004.2 case). `commands/next.mjs`
  #      composes it in ONE pass: build the routing verdict per candidate FIRST (over
  #      `readIssuanceDirectives` + `nodeSatisfiesTarget` against this node's own descriptor,
  #      `readNodeRecord(ws, ownNodeId)`), THEN fold the lease view's existing entries in (or build
  #      both into one Map from the start — either order is fine since the two write disjoint keys
  #      per ref before `work.mjs` ever reads them). `work.mjs`'s ready-return call sites need
  #      EXACTLY ONE extra `.get(ref)` — no second lookup, no second parameter on `nextWork`
  #      (confirmed against the CURRENT single-optional-arg signature at `src/work.mjs:535`, which
  #      this story does not widen). The story-loop code reads ONE map entry's `.state` (existing)
  #      and a routing filter reads the SAME entry's `.routed` (new) — no two-lookup fight; the
  #      precedence (routing skip BEFORE lease check) is encoded by `commands/next.mjs` never
  #      offering a `routed:"elsewhere"` ref's lease state to `work.mjs` at all (it need not even be
  #      in the map, or is present with a value `work.mjs`'s guard treats as unconditional-skip —
  #      the exact per-return guard shape is confirmed in task 03's resolution, which this task
  #      depends on symmetrically).
  #  (ii) TWO IN-PROCESS CLONES OVER A BARE REMOTE — YES, proven reusable verbatim.
  #      `test/mesh-lease-claim-arbitration.test.mjs:65-101` (`buildFixture`/`clonePeer`) already
  #      drives TWO CONTENDERS racing ONE item's lease over a real bare remote, sequentially
  #      in-process, with `runSync = () => syncMesh(workspace)` (`:161`) — the identical git
  #      machinery this row needs. This task's two-eligible-nodes row is the SAME fixture with an
  #      ADDITIONAL planted directive (`{kind:"capability", value:"claude"}`) and each side's
  #      candidacy view built from ITS OWN workspace's `readIssuanceDirectives` +
  #      `nodeSatisfiesTarget` before each calls `acquireLease`. No mocked winner — arbitration is
  #      the real `acquireLease` protocol (`src/mesh-lease.mjs:297-377`) racing over the real bare
  #      remote exactly as the m26 test proves; routing only decides which candidates ENTER the
  #      race (both do, here — the row's whole point), never who wins it.
  # Precedence confirmed structurally: ADR-004.1's "routing runs FIRST" is honoured because the
  # command-layer view build can OMIT a lease lookup entirely for a `targeted-elsewhere` ref (it
  # never calls `readLeaseClaims`-derived state for a ref it has already decided to skip) — but
  # since `readLeaseClaims`/`buildLeaseView` read the WHOLE fleet in one pass (not per-ref), the
  # cheaper equivalent is: compute both, then let the SKIP verdict simply override the lease state
  # NEVER let a live/stale lease state override a skip. `work.mjs`'s single `.get(ref)` guard
  # reads `routed:"elsewhere"` FIRST, unconditionally, before ever branching on `.state` — the
  # "targeted-elsewhere short-circuits before its lease is even consulted" scenario is thus a
  # PURE consequence of the guard's read order, not a second pass.
  Background:
    Given an initialised aof project whose work stream is a fixture I control
    And directive and descriptor fixtures I write directly, read under an injected now
    And unless a scenario says otherwise the work tree holds one milestone whose not-done stories walk "27/00" then "27/01"
    And this node's descriptor advertises runtimes ["claude"] and skills ["typescript"]

  # THE SINGLE-NODE FLOOR (ADR-004.4; SPEC §Scope "single-node installs keep working UNCHANGED"):
  # with NO config.mesh.nodeId the command builds NO candidacy view — directive files on disk are
  # INVISIBLE to next, and the human render and --json are byte-identical to today's for that
  # tree. This is the sharp assertion of the floor at the COMMAND face: the same directive bytes
  # that skip an item under a configured mesh do nothing at all under an unconfigured one.
  Scenario: with mesh unconfigured the command builds no view — directive files on disk are invisible and the render is byte-identical to today
    Given a directive targets "27/00" at a node that is NOT this node
    And config.mesh.nodeId is absent (mesh unconfigured)
    When the next command is invoked
    Then the offered item is "27/00" (the directive was never read)
    And the human render and the --json result are byte-identical to today's for that tree

  # A NODE-TARGETED DIRECTIVE — OFFERED ONLY ON THE TARGET, SKIPPED ELSEWHERE (ADR-004.2 / ADR-003.2):
  # a { kind:"node" } directive is offered ONLY on the node whose id matches; a non-target node
  # SKIPS it exactly as a leased-live item is skipped (it is another node's work), and offers the
  # following candidate.
  Scenario Outline: a node-targeted directive is offered only on the target node and skipped elsewhere
    Given a directive targets "27/00" at node "build-server"
    And this node's config.mesh.nodeId is "<this-node>"
    When the next command is invoked
    Then the offered item is "<offered>"

    Examples:
      | this-node    | offered | note                                        |
      | build-server | 27/00   | targeted-here — offered (then the lease)    |
      | node-a       | 27/01   | targeted-elsewhere — 27/00 skipped          |

  # A CAPABILITY-TARGETED DIRECTIVE — OFFERED WHERE THE DESCRIPTOR ADVERTISES IT (ADR-004.2 /
  # ADR-003.3): a { kind:"capability" } directive is offered on a node whose descriptor advertises
  # that runtime OR skill (runtimes[] ∪ skills[] membership) and SKIPPED on a node that does not.
  # This node advertises runtimes ["claude"] and skills ["typescript"].
  Scenario Outline: a capability-targeted directive is offered where the descriptor advertises the runtime or skill and skipped otherwise
    Given a directive targets "27/00" at capability "<capability>"
    And this node's config.mesh.nodeId is "node-a"
    When the next command is invoked
    Then the offered item is "<offered>"

    Examples:
      | capability | offered | note                                      |
      | claude     | 27/00   | runtime match — targeted-here             |
      | typescript | 27/00   | skill match — targeted-here               |
      | codex      | 27/01   | not advertised — targeted-elsewhere, skip |
      | rust       | 27/01   | not advertised — targeted-elsewhere, skip |

  # AN "ANY" DIRECTIVE (OR NO DIRECTIVE) — OFFERED FLEET-WIDE (ADR-004.2 / ADR-003.1): a
  # { kind:"any" } directive (or no directive at all) is offered in its normal walk position on
  # every node — nodeSatisfiesTarget is true for any. The untargeted case is the byte-identical
  # baseline the routing filter overlays.
  Scenario Outline: an any-targeted directive (or no directive) is offered in its normal walk position on any node
    Given "27/00" is "<directive>"
    And this node's config.mesh.nodeId is "node-a"
    When the next command is invoked
    Then the offered item is "27/00"

    Examples:
      | directive                 |
      | targeted at { kind:"any" }|
      | not targeted at all       |

  # ROUTING NARROWS, THE LEASE ARBITRATES — TWO ELIGIBLE NODES, EXACTLY ONE RUNS (ADR-004.2; KR2
  # held): a targeted-here item is OFFERED on every eligible node — routing decided candidacy, it
  # did NOT grant. Two nodes both offered the same targeted-here item contend the m26 lease over a
  # shared bare remote and exactly ONE holds and runs; the other stands down (the m26 KR2
  # mechanism, unchanged). The routing view can only NARROW candidacy, never manufacture a
  # double-grant.
  Scenario: two eligible nodes are both offered a targeted-here item and the m26 lease resolves exactly one runner
    Given a directive targets "27/00" at capability "claude"
    And two nodes "node-a" and "node-b" whose descriptors both advertise runtime "claude", each a clone of a shared bare remote
    When both nodes seek work through next and then contend the item through the m26 lease
    Then both nodes were OFFERED "27/00" by their routing view (candidacy, not a grant)
    And exactly one node holds the m26 lease and runs the item
    And the other node stands down with no run minted (the lease arbitrated — routing only narrowed)

  # A TARGETED-HERE ITEM THAT IS LEASED-LIVE ELSEWHERE — ROUTING OFFERS, THE LEASE SKIPS (ADR-004.2,
  # the precedence lock): the routing filter runs FIRST but only ever SKIPS a targeted-elsewhere
  # item; a targeted-HERE item that is currently leased-live by a peer is offered by routing then
  # SKIPPED by the lease view (the m26 rule unchanged — next is a read; the claim path reclaims).
  # The two overlays compose without fighting: routing narrows, the lease then applies.
  Scenario: a targeted-here item leased-live by a peer is offered by routing then skipped by the lease view
    Given a directive targets "27/00" at capability "claude" (this node advertises "claude" — targeted-here)
    And "27/00" is leased-live on disk by peer "node-b"
    And "27/01" is unleased and untargeted
    And this node's config.mesh.nodeId is "node-a"
    When the next command is invoked
    Then the offered item is "27/01" ("27/00" was targeted-here but skipped by the live lease)
    And the routing filter did not skip "27/00" (routing offered it — the lease skipped it)

  # A TARGETED-ELSEWHERE ITEM SHORT-CIRCUITS BEFORE THE LEASE (ADR-004.1, the FIRST-filter order):
  # a targeted-elsewhere item is skipped by routing BEFORE its lease is even consulted — so a
  # stale-elsewhere lease on a targeted-elsewhere item does NOT surface reclaimable here (it is
  # not this node's work at all). Routing precedes the lease; a non-candidate item is never a
  # reclaim candidate.
  Scenario: a targeted-elsewhere item is skipped by routing before its lease is consulted — never surfaced reclaimable here
    Given a directive targets "27/00" at node "build-server" (NOT this node)
    And "27/00" is leased-stale on disk by peer "node-b"
    And this node's config.mesh.nodeId is "node-a"
    When the next command is invoked
    Then "27/00" is NOT offered and NOT surfaced reclaimable here (it is targeted elsewhere — not this node's work)
    And the offered item is "27/01"
