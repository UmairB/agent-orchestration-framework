@cli @work @board @executable
Feature: An enabled, routable terminal session spawns headroom wrap <provider> end-to-end
  In order to actually get the token savings the plugin promises whenever I have opted in and headroom
  is installed
  the system must, when handleConnection opens a session for a routable provider with the plugin enabled
  and headroom on PATH, invoke spawn with the resolved headroom binary and args beginning ["wrap",
  <provider>, ...rawArgs] — and start the session normally, emitting no error control-frame.

  # This is the END-TO-END wiring scenario (ADR-003 branch 4 observed through the REAL handleConnection
  # in src/terminal-ws.mjs, with a STUBBED spawn and a stubbed which). It is distinct from story 00's
  # pure-resolver feature (00_story_headroom-config-contract), which asserts resolveHeadroomLaunch's
  # RETURN value in isolation. Here the resolver is wired into the real launch path between the
  # provider's resolveBinaryPath()/buildArgs() and the spawn(bin, args, {cwd, env}) call.
  #
  # The OBSERVABLE surface (the litmus): what the stubbed spawn is called with — its first argument
  # (the binary) and its second argument (the args array) — and whether a {type:"error"} control-frame
  # is emitted. Nothing here asserts internal call ORDERING, that "the resolver is the only decision
  # site", or that the resolver is pure: those are ADR-003 structural invariants owned by the arch-test
  # acd-headroom-honest-degrade. The pure-resolver branch table is unit-tested there; THIS feature
  # proves the seam carries the resolver's verdict to the real spawn.
  #
  # The wrapped form is `headroom wrap <provider>` followed by the provider's own raw args — for the
  # default providers (claude, codex) buildArgs() is [] today, so the wrapped args are exactly
  # ["wrap", <provider>]. The clause "args BEGINNING ["wrap", <provider>]" is what keeps this honest if
  # a provider's raw args ever become non-empty: the raw args follow verbatim after the wrap prefix.

  Background:
    Given a work board terminal server with an injected (stubbed) spawn that records the binary and args it receives
    And an injected (stubbed) which that reports the requested binary present or absent on PATH
    And the plugin config is '{ "work": { "headroom": { "enabled": true, "providers": ["claude", "codex"] } } }'
    And the selected provider's CLI binary resolves on PATH
    And headroom resolves on PATH

  Scenario: an enabled routable claude session spawns headroom wrap claude
    Given the selected provider is "claude"
    When a terminal session is opened
    Then spawn is invoked with the resolved headroom binary
    And spawn's args begin with ["wrap", "claude"]
    And no error control-frame is emitted

  Scenario: an enabled routable codex session spawns headroom wrap codex
    Given the selected provider is "codex"
    When a terminal session is opened
    Then spawn is invoked with the resolved headroom binary
    And spawn's args begin with ["wrap", "codex"]
    And no error control-frame is emitted

  # ADR-003 branch 4 over the routable providers. With the plugin enabled, the default subset
  # (["claude","codex"]) routable, and headroom on PATH, every routable provider session spawns the
  # headroom binary with args beginning ["wrap", <provider>], and the session starts normally (no error
  # control-frame). gemini is NOT in this table — it is never routable; its passthrough lives in
  # 01_degrade-spawn-passthrough.feature.
  Scenario Outline: an enabled routable <provider> session spawns headroom wrap <provider>
    Given the selected provider is "<provider>"
    When a terminal session is opened
    Then spawn is invoked with the resolved headroom binary
    And spawn's args begin with ["wrap", "<provider>"]
    And no error control-frame is emitted

    Examples: the two routable providers, plugin enabled, headroom present
      | provider |
      | claude   |
      | codex    |
