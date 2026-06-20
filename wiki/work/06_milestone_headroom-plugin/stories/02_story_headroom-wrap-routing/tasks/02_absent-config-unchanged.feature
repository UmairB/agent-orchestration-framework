@cli @work @board @executable
Feature: With no headroom config (or the plugin disabled) the terminal launch is byte-for-byte today's behaviour
  In order to be certain the plugin is invisible until I opt in
  the system must, when handleConnection opens a session with no work.headroom block — or with
  work.headroom.enabled:false — spawn the RAW provider binary with the raw provider args (never a wrap),
  even when headroom happens to be installed on PATH, leaving the spawn exactly as it is today.

  # ADR-001 (absent ≡ off; enabled:false ≡ off) and ADR-003 branch 1, observed END-TO-END through the
  # REAL handleConnection (src/terminal-ws.mjs) with a STUBBED spawn and a stubbed which. The
  # pure-resolver "branch 1 returns raw unchanged" case is unit-tested by the arch-test
  # acd-headroom-honest-degrade; THIS feature proves the seam, plugin-off, spawns the raw launch the
  # board does today.
  #
  # The OBSERVABLE surface (the litmus): what the stubbed spawn receives. The load-bearing twist is that
  # headroom is PRESENT on PATH in these scenarios — proving the plugin being off (not headroom being
  # absent) is what produces the raw launch. We pin: (a) the spawn binary is the raw provider, (b) the
  # spawn args carry no "wrap" prefix, and (c) the plugin adds nothing to the spawn — the binary and
  # args are exactly what a session resolves with no plugin in play. The cwd/env CONTENTS are the
  # provider seam's concern (terminal-providers.mjs / the existing m03 contract), not the plugin's; the
  # only plugin claim here is that an off plugin contributes NOTHING to them.

  Background:
    Given a work board terminal server with an injected (stubbed) spawn that records the binary and args it receives
    And an injected (stubbed) which that reports the requested binary present or absent on PATH
    And the provider "claude" binary resolves on PATH
    And headroom resolves on PATH

  # No work.headroom block at all — even with headroom installed, the launch is the raw provider.
  Scenario: no work.headroom config spawns the raw provider even when headroom is on PATH
    Given the plugin config has no "work.headroom" key
    And the selected provider is "claude"
    When a terminal session is opened
    Then spawn is invoked with the raw "claude" provider binary
    And spawn's args do not begin with "wrap"
    And no error control-frame is emitted

  # enabled:false — same raw launch as absent; ADR-001 makes the two equivalent.
  Scenario: work.headroom.enabled:false spawns the raw provider even when headroom is on PATH
    Given the plugin config is '{ "work": { "headroom": { "enabled": false, "providers": ["claude"] } } }'
    And the selected provider is "claude"
    When a terminal session is opened
    Then spawn is invoked with the raw "claude" provider binary
    And spawn's args do not begin with "wrap"
    And no error control-frame is emitted

  # An off plugin adds nothing to the spawn options — the binary and args are exactly what the session
  # resolves with no plugin present at all. This pins "byte-for-byte today's behaviour" as observable on
  # the recorded spawn call, without asserting the resolver internals.
  Scenario: an off plugin contributes nothing to the spawn binary or args
    Given the plugin config has no "work.headroom" key
    And the selected provider is "claude"
    When a terminal session is opened
    Then the spawn binary and args are identical to a session opened with the plugin code absent entirely

  # ADR-001 / ADR-003 branch 1 — the two off-states. headroom is on PATH throughout (the Background), so
  # an unwrapped launch isolates "plugin off" as the cause. Both off-states spawn the raw provider with
  # no wrap prefix.
  Scenario Outline: an off plugin (<headroomConfig>) spawns the raw provider unwrapped
    Given the plugin config <headroomConfig>
    And the selected provider is "claude"
    When a terminal session is opened
    Then spawn is invoked with the raw "claude" provider binary
    And the spawn args carrying a leading "wrap" is <wrapped>

    Examples: the two equivalent off-states (ADR-001)
      | headroomConfig                                                   | wrapped |
      | has no "work.headroom" key                                       | no      |
      | is '{ "work": { "headroom": { "enabled": false } } }'           | no      |
