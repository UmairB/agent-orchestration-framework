@cli @work @distribution @executable @bug @finding-F-3204
Feature: the ws@8 broker retires as the liveness transport — a node's presence/liveness view is FULLY POPULATED with the broker never started; "already on the tailnet" is the admission boundary; the reused git guards stay GREEN
  In order to remove the redundant aof-run relay bus a mesh VPN already makes unnecessary (ADR-002.1 consequence, closing F-3204)
  the ws@8 fan-out in mesh-relay.mjs (serveRelay's clients Set), mesh-presence-subscriber.mjs, and mesh-presence-cache.mjs are removed from the liveness path; the device-flow /enroll route + the ws upgrade auth-gate are no longer the trust mechanism ("already on the tailnet" is the admission boundary); and the reused git guards (acd-mesh-partition-write, acd-mesh-sync-record-neutral, the *-write-scope set, acd-mesh-command-cli-bijection) stay GREEN,
  so that the mesh operates with NO listening broker socket and NO relay subscriber, and the behavioural face is: a node's presence + liveness view is fully populated with the broker never started.

  # ARCHITECTURE ADR-002.1 (eliminate the broker as the presence/liveness transport) + ADR-002.4
  # (git stays the durable authority, reused verbatim) + ADR-002.consequence (the enrollment
  # auth-gate retires; "already on the tailnet" is the admission boundary):
  #   1. The BEHAVIOURAL face this feature asserts: presence/liveness is fully populated WITHOUT
  #      the broker ever being started — mesh:status renders every synced peer + its fabric
  #      liveness with serveRelay never invoked, no clients Set, no subscriber connection, no
  #      relay cache. The fast path is now resolvePeers (task 01); the durable floor is the reused
  #      git records (mesh-presence.mjs / mesh-sync.mjs, ADR-002.4).
  #   2. "Already on the tailnet" is the admission boundary (ADR-002.consequence): a node's
  #      liveness is visible to a peer with NO device-code enrollment, NO /enroll POST, NO ws
  #      upgrade auth-gate check — tailnet membership is the trust boundary the fabric supplies.
  #   3. The reused git substrate is UNTOUCHED: mesh-store.mjs (10 dependents), mesh-sync.mjs's
  #      payload-agnostic transport, the one-node-per-path partition — all reused verbatim, so
  #      the reused guards below stay GREEN throughout.
  #
  # SEAM SPLIT — what is a STRUCTURAL/buildable unit (NOT a scenario here) vs what THIS feature
  # asserts:
  #  - The assertion "the fabric spawn/peer-resolution lives ONLY in mesh-fabric.mjs" is the
  #    fitness function acd-fabric-single-seam (ADR-001/006, STORY.md buildable unit) — a
  #    SOURCE-discipline grep, un-skipped + made GREEN WITH this story, NOT a scenario here.
  #  - RETIRING acd-relay-auth-gate-checked (+ its siblings acd-relay-stateless /
  #    acd-relay-envelope-neutral / acd-relay-lease-blind) is a STRUCTURAL task done WITH this
  #    feature (ADR-002.consequence): the task removing the broker MUST atomically retire those
  #    four arch-tests + unwire them from scripts/test.mjs with the supersession note "superseded
  #    by 33/ADR-002 — the broker is eliminated". That retirement is a buildable unit tracked in
  #    STORY.md — NOT a behaviour scenario here (a green guard over a broker that no longer brokers
  #    is exactly what must not be left dangling). All four exist today under test/arch/
  #    (acd-relay-auth-gate-checked.test.mjs + the three siblings, confirmed).
  #  - THIS feature asserts the OBSERVABLE behaviour: presence/liveness fully populated with the
  #    broker never started, admission needing no enrollment, and the reused git guards staying
  #    GREEN as an observable regression check.
  #
  # QA FEASIBILITY FLAG (developer-amigo): the "broker never started" rows stay @executable ONLY
  #  if presence/liveness is fully reachable through the reused mesh:status render + the injected
  #  fabric exec (task 00) with serveRelay NEVER invoked — i.e. the render's fast source is the
  #  fabric read, not a relay subscriber the test would have to stand up. The green-guard rows are
  #  @executable by construction (the arch-runner already runs them). One thing the developer must
  #  confirm: that mesh:status (and any liveness read) has NO hard import of
  #  mesh-presence-subscriber / mesh-presence-cache after the cutover — otherwise "the broker never
  #  started" is not observable because the module graph still pulls the relay bus in.
  # RAISED — the developer confirms mesh:status's liveness render imports the fabric seam, NOT the
  # retired relay subscriber/cache, so "fully populated with the broker never started" is a real
  # observable and not an unreachable state. See VERIFICATION.
  #
  # RESOLVED (developer-amigo): CONFIRMED — @executable stands unchanged; the import graph is
  #  exactly as narrow as the flag hopes. `src/commands/mesh-identity.mjs` (mesh:status's home)
  #  imports `mergePresence` from `src/mesh-presence.mjs` (`:40`) and reads its liveness
  #  accelerator OFF `ctx.presenceCache` (`:214`, `const cache = ctx?.presenceCache ?? null;`) —
  #  it does NOT statically `import` `mesh-presence-cache.mjs` or `mesh-presence-subscriber.mjs`
  #  anywhere in the file; the cache instance is constructed and INJECTED by whatever wires ctx
  #  (today: nothing wires it for the CLI face — `ctx?.presenceCache ?? null` is null on every
  #  `aof mesh status` call, confirmed by the comment at `:211`, "The CLI face … injects NO
  #  cache, so it reads git only"). So the ONE residual import to sever is NOT inside
  #  `mesh-identity.mjs` at all — it is whatever process-level wiring (if any) constructs a
  #  `createPresenceCache()`/`startPresenceSubscriber` and assigns it to `ctx.presenceCache`
  #  before invoking `mesh:status`; per ARCHITECTURE.md's graph read (`ARCHITECTURE.md:38-40`)
  #  the dependents of `mesh-relay-client.mjs` are `commands/mesh-heartbeat.mjs`,
  #  `commands/run-start.mjs`, `mesh-presence-cache.mjs` — NOT `mesh-identity.mjs` — so
  #  `mesh:status`'s render is ALREADY import-clean of the relay-cache/subscriber cluster; task
  #  02's job is to (i) delete `mesh-presence-subscriber.mjs` + `mesh-presence-cache.mjs`
  #  outright (no consumer left once the launcher wires `resolvePeers` as the new
  #  `ctx.presenceCache`-shaped source instead of the relay cache) and (ii) confirm
  #  `mesh-heartbeat.mjs`'s push-side import of `createRelayClient`/`pushPresenceSignal`
  #  (`mesh-relay-client.mjs`) is likewise removed from the liveness path per ADR-002.1. With
  #  both removed, "the broker never started" is a real, observable state — `serveRelay` has NO
  #  remaining caller in the liveness path, confirmed by the graph's dependents list above (only
  #  `commands/mesh-invite.mjs`, `commands/mesh-relay.mjs`, `mesh-presence-subscriber.mjs`
  #  import `mesh-relay.mjs` today — the first two are the enrollment/probe faces, orthogonal to
  #  liveness; the third is deleted by this task).
  #
  # THE FOUR RELAY ARCH-TESTS ARE CONFIRMED WIRED (developer-amigo, structural unit for THIS
  #  task): all four exist and are wired into `scripts/test.mjs` at these exact import + spread
  #  points, so the retirement is one atomic edit removing both the import line and the spread
  #  line per test (never leaving a dangling import or an unreferenced spread):
  #   - `acd-relay-stateless` — import `scripts/test.mjs:581`, spread `:1248`.
  #   - `acd-relay-envelope-neutral` — import `:582`, spread `:1249`.
  #   - `acd-relay-auth-gate-checked` — import `:643`, spread `:1260`.
  #   - `acd-relay-lease-blind` — import `:823`, spread `:1305`.
  #  Retirement shape (a buildable unit done WITH this task, per STORY.md, NOT a scenario here):
  #  delete all four import lines + all four spread lines, and land the explicit supersession
  #  note "superseded by 33/ADR-002 — the broker is eliminated" as a comment at the deletion
  #  site (mirroring how this milestone's other superseded-fitness note is written at
  #  `src/commands/mesh-identity.mjs:176`, "superseded 'zero production code' stance with a
  #  real, tested consumer" — the house idiom for a comment marking a superseded assertion).
  #  Nothing else in `scripts/test.mjs` references these four test files (confirmed by the grep
  #  above returning exactly these eight lines total), so the unwire is clean — no orphaned
  #  partial reference survives the deletion.

  Background:
    Given an initialised aof project whose config I control
    And config.mesh.fabric is "tailscale"
    And the fabric exec is an injected closure returning a healthy `tailscale status --json`
    And a synced aof roster with node + presence records for peers "umairs-mbp" and "build-linux"
    And NO relay broker is started (serveRelay is never invoked in this run)

  # THE BEHAVIOURAL FACE (ADR-002.1): presence + liveness is FULLY POPULATED with the broker never
  # started. mesh:status renders every synced peer and its fabric-sourced liveness, sourcing
  # liveness from resolvePeers (task 01), with no clients Set, no subscriber, no relay cache in the
  # path.
  Scenario: a node's presence and liveness view is fully populated with the broker never started
    Given resolvePeers reports "umairs-mbp" online true and "build-linux" online false
    When I invoke mesh:status
    Then serveRelay was never invoked (no listening broker socket bound)
    And the status lists both "umairs-mbp" and "build-linux" from the synced roster
    And each peer's liveness is sourced from the fabric peer-map (umairs-mbp live, build-linux offline)
    And no relay subscriber connection was opened and no relay cache was consulted

  # "ALREADY ON THE TAILNET" IS THE ADMISSION BOUNDARY (ADR-002.consequence): a peer's liveness is
  # visible with NO device-code enrollment — no /enroll POST, no ws upgrade auth-gate, no 6-digit
  # code. Tailnet membership is the trust boundary; the enrollment dance is no longer load-bearing.
  Scenario: a peer's liveness is visible without any device-code enrollment or ws upgrade auth-gate
    Given peer "umairs-mbp" was never enrolled via a device code and holds no relay credential
    And peer "umairs-mbp" is on the tailnet and Online per the fabric peer-map
    When I invoke mesh:status
    Then "umairs-mbp" is rendered live
    And no /enroll POST and no ws upgrade auth-gate check was required to see it (tailnet membership is the admission boundary)

  # THE REUSED GIT GUARDS STAY GREEN (ADR-002.4 / the Fitness ledger): the reused record model is
  # untouched by the broker retirement — the partition, the payload-agnostic sync, the write-scope
  # seams, and the command-cli bijection all remain GREEN. This is the observable regression check
  # that the retirement did NOT ripple into the reused substrate.
  Scenario Outline: the reused record-model guard stays GREEN across the broker retirement
    When the arch-test suite runs after the broker is removed from the liveness path
    Then the guard "<guard>" is GREEN

    Examples:
      | guard                            |
      | acd-mesh-partition-write         |
      | acd-mesh-sync-record-neutral     |
      | acd-mesh-write-scope             |
      | acd-presence-write-scope         |
      | acd-issuance-write-scope         |
      | acd-lease-write-scope            |
      | acd-mesh-command-cli-bijection   |

  # THE DURABLE FLOOR CARRIES LIVENESS EVEN WITH NO FABRIC AND NO BROKER (ADR-002.4): with the
  # broker gone AND the fabric read absent (unconfigured), presence still renders from the git
  # records — the durable floor never depended on the relay bus, so its removal loses no data.
  Scenario: with neither broker nor fabric read, presence still renders from the reused git records
    Given no relay broker is started and config has no fabric configured
    When I invoke mesh:status
    Then presence renders from the synced git presence records (the reused durable floor)
    And the removal of the relay bus lost no presence data (liveness, not data, was ever the relay's job)
