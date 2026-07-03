@cli @adapter @distribution
Feature: The installer detects OS/arch and resolves the matching signed asset plus its node-pty sidecar
  In order that one command fetches the RIGHT binary for whatever machine runs it (no manual asset picking)
  install.sh detects via `uname -sm` and install.ps1 via PROCESSOR_ARCHITECTURE + Is64BitOperatingSystem, mapping each to the release asset name and its node-pty sidecar,
  so that a user on any OS/arch gets their build, and the detection logic is verifiable over a case matrix before any real download.

  # ARCHITECTURE ADR-006: install.sh (curl|sh) + install.ps1 (irm|iex), the deno_install shape —
  # `uname -sm` → a target triple → the asset name. The node-pty sidecar is a CO-DOWNLOAD, not a second
  # product: "one binary, two modes" places ONE binary file; `relay` is a runtime subcommand. This story
  # is FILE-DISJOINT GREENFIELD (installer scripts, not in the src graph).
  #
  # @executable: the detect→asset-name MAPPING is a pure function over uname/arch strings — asserted over
  # a case matrix with no network. The actual DOWNLOAD (one scenario) is @manual (it hits the release
  # host); tagged individually below.
  #
  # DEVELOPER-SEAT (feasibility, RESEARCH §5): confirm the uname/arch → triple mapping matches EXACTLY the
  # asset names Story 01's matrix emits (the asset-naming is a soft contract with 01). Flag any OS/arch
  # the matrix ships that the detector does not map (an unmapped combo must fail loudly, not silently pick
  # a wrong asset).
  Background:
    Given install.sh with a detect() over `uname -sm` output
    And install.ps1 with a detect() over PROCESSOR_ARCHITECTURE + Is64BitOperatingSystem

  # The detection case matrix — each supported OS/arch maps to its asset name + sidecar. R4: an UNKNOWN
  # combo must FAIL LOUDLY, never silently pick a wrong asset (the unsupported scenarios below).
  #
  # QA: extended the matrix with the arch-string ALIASES real machines emit, which must map to the SAME
  # asset (the mapping is not one string per target):
  #  - `Darwin arm64` AND `Darwin aarch64` (some environments report aarch64 for Apple Silicon);
  #  - Linux `x86_64` AND `amd64` (some report amd64);
  #  - Windows `AMD64` (env var) which Is64BitOperatingSystem confirms.
  # These pin that the detector normalizes aliases, not just the deno_install canonical strings.
  @executable
  Scenario Outline: OS/arch detection maps to the matching release asset and node-pty sidecar
    Given the machine reports <detected>
    When the installer resolves the asset to download
    Then it selects the <asset> binary and its <sidecar> sidecar
    And it does not select any other OS/arch asset

    Examples: uname -sm (POSIX) and PROCESSOR_ARCHITECTURE (PowerShell) → asset
      | detected              | asset                  | sidecar               |
      | Darwin arm64          | aof-macos-arm64        | node-pty darwin-arm64 |
      | Darwin aarch64        | aof-macos-arm64        | node-pty darwin-arm64 |
      | Darwin x86_64         | aof-macos-x64          | node-pty darwin-x64   |
      | Linux x86_64          | aof-linux-x64          | node-pty linux-x64    |
      | Linux amd64           | aof-linux-x64          | node-pty linux-x64    |
      | Linux aarch64         | aof-linux-arm64        | node-pty linux-arm64  |
      | Windows AMD64         | aof-windows-x64.exe    | node-pty win32-x64    |
      | Windows ARM64         | aof-windows-arm64.exe  | node-pty win32-arm64  |

  # QA: added a WOW64 boundary — a 32-bit PowerShell host on 64-bit Windows reports PROCESSOR_ARCHITECTURE
  # = x86 while PROCESSOR_ARCHITEW6432 = AMD64; the installer must trust Is64BitOperatingSystem (ADR-006)
  # and resolve the 64-bit asset, NOT the (nonexistent) x86 asset. This is the exact reason ADR-006 pairs
  # PROCESSOR_ARCHITECTURE WITH Is64BitOperatingSystem rather than reading the arch var alone.
  # QA FEASIBILITY FLAG (developer-amigo): confirm install.ps1 reads Is64BitOperatingSystem (or
  # PROCESSOR_ARCHITEW6432) and does not naively branch on PROCESSOR_ARCHITECTURE alone — otherwise a
  # 32-bit host process mis-detects a 64-bit OS as x86.
  @executable
  Scenario: a 32-bit PowerShell host on a 64-bit Windows OS resolves the 64-bit asset (WOW64 not mis-detected)
    Given the machine reports PROCESSOR_ARCHITECTURE x86 but Is64BitOperatingSystem is true (a 32-bit host on 64-bit Windows)
    When install.ps1 resolves the asset to download
    Then it selects the aof-windows-x64.exe binary (trusting Is64BitOperatingSystem, not the x86 host arch)
    And it does not select an x86 asset (none is shipped)

  # QA: extended the unsupported cases into a matrix — the loud-fail must fire for EVERY combo the release
  # does not ship, each a real machine class: a 32-bit x86 Windows/Linux (no 32-bit build), 32-bit ARM
  # (armv7l — Raspberry-Pi-class, no build), an unshipped OS (FreeBSD), and an unparseable uname. R4: pin
  # the loud-fail — every unsupported combo exits with a clear error and downloads NOTHING (never a wrong
  # asset). This is the boundary the whole "one command, right binary" claim rests on.
  @executable
  Scenario Outline: an unsupported OS/arch fails loudly rather than downloading a wrong asset
    Given the machine reports <detected>
    When the installer resolves the asset to download
    Then it exits with a clear "unsupported platform" error naming the detected OS/arch
    And it downloads nothing

    Examples: unsupported / unshippable combinations
      | detected           |
      | Linux i686         |
      | Linux armv7l       |
      | Windows x86        |
      | FreeBSD amd64      |
      | Linux ppc64le      |
      | an unparseable uname string |

  @manual
  # The real co-download — binary + sidecar together — needs the release host, so @manual.
  # QA: added the PARTIAL-DOWNLOAD cleanup half (binary fetched, sidecar fetch fails) — the abort must not
  # leave a binary without its sidecar in a state a later step could treat as installed. R4: pin the
  # unaffected side — a failed co-download leaves NO half-installed tree.
  Scenario: the installer downloads the resolved binary AND its sidecar together, cleaning up a partial fetch
    Given a resolved asset + sidecar for this machine
    When the installer downloads them from the pinned release host
    Then both the binary and its node-pty sidecar are fetched (a co-download, not a second product)
    And if either download fails, the installer aborts and leaves no half-installed tree (no binary without its sidecar)
