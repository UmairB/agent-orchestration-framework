@cli @work @distribution @manual @bug @finding-F-3204
Feature: the outsider-verifiable success lane — a fresh operator stands up a ≥2-node cross-OS fleet (Windows + macOS [+ Linux]) over a LIVE Tailscale tailnet, runs the launcher on each, and sees every node + assigns and runs work end-to-end, with NO hand-derived URLs, NO tunnels, NO device-code dance, and NO shared/inherited node identity
  In order to prove the fabric-native model on the REAL mesh-VPN fabric the fixtured lanes cannot reach (SPEC §Objective; the UAT 32 · F-2701 breadth)
  a fresh operator stands up a cross-OS fleet over Tailscale, runs the launcher daemon on each node, and drives "issue anywhere, run anywhere, watch from one place" end-to-end,
  so that this VERIFICATION-time observation re-feeds the UAT 32 re-run (aof:verify 32) with the reachability/identity findings F-3201/F-3202/F-3203/F-3204 actually closed on live hardware.

  # ARCHITECTURE ADR-001 (the live-tailnet parse is the @manual soak) + ADR-002 (the fabric IS the
  # discovery+liveness plane, on real hardware) + ADR-003 (the launcher, running as a real
  # foreground daemon) + RESEARCH's explicitly-@manual gaps.
  #
  # @manual BECAUSE — this lane is NOT fixtured (it is the counterpart to the @executable
  # 00–04 fixtured lanes) and CANNOT be a CI assert:
  #  - RESEARCH §2/§3/§4/§5 flag every load-bearing Tailscale behaviour as vendor-doc /
  #    community-observed, NOT measured on a live tailnet in this pass — this lane is where they
  #    are MEASURED: the `Online`-transition cadence (§2), the literal not-installed vs
  #    not-logged-in CLI exit code + stderr per OS (§4), the Windows PATH / install-path-folder
  #    reality (§3), the macOS App-Store-vs-Standalone CLI split on a real install (§3), and a
  #    real shields-up/ACL dial-refusal being distinguished from offline (§5).
  #  - It requires real Windows + macOS [+ Linux] boxes on a shared tailnet — no injected fabric
  #    exec, no fixture JSON; the real `tailscale` binary, the real control plane maintaining
  #    Online, real NAT traversal.
  #
  # SEAM SPLIT / RE-FEED: this is a VERIFICATION-time OBSERVATION (recorded as a signed-off @uat
  #  narrative in VERIFICATION.md, not a CI assert). Its outcome is the input that re-feeds
  #  aof:verify 32 — the same F-320x findings, re-checked on live hardware. The @executable 00–04
  #  lanes prove the SEAM logic over fixtures; THIS lane proves the seam holds against the real
  #  fabric the fixtures stand in for.
  #
  # RESEARCH-GAP NOTES the operator MUST RECORD (the facts the fixtured lanes could not pin — feed
  #  each back to the developer/verify + the RESEARCH doc):
  #  - the literal `tailscale status` exit code + stderr in each of not-installed / logged-out /
  #    running, on each OS (RESEARCH §4 — unmeasured);
  #  - the real Windows install-path folder name in use (`C:\Program Files\Tailscale\` vs
  #    `...\Tailscale IPN\`) and whether a bare `tailscale` resolves off PATH (RESEARCH §3);
  #  - whether a macOS box on the App-Store build actually degrades CLI/daemon reach as §3 warns,
  #    and the observable symptom the task-04 warn should key on;
  #  - the observed Online-transition latency after a node drops (RESEARCH §2 — the liveness lag
  #    task 03's periodic re-read cannot bound from a fixture).

  Background:
    Given a fresh operator with NO prior aof mesh state
    And real Windows and macOS [+ Linux] machines, each on the SAME Tailscale tailnet
    And each machine has the tailscale CLI installed and `tailscale status` shows BackendState "Running"
    And a shared git remote the fleet's .mesh/ records sync to

  # THE OUTSIDER-VERIFIABLE END-TO-END (SPEC §Objective / F-2701 breadth): the whole model, on live
  # hardware — stand up, discover, issue, run, watch — with none of the retired machinery.
  Scenario: a fresh operator stands up a cross-OS fleet and drives work end-to-end over the live fabric with no retired machinery
    Given each node derives its OWN per-install nodeId from its OWN hostname (no shared/inherited identity — F-3203)
    When the operator runs the launcher's --serve daemon on each node
    Then each node's preflight resolves + prints its own tailscale self-address and the same-tailnet guidance
    And each node publishes its git presence record and runs the sync loop with NO listening broker socket
    And from any one node `mesh:status` shows EVERY node in the fleet with its live fabric liveness
    When the operator issues a work item from one node targeted at another (`aof mesh issue`)
    And an eligible node picks it up and runs it to completion
    Then the run is visible fleet-wide from the watching node
    And the whole flow used NO hand-derived ws:// URL, NO tunnel, NO device-code enrollment, and NO shared node identity

  # THE Online-≠-DIALABLE GROUND TRUTH ON REAL HARDWARE (ADR-002.3 / RESEARCH §5): a real
  # shields-up peer is Online in the peer map yet a dial is refused — the operator observes the
  # HANDLED "unreachable (check shields-up/ACL)" distinction (never a crash), confirming the
  # task-01 fixtured branch against the real silent failure mode.
  Scenario: a real shields-up peer is Online but a dial is refused, and the fleet handles it as unreachable not offline
    Given one peer is on the tailnet with `--shields-up` set (Online per the peer map, inbound refused)
    When another node resolves that peer's reachability and attempts a dial
    Then the peer shows as Online in `tailscale status --json`
    And the dial is refused
    And the fleet surfaces it as "unreachable (check shields-up/ACL)", DISTINCT from an offline peer, with no crash

  # THE macOS App-Store-CLI-SPLIT ON A REAL INSTALL (ADR-001.4 / RESEARCH §3): the operator
  # confirms whether a real macOS App-Store build degrades CLI/daemon reach as §3 warns, and records
  # the observable symptom the task-04 warn keys on — the fact the fixtured lane injected.
  Scenario: the macOS App-Store vs Standalone CLI split is confirmed on a real macOS node
    Given a macOS node running the App-Store Tailscale build
    When the launcher preflight runs on that node
    Then the operator records whether the CLI can reach the daemon (the App-Store-sandbox symptom, RESEARCH §3)
    And whether the task-04 App-Store-split warning fired and steered to the Standalone/open-source build
    And the observed CLI failure shape (exit code + stderr) is recorded to close the RESEARCH §3/§4 gap
