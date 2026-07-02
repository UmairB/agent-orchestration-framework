@cli @work @distribution @executable
Feature: Two clones' run records for one item merge add-only over a shared bare remote — no conflict, no wedged state, both records intact on both sides
  In order to prove the substrate property an outsider can check — two nodes can record runs against one shared work stream over git alone
  two clones of one bare remote each mint a run for the SAME item under their own node dir and sync; the merge is add-only — no content conflict, no MERGING state — and after convergence each clone reads one union carrying BOTH records byte-for-byte,
  so that leasing (story 01) and fleet reclaim (story 02) stand on a bus that never wedges and never rewrites a peer's record.

  # ARCHITECTURE ADR-001 + ADR-002 (story 00 — the outsider-verifiable acceptance): the
  # one-node-one-path partition (runs/<node>/<run-id>.json) makes every cross-node merge
  # ADD-ONLY — disjoint files, never a three-way content merge — and the root-set tick
  # (task 01) is what carries the records to and from the remote. Real git, real bare
  # remote, no mocks: the m22 transport-task precedent (22/story-02, proven @executable in
  # CI by test/mesh-git-sync-transport.test.mjs + test/support/roundtrip-harness.mjs).
  #
  # 22/R3 CAUTION (Windows spawn — a comment, NOT a retag): the m22 retro found real-process
  # spawns flaking ~1-in-3 full-suite runs on Windows (CreateProcess under temp-dir churn)
  # while passing in isolation. Route every git/CLI spawn through the shared retry seam
  # (test/support/cli-spawn.mjs precedent) and let verify run the suite enough to detect
  # flakes — a flaky proof is itself a defect. The property stays @executable.
  #
  # RESOLVED (developer-amigo): confirmed — the helper is test/support/cli-spawn.mjs
  # `spawnSyncHardened` (6 attempts, linear 25·n ms backoff; it retries ONLY the
  # never-ran case `status === null && signal == null`; a real exit code or signal-kill
  # returns immediately, so genuine failures are never masked). Every git spawn in this
  # fixture routes through it, exactly as test/mesh-git-sync-transport.test.mjs's local
  # git() wrapper does (lines 40–43).
  #
  # SEAM SPLIT — what is an arch-test vs what is this behaviour feature:
  #  - the partition builder singleton (fitness #1), the fourteen-key freeze (#2), the R3
  #    EOL pin on the real nested path (#3), and the root-set source discipline (#5) are
  #    STRUCTURAL → ARCH-TESTS, never scenarios here.
  #  - THIS feature asserts what two REAL clones observe over one bare remote: sync outcomes,
  #    repo state (no merge left in progress), on-disk bytes, and the union both sides read.
  #
  # FIXTURE NOTE — the pre-convergence window is the point: clone B mints BEFORE any sync
  # brings A's record to B, so the dedup guard (which spans only the union a clone can SEE —
  # task 00) does not fire on either side. Both mints succeeding in that window is exactly
  # the race the add-only partition exists to make safe. (After convergence both clones see
  # two non-terminal runs and the guard blocks further mints — that in-tree behaviour is
  # task 00's matrix, not re-asserted here.)
  #
  # QA FEASIBILITY FLAG (developer-amigo): the byte-for-byte cross-clone equality assertions
  # interact with EOL translation on Windows checkouts. The m22 harness neutralised it with a
  # fixture-level `* -text` .gitattributes; this story lands the REAL R3 pin (eol=lf on the
  # runs tree, fitness #3). Pick ONE deliberately for the fixture — the real pin in force, or
  # the harness neutralisation — so the byte-for-byte assertions are stable on Windows CI.
  # RAISED — do NOT silently weaken the assertions to content-equality; see VERIFICATION.
  #
  # RESOLVED (developer-amigo): the fixture uses the PROVEN m22 harness neutralisation —
  # per-clone `core.autocrlf false` + `core.eol lf` plus a fixture-level `.gitattributes`
  # of `* -text` (test/mesh-git-sync-transport.test.mjs configIdentity lines 45–56 +
  # buildFixture line 94). `-text` disables ALL EOL translation, strictly STRONGER than
  # eol=lf for byte-stability, so the byte-for-byte assertions hold unweakened on
  # Windows CI. The REAL R3 pin is asserted SEPARATELY by fitness #3 (acd-runs-eol-pinned)
  # against THIS repo's .gitattributes via git-semantics matching (git check-attr over
  # the real nested + flat sample paths) — the fixture's neutralisation therefore never
  # stands in for, masks, or weakens the production pin. Assertions stay strict
  # byte-for-byte; no content-equality fallback.
  Background:
    Given a shared bare git remote and two aof installs "clone A" and "clone B", each cloned from that remote over the same work stream
    And one work item both clones can mint runs against
    And clone A has minted a run for the item with node id "node-a" and synced it to the remote (committed and pushed)
    And clone B has minted a run for the SAME item with node id "node-b" BEFORE any sync brought A's record to B

  # THE HEADLINE ADD-ONLY MERGE: B's tick commits its own record, pulls A's (disjoint paths —
  # add-only, clean), and pushes. No content conflict, and — the 26/ADR-003 load-bearing
  # negative — no repo left mid-merge (the wedged MERGING state the engine cannot recover is
  # the exact failure the partition makes impossible). Each record arrives byte-for-byte as
  # its owner wrote it: add-only means added, never content-merged into a hybrid.
  Scenario: clone B's sync merges the two nodes' run records add-only with no conflict and no MERGING state
    When clone B runs a sync tick with the mesh-aware root set
    Then the tick succeeds (no pull-failed, no push-failed)
    And no merge is left in progress in clone B's repo (no wedged MERGING state)
    And clone B's tree holds A's record under runs/node-a/ and its own under runs/node-b/
    And A's record in clone B's tree is byte-identical to what clone A wrote (never content-merged)
    And clone B's own record is byte-identical to what clone B wrote
    And the shared remote's branch tip carries BOTH records

  # THE SECOND-SYNC CONVERGENCE: A's next tick pulls B's record — the round trip that makes
  # the union whole on BOTH sides. R4: pin the UNAFFECTED side — receiving a peer's record
  # never rewrites this clone's own (the m22 pull discipline, now over run records).
  Scenario: clone A's second sync converges it on the union without touching its own record
    Given clone B's record has reached the shared remote
    And I record the on-disk bytes of clone A's own run record
    When clone A runs a sync tick with the mesh-aware root set
    Then the tick succeeds
    And clone B's record is present in clone A's tree under runs/node-b/
    And the envelope's pulled names include clone B's record path
    And clone A's own record is byte-identical to before the tick (the pull did not touch it)

  # THE CONVERGED UNION — the acceptance an outsider can check: both clones read the SAME
  # two-run history for the item, ordered runId-ascending (task 00's union read, here over
  # records that travelled through git), each record still carrying its owner's node id, the
  # two reads agreeing byte-for-byte across machines.
  Scenario: after convergence both clones read one identical runId-ascending union of both nodes' runs
    Given both clones have synced to convergence (each tree carries both records)
    When each clone reads the item's runs
    Then each clone's read returns exactly two runs, ordered runId-ascending
    And one record carries node "node-a" and the other carries node "node-b"
    And the two clones' reads agree record-for-record, byte-for-byte
