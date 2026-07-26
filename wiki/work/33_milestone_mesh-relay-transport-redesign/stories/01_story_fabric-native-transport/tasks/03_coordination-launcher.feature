@cli @work @distribution @executable @bug @finding-F-3201
Feature: the per-node presence+sync daemon serve verb — its registered run is the NON-BLOCKING probe that RETURNS (bijection-safe); the --serve face preflights the fabric + refuses-with-guidance if degraded, binds the fabric self-address (no listening broker socket), and stops cleanly on SIGTERM
  In order to ship the long-lived per-node process the fabric-native model needs, without breaking acd-mesh-command-cli-bijection (F-3201; ADR-003)
  a new mesh:* serve verb registers on the spine whose REGISTERED RUN is the non-blocking probe (the 23 relayStatus precedent): `aof mesh <serve> --json` reports fabric state + self-address + peer count + whether this node is the issuance authority, and RETURNS; and whose --serve face path over the one-shot core (a) preflights the fabric via probeFabric and refuses-with-guidance if degraded, (b) publishes this node's git presence record + runs the reused startSyncLoop cadence, (c) periodically reads resolvePeers so mesh:status reflects live fabric liveness, binds NO listening broker socket (the "bind" is the fabric self-address), and traps SIGINT/SIGTERM to stop the loop + publisher cleanly,
  so that a fresh operator runs ONE verb, the registered run stays a clean parseable return (the bijection gate honours it), and the long-lived serve is the blocking --serve path never the bijection-probed run.

  # ARCHITECTURE ADR-003 (the launcher is a per-node foreground presence+sync daemon; the
  # registered run is the NON-BLOCKING probe; the serve path binds the fabric self-address) +
  # 08/ADR-001 (serve is a thin face over a one-shot core) + the 23 precedent (relayStatus /
  # commands/mesh-relay.mjs — the registered run must not listen()/block):
  #   1. THE REGISTERED RUN IS THE NON-BLOCKING PROBE (ADR-003.2, the relayStatus shape at
  #      mesh-relay.mjs:665): `aof mesh <serve> --json` reports { fabricState, selfAddress,
  #      peerCount, issuanceAuthority } and RETURNS — it NEVER calls listen()/startSyncLoop/blocks,
  #      so acd-mesh-command-cli-bijection stays GREEN (the probe runs clean + parseable + returns).
  #      The verb rides the existing mesh: gate — one import + one COMMANDS entry + one meshCommand
  #      branch (`subcommand === "<serve>"`) + one argsFor/meshVerbCli case + one cli.mjs dispatch
  #      (22/R1; the meshRelayCommand precedent at command-core.mjs:202 / cli.mjs:522).
  #   2. THE --serve FACE PREFLIGHTS + REFUSES-WITH-GUIDANCE (ADR-003.1a): the blocking serve path
  #      calls probeFabric FIRST; a degraded probe (not-installed / needs-login / stopped /
  #      needs-machine-auth / degraded, task 00) refuses to start the daemon and prints the matching
  #      remediation (task 04 owns the message text), exiting non-zero — the daemon never starts a
  #      loop over a dead fabric.
  #   3. THE HAPPY SERVE PATH (ADR-003.1b/1c): a healthy preflight publishes this node's git presence
  #      record (reused publishPresenceRecord) + runs the reused startSyncLoop (mesh-sync.mjs:292,
  #      injected runSync + ticker) + periodically reads resolvePeers. It binds NO listening broker
  #      socket — the "bind" is the fabric self-address resolved via selfAddress (ADR-003.3).
  #   4. LIFECYCLE (ADR-003.3, the serve-unit discipline): SIGINT/SIGTERM traps stop the sync loop
  #      (handle.stop()) + the presence publisher CLEANLY — no dangling loop, no half-published
  #      record. The prototype's serve → stop shape (STATE §Prototype context).
  #
  # SEAM SPLIT: acd-mesh-command-cli-bijection (a reused guard, ADR-003.2) is what asserts the verb
  #  is registered with a cli adapter + a reachable dispatch branch AND that its registered run is a
  #  clean non-blocking return — a registry-DERIVED gate, NOT a scenario here. THIS feature asserts
  #  the OBSERVABLE run behaviour: the probe shape + that it RETURNS, the preflight refusal, the
  #  no-listening-socket bind, and the SIGTERM clean-stop.
  #
  # QA FEASIBILITY FLAG (developer-amigo): rows stay @executable ONLY if:
  #  (a) the registered-run probe is a pure config+fabric read (the relayStatus precedent) that
  #      returns a value — reachable in-process via invoke("mesh:<serve>") with NO listen, so "it
  #      RETURNS" is directly observable (the acd-mesh-command-cli-bijection fixture already proves
  #      this shape for every mesh: verb);
  #  (b) the --serve path composes over the INJECTED startSyncLoop ticker (mesh-sync.mjs:292 takes
  #      an injectable ticker so no wall-clock wait) + the INJECTED fabric exec (task 00) — so the
  #      preflight-refuse and happy-start rows run with no tailnet and no real timer;
  #  (c) the SIGINT/SIGTERM clean-stop is testable via an INJECTED lifecycle seam (a signal handler
  #      the harness can fire + a stop() the harness can observe) rather than a real process signal —
  #      the developer confirms the serve loop exposes a stop() the test drives (mirroring
  #      startSyncLoop's returned { stop } and serveRelay's returned { stop }).
  # RAISED — the developer confirms: the serve path takes an injected ticker + fabric exec, AND the
  # SIGINT/SIGTERM handler routes through an observable stop() seam (not only a raw process.on).
  # WITHOUT (c) the clean-stop row is a @manual soak observation, not an @executable assertion.
  # See VERIFICATION.
  #
  # RESOLVED (developer-amigo): all three sub-flags CONFIRMED — @executable stands unchanged,
  #  INCLUDING the clean-stop row (DECISION: stays @executable, does NOT degrade to @manual).
  #  (a) THE REGISTERED-RUN PROBE RETURNS A VALUE, REACHABLE VIA invoke() — YES, the EXACT
  #      relayStatus shape. `src/commands/mesh-relay.mjs:25-32` (`meshRelayCommand.run`) is a
  #      pure `return relayStatus(config);` — no listen, no await-forever — and
  #      `test/arch/acd-mesh-command-cli-bijection.test.mjs` already proves every registry
  #      mesh:* command's registered run is reachable via `invoke("mesh:<sub>", …)`/the CLI
  #      spawn and RETURNS a parseable JSON value (`:186-209`, the spawn-and-parse proof over
  #      EVERY derived `mesh:*` sub, including `relay` — `argsFor("relay")` at `cli.mjs`-adjacent
  #      test file `:115`). The new serve verb's registered run composes the identical shape:
  #      `probeFabric(config)` + `selfAddress(config)` + `resolvePeers(config).length` +
  #      an issuance-authority check off `config.mesh.relay.controlNode === config.mesh.nodeId`
  #      (the SAME comparison `relayStatus` already makes at `mesh-relay.mjs:669`,
  #      `nominated = nodeId != null && controlNode != null && controlNode === nodeId`) — a pure
  #      config+fabric read returning a value, zero blocking calls.
  #  (b) THE --serve PATH TAKES AN INJECTED TICKER + FABRIC EXEC — YES. `startSyncLoop({
  #      runSync, cadenceSeconds, ticker })` (`src/mesh-sync.mjs:292-303`) ALREADY takes an
  #      injectable `ticker: { start(intervalSeconds, onTick) -> handle, stop(handle) }` — no
  #      wall-clock wait needed; production uses `intervalTicker()` (`:307-316`, a real
  #      `setInterval` wrapper), tests inject a manual ticker. The launcher's --serve path
  #      reuses `startSyncLoop` UNCHANGED (per STORY.md's "reused `startSyncLoop`" line), wiring
  #      `runSync = () => syncMesh(ws)` (the `run-start.mjs:209` shape) and passing the SAME
  #      injected fabric-exec closure task 00 established for the periodic `resolvePeers`
  #      re-read. Both injection seams pre-exist; the launcher composes them, adding none new.
  #  (c) SIGINT/SIGTERM CLEAN-STOP STAYS @executable — CONFIRMED, an observable stop() seam
  #      already exists at the EXACT precedent cited: `startSyncLoop`'s return value IS `{
  #      intervalSeconds, stop() { ticker.stop(handle); } }` (`mesh-sync.mjs:296-302`) — a
  #      caller-observable `stop()` the harness calls directly (no real OS signal needed to
  #      prove the loop tears down); `serveRelay` returns the SAME shape, `{ server, url, stop }`
  #      (`mesh-relay.mjs:638`, `stop()` at `:623-636` closing every live socket then the wss +
  #      server). The launcher's serve unit composes BOTH: publish presence once, start
  #      `startSyncLoop`, and expose ITS OWN `stop()` that calls the sync-loop handle's `stop()`
  #      + tears down the presence-publish/peer-poll ticker — a plain closure return, not a
  #      dependency on `process.on("SIGINT", …)` firing inside the test. The SIGINT/SIGTERM
  #      Scenario Outline here asserts "the process receives <signal> → sync loop's stop() is
  #      called → presence publisher stopped → serve path returns cleanly" — ALL FOUR of those
  #      are observable by (i) registering the REAL `process.on(signal, …)` handler in
  #      production but (ii) having the test invoke the SAME internal stop-routine the handler
  #      calls (an exported `stopLauncher(handle)` or the handle's own `.stop()`) directly,
  #      exactly as `test/mesh-lease-claim-arbitration.test.mjs` and the sync-loop tests already
  #      drive `handle.stop()` without ever raising a real signal. No @manual degrade needed —
  #      the "process receives SIGINT" wording is satisfied by the handler-registration being
  #      unit-tested as "the registered handler, when invoked, calls stop()" (a direct call to
  #      the captured handler function), the standard Node signal-handler testing idiom.
  #
  # RESEARCH-GAP FLAG: RESEARCH §2 notes the CADENCE of Online transitions (how fast a peer going
  #  down is reflected in the peer map) is undocumented/unmeasured — so "periodically reads
  #  resolvePeers so mesh:status reflects LIVE fabric liveness" asserts only THAT a re-read happens
  #  each tick, NOT a latency bound. The live liveness-lag is task 05's @manual measurement.
  #
  # RESEARCH-GAP RESOLVED (developer-amigo): ACCEPTABLE TO DEFER — no retag, no design note
  #  needed now. This feature's scenario only asserts "each ticker tick re-reads resolvePeers"
  #  (a re-read HAPPENS), which is fully fixturable over the injected ticker with zero timing
  #  assumption — the cadence NUMBER (how many seconds until Tailscale's control plane reflects
  #  a peer drop) is an external vendor-side latency no CI fixture could ever bound honestly;
  #  asserting a number here would be asserting a fact about Tailscale's infrastructure, not
  #  about this code. Task 05's Background already commits to recording "the observed
  #  Online-transition latency after a node drops" — correctly scoped as the @manual re-feed.

  Background:
    Given an initialised aof project whose config I control
    And config.mesh.fabric is "tailscale"
    And the fabric exec is an injected closure whose probe outcome and peer map I control
    And the sync loop takes an injected ticker so no wall-clock tick is required
    And the serve loop exposes an observable stop() the harness can drive

  # THE REGISTERED RUN IS THE NON-BLOCKING PROBE THAT RETURNS (ADR-003.2 / the 23 precedent): the
  # `--json` face reports fabric state + self-address + peer count + issuance-authority and RETURNS
  # — it never listens, never starts the loop, so the bijection gate honours it. The probe shape is
  # a specific parseable record.
  Scenario: the registered run is a non-blocking probe that reports fabric state + self-address + peer count + issuance authority and RETURNS
    Given the fabric exec returns a healthy status with Self.TailscaleIPs[0] "100.121.112.23" and two Online peers
    And config.mesh.relay.controlNode is this node's nodeId (this node is the issuance authority)
    When I invoke the serve verb's registered run with --json
    Then the run RETURNS (it never calls listen() and never starts the sync loop)
    And the --json result is { fabricState:"running", selfAddress:"100.121.112.23", peerCount:2, issuanceAuthority:true }

  Scenario: on a degraded fabric the registered probe still RETURNS, reporting the unhealthy state (never blocks)
    Given the fabric exec rejects with a spawn error whose code is "ENOENT"
    When I invoke the serve verb's registered run with --json
    Then the run RETURNS
    And the --json result reports fabricState "not-installed" and healthy false (a status probe, not a start)

  # THE --serve FACE PREFLIGHTS + REFUSES-WITH-GUIDANCE ON A DEGRADED FABRIC (ADR-003.1a): the
  # blocking serve path probes the fabric FIRST; a degraded probe refuses to start the daemon,
  # prints the matching remediation (task 04), and exits non-zero — no loop starts over a dead
  # fabric, and no presence record is published.
  Scenario Outline: the --serve path preflights and refuses-with-guidance when the fabric probe is degraded
    Given the fabric exec is scripted so probeFabric returns { healthy:false, reason:"<reason>" }
    When I run the launcher's --serve path
    Then the daemon does NOT start (no sync loop, no presence publish)
    And it exits non-zero with the guidance for reason "<reason>"

    Examples:
      | reason              |
      | not-installed       |
      | needs-login         |
      | stopped             |
      | needs-machine-auth  |
      | degraded            |

  # THE HAPPY SERVE PATH BINDS THE FABRIC SELF-ADDRESS, NO LISTENING BROKER SOCKET (ADR-003.1b/1c/3):
  # a healthy preflight starts the daemon — it publishes this node's presence, runs the reused
  # startSyncLoop cadence, periodically re-reads resolvePeers — and binds NO listening broker socket;
  # the "bind" is the fabric self-address resolved via selfAddress.
  Scenario: a healthy preflight starts the daemon, publishes presence, runs the reused sync loop, and binds no listening socket
    Given the fabric exec returns a healthy status with Self.TailscaleIPs[0] "100.121.112.23"
    When I run the launcher's --serve path
    Then this node's git presence record is published (via the reused publishPresenceRecord)
    And the reused startSyncLoop is started on the configured cadence
    And no listening broker socket is bound (the "bind" is the fabric self-address "100.121.112.23")
    And each ticker tick re-reads resolvePeers so mesh:status reflects live fabric liveness

  # SIGTERM → CLEAN STOP (ADR-003.3, the serve-unit discipline): the running daemon traps SIGINT/
  # SIGTERM and stops the sync loop + the presence publisher cleanly — no dangling loop, no
  # half-published record.
  Scenario Outline: <signal> stops the sync loop and the presence publisher cleanly
    Given the launcher's --serve path is running with a published presence record and a live sync loop
    When the process receives <signal>
    Then the sync loop's stop() is called (the ticker is torn down, no further tick fires)
    And the presence publisher is stopped cleanly (no half-published record, no dangling loop)
    And the serve path returns cleanly (a clean daemon shutdown, exit 0)

    Examples:
      | signal   |
      | SIGINT   |
      | SIGTERM  |

  # THE VERB RIDES THE EXISTING mesh: GATE (ADR-003.2 / 22/R1): the registered run is a
  # config+fabric read that returns — it never blocks — so acd-mesh-command-cli-bijection covers it
  # exactly as it covers mesh:relay's non-blocking probe. This is the observable that the long-lived
  # serve is the --serve path, NOT the bijection-probed run.
  Scenario: the serve verb rides acd-mesh-command-cli-bijection because its registered run returns, not listens
    Given the serve verb is registered as a mesh:* command with a cli adapter and a dispatch branch
    When the acd-mesh-command-cli-bijection gate probes the verb's registered run
    Then the registered run completes and returns a parseable result (never a blocking listen)
    And the long-lived serve is reached ONLY via the --serve face path, never the bijection-probed run
