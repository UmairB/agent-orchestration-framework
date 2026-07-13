@executable @ui @distribution @adapter
Feature: The supervisor resolves the sibling aof binary by an absolute co-located path and spawns it shell-less, never a bare-PATH lookup
  In order that a hijacked or shadowing aof.exe earlier on PATH can never be executed in the real binary's place,
  the Rust supervisor resolves the aof it spawns by an ABSOLUTE path to its sibling in its own install dir
  ($HOME/.aof/bin), never a bare-PATH `aof` lookup, spawns it as shell-less argv (never a cmd/sh/powershell
  string), and — on a dev/unpackaged run with no co-located binary — falls back per the mesh-fabric
  PATH-then-pinned precedent rather than crashing.

  # ARCHITECTURE 36/ADR-004 d4 (trusted co-located spawn — the spawn-hijack control, stronger than the fabric
  # precedent). Both binaries install together into $HOME/.aof/bin (36/ADR-003), so the sibling path is
  # unambiguous — an absolute sibling resolution removes even the PATH-order ambiguity aof's own tailscale
  # spawn (PATH-first-then-pinned-fallback, mesh-fabric.mjs:61-113) can't fully avoid. Spawns are shell-less
  # argv (never `cmd /c` / a shell string — the injection surface). The dev/unpackaged fallback mirrors the
  # mesh-fabric PATH-first-then-pinned idiom (RESEARCH §4). "no `Command::new("aof")` bare-PATH spawn, no
  # `Command::new("cmd"/"sh"/"powershell")` shell-string spawn" is the STRUCTURAL invariant → the fitness
  # acd-desktop-trusted-spawn (test/arch/), NOT a step — THIS feature asserts the observable resolution
  # BEHAVIOUR: which path is chosen, in which order, and that the spawn form carries no shell.
  #
  # RESOLVED (developer-amigo): proposed `@executable` via `cargo test` over the resolver as a pure function —
  # a fake home dir (a temp $HOME with .aof/bin/aof.exe present, or absent) fed to the resolver, asserting the
  # returned absolute path and the argv (program + args, no shell wrapper) WITHOUT spawning a real process
  # (the spawn call itself is the trusted-spawn fitness's surface). Confirm the `cargo test` lane + the injected
  # home/env seam next, mirroring m35's `@executable` Rust-logic features.

  Background:
    Given a Rust supervisor whose own executable lives in an install dir
    And the install dir is the per-user aof bin dir "$HOME/.aof/bin"

  # CO-LOCATED ABSOLUTE RESOLUTION (ADR-004 d4): the packaged happy path — resolve the sibling by an absolute
  # path in the supervisor's OWN install dir, with no PATH search at all.
  Scenario: the packaged supervisor resolves aof by an absolute path to its co-located sibling
    Given a co-located "aof.exe" sits beside the supervisor in "$HOME/.aof/bin"
    When the supervisor resolves the aof binary to spawn
    Then the resolved path is the absolute path "$HOME/.aof/bin/aof.exe"
    And the resolution performs no PATH search
    And the resolved path points inside the supervisor's own install dir

  # NEVER A BARE-PATH LOOKUP (ADR-004 d4 / RESEARCH §4): resolution never hands a bare "aof" to the OS to
  # resolve off PATH — the exact hijack vector an earlier malicious aof.exe on PATH would exploit.
  Scenario: resolution never spawns a bare-PATH "aof" that an earlier PATH entry could hijack
    Given a co-located "aof.exe" sits beside the supervisor in "$HOME/.aof/bin"
    And an unrelated "aof.exe" sits earlier on the PATH
    When the supervisor resolves the aof binary to spawn
    Then the resolved program is the absolute co-located path, not the bare name "aof"
    And the earlier PATH "aof.exe" is not the resolved target

  # SHELL-LESS ARGV (ADR-004 d4): the spawn is program + argument vector, never a shell command string — no
  # `cmd /c` / `sh -c` / `powershell` wrapper, closing the shell-metacharacter injection surface.
  Scenario: the spawn is a shell-less argv, never routed through a shell interpreter
    Given the resolved absolute aof path
    When the supervisor forms the spawn for "mesh status --json"
    Then the spawn program is the resolved absolute aof path
    And the arguments are the argv vector "mesh", "status", "--json"
    And the spawn is not wrapped in a "cmd" / "sh" / "powershell" shell string

  # THE DEV/UNPACKAGED FALLBACK (RESEARCH §4 / ADR-004 d4): when no co-located binary exists (a dev run), the
  # resolver falls back to the mesh-fabric PATH-first-then-pinned precedent — it degrades, it does not crash;
  # and even the fallback path stays shell-less.
  Scenario Outline: resolution chooses the co-located sibling first and the PATH fallback only when no sibling exists
    Given the install dir <sibling> a co-located "aof.exe"
    When the supervisor resolves the aof binary to spawn
    Then the resolution mode is "<mode>"
    And the resolution does not crash
    And whichever program is chosen, the spawn carries no shell string

    Examples:
      | sibling      | mode                                    |
      | contains     | co-located absolute path                |
      | omits        | PATH-then-pinned fallback (dev run)     |
