@cli @work @distribution @executable
Feature: KR3 cross-node issuance — the MECHANISM over two clones of one shared bare remote (issue on A, pick up and run on eligible B, never offered on A), entirely over git
  In order to prove the milestone's headline pickup path end-to-end without a real fleet — the @executable half of KR3 (the ≥95% / 3-OS soak is the @manual task 06)
  two in-process clones of one shared bare remote drive the whole routing pickup: A issues an item targeted at B (a node target OR a capability B advertises), A syncs once (default roots), B pulls and its next OFFERS the item, B claims it via the m26 lease and mints a run, and A's next does NOT offer it (targeted elsewhere) — the directive rode git with no manual file shuffling,
  so that an outsider confirms the issue → propagate → eligible-pickup path works over git alone, deterministically in one process, leaving the wall-clock ≥95% / ≤2-interval / 3-OS claim to the @manual soak (task 06).

  # ARCHITECTURE ADR-005 (the directive propagates over the default [meshDir] sync — KR3 met with
  # ZERO new mover) + ADR-002.4 (mesh:issue pushes one default-root sync) + ADR-004 (the eligible
  # peer's next offers the targeted-here item, the m26 lease arbitrates the claim):
  #   - two clones of ONE shared bare remote (the m26 buildFixture/clonePeer idiom), driven
  #     SEQUENTIALLY in one process against the real git binary — issue on A targeted at B, A syncs
  #     (default roots), B pulls + next OFFERS it, B claims via the m26 lease and runs, A's next
  #     does NOT offer it (targeted elsewhere). NO manual file shuffling — the directive rode git.
  #   The run-record durability mover + the ghost-claim reconciliation stay bounded follow-ups (not
  #   this story — ADR-005.2/.3): B mints its OWN run under its OWN partition when it claims, so the
  #   pickup path needs the DIRECTIVE + B's descriptor + the target, never the issuer's run record.
  #
  # SEAM SPLIT — why the @executable/@manual split, and what covers the structural half:
  #  - The MECHANISM is @executable HERE (the two-clone routing pickup over a bare remote) plus the
  #    fitness #1/#3/#4/#5/#6 arch-tests — all green WITHOUT a real fleet.
  #  - The ≥95% / ≤2-interval / 3-OS SOAK is task 06 (@manual, ADR-005) — real concurrency on real
  #    hardware, a MEASURED observation, never a CI assert (a wall-clock coverage/latency soak in CI
  #    is flaky by construction — the m23/m26 measurement discipline).
  #
  # QA FEASIBILITY FLAG (developer-amigo): the mechanism stays @executable ONLY if two workspaces +
  # one bare remote drive the routing pickup IN ONE PROCESS the way the m26 lease tests drive two
  # contenders — clone A issues + syncs, clone B pulls + next + claims + runs, A re-nexts, all
  # SEQUENTIALLY in-process against the real git binary (syncMesh spawns git synchronously, so the
  # interleave is deterministic — no second OS process). Open question for the developer wave: the
  # m26 lease tests proved two CONTENDERS in one process, but this row ALSO threads a mesh:issue
  # write + a directive PROPAGATION (A's push → B's pull) + B's routing view built from the pulled
  # directive — confirm the pull side surfaces A's directive to B's candidacy view in the in-process
  # fixture (the directive is under .mesh/, so the default syncMesh roots carry it — no runs
  # pathspec needed, ADR-005.1). If the pulled directive does not reach B's candidacy view
  # in-process, the pickup rows need a harness lever — keep them @executable either way; do NOT
  # silently retag. RAISED — see VERIFICATION.
  #
  # RESOLVED (developer-amigo): CONFIRMED — the pulled directive reaches B's candidacy view with
  # NO harness lever; @executable stands unchanged. Verified two ways:
  #  - the git mechanics: mesh:issue's push is syncMesh(ws) with DEFAULT roots
  #    ([meshDir(ws)], ADR-002.4/ADR-005.1) — the directive lives at
  #    issuanceDirectivePath(ws, issuer, ref) = .mesh/issuance/<issuer>/<ref>.json
  #    (ARCHITECTURE.md ADR-001.1), strictly UNDER meshDir(ws). syncMesh's stage step is
  #    "git add -- <root>" per root (src/mesh-sync.mjs:167-169), so the directive is swept by the
  #    SAME meshDir root A already pushes today for node records/leases — no runsPathspec
  #    needed (that pathspec exists ONLY for the runs tree, mesh-sync.mjs:94-96, irrelevant here).
  #    B's "git pull --no-edit -q" (mesh-sync.mjs:216) is BRANCH-WIDE (the module's own comment,
  #    :132-134: "peers' commits arrive on disk regardless of path") — so ANY single-root
  #    syncMesh(ws) call on B's side (default roots, identical to A's) pulls A's commit,
  #    including the directive file, onto B's local tree.
  #  - the in-process proof this reuses VERBATIM: test/mesh-lease-claim-arbitration.test.mjs
  #    already drives exactly this shape for lease claims — buildFixture()/clonePeer()
  #    (:65-101) build ONE bare remote + TWO clones, realSync(workspace) = () =>
  #    syncMesh(workspace) (:161) is the injected runner, and node-a's claim reaches node-b's
  #    local tree after node-b's OWN syncMesh call (proven at :226- "of two claimants racing
  #    one item" — b's sync surfaces a's already-pushed claim). A directive under .mesh/issuance/
  #    is STRUCTURALLY the same class of record as a lease claim under .mesh/leases/ — both ride
  #    the identical meshDir root, the identical add-only per-issuer/per-contender partition
  #    (ADR-001.1 mirrors 26/ADR-003.1's partition-by-writer discipline exactly), and the identical
  #    syncMesh(ws) default-root call. No new sync argument, no new pathspec, no harness lever —
  #    this task's fixture is buildFixture()/clonePeer() reused with A writing a DIRECTIVE
  #    (fixture-written at issuanceDirectivePath, or via mesh:issue's own write once story 01's
  #    issueDirective lands) instead of a claim, then B's syncMesh(B.workspace) call, then B's
  #    candidacy-view build reads readIssuanceDirectives(B.workspace) off its now-pulled tree —
  #    the SAME "re-read disk after sync" idiom acquireLease already performs
  #    (src/mesh-lease.mjs:341-343, observeCompetitors after every runSync() return).
  Background:
    Given a shared bare git remote both nodes can push and pull
    And two aof installs ("node A", "node B") each cloned from that remote, each a mesh node with its own nodeId
    And node B's descriptor advertises runtime "codex" (the capability node A will target); node A does not
    And a pool of ready items issuable from node A
    And both installs drive only the registered aof work and mesh commands (no hand-edited files)

  # NODE-TARGETED ISSUE PICKED UP ON THE TARGET (ADR-002 + ADR-004 + ADR-005): A issues an item
  # targeted at B by NODE ID, A syncs (one default-root push), B pulls and its next OFFERS the item,
  # B claims it via the m26 lease and mints a run under B's partition — A's next does NOT offer it
  # (targeted elsewhere). The directive rode git; no file was hand-shuffled.
  Scenario: a node-targeted directive issued on A is offered and run on target B, and never offered on A
    Given node A issues a ready item targeted at node B by its nodeId, then syncs once (default roots)
    When node B pulls, seeks work through next, and claims the item through the m26 lease
    Then node B was OFFERED the item by its routing view (targeted-here)
    And node B holds the m26 lease and mints a run for the item under node B's partition
    And node A's next does NOT offer the item (it is targeted at node B — targeted elsewhere)
    And no file was hand-shuffled — the directive reached B over git alone

  # CAPABILITY-TARGETED ISSUE PICKED UP ON AN ADVERTISING NODE (ADR-003.3): A issues an item
  # targeted at a CAPABILITY B advertises (runtime "codex"), A syncs, B pulls and its next OFFERS it
  # (its descriptor advertises "codex"), B claims + runs; A (which does not advertise "codex") does
  # NOT offer it. Same end-to-end pickup, the capability arm.
  Scenario: a capability-targeted directive issued on A is offered and run on an advertising B
    Given node A issues a ready item targeted at capability "codex" (which node B advertises, node A does not), then syncs once
    When node B pulls, seeks work through next, and claims the item through the m26 lease
    Then node B was OFFERED the item (its descriptor advertises "codex" — targeted-here)
    And node B mints a run for the item under node B's partition
    And node A's next does NOT offer the item (node A does not advertise "codex" — targeted elsewhere)

  # THE ≤2-SYNC-INTERVAL MECHANISM (ADR-005.1): the directive is visible on B after ONE pull
  # following A's issue-push — issuer push + peer pull = the two-sync-interval budget. This row
  # proves the MECHANISM meets the budget deterministically in-process (A pushes, B's very next pull
  # surfaces it); the wall-clock ≤2-interval CLAIM on a live fleet is the @manual soak (task 06).
  Scenario: the directive is visible to B's routing view after a single pull following A's issue-push (the ≤2-interval mechanism)
    Given node A issues an item targeted at node B and pushes it in the issue call (default-root sync)
    When node B performs one mesh pull and rebuilds its candidacy view
    Then the issued directive is present in node B's candidacy view (issuer push + peer pull = two sync intervals)
    And node B's next offers the item on that first post-pull walk

  # THE WITHDRAW ROUND-TRIP OVER GIT (ADR-001.3 + ADR-004.2): A withdraws its directive, A syncs,
  # B pulls the withdrawn state and its next no longer offers the item (the withdrawal rode git like
  # any other .mesh/ write — the propagation is symmetric with the issue). No file was hand-deleted.
  Scenario: a withdrawal issued on A propagates over git and stops B offering the item
    Given node A has issued an item targeted at node B, B pulled it, and B's next offered it
    When node A withdraws its directive (own-path state flip) and syncs, and node B pulls again
    Then B's next no longer offers the item (the withdrawn directive is spent)
    And no directive file was deleted on either node (the withdrawal was a state flip that rode git)
