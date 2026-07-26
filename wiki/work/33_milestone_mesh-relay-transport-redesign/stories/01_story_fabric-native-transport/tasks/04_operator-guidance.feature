@cli @work @distribution @executable @bug @finding-F-3202
Feature: per-fabric operator guidance sourced from mesh-fabric.mjs — a healthy tailscale preflight prints the self-address + the same-tailnet/Online/shields-up guidance; a degraded probe prints the matching RESEARCH §4 remediation; the macOS App-Store-CLI-split preflight warns and steers to the Standalone/open-source build
  In order to guide a fresh operator standing up a node instead of leaving them to hand-derive URLs and stand up Tailscale unguided (F-3202; ADR-003.4 / ADR-001.4)
  the launcher preflight (and work doctor), sourced from mesh-fabric.mjs, prints for a healthy tailscale the resolved self-address + "both nodes must be on the same tailnet; ensure `tailscale status` shows the peer Online; if a dial is refused, check `--shields-up`/ACLs"; a degraded probe prints the matching RESEARCH §4 remediation (ENOENT ⇒ "install Tailscale"; NeedsLogin ⇒ "run `tailscale up`"; Stopped ⇒ "the daemon isn't running"; NeedsMachineAuth ⇒ "waiting on tailnet admin approval"); and the macOS App-Store-CLI-split preflight warns, on macOS, when the CLI cannot reach the daemon, steering to the Standalone / open-source tailscaled build,
  so that guidance is surfaced by work doctor + the launcher and is install-guidance, NEVER a runtime auto-fix (ADR-001.consequence — the transport can only report "the fabric CLI failed, here is why").

  # ARCHITECTURE ADR-003.4 (per-fabric operator guidance emitted by the preflight, sourced from
  # mesh-fabric.mjs) + ADR-001.4 (the macOS App-Store risk is a doctor/launcher preflight) +
  # RESEARCH §3/§4/§5:
  #   1. HEALTHY-TAILSCALE GUIDANCE (ADR-003.4 / RESEARCH §5): a healthy preflight resolves +
  #      prints the self-address AND the reachability guidance — same tailnet, peer Online,
  #      shields-up/ACL if a dial is refused (RESEARCH §5's silent failure modes named for the
  #      operator, since they cannot be pre-read from status --json).
  #   2. PER-BackendState REMEDIATION MATRIX (ADR-001.2 / RESEARCH §4): each degraded reason
  #      (task 00's probeFabric reason) maps to ONE actionable remediation message.
  #   3. THE macOS App-Store-CLI-SPLIT WARN (ADR-001.4 / RESEARCH §3): on macOS, when the CLI
  #      cannot reach the daemon (the App-Store-sandbox symptom), the preflight WARNS and steers to
  #      the Standalone / open-source tailscaled build — install-guidance, never a runtime auto-fix.
  #      On non-macOS this warn is not emitted (it is macOS-specific, RESEARCH §3).
  #   4. Guidance is emitted by BOTH the launcher preflight (task 03) and work doctor (ADR-001.4);
  #      it NEVER auto-fixes (ADR-001.consequence) — the transport reports "the CLI failed, here is
  #      why", the operator acts.
  #
  # SEAM SPLIT: the guidance TEXT is sourced from mesh-fabric.mjs (the ONE fabric-assumption site,
  #  acd-fabric-single-seam); THIS feature asserts the OBSERVABLE message per fabric state, not the
  #  source-discipline (that is the fitness function). The probe reason → message mapping is the
  #  behavioural face of task 00's refusal-reason matrix, surfaced to the operator.
  #
  # QA FEASIBILITY FLAG (developer-amigo): rows stay @executable ONLY if:
  #  (a) the guidance is a PURE projection of the probeFabric result (reason → message) — a pure
  #      formatter over the { healthy, reason } shape, driven by the injected fabric exec (task 00),
  #      so every remediation row is reachable with no tailnet;
  #  (b) the macOS-App-Store warn branches on an INJECTED platform + an injected "CLI-cannot-reach-
  #      daemon" signal (the mesh:heartbeat/mesh:status input.now injected-input precedent) — the
  #      developer confirms the preflight takes an injected platform value (not a bare
  #      process.platform read) so the macOS row is exercisable on any CI OS. This is the SAME
  #      class of injection task 03 flagged for the ticker/fabric-exec.
  # RAISED — the developer confirms the guidance formatter is pure over the probe result AND the
  # macOS branch reads an injected platform (mirroring the injected `now`), so the App-Store-split
  # row is @executable rather than macOS-CI-only. See VERIFICATION.
  #
  # RESOLVED (developer-amigo): both sub-flags CONFIRMED — @executable stands unchanged.
  #  (a) A PURE FORMATTER OVER { healthy, reason } — YES, straightforward: the reason → message
  #      matrix (task 00's refusal-reason vocabulary: "not-installed" / "needs-login" /
  #      "stopped" / "needs-machine-auth" / "degraded" / "fabric-unsupported" /
  #      "fabric-undeclared") is a plain object/switch lookup over the STRING `reason` task 00's
  #      `probeFabric` already returns as a structured value — no fs, no clock, no process
  #      access needed to select a message. Driven end-to-end over the task-00 injected fabric
  #      exec closure exactly as this feature's Background states.
  #  (b) AN INJECTED PLATFORM VALUE, NOT A BARE process.platform READ — YES, and this is NOT a
  #      novel ask: the injected-platform-defaulting-to-process.platform idiom is ALREADY
  #      house-wide precedent, confirmed at FOUR existing call sites, not one:
  #        - `src/paths.mjs:4` — `defaultDataDir(env = process.env, platform = process.platform,
  #          homedir = os.homedir())`;
  #        - `src/paths.mjs:18` — `defaultGlobalWorkspaceDir(env = process.env, platform =
  #          process.platform, homedir = os.homedir())`;
  #        - `src/tool-store.mjs:47` — `exeDirFor(versionDir, platform = process.platform)` and
  #          `:54` `exeNameFor(binary, platform = process.platform)`;
  #        - `src/config-inspect.mjs:597` — `toolPlatformCheckFor(descriptor, platform =
  #          process.platform)`, consumed by `:639-643`'s `toolPlatformChecks(options = {})`:
  #          `const platform = options.platform ?? process.platform;` — the EXACT
  #          options-bag-overrides-process.platform shape a `work doctor` check already uses
  #          TODAY for a DIFFERENT platform-conditional warning (managed-tool platform support),
  #          proving this class of check is already unit-tested per-platform on any CI OS.
  #      `mesh-fabric.mjs`'s guidance formatter (and the launcher/doctor preflight callers)
  #      compose the IDENTICAL shape: `platform = process.platform` as a defaulted parameter,
  #      overridable by the caller/test — so the macOS-App-Store-split Scenario Outline
  #      (`platform: "darwin"` vs `"win32"`/`"linux"`) runs on ANY CI OS with zero skip/guard,
  #      exactly like `toolPlatformChecks` already does for its own platform matrix today.
  #  This is the SAME class of injection task 03 confirmed for the ticker/fabric-exec (the flag's
  #  own framing) — no new precedent needed, an established one generalizes cleanly.
  #
  # RESEARCH-GAP FLAG: RESEARCH §3 states the macOS "CLI cannot reach the daemon" symptom is
  #  community-reported, NOT independently measured, and the EXACT CLI failure shape (exit code /
  #  stderr) that distinguishes App-Store-sandbox-degraded from genuinely-not-installed on macOS is
  #  unconfirmed (RESEARCH §3/§4). So this feature asserts the WARN fires on the injected
  #  "CLI-unreachable-on-macOS" signal; the real signal that raises that flag on a live App-Store
  #  install is task 05's @manual observation to record. Likewise RESEARCH §3 notes the Windows
  #  install-path folder name has varied across releases (`C:\Program Files\Tailscale\` vs
  #  `...\Tailscale IPN\`) — the exact fallback path list is a developer/verify detail to confirm
  #  against a real Windows install (task 05).
  #
  # RESEARCH-GAP RESOLVED (developer-amigo): ACCEPTABLE TO DEFER — no retag; ONE design note for
  #  the build (not a re-litigation, an implementation-time clarification):
  #   - the macOS symptom: the feature fixtures the WARN off an injected "CLI-unreachable"
  #     SIGNAL (a boolean/reason the harness sets), never off a literal exit-code/stderr string —
  #     so this row stays byte-deterministic regardless of what the real macOS App-Store CLI
  #     failure shape turns out to be. Task 05's Background already commits to recording it live.
  #   - the Windows install-path variance: DESIGN NOTE for task 00's build — the fallback should
  #     try BOTH documented folder names (`C:\Program Files\Tailscale\tailscale.exe` AND
  #     `C:\Program Files\Tailscale IPN\tailscale.exe`) in sequence before concluding
  #     "not-installed", since RESEARCH §3 confirms both are current vendor/community-cited
  #     paths and the cost of trying both is one extra ENOENT-tolerant spawn attempt. This is a
  #     concrete, cheap implementation detail — not a reason to retag or block the task.

  Background:
    Given an initialised aof project whose config I control
    And config.mesh.fabric is "tailscale"
    And the fabric exec is an injected closure whose probe outcome I control
    And the preflight reads an injected platform value

  # HEALTHY-TAILSCALE GUIDANCE (ADR-003.4 / RESEARCH §5): a healthy preflight prints the resolved
  # self-address AND the same-tailnet / peer-Online / shields-up-or-ACL reachability guidance —
  # naming the silent failure modes that cannot be pre-read from status --json.
  Scenario: a healthy tailscale preflight prints the resolved self-address and the reachability guidance
    Given the fabric exec returns a healthy status with Self.TailscaleIPs[0] "100.121.112.23"
    When the launcher preflight runs
    Then the guidance includes the resolved self-address "100.121.112.23"
    And the guidance states both nodes must be on the same tailnet
    And the guidance states to ensure `tailscale status` shows the peer Online
    And the guidance states that if a dial is refused, check `--shields-up`/ACLs

  # PER-BackendState REMEDIATION MATRIX (ADR-001.2 / RESEARCH §4): each degraded reason maps to ONE
  # actionable remediation message — the behavioural face of task 00's refusal-reason matrix.
  Scenario Outline: a degraded probe prints the RESEARCH §4 remediation matching its reason
    Given the fabric exec is scripted so probeFabric returns { healthy:false, reason:"<reason>" }
    When the launcher preflight runs
    Then the printed guidance is the remediation "<remediation>"

    Examples:
      | reason              | remediation                                        |
      | not-installed       | install Tailscale                                  |
      | needs-login         | run `tailscale up`                                 |
      | stopped             | the tailscale daemon isn't running                 |
      | needs-machine-auth  | waiting on tailnet admin approval                  |
      | degraded            | the fabric probe could not be parsed — check tailscale |
      | fabric-unsupported  | this build targets tailscale — that fabric is not yet supported |
      | fabric-undeclared   | declare config.mesh.fabric = "tailscale" to enable the mesh |

  # THE macOS App-Store-CLI-SPLIT WARN (ADR-001.4 / RESEARCH §3): on macOS, when the CLI cannot
  # reach the daemon (the App-Store-sandbox symptom), the preflight WARNS and steers to the
  # Standalone / open-source tailscaled build. It is install-guidance, NEVER a runtime auto-fix.
  Scenario: on macOS, when the CLI cannot reach the daemon, the preflight warns and steers to the Standalone/open-source build
    Given the injected platform is "darwin"
    And the fabric exec signals the CLI cannot reach the daemon (the App-Store-sandbox symptom)
    When the launcher preflight runs
    Then a warning is emitted about the macOS App-Store CLI split
    And it steers the operator to the Standalone or open-source tailscaled build
    And it does NOT attempt a runtime auto-fix (install-guidance only)

  # THE macOS WARN IS macOS-SPECIFIC (RESEARCH §3): the App-Store-split warn is not emitted on a
  # non-macOS platform even on an equivalent CLI-unreachable signal — the sandbox variant is a
  # macOS-only concern.
  Scenario Outline: the macOS App-Store-split warn is not emitted on a non-macOS platform
    Given the injected platform is "<platform>"
    And the fabric exec signals the CLI cannot reach the daemon
    When the launcher preflight runs
    Then no macOS App-Store CLI-split warning is emitted
    And the failure is reported through the ordinary degraded-fabric remediation instead

    Examples:
      | platform |
      | win32    |
      | linux    |

  # GUIDANCE IS SURFACED BY BOTH work doctor AND THE LAUNCHER, AND NEVER AUTO-FIXES (ADR-001.4 /
  # ADR-001.consequence): the same probeFabric-sourced guidance appears in work doctor, and no
  # surface ever mutates the fabric — the transport can only report why the CLI failed.
  Scenario: work doctor surfaces the same per-fabric guidance and never runtime-auto-fixes
    Given the fabric exec is scripted so probeFabric returns { healthy:false, reason:"needs-login" }
    When work doctor runs its fabric preflight check
    Then work doctor reports the same remediation "run `tailscale up`" as the launcher
    And work doctor performs NO runtime auto-fix (it reports, it never runs `tailscale up` itself)
