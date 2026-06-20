@cli @work @board @executable
Feature: An enabled session degrades to the raw provider when headroom is absent or the provider is gemini, without breaking the terminal
  In order to never have the terminal break for a plugin I opted into, and never have gemini wrapped by
  a tool that cannot front it
  the system must, when handleConnection opens a session, spawn the RAW provider binary with the raw
  provider args (NOT headroom) whenever headroom is not on PATH or the provider is gemini — emitting no
  error control-frame — while leaving the unchanged missing-PROVIDER-binary error gate firing exactly
  as it does today.

  # ADR-003 honest-degrade (branch 3) + gemini-never-routable (branch 2), observed END-TO-END through
  # the REAL handleConnection (src/terminal-ws.mjs) with a STUBBED spawn and a stubbed which. The
  # pure-resolver branch table is unit-tested by the arch-test acd-headroom-honest-degrade; THIS feature
  # proves the seam carries the degrade verdict to the real spawn AND that the degrade is kept DISTINCT
  # from the pre-existing missing-provider gate.
  #
  # The OBSERVABLE surface (the litmus): what the stubbed spawn receives (binary + args), and whether a
  # {type:"error"} control-frame is emitted. The CRUX of this feature is that two missing-binary paths
  # must not be conflated:
  #   - headroom missing  -> DEGRADE: spawn the RAW provider, NO error control-frame (terminal works).
  #   - PROVIDER missing  -> the existing gate (resolveBinaryPath() === null): an error control-frame
  #                          and NO spawn at all. This gate predates the plugin and is UNCHANGED; the
  #                          headroom degrade must never suppress it.
  # The resolver runs only AFTER the provider bin is non-null, so when the provider is missing the
  # session never reaches the resolver — the error frame fires and spawn is never called.

  Background:
    Given a work board terminal server with an injected (stubbed) spawn that records the binary and args it receives
    And an injected (stubbed) which that reports the requested binary present or absent on PATH
    And the plugin config is '{ "work": { "headroom": { "enabled": true, "providers": ["claude", "codex"] } } }'

  # Branch 3 — honest degrade: enabled + routable provider present, but headroom NOT on PATH. The
  # terminal must still launch the raw provider, with no wrap and no error.
  Scenario: enabled but headroom absent degrades to the raw provider with no error frame
    Given the provider "claude" binary resolves on PATH
    And headroom is not on PATH
    When a terminal session is opened
    Then spawn is invoked with the raw "claude" provider binary
    And spawn's args do not begin with "wrap"
    And no error control-frame is emitted

  # Branch 2 — gemini is never wrapped even with the plugin enabled and headroom present.
  Scenario: gemini is never wrapped even when headroom is on PATH
    Given the provider "gemini" binary resolves on PATH
    And headroom resolves on PATH
    When a terminal session is opened
    Then spawn is invoked with the raw "gemini" provider binary
    And spawn's args do not begin with "wrap"
    And no error control-frame is emitted

  # The unchanged provider gate — the headroom degrade must NOT swallow a genuine missing-provider
  # error. With the PROVIDER binary itself absent, the existing error control-frame still fires and
  # spawn is never called — this is NOT the headroom path.
  Scenario: a missing PROVIDER binary still fires the existing error control-frame (not the degrade path)
    Given the provider "claude" binary does not resolve on PATH
    And headroom resolves on PATH
    When a terminal session is opened
    Then an error control-frame is emitted naming the missing provider
    And spawn is never invoked

  # The decision matrix over (headroomOnPath x providerOnPath x provider), all with the plugin enabled.
  # Each row pins the observable launch: the spawn binary, whether the args carry the "wrap" prefix,
  # and whether an error control-frame fires. "spawnBin: (none)" + "errorFrame: yes" is the unchanged
  # missing-provider gate where spawn is never reached. Note the contrast on the last two rows: when the
  # provider is present, headroom-absent DEGRADES (raw, no error); when the provider is absent, the
  # genuine error fires regardless of headroom — the two missing-binary paths stay distinct.
  Scenario Outline: the enabled launch matrix routes, degrades, or errors per the missing-binary distinction
    Given the provider "<provider>" binary resolution on PATH is <providerOnPath>
    And headroom on PATH is <headroomOnPath>
    When a terminal session is opened
    Then the spawn binary is <spawnBin>
    And the spawn args carrying a leading "wrap" is <wrapArgs>
    And an error control-frame emitted is <errorFrame>

    Examples: routable provider present + headroom present -> wrapped, no error
      | provider | providerOnPath | headroomOnPath | spawnBin | wrapArgs | errorFrame |
      | claude   | present        | yes            | headroom | yes      | no         |
      | codex    | present        | yes            | headroom | yes      | no         |

    Examples: routable provider present + headroom absent -> honest degrade to raw, no error
      | provider | providerOnPath | headroomOnPath | spawnBin    | wrapArgs | errorFrame |
      | claude   | present        | no             | raw claude  | no       | no         |
      | codex    | present        | no             | raw codex   | no       | no         |

    Examples: gemini present (never routable) -> raw, no error, regardless of headroom
      | provider | providerOnPath | headroomOnPath | spawnBin    | wrapArgs | errorFrame |
      | gemini   | present        | yes            | raw gemini  | no       | no         |
      | gemini   | present        | no             | raw gemini  | no       | no         |

    Examples: provider ABSENT -> the unchanged missing-provider gate, spawn never reached
      | provider | providerOnPath | headroomOnPath | spawnBin | wrapArgs | errorFrame |
      | claude   | absent         | yes            | (none)   | no       | yes        |
      | claude   | absent         | no             | (none)   | no       | yes        |
