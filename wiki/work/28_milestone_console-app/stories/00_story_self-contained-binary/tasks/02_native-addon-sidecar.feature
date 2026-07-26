@cli @adapter @distribution @executable
Feature: node-pty loads from an on-disk sidecar under a SEA and degrades cleanly when the sidecar is absent — never crashing the node or the relay
  In order to ship a native addon a SEA blob cannot embed WITHOUT letting a missing/unloadable addon take down the whole binary
  defaultSpawn resolves node-pty via createRequire(process.execPath) under a SEA (the current dynamic import in dev), and a load/spawn failure is caught and surfaced as a {type:'error'} frame,
  so that a PTY session works where the sidecar loads, degrades to an error frame where it does not, and node/relay run regardless (the low-blast-radius property).

  # ARCHITECTURE ADR-002: node-pty ships as an on-disk sidecar .node beside the binary (never embedded —
  # its own loader does a relative require a SEA blob can't satisfy). Under a SEA, defaultSpawn's
  # `await import("node-pty")` (which THROWS for an FS module in a raw SEA main) becomes
  # createRequire(process.execPath)("node-pty"), resolved against the sidecar dir anchored at
  # process.execPath (the same packaged base as ADR-003). The load stays INSIDE defaultSpawn — never a
  # top-level import — so importing terminal-ws.mjs never needs the addon. The graceful-degrade guard
  # (23/ADR-003 / 03/ADR-003 — a spawn/load failure yields {type:'error'}) becomes a LOAD-BEARING
  # packaging invariant: a missing/unloadable sidecar degrades ONLY the terminal dock, never crashes.
  #
  # The SOURCE invariant "no module top-level-imports node-pty / a .node" is the acd-native-addon-degrades
  # ARCH-TEST (fitness #3) — NOT a scenario here. This feature asserts the OBSERVABLE degrade + the
  # re-home branch selection, IN-PROCESS: terminal-ws already injects its spawn (the m03 pattern), so a
  # stub loader models "sidecar present", "sidecar missing", and "sidecar load throws" without a built
  # binary. The real PTY over a real sidecar rides the @manual build-smoke (01_sea-build-recipe).
  #
  # DEVELOPER-SEAT (feasibility): the injectable loader seam must let the test choose the load outcome
  # (resolves / ENOENT / throws) AND assert which resolver was chosen (import vs createRequire) off the
  # SEA sentinel. Confirm the existing terminal-ws error-frame path (RESEARCH §2: :166-175) already
  # catches an import/require failure, not only a post-spawn failure — flag if the catch must widen to
  # cover the load itself.
  Background:
    Given terminal-ws.mjs with an injectable node-pty loader and the SEA sentinel from src/asset-base.mjs
    And a wired ws session that surfaces failures as {type:'error'} control-frames (23/ADR-003)

  # Re-home branch selection: under a SEA the loader is createRequire(process.execPath), in dev it is the
  # dynamic import — the SAME defaultSpawn, chosen off the sentinel. R4: pin the unaffected side — the
  # dev branch is the current `await import("node-pty")`, unchanged.
  Scenario Outline: defaultSpawn chooses the sidecar require under a SEA and the dynamic import in dev
    Given the "in a SEA?" sentinel reports <environment>
    When defaultSpawn resolves node-pty
    Then it loads via <loader>
    And the load stays inside defaultSpawn (no top-level node-pty import)

    Examples:
      | environment | loader                              |
      | IN a SEA    | createRequire(process.execPath)     |
      | NOT in a SEA| the dynamic import("node-pty")      |

  # The load-bearing degrade: whatever the failure mode, the session gets an error frame and the process
  # survives. R4: pin the unaffected side HARD — node mode and relay mode are untouched by a PTY load
  # failure (the failure is scoped to the terminal dock).
  #
  # QA: extended the failure-mode matrix with the real degrade classes ADR-002 / RESEARCH §1-2 name:
  #  - the raw-SEA FS-import() throw — the SPECIFIC bug ADR-002 fixes (`await import("node-pty")` throws
  #    for an FS module inside a raw SEA main); if the createRequire re-home is missed, THIS is how it
  #    surfaces, so it must degrade to a frame, not an uncaught throw at load;
  #  - a WRONG-ARCH / abi-mismatched .node (dlopen fails on an x64 .node under an arm64 binary — a real
  #    cross-arch install error, RESEARCH §6);
  #  - a MISSING WINDOWS COMPANION (pty.node present but winpty.dll / conpty absent — the sidecar is a
  #    DIRECTORY on Windows, RESEARCH §2, so a partial sidecar is a distinct failure from a missing .node).
  # QA FEASIBILITY FLAG (developer-amigo): does the existing catch (RESEARCH §2 :166-175) wrap the LOAD
  # (createRequire/import) itself, or only the post-load spawn? The raw-SEA-import-throws and
  # load-throws rows require the catch to cover the load call — flag if the try/catch must widen to
  # enclose the loader invocation, not just the spawn.
  Scenario Outline: a sidecar that is missing or unloadable degrades to an error frame — the node and relay never crash
    Given the injected node-pty loader is configured to <failure>
    When a terminal session attempts to start
    Then the session receives a {type:'error'} control-frame (not a throw)
    And the process does not crash
    And a subsequent node-mode command and a relay-mode probe both still run

    Examples: the addon failure modes
      | failure                                                          |
      | the sidecar .node is missing (ENOENT)                            |
      | the sidecar .node fails to load (throws on require)              |
      | a raw-SEA FS import() of node-pty throws (the createRequire re-home is the fix) |
      | the sidecar .node is the wrong arch / abi (dlopen fails)         |
      | a Windows companion is missing (pty.node present, winpty.dll/conpty absent) |
      | the spawn itself fails after a successful load                   |

  # The happy path stays intact: with the sidecar present the PTY spawns as today (no regression from
  # the re-home). R4: the dev path is unchanged.
  Scenario: with the sidecar present the PTY session spawns normally (no regression from the re-home)
    Given the injected node-pty loader resolves the addon successfully
    When a terminal session starts
    Then the PTY spawns and streams as it does today
    And no error control-frame is emitted

  # QA: added the STARTUP-INDEPENDENCE assertion — ADR-002/fitness #3 rest on "importing terminal-ws.mjs
  # never needs the addon", so a binary with NO sidecar at all must still boot node mode and relay mode.
  # This is the packaging invariant made observable in-process (fitness #3 asserts it structurally; this
  # asserts the behaviour): the addon's absence is invisible until a terminal session is actually started.
  # R4: pin the unaffected side — node/relay start with zero reference to the missing addon.
  Scenario: a binary whose sidecar is entirely absent still boots node mode and relay mode (the addon is not a startup dependency)
    Given no node-pty sidecar is present at all
    When node mode and relay mode start up
    Then both start successfully without ever loading node-pty
    And node-pty is loaded only if and when a terminal session is started
