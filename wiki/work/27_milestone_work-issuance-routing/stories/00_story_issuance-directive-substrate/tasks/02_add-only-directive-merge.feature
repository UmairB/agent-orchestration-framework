@cli @work @distribution @executable
Feature: Two clones' issuance directives for one item merge add-only over a shared bare remote — distinct issuer paths, no conflict, no wedged state, both intact on both sides
  In order to prove the substrate property an outsider can check — two nodes can issue directives against one shared work stream over git alone, per-issuer partitioned so every merge is add-only
  two clones of one bare remote each write a directive under their OWN issuer partition and sync; the merge is add-only — distinct issuer paths, no content conflict, no MERGING state — and after convergence each clone reads one union carrying BOTH directives byte-for-byte,
  so that routing (story 01) and the fleet-UI affordance (story 02) stand on a directive bus that never wedges and never rewrites a peer's directive, and two issuers of the SAME item yield two files at distinct paths that both survive the merge (the partition invariant held STRICTLY).

  # ARCHITECTURE ADR-001 (story 00 — the outsider-verifiable acceptance): the per-ISSUER
  # partition issuance/<issuer>/<item-ref>.json (ADR-001.1) makes every cross-node directive
  # merge ADD-ONLY — disjoint files, never a three-way content merge — even when two issuers
  # issue the SAME item (they write DISTINCT paths <issuerA>/<ref>.json and <issuerB>/<ref>.json,
  # the 22/ADR-002 invariant held STRICTLY, ADR-001 rejected-alternative "one file per item,
  # first-writer-wins"). It rides the DEFAULT [meshDir] sync with ZERO engine change (ADR-001.5 /
  # ADR-005.1 / 26/ADR-002 — the directive lives under .mesh/, so syncMesh(workspace) with the
  # default root set [meshDir] already stages/commits/pushes it; NO runs pathspec, unlike the
  # m26 runs tree). The **/.mesh/** EOL pin already covers issuance/ (ADR-001.5 / 22/R3 — no
  # new .gitattributes rule owed). Real git, real bare remote, no mocks: the m22 transport-task
  # precedent (proven @executable in CI by test/mesh-git-sync-transport.test.mjs +
  # the two-clones-of-one-bare-remote add-only fixture m26 story-00's 02_add-only-run-merge rides).
  #
  # SEAM SPLIT — what is an arch-test vs what is this behaviour feature:
  #  - fitness #2 (acd-issuance-record-frozen): the six-key freeze + the **/.mesh/** EOL pin
  #    matching the real nested issuance sample path (git-semantics matching, NOT a literal
  #    grep) are STRUCTURAL → arch-test, never scenarios here.
  #  - fitness #3 (acd-targeting-matcher-descriptor-pure): the pure descriptor-reading matcher
  #    is a SOURCE/import assertion → arch-test, not exercised here (this feature is the git
  #    transport property, not the matcher).
  #  - THIS feature asserts what two REAL clones observe over one bare remote: the sync
  #    outcome (no push/pull-failed), repo state (no merge left in progress), the distinct
  #    per-issuer paths on disk, the on-disk bytes, and the union both sides read.
  #
  # FIXTURE NOTE — story 00 writes are FIXTURE-WRITTEN (the production issueDirective write is
  # story 01's, behind mesh:issue). Each clone places its directive file DIRECTLY at
  # issuanceDirectivePath(ws, ownIssuer, ref) via the test helper, then drives a real syncMesh
  # tick over the DEFAULT [meshDir] root set — exactly as m26 story-00's 02_add-only-run-merge
  # writes run records directly and syncs, and as this milestone rides the default sync with no
  # runs pathspec (ADR-005.1). The pre-convergence window is deliberate: clone B writes its
  # directive under its OWN issuer partition BEFORE any sync brings A's directive to B, so the
  # two writes land at distinct paths with no coordination — exactly the race the per-issuer
  # partition exists to make safe (add-only, never a content conflict).
  #
  # QA FEASIBILITY FLAG (developer-amigo): the byte-for-byte cross-clone equality assertions
  # interact with EOL translation on Windows checkouts. The proven m22 harness neutralised it
  # with a fixture-level `* -text` .gitattributes + per-clone core.autocrlf false / core.eol lf
  # (test/mesh-git-sync-transport.test.mjs), which is strictly STRONGER than eol=lf for
  # byte-stability; the REAL production pin is the existing **/.mesh/** eol=lf rule (asserted
  # SEPARATELY by fitness #2 against this repo's .gitattributes via git-semantics matching, so
  # the fixture neutralisation never stands in for or masks the production pin). Pick the m22
  # harness neutralisation for the fixture so the byte-for-byte assertions are stable on
  # Windows CI. RAISED — do NOT silently weaken the assertions to content-equality; see VERIFICATION.
  #
  # RESOLVED (developer-amigo): confirmed — the fixture uses the PROVEN m22 harness
  # neutralisation, byte-for-byte assertions unweakened. Per-clone `core.autocrlf false` +
  # `core.eol lf` (test/mesh-git-sync-transport.test.mjs configIdentity, lines 45-56) plus a
  # fixture-level `.gitattributes` of `* -text` (buildFixture, line 94) — the SAME two-part
  # neutralisation the m26 story-00 02_add-only-run-merge RESOLVED block locked
  # (wiki/work/26_milestone_distributed-runs-leasing/stories/00_story_node-dimensioned-run-records/
  # tasks/02_add-only-run-merge.feature, "RESOLVED (developer-amigo)" block). `* -text` disables
  # ALL EOL translation — strictly stronger than `eol=lf` — so byte-for-byte holds unweakened on
  # Windows CI. The REAL production pin (`**/.mesh/** text eol=lf`, .gitattributes:21) is asserted
  # SEPARATELY by fitness #2's git-semantics check against THIS repo's .gitattributes over the real
  # nested `wiki/work/<item>/.mesh/issuance/<node>/<ref>.json` sample path — so the fixture
  # neutralisation never stands in for, masks, or weakens the production pin being proven
  # elsewhere. Every git spawn in the fixture routes through test/support/cli-spawn.mjs
  # `spawnSyncHardened` (the m22/R3 Windows-flake mitigation, 6 attempts / linear 25·n ms
  # backoff, retries ONLY the never-ran case) — the same idiom the m26 story-00 fixture uses.
  #
  # QA FEASIBILITY FLAG (developer-amigo): this feature asserts the directive rides the DEFAULT
  # [meshDir] sync with NO runs pathspec (ADR-005.1 — the directive lives under .mesh/, unlike
  # the m26 runs tree which needed the runs glob). Confirm the fixture drives syncMesh(workspace)
  # with the default root set (no explicit roots argument, or roots omitted so it defaults to
  # [meshDir(workspace)], src/mesh-sync.mjs) — NOT the mesh-aware runs root set. If a scripted
  # sync stand-in is used instead of a real bare-remote push, mirror the m26 lease-of-record
  # RESOLVED contract (a scripted envelope sequence returning the engine's frozen shapes); but
  # the m26 story-00 02_add-only-run-merge precedent is a REAL bare-remote push/pull round trip,
  # and this feature should match it (real git, no scripted transport) to be the outsider-verifiable
  # proof. RAISED — do NOT silently retag to @manual; see VERIFICATION.
  #
  # RESOLVED (developer-amigo): confirmed — REAL bare-remote transport, DEFAULT root set, no
  # scripted stand-in. src/mesh-sync.mjs:148-149 `export async function syncMesh(workspace,
  # { roots } = {}) { const rootSet = roots ?? [meshDir(workspace)]; … }` — calling
  # `syncMesh(workspace)` with NO second argument (exactly what every scenario's "clone B/A runs
  # a sync tick over the default [meshDir] root set" step drives) resolves `rootSet` to
  # `[meshDir(workspace)]`, the identical default the every-existing-caller-unchanged m26/ADR-002
  # guarantee protects — no runs pathspec is ever passed. The fixture is the REAL git
  # bare-remote-plus-two-clones harness (test/mesh-git-sync-transport.test.mjs buildFixture/
  # clonePeer, mirrored by the m26 story-00 02_add-only-run-merge test), NOT a scripted envelope
  # sequence: the scripted-envelope stand-in the m26 lease-of-record RESOLVED contract used is
  # for the LEASE ARBITRATION feature's ambiguity/retry rows (mesh-lease.mjs's injected
  # `runSync` closure, a unit-level concern) — this feature proves the TRANSPORT property itself
  # (add-only merge, no wedged MERGING state, converged byte-for-byte union), which is exactly
  # what the m22 transport-task precedent and the m26 story-00 02_add-only-run-merge feature
  # already prove with a real bare remote, and this feature should — and does — match that shape
  # for the same outsider-verifiable reason. Zero scenarios retag to @manual.
  Background:
    Given a shared bare git remote and two aof installs "clone A" and "clone B", each cloned from that remote over the same work stream
    And one work item both clones can issue directives against
    And clone A has written a directive for the item under its OWN issuer partition issuance/node-a/ and synced it to the remote (committed and pushed) over the default [meshDir] root set
    And clone B has written a directive for the SAME item under its OWN issuer partition issuance/node-b/ BEFORE any sync brought A's directive to B

  # THE HEADLINE ADD-ONLY MERGE: B's tick commits its own directive, pulls A's (disjoint
  # issuer paths — add-only, clean), and pushes. No content conflict, and — the 26/ADR-003
  # load-bearing negative — no repo left mid-merge (the wedged MERGING state the engine cannot
  # recover is the exact failure the per-issuer partition makes impossible). Each directive
  # arrives byte-for-byte as its issuer wrote it: add-only means added, never content-merged
  # into a hybrid. The distinct-path assertion is the partition invariant made observable —
  # two issuers of ONE item never collide because they write different issuer subtrees.
  Scenario: clone B's sync merges the two issuers' directives add-only with no conflict and no MERGING state
    When clone B runs a sync tick over the default [meshDir] root set
    Then the tick succeeds (no pull-failed, no push-failed)
    And no merge is left in progress in clone B's repo (no wedged MERGING state)
    And clone B's tree holds A's directive at issuance/node-a/ and its own at issuance/node-b/ — two distinct issuer paths for the one item
    And A's directive in clone B's tree is byte-identical to what clone A wrote (never content-merged)
    And clone B's own directive is byte-identical to what clone B wrote
    And the shared remote's branch tip carries BOTH directives at their distinct issuer paths

  # THE SECOND-SYNC CONVERGENCE: A's next tick pulls B's directive — the round trip that makes
  # the union whole on BOTH sides. The unaffected side is pinned: receiving a peer's directive
  # never rewrites this clone's own (the m22 pull discipline, now over issuance directives).
  Scenario: clone A's second sync converges it on the union without touching its own directive
    Given clone B's directive has reached the shared remote
    And I record the on-disk bytes of clone A's own directive
    When clone A runs a sync tick over the default [meshDir] root set
    Then the tick succeeds
    And clone B's directive is present in clone A's tree at issuance/node-b/
    And the envelope's pulled names include clone B's directive path
    And clone A's own directive is byte-identical to before the tick (the pull did not touch it)

  # THE CONVERGED UNION — the acceptance an outsider can check: both clones read the SAME two
  # directives for the item via readIssuanceDirectives (task 00's union read, here over
  # directives that travelled through git), each directive still carrying its issuer, at its
  # own distinct issuer path — the two reads agreeing directive-for-directive, byte-for-byte
  # across machines. This is the KR3 substrate proof at the git layer: a directive issued on A
  # is reachable on B (the pickup itself is story 01's routing filter).
  Scenario: after convergence both clones read one identical union of both issuers' directives for the item
    Given both clones have synced to convergence (each tree carries both directives)
    When each clone reads the workspace's issuance directives
    Then each clone's read returns exactly two directives for the item
    And one carries issuer "node-a" and the other carries issuer "node-b"
    And each directive lives at its own distinct issuer path (issuance/node-a/ and issuance/node-b/ — the partition invariant held strictly)
    And the two clones' reads agree directive-for-directive, byte-for-byte

  # THE SAME-ITEM TWO-ISSUER INVARIANT — the ADR-001 rejected-alternative made concrete: the
  # one-file-per-item first-writer-wins design would wedge the bus on a content conflict here
  # (both issuers writing ONE contested path). Per-issuer partitioning makes it add-only: two
  # issuers issuing the SAME item produce two files at DISTINCT paths, both survive the merge.
  # This row isolates the partition property from the transport property above.
  Scenario: two issuers issuing the same item produce two directive files at distinct paths that both survive the merge
    Given clone A's directive for item "27/00" lives at issuance/node-a/ and clone B's directive for the SAME item "27/00" lives at issuance/node-b/
    When both clones sync to convergence over the default [meshDir] root set
    Then the converged tree holds exactly two directive files for item "27/00" at the distinct paths issuance/node-a/ and issuance/node-b/
    And neither issuer's directive file was overwritten or content-merged by the other (the per-issuer partition held strictly)
    And no content conflict and no wedged MERGING state occurred on either clone
