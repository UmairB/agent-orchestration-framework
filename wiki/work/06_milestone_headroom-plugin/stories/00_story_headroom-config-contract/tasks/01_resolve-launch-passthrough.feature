@cli @work @board @executable
Feature: resolveHeadroomLaunch returns the raw provider launch unchanged on every off / not-routable / degrade branch
  In order to keep the terminal byte-for-byte unchanged whenever the plugin is off, the provider is not
  routable, or headroom is unavailable
  the system must, from resolveHeadroomLaunch, return the raw { bin, args } with wrapped:false when
  work.headroom is absent or disabled, when the provider is gemini or outside the configured subset, and
  when headroom is not on PATH (the honest degrade).

  # ADR-003 branches 1-3 of the frozen decision table (first match wins). The resolver is PURE: the
  # headroom-on-PATH check is the INJECTED `which(binName, env) => absolutePath|null`, so each branch is a
  # unit case with no spawn and no real PATH walk. Signature (frozen 2026-06-20):
  #
  #   resolveHeadroomLaunch({ providerId, config, rawBin, rawArgs, env, which }) => { bin, args, wrapped }
  #
  #   1. config.work?.headroom absent OR enabled !== true   -> raw, wrapped:false
  #   2. providerId not in routable set                     -> raw, wrapped:false
  #        routable = (headroom.providers ?? ["claude","codex"]) ∩ {"claude","codex"}
  #        (gemini is NEVER routable — it can never enter the set, even if listed)
  #   3. routable, but which("headroom", env) === null      -> raw, wrapped:false  (honest degrade)
  #
  # These are OBSERVABLE: the returned { bin, args, wrapped } for a given config + provider + PATH probe.
  # The INVARIANTS "the resolver is the only place the wrap decision is made" and "the resolver is pure
  # (no spawn / real PATH walk only via injected which)" are ADR-003 structural claims owned by the
  # arch-test acd-headroom-honest-degrade — NOT restated as scenarios here. "Raw unchanged" is made
  # black-box checkable by fixing the raw launch concretely below.
  Background:
    Given the raw provider launch is bin "/usr/bin/claude" and args []

  Scenario: plugin absent — no work.headroom returns the raw launch unchanged
    Given a project config with no "work.headroom" key
    And the provider is "claude"
    And headroom resolves on PATH to "/usr/local/bin/headroom"
    When resolveHeadroomLaunch is called
    Then the result is { bin: "/usr/bin/claude", args: [], wrapped: false }

  Scenario: plugin disabled — enabled:false returns the raw launch unchanged
    Given a project config '{ "work": { "headroom": { "enabled": false, "providers": ["claude"] } } }'
    And the provider is "claude"
    And headroom resolves on PATH to "/usr/local/bin/headroom"
    When resolveHeadroomLaunch is called
    Then the result is { bin: "/usr/bin/claude", args: [], wrapped: false }

  # ADR-003 branch 2: gemini can never enter the routable set even when enabled and explicitly listed.
  Scenario: gemini is never routable — raw unchanged even when enabled and listed in providers
    Given a project config '{ "work": { "headroom": { "enabled": true, "providers": ["gemini"] } } }'
    And the provider is "gemini"
    And headroom resolves on PATH to "/usr/local/bin/headroom"
    When resolveHeadroomLaunch is called
    Then the result is { bin: "/usr/bin/gemini", args: [], wrapped: false }

  Scenario: a provider outside the configured subset returns the raw launch unchanged
    Given a project config '{ "work": { "headroom": { "enabled": true, "providers": ["claude"] } } }'
    And the provider is "codex"
    And headroom resolves on PATH to "/usr/local/bin/headroom"
    When resolveHeadroomLaunch is called
    Then the result is { bin: "/usr/bin/codex", args: [], wrapped: false }

  # ADR-003 branch 3: the honest degrade — enabled + routable, but headroom absent from PATH => raw,
  # never an error, never a spawn failure.
  Scenario: enabled and routable but headroom not on PATH degrades to the raw launch
    Given a project config '{ "work": { "headroom": { "enabled": true, "providers": ["claude"] } } }'
    And the provider is "claude"
    And headroom is not on PATH
    When resolveHeadroomLaunch is called
    Then the result is { bin: "/usr/bin/claude", args: [], wrapped: false }

  # The decision table, branches 1-3. rawBin is "/usr/bin/<provider>", rawArgs is [] throughout, so an
  # unchanged return is black-box checkable. headroomOnPath: "yes" => which returns a path; "no" => null.
  # Every row here returns the raw launch with wrapped:false (no wrap happens on these branches).
  Scenario Outline: off, not-routable, and degrade branches all return the raw launch unchanged
    Given a project config <config>
    And the provider is <provider>
    And headroom on PATH is <headroomOnPath>
    And the raw provider launch is bin <rawBin> and args []
    When resolveHeadroomLaunch is called
    Then the result bin is <rawBin> and the result args are [] and wrapped is false

    Examples: branch 1 — absent or disabled returns raw
      | config                                                                | provider   | headroomOnPath | rawBin             |
      | absent                                                                | "claude"   | yes            | "/usr/bin/claude"  |
      | { "work": { "headroom": { "enabled": false } } }                      | "claude"   | yes            | "/usr/bin/claude"  |

    Examples: branch 2 — not in routable set returns raw (gemini never routable)
      | config                                                                | provider   | headroomOnPath | rawBin             |
      | { "work": { "headroom": { "enabled": true, "providers": ["gemini"] } } } | "gemini" | yes            | "/usr/bin/gemini"  |
      | { "work": { "headroom": { "enabled": true } } }                       | "gemini"   | yes            | "/usr/bin/gemini"  |
      | { "work": { "headroom": { "enabled": true, "providers": ["claude"] } } } | "codex"  | yes            | "/usr/bin/codex"   |

    Examples: branch 3 — enabled + routable but headroom absent from PATH degrades to raw
      | config                                                                | provider   | headroomOnPath | rawBin             |
      | { "work": { "headroom": { "enabled": true, "providers": ["claude"] } } } | "claude" | no             | "/usr/bin/claude"  |
      | { "work": { "headroom": { "enabled": true } } }                       | "codex"    | no             | "/usr/bin/codex"   |
