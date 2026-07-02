@cli @work @distribution @executable
Feature: work:run-start composes the frozen A2 claim sequence — durable local claim first, best-effort relay intent second, authoritative git sync third, hold-or-stand-down decided from git alone
  In order to keep claim correctness independent of the relay (PRD A2 — leasing is race-safe; relay loss only slows arbitration to the git cadence)
  work:run-start writes this node's durable claim file UNCONDITIONALLY first, pushes the lease intent over the relay BEST-EFFORT second (caught, never thrown), runs the authoritative git sync third, and decides hold-or-stand-down from git observation ALONE,
  so that the durable claim and the git sync are byte-identical whatever the relay does, exactly one contender ever executes an item, and killing the relay only slows arbitration — it never blocks or breaks a claim.

  # ARCHITECTURE ADR-004.3 (the FROZEN claim sequence) + ADR-003 (arbitration is remote-history
  # order over the git lease-of-record; ambiguity fails CLOSED — stand down):
  #   1. the local durable claim write — unconditional, FIRST, never inside any relay branch;
  #   2. try { pushLeaseSignal(...) } catch { /* liveness lost, arbitration falls to git cadence */ };
  #   3. the git sync — the AUTHORITATIVE act; hold or stand down is decided HERE and only here;
  #   4. arbitrate from git observation ONLY (the relay grant is worth nothing without the git win).
  #
  # SEAM SPLIT — what is an arch-test vs what is this behaviour feature (the m23 dual-bus pattern):
  #  - fitness #9 (acd-claim-relay-independent) is the SOURCE control-flow assertion over
  #    commands/run-start.mjs: the claim write + git sync are not nested in any relay-push
  #    conditional and the push sits inside try/catch. fitness #8 (acd-lease-arbitration-git-
  #    observed) pins that the resolver imports no cache/subscriber/relay module. ARCH-TESTS,
  #    never scenarios here.
  #  - THIS feature asserts the OBSERVABLE behaviour that structure produces: across every relay
  #    state the durable claim file is byte-identical, the git sync runs, the start outcome is
  #    decided on git evidence alone, and no relay failure ever propagates.
  # The KR2 "100 contested claims / 0 double-executions" SOAK is task 04 (@manual, ADR-004.4) —
  # this feature proves the MECHANISM over real local git fixtures, never the wall-clock race.
  #
  # QA FEASIBILITY FLAG (developer-amigo): every scenario stays @executable ONLY if
  #  (a) the claim path takes an INJECTED relay client { connect, push } (the mesh-heartbeat idiom,
  #      src/mesh-relay-client.mjs) so the four relay states — up / down-connect-throws /
  #      unconfigured (null client => the push is SKIPPED) / push-throws — are reachable with NO
  #      real ws server; if run-start can only build the production client from config, the
  #      down / push-throws rows are not reliably @executable;
  #  (b) TWO contenders are drivable IN ONE PROCESS over a shared bare git remote (two local
  #      clones, each with its own injected sync closure and node id) — ADR-003's consequence
  #      promises "lease tests run over plain local git fixtures"; if a second contender needs a
  #      second OS process, the race rows need a harness lever;
  #  (c) claim/run stamps accept FIXED INJECTED instants so the byte-identical baselines are
  #      deterministically assertable.
  # RAISED — do NOT silently retag to @manual; the sequence (not the latency) must stay unit-testable.
  # RESOLVED (developer-amigo): every scenario stays @executable — all three levers exist today.
  #  (a) CONFIRMED — the injected client rides ctx: invoke(id, input, ctx) hands ctx verbatim to
  #      run(input, ctx) (src/command-core.mjs:189–194), and mesh:heartbeat already reads
  #      `ctx?.relayClient !== undefined ? ctx.relayClient : createRelayClient(config)`
  #      (src/commands/mesh-heartbeat.mjs:113) — injected NULL models unconfigured (the push is
  #      SKIPPED via pushPresenceSignal's null guard, src/mesh-relay-client.mjs:55–57); the
  #      up / connect-fails / push-throws states are the makeRelayStub idiom
  #      (test/mesh-presence-dual-bus.test.mjs:63–80). run-start MUST adopt the identical seam.
  #  (b) CONFIRMED — two contenders in ONE process over a shared bare remote is the proven m22
  #      fixture idiom: buildFixture() (bare remote + clone A) + clonePeer() (clone B), each with
  #      its own workspace/nodeId, driven SEQUENTIALLY in-process against the real git binary
  #      (test/mesh-git-sync-transport.test.mjs:70–115; remote observation via git show,
  #      lines 141–145). syncMesh spawns git synchronously (src/mesh-sync.mjs:39–49), so the
  #      interleave is deterministic — no second OS process, no harness lever needed.
  #  (c) CONFIRMED — run-start gains an OPTIONAL white-box `now` input (the mesh:heartbeat /
  #      mesh:status input.now precedent, src/commands/mesh-heartbeat.mjs:63–69 and
  #      src/commands/mesh-identity.mjs:155–160 — a test input, never a CLI flag); the store
  #      already accepts injected instants end-to-end (startRun/reclaimStaleRuns { now },
  #      src/run-store.mjs:233, :407) and the claim stamp threads the same instant through
  #      acquireLease. Byte-identity is the relayUpBaseline() compare
  #      (test/mesh-presence-dual-bus.test.mjs:86–96).
  Background:
    Given an initialised aof project whose work stream is a fixture I control
    And the work run-lifecycle commands registered in the command core
    And mesh is configured with a stable mesh.nodeId for this node
    And a shared bare git remote this workspace syncs its claims and run records to
    And the claim path takes an injected relay client whose connect/push I can stub
    And a ready task item this node is about to start

  # THE INVARIANT MATRIX — across every relay state the DURABLE claim file is written
  # byte-identically, the AUTHORITATIVE git sync runs, and the start outcome is decided on git
  # evidence alone. The four rows are the complete relay-state equivalence class (the m23 rows):
  #   - up                 : the relay client connects and the intent push succeeds (happy path);
  #   - down (connect-fail): the relay is configured but unreachable — connect throws;
  #   - unconfigured       : no relay configured — a null client, the push is SKIPPED (not attempted);
  #   - push throws        : the relay connects but the push call itself throws (mid-send failure).
  # For EVERY row, with no competing claim on the remote: (a) this node's claim file is written
  # byte-identically to the relay-up baseline, (b) the git sync runs and the claim reaches the
  # remote, (c) the start HOLDS and mints the run on git evidence alone, (d) no relay failure
  # propagates to the start result.
  Scenario Outline: the durable claim is written byte-identically and the start holds on git evidence for every relay state
    Given the injected relay client is in relay state "<relay-state>"
    And no competing claim for the item exists on the shared remote
    When I invoke work:run-start for the item with a fixed injected claim instant
    Then the start result is "<result>"
    And this node's claim file for the item is persisted under the lease seam with state "claimed"
    And the persisted claim file is byte-identical to the relay-up baseline (the durable claim does not depend on relay state)
    And the claim reached the shared remote (the authoritative git sync ran)
    And no relay failure propagated to the start result

    Examples:
      | relay-state          | result            |
      | up                   | held — run minted |
      | down (connect-fails) | held — run minted |
      | unconfigured         | held — run minted |
      | push throws          | held — run minted |

  # The accelerator works on the happy path: when the relay is UP exactly ONE lease intent envelope
  # IS pushed — "best-effort" must not collapse into "skipped". The envelope is the relay's frozen
  # { kind, nodeId, signal } second kind (ADR-004.1): kind "lease", this node's id, the claim record
  # as the OPAQUE signal blob. (The full wire-shape freeze + the receive side belong to task 02.)
  Scenario: when the relay is up exactly one lease intent envelope is pushed (best-effort is not skipped)
    Given the injected relay client is in relay state "up"
    And no competing claim for the item exists on the shared remote
    When I invoke work:run-start for the item
    Then exactly one lease intent was pushed over the relay client
    And the pushed envelope carries kind "lease" and this node's nodeId
    And the pushed envelope's opaque signal carries this node's claim record for the item
    And the start outcome was still decided by the git sync, not the push (the intent is advisory only)

  # HOLD — the win is cashed in full (ADR-004.3 step 4 + ADR-003.1's runId tie): the run is minted
  # WITH this node's id (it lands under this node's partition of the item's runs) and the claim
  # file's runId is tied back onto the minted run — the lease<->run tie every reader consumes.
  Scenario: a held claim mints the run with this node's id and ties the runId back onto the claim
    Given no competing claim for the item exists on the shared remote
    When I invoke work:run-start for the item
    Then a run is minted for the item in state running
    And the minted run record carries this node's id as its node key
    And the run record is persisted under this node's partition of the item's runs
    And this node's claim file for the item now carries the minted run's runId (the lease-to-run tie-back)

  # STAND DOWN — losing mints NOTHING (ADR-003 step e: defeat and ambiguity fail CLOSED; two losers
  # is a liveness hiccup, two winners is the KR2 violation). The loser's own claim flips released —
  # an own-path withdrawal; the winner's claim file is never touched.
  Scenario: a competing live claim on the remote stands this node down — no run is minted
    Given a peer's LIVE claim for the item is already on the shared remote (state "claimed", the peer's presence fresh)
    When I invoke work:run-start for the item
    Then NO run is minted for the item
    And the result says stood-down and names the holding peer (heldBy)
    And this node's own claim file for the item flips to state "released" (the own-path withdrawal)
    And the peer's claim file is left byte-unchanged (never a foreign write)

  # THE PRIMARY-SPIKE ROW (ADR-004.3 — the relay-grant vs git-commit ordering, the PRD's spike): a
  # node that broadcast its intent UNOPPOSED — "holds the relay grant" — but whose git race is lost
  # STANDS DOWN. The relay grant is worth nothing without the git win.
  Scenario: a node whose intent broadcast unopposed but whose git race is lost stands down
    Given this node pushed its lease intent over the relay and heard no competing intent
    And a peer's claim for the same item reached the shared remote before this node's sync landed
    When this node's authoritative git sync observes the shared remote
    Then this node stands down — NO run is minted
    And the result names the peer that won the git race (heldBy)
    And the unopposed relay broadcast carried no authority (the decision came from git observation alone)

  # RELAY WHOLLY LOST — the A2 floor: with NO relay at all, two contenders racing one item still
  # arbitrate to exactly ONE winner at the git cadence (slower, never broken). This is the
  # @executable MECHANISM of the soak's relay-killed half (task 04 measures it on a real fleet).
  Scenario: with the relay wholly absent two contenders still arbitrate to exactly one winner at the git cadence
    Given two contender nodes, each a clone of the shared bare remote, and neither has any relay configured
    When both contenders invoke work:run-start for the same item
    Then exactly one contender holds and mints a run for the item
    And the other contender stands down with NO run minted, naming the winner (heldBy)
    And the arbitration was carried purely by git (no relay transported anything)
