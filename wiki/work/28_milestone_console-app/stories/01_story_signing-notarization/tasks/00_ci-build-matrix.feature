@cli @adapter @distribution @uat
Feature: A per-OS CI runner matrix instantiates the build recipe on all three OSes and compiles the Linux node-pty from source
  In order to produce a working binary on Windows, macOS, and Linux (SEA cannot cross-compile, and node-pty ships no Linux prebuild)
  a GitHub Actions matrix runs Story 00's SEA recipe on ubuntu-latest/macos-latest/windows-latest (+ arch legs), compiles the Linux node-pty .node on the Linux runner, and emits a per-OS/arch artifact plus its sidecar,
  so that KR4's "a working node on all three OSes" has an artifact per OS to sign, and the one packaging gap (Linux node-pty) is closed in CI.

  # ARCHITECTURE ADR-001/ADR-002: SEA copies the host's node → each OS/arch artifact builds on a matching
  # runner (no cross-compile); node-pty ships prebuilds for darwin-x64/arm64 + win32-x64/arm64 but NO
  # linux-* (confirmed against node_modules/node-pty/prebuilds/), so the Linux .node is compiled from
  # source on the Linux runner. This story is FILE-DISJOINT GREENFIELD (CI YAML + build/compile scripts,
  # not in the src graph); it consumes Story 00's build recipe.
  #
  # @uat (feature default): the full three-OS matrix runs in GitHub Actions across runners this dev box
  # cannot host — the evidence is a real CI run producing the three artifacts. A build agent CAN lint the
  # workflow and (where the host OS matches a leg) dry-run a single leg; the CROSS-OS completeness is a
  # human sign-off over the CI run + the release artifacts. Scenarios that a build agent CAN run on a
  # matching host (the Linux node-pty compile) carry a scenario-level @manual override below.
  #
  # DEVELOPER-SEAT (feasibility, RESEARCH §6): arm64 SEA must build on a NATIVE/non-container runner — a
  # Linux-arm64 Docker container corrupts the ELF hash table so process.dlopen() (node-pty) breaks. Flag
  # if the CI provider lacks native arm64 runners (then arm64 needs a self-hosted/native leg).
  Background:
    Given Story 00's SEA build recipe available to CI
    And a GitHub Actions workflow with a per-OS/arch runner matrix

  # The headline: one workflow, three (or more) artifacts, each built on its own OS. This is @uat — it
  # needs all three real runners, which only a CI run provides; a human signs off the cross-OS completeness.
  Scenario: the matrix builds a self-contained artifact on each OS runner
    Given the matrix legs ubuntu-latest, macos-latest, windows-latest (+ the arch legs)
    When the release workflow runs
    Then each leg produces its OS/arch artifact + its node-pty sidecar by running Story 00's recipe on that runner
    And no leg cross-compiles another OS's artifact (SEA copies the host node)

  # NOTE (PO, validator): this scenario stays @uat (the feature default) — the work-stream validator requires
  # exactly ONE verification tag per scenario (feature ∪ scenario), so a scenario-level @manual would
  # double-tag it. The Linux node-pty compile is confirmed within the @uat cross-OS CI matrix run; the
  # glibc/toolchain-matching flag below still applies at build.
  # The Linux packaging gap closed: the Linux runner compiles node-pty from source (no prebuild exists).
  # R4: the mac/win legs use the SHIPPED prebuilt .node (+ Windows conpty/winpty companions), not a compile.
  # QA FEASIBILITY FLAG (developer-amigo): does the Linux leg need a specific glibc / node-gyp / python
  # toolchain pinned so the compiled linux-<arch>/pty.node loads on the target distros (not just the
  # builder)? Flag whether the runner's build toolchain and the target runtime's libc are matched, or the
  # .node dlopens on the runner but fails on an older-glibc user machine.
  Scenario: the Linux runner compiles the node-pty .node from source; mac/win use the shipped prebuilts
    Given node-pty ships no linux-* prebuild but ships darwin-*/win32-* prebuilds
    When the Linux leg builds
    Then it compiles a linux-<arch>/pty.node from source (a C++ toolchain on the runner)
    And the built linux .node loads under process.dlopen on that runner
    And the macOS and Windows legs ship the package's prebuilt .node (+ the Windows winpty/conpty companions)

  # arm64 native-runner constraint (RESEARCH §6). R4: pin the unaffected side — the x64 legs are
  # container-safe; only arm64 requires the native runner. Stays @uat — confirming a native arm64 runner's
  # ELF dlopens correctly needs the real arm64 CI leg, not a dev-box dry-run.
  Scenario: arm64 legs build on a native (non-container) runner so the ELF loads addons
    Given the arm64 leg
    When it builds the SEA
    Then it runs on a native/non-container arm64 runner (not a Linux-arm64 Docker container)
    And the resulting arm64 binary can process.dlopen its node-pty sidecar

  # QA: added the ARTIFACT-COMPLETENESS boundary — the matrix's whole purpose is that EVERY declared
  # OS/arch leg produces both a binary AND its matching sidecar, with no leg silently dropped. This pins
  # the set of emitted artifacts against the declared matrix legs (a missing leg = a platform a user cannot
  # install on). Stays @uat — the full emitted-artifact set is only real after a CI run.
  Scenario: every declared matrix leg emits both a binary and its matching-arch node-pty sidecar (no leg dropped)
    Given the declared matrix legs (the six OS/arch combinations the installer maps)
    When the release workflow completes
    Then each declared leg has produced exactly one binary and its matching-arch node-pty sidecar
    And no declared leg is missing from the released artifact set
