@cli @work @distribution @executable @bug @finding-F-3202
Feature: src/mesh-fabric.mjs — the ONE fabric-assumption site: probeFabric / selfAddress / resolvePeers over an INJECTED tailscale exec, each returning a structured shape (never a crash, never a hidden fallback)
  In order to make "the fabric gives every node a stable directly-dialable address and handles NAT" an assumption asserted in EXACTLY one place (ADR-001.1)
  src/mesh-fabric.mjs spawns the fabric CLI shell-less via execFile("tailscale", [...]) with a timeout (the git-argv precedent, ADR-001.consequence), parses tailscale status --json TOLERANTLY (read the fields we need, ignore unknowns, a parse failure ⇒ a degraded-fabric refusal), and exposes three functions: probeFabric(config) → { fabric, state, healthy, reason } (the two-stage liveness probe), selfAddress(config) → this node's dial address, and resolvePeers(config) → [{ nodeId, dialAddress, online, host }] joined to the aof nodeId by HostName/DNSName,
  so that no other src module hard-codes tailscale / a 100.x range / a ws:// URL derivation, a degraded or absent fabric is a structured actionable refusal rather than a crash or a silent wrong-address, and a config.mesh.fabric other than "tailscale" is a clean designed-not-shipped refusal (06/ADR-002).

  # ARCHITECTURE ADR-001 (pin the fabric FIRST; the ONE narrow resolver) + ADR-002.2 (the
  # HostName/DNSName → nodeId join) + RESEARCH §1/§2/§3/§4:
  #   1. probeFabric is a TWO-STAGE probe (RESEARCH §4): stage 1 — can `tailscale` be spawned
  #      at all? ENOENT (with the Windows well-known-install-path fallback tried FIRST, RESEARCH
  #      §3) ⇒ { healthy:false, reason:"not-installed" }. stage 2 — it spawned + returned JSON:
  #      branch on top-level BackendState (RESEARCH §4): "Running" ⇒ { healthy:true }, else the
  #      matching actionable reason ("NeedsLogin"⇒"needs-login", "Stopped"⇒"stopped",
  #      "NeedsMachineAuth"⇒"needs-machine-auth"). A --json that will not parse ⇒
  #      { healthy:false, reason:"degraded" } (tolerant parse; RESEARCH §2 "format subject to
  #      change" — never a throw).
  #   2. selfAddress reads THIS node's dial address — Self.TailscaleIPs[0] out of `tailscale
  #      status --json` (or the cheaper `tailscale ip --4`, RESEARCH §1), the CGNAT 100.x v4.
  #   3. resolvePeers parses the Peer map (each value the identical PeerStatus struct as Self,
  #      RESEARCH §2) into [{ nodeId, dialAddress, online, host }] — dialAddress from the peer's
  #      TailscaleIPs[0], online from Peer[x].Online (the control-plane liveness), host from
  #      HostName, and nodeId JOINED to the aof roster by HostName/DNSName (ADR-002.2; DNSName's
  #      trailing dot stripped/tolerated, RESEARCH §1). A Peer that joins no aof nodeId is
  #      surfaced UNJOINED (nodeId:null), never dropped silently and never crashed on.
  #   4. A config.mesh.fabric !== "tailscale" is a clean structured refusal
  #      ({ healthy:false, reason:"fabric-unsupported" }), NOT a crash and NOT a hidden fallback
  #      (ADR-001.3 / 06/ADR-002 designed-not-shipped).
  #
  # SEAM SPLIT — what is an arch-test / structural unit vs what THIS behaviour feature asserts:
  #  - Fitness acd-fabric-single-seam (ADR-006, STORY.md buildable unit): the `tailscale`-spawn
  #    call-form + the peer-dial-address resolution live ONLY in src/mesh-fabric.mjs — a
  #    SOURCE-discipline grep over the tree, NOT a scenario here. THIS feature asserts the
  #    OBSERVABLE returns of the three functions over fixtured CLI output.
  #  - THIS feature asserts: the refusal-reason matrix (BackendState/ENOENT → reason), the
  #    self-address parse, the peer-map → resolvePeers join matrix, and the non-tailscale
  #    clean refusal — all over a fabric exec whose stdout/exit/error I control.
  #
  # QA FEASIBILITY FLAG (developer-amigo): every row here stays @executable ONLY if the fabric
  #  CLI is INJECTABLE — mesh-fabric.mjs must take an injected spawn/exec closure the way
  #  mesh-lease/mesh-issue take runSync and mesh-presence-subscriber takes `transport`
  #  (mesh-relay-client.mjs's { connect, push } injected client is the exact precedent). The
  #  closure the harness swaps in must let a test drive: (i) stdout = a fixture `tailscale status
  #  --json` blob; (ii) a bare exit-0 IP string for `tailscale ip --4`; (iii) an ENOENT-shaped
  #  rejection (spawn error, code:"ENOENT") to reach the not-installed branch; (iv) an exit code
  #  + stderr for a stopped/logged-out daemon. Production defaults to a real
  #  execFile("tailscale",[...]) with a timeout when the closure is absent (the createRelayClient
  #  config-default precedent). WITHOUT that injection point, stage-1 ENOENT and every
  #  BackendState row need a real tailnet and the feature is @manual — so:
  # RAISED — do NOT silently retag to @manual; the developer confirms mesh-fabric.mjs takes an
  # injected fabric-exec closure (ctx key mirroring ctx.relayClient at run-start.mjs:210 /
  # mesh-presence-subscriber's injected `transport`). See VERIFICATION.
  #
  # RESOLVED (developer-amigo): CONFIRMED — @executable stands unchanged. The injected-closure
  #  idiom this flag asks for is already load-bearing precedent in THREE places, not one:
  #   - `src/commands/run-start.mjs:210` — `const relayClient = ctx?.relayClient !== undefined
  #     ? ctx.relayClient : createRelayClient(config);` — a ctx-injected seam, production
  #     default when absent.
  #   - `src/mesh-presence-subscriber.mjs:110` (`startPresenceSubscriber({ transport, ... })`)
  #     takes an injected `{ onMessage, connect, close }` transport; `createSubscriberTransport`
  #     (`:168`) is the production ws@8 default, exercised only by the @manual soak.
  #   - `src/tool-store.mjs:88` — `export function defaultProbe(exeFile, spawn = spawnSync)` —
  #     an injected spawn closure defaulting to the REAL spawnSync, unit-testing the branch
  #     logic (non-zero exit / empty stdout / clean version) with NO live binary. This is the
  #     nearest existing precedent for an injected PROCESS-SPAWN seam specifically (as opposed
  #     to an injected network client), so `mesh-fabric.mjs` composes the SAME shape: an
  #     injected `exec` closure (`(bin, args) => Promise<{ stdout, status }>` or equivalent)
  #     defaulting to a real `execFile("tailscale", [...])` + timeout when absent.
  #  The four fixtured shapes the harness must drive over that ONE injection key (name it
  #  `fabricExec` — the ctx/options key `probeFabric`/`selfAddress`/`resolvePeers` all accept):
  #   (i)   stdout = a fixture `tailscale status --json` blob (resolve with { stdout }) — drives
  #         every BackendState row + resolvePeers' join matrix;
  #   (ii)  a bare exit-0 IP string for `tailscale ip --4` (resolve with { stdout: "100.x.y.z" })
  #         — the cheaper selfAddress path RESEARCH §1 names, though the Background fixture here
  #         drives selfAddress off the SAME `status --json` Self key, so this shape is optional
  #         until a caller opts into the single-purpose call;
  #   (iii) an ENOENT-shaped rejection (reject with an Error carrying `.code === "ENOENT"`) —
  #         mirrors Node's real `child_process` ENOENT shape (`tool-store.mjs`'s spawn-error
  #         degrade already treats a thrown/failed spawn as "absent", same class);
  #   (iv)  an exit code + stderr for a stopped/logged-out daemon (resolve with { stdout:
  #         <BackendState-carrying JSON>, status:0 } — RESEARCH §4 confirms the STATE lives in
  #         the parsed JSON, not the exit code, so this row is satisfied by shape (i) with a
  #         non-"Running" BackendState; a non-zero exit path is ALSO fixturable
  #         (`{ stdout: "", status: 1 }`) for completeness though RESEARCH flags the live exit
  #         code as unconfirmed — see the RESEARCH-GAP resolution below).
  #  Production default confirmed feasible: `mesh-fabric.mjs`'s three exported functions each
  #  accept an options bag whose `exec` key defaults to a real
  #  `execFile("tailscale", args, { timeout })` promisified wrapper — the exact
  #  default-when-absent shape `createRelayClient`/`defaultProbe` already establish house-wide.
  #  Windows install-path fallback (ADR-001.consequence, RESEARCH §3) composes as a SECOND
  #  `exec` call over the SAME injected closure (bare "tailscale" ENOENTs → retry the well-known
  #  path string) — no second injection seam needed, one closure serves both attempts.
  #
  # RESEARCH-GAP FLAG (verify/developer must close before a row is byte-deterministic): RESEARCH
  #  §4 states NO exact exit-code table for `tailscale status` on a logged-out/stopped daemon was
  #  confirmed (only `tailscale wait` documents 0/non-zero) — so the stage-2 rows below key off
  #  the PARSED BackendState string in the --json stdout, NOT off an exit code (the deterministic
  #  fixture surface). If a logged-out `tailscale status` exits NON-ZERO with NO parseable JSON on
  #  some OS (RESEARCH §4 flags this unmeasured), that collapses into the reason:"degraded" row —
  #  the live exit-code/stderr shapes per OS are the @manual soak (task 05) input the fixture
  #  cannot pre-know.
  #
  # RESEARCH-GAP RESOLVED (developer-amigo): ACCEPTABLE TO DEFER — no retag, no design note
  #  needed now. The stage-2 fixture rows key off the PARSED `BackendState` field (a shape
  #  RESEARCH §2 confirms is literal `ipnstate.Status` ground truth, not a paraphrase), so
  #  every `@executable` row in this feature is byte-deterministic regardless of what the real
  #  exit code turns out to be — the exit code is consulted ONLY as a coarse spawn-succeeded/
  #  failed signal (ENOENT vs "it ran"), never branched on for the reason mapping. task 05's
  #  Background already commits to recording "the literal `tailscale status` exit code +
  #  stderr in each of not-installed / logged-out / running, on each OS" — that is the correct
  #  and sufficient re-feed point; no fixture here is invalidated if the live exit code differs
  #  from 0, because none of these scenarios assert on it.

  Background:
    Given an initialised aof project whose config I control
    And config.mesh.fabric is "tailscale"
    And the fabric exec is an injected closure whose stdout, exit code, and spawn error I control
    And a representative `tailscale status --json` fixture shaped as the ipnstate.Status struct:
      """
      {
        "Version": "1.80.0",
        "BackendState": "Running",
        "Self": {
          "HostName": "umairs-msi",
          "DNSName": "umairs-msi.tail1a2b.ts.net.",
          "OS": "windows",
          "TailscaleIPs": ["100.121.112.23", "fd7a:115c:a1e0::1"],
          "Online": true
        },
        "Peer": {
          "nodekey:aaa": {
            "HostName": "umairs-mbp",
            "DNSName": "umairs-mbp.tail1a2b.ts.net.",
            "OS": "macOS",
            "TailscaleIPs": ["100.90.11.5", "fd7a:115c:a1e0::5"],
            "Online": true,
            "LastSeen": "0001-01-01T00:00:00Z"
          },
          "nodekey:bbb": {
            "HostName": "build-linux",
            "DNSName": "build-linux.tail1a2b.ts.net.",
            "OS": "linux",
            "TailscaleIPs": ["100.70.22.9"],
            "Online": false,
            "LastSeen": "2026-07-04T09:12:00Z"
          }
        }
      }
      """

  # STAGE-1/STAGE-2 REFUSAL-REASON MATRIX (ADR-001.2 / RESEARCH §4): probeFabric never crashes;
  # every degraded fabric is a { healthy:false, reason } with the RESEARCH-§4 actionable reason,
  # and a Running daemon is { healthy:true }. Stage 1 (spawn) distinguishes not-installed from
  # every state the JSON reports (stage 2). The tolerant parse turns unparseable JSON into a
  # degraded refusal, never a throw (RESEARCH §2 "format subject to change").
  Scenario Outline: probeFabric maps the spawn outcome / BackendState to a structured healthy-or-refusal shape
    Given the fabric exec is scripted to <exec_outcome>
    When I call probeFabric(config)
    Then the result's fabric is "tailscale"
    And the result's healthy is <healthy>
    And the result's reason is <reason>

    Examples:
      | exec_outcome                                              | healthy | reason                |
      | return stdout with BackendState "Running"                | true    | null                  |
      | reject with a spawn error whose code is "ENOENT"          | false   | "not-installed"       |
      | return stdout with BackendState "NeedsLogin"             | false   | "needs-login"         |
      | return stdout with BackendState "Stopped"               | false   | "stopped"             |
      | return stdout with BackendState "NeedsMachineAuth"      | false   | "needs-machine-auth"  |
      | return stdout that is not valid JSON                     | false   | "degraded"            |

  # WINDOWS INSTALL-PATH FALLBACK BEFORE CONCLUDING NOT-INSTALLED (ADR-001.consequence / RESEARCH
  # §3): a bare-`tailscale` ENOENT on Windows can mean "installed but not on PATH", so a
  # well-known install path is tried FIRST; only when THAT also ENOENTs is the reason
  # "not-installed". A fallback that resolves to a working exec yields the underlying healthy shape.
  Scenario: on Windows a bare-tailscale ENOENT retries the well-known install path before concluding not-installed
    Given the platform is windows
    And a bare `tailscale` spawn rejects with code "ENOENT"
    And the well-known install-path `tailscale.exe` returns stdout with BackendState "Running"
    When I call probeFabric(config)
    Then the fallback install-path exec was attempted before concluding
    And the result is { healthy:true, reason:null } (never "not-installed")

  # SELF-ADDRESS IS Self.TailscaleIPs[0] (ADR-001.3 / RESEARCH §1): this node's dial address is
  # the CGNAT 100.x v4 read out of Self — the same parse as a peer, different map key. A degraded
  # fabric (probe not healthy) yields no address (null), never a crash.
  Scenario: selfAddress returns this node's 100.x v4 dial address parsed from Self.TailscaleIPs
    Given the fabric exec returns the Background status fixture
    When I call selfAddress(config)
    Then the returned dialAddress is "100.121.112.23"

  Scenario: selfAddress on a degraded fabric returns null, never a crash
    Given the fabric exec rejects with a spawn error whose code is "ENOENT"
    When I call selfAddress(config)
    Then the returned dialAddress is null

  # THE PEER-MAP → resolvePeers JOIN MATRIX (ADR-002.2 / RESEARCH §2): each Peer value is parsed
  # into { nodeId, dialAddress, online, host }; dialAddress = TailscaleIPs[0]; online =
  # Peer[x].Online; host = HostName; nodeId JOINED to the aof roster by HostName then DNSName
  # (trailing dot tolerated). A peer that matches an aof nodeId joins; a peer that matches none is
  # surfaced UNJOINED (nodeId:null), never dropped, never crashed on.
  Scenario Outline: resolvePeers joins each fabric peer to an aof nodeId by HostName/DNSName, or surfaces it unjoined
    Given the synced aof roster holds node records for "umairs-mbp" and "build-linux"
    And a fabric peer with HostName "<host>", DNSName "<dnsname>", TailscaleIPs ["<ip>"], and Online <online>
    When I call resolvePeers(config)
    Then that peer resolves to { nodeId:<nodeId>, dialAddress:"<ip>", online:<online>, host:"<host>" }

    Examples:
      | host          | dnsname                          | ip           | online | nodeId          |
      | umairs-mbp    | umairs-mbp.tail1a2b.ts.net.      | 100.90.11.5  | true   | "umairs-mbp"    |
      | build-linux   | build-linux.tail1a2b.ts.net.     | 100.70.22.9  | false  | "build-linux"   |
      | stray-laptop  | stray-laptop.tail1a2b.ts.net.    | 100.55.3.1   | true   | null            |

  # DNSName-KEYED JOIN WHEN HostName ALONE DOES NOT MATCH (ADR-002.2 / RESEARCH §1): the join
  # tolerates the FQDN trailing-dot form — a peer whose HostName differs but whose DNSName's
  # leading label matches an aof nodeId still joins on the DNSName key.
  Scenario: a peer joins on its DNSName leading label when HostName alone does not match a roster nodeId
    Given the synced aof roster holds a node record for "umairs-mbp"
    And a fabric peer with HostName "MacBook-Pro" and DNSName "umairs-mbp.tail1a2b.ts.net."
    When I call resolvePeers(config)
    Then that peer resolves to nodeId "umairs-mbp" (joined on the trailing-dot-stripped DNSName label)

  # A NON-TAILSCALE FABRIC IS A CLEAN STRUCTURED REFUSAL (ADR-001.3 / 06/ADR-002 designed-not-
  # shipped): a config.mesh.fabric the build does not implement refuses with a structured reason
  # and NEVER spawns tailscale, NEVER falls back silently, NEVER crashes. probeFabric, selfAddress,
  # and resolvePeers all refuse coherently.
  Scenario Outline: a config.mesh.fabric other than "tailscale" is a clean fabric-unsupported refusal, no spawn attempted
    Given config.mesh.fabric is "<fabric>"
    When I call probeFabric(config)
    Then the result is { fabric:"<fabric>", healthy:false, reason:"fabric-unsupported" }
    And no `tailscale` exec was spawned (never a hidden tailscale fallback)

    Examples:
      | fabric      |
      | lan         |
      | cloudflared |
      | wireguard   |

  # THE UNCONFIGURED-FABRIC CASE (ADR-001.2 declaration side): config.mesh.fabric ABSENT is not a
  # crash — it is the no-fabric-declared refusal, distinct from an unsupported named fabric, so the
  # launcher/doctor can steer the operator to declare tailscale.
  Scenario: an absent config.mesh.fabric refuses cleanly as fabric-undeclared, never a crash
    Given config.mesh has no `fabric` key
    When I call probeFabric(config)
    Then the result healthy is false
    And the result reason is "fabric-undeclared"
    And no `tailscale` exec was spawned
