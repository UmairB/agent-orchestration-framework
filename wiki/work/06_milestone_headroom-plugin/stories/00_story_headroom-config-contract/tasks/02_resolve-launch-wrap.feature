@cli @work @board @executable
Feature: resolveHeadroomLaunch returns the headroom-wrapped launch when enabled, routable, and headroom is on PATH
  In order to front a routable provider session with `headroom wrap <provider>` whenever the developer
  opted in and headroom is available
  the system must, from resolveHeadroomLaunch, return { bin: <resolved headroom path>, args: ["wrap",
  <provider>, ...rawArgs], wrapped: true } so the raw provider args flow through unchanged AFTER wrap.

  # ADR-003 branch 4 of the frozen decision table (the only wrapping branch). The resolver is PURE: the
  # headroom-on-PATH lookup is the INJECTED `which(binName, env) => absolutePath|null`. Branch 4:
  #
  #   4. enabled + routable + which("headroom", env) !== null -> {
  #        bin: <resolved headroom path>,                       // the which result, NOT rawBin
  #        args: ["wrap", providerId, ...rawArgs],              // `headroom wrap <provider>` then raw args
  #        wrapped: true
  #      }
  #
  # routable set = (headroom.providers ?? ["claude","codex"]) ∩ {"claude","codex"}, so an enabled block
  # with NO providers key wraps BOTH claude and codex (default = ["claude","codex"]). gemini can never
  # reach this branch (it is never routable) — its non-wrapping is covered in 01_resolve-launch-passthrough.
  #
  # These are OBSERVABLE: the returned { bin, args, wrapped } for a given config + provider + rawArgs + PATH
  # probe. The INVARIANTS "the resolver is the only place the wrap decision is made" and "the resolver is
  # pure" are ADR-003 structural claims owned by the arch-test acd-headroom-honest-degrade — NOT restated
  # as scenarios here. raw args are fixed concretely so "flow through after wrap" is black-box checkable.
  Background:
    Given headroom resolves on PATH to "/usr/local/bin/headroom"

  Scenario: an enabled routable claude session wraps to headroom wrap claude
    Given a project config '{ "work": { "headroom": { "enabled": true, "providers": ["claude", "codex"] } } }'
    And the provider is "claude"
    And the raw provider launch is bin "/usr/bin/claude" and args []
    When resolveHeadroomLaunch is called
    Then the result is { bin: "/usr/local/bin/headroom", args: ["wrap", "claude"], wrapped: true }

  Scenario: an enabled routable codex session wraps to headroom wrap codex
    Given a project config '{ "work": { "headroom": { "enabled": true, "providers": ["claude", "codex"] } } }'
    And the provider is "codex"
    And the raw provider launch is bin "/usr/bin/codex" and args []
    When resolveHeadroomLaunch is called
    Then the result is { bin: "/usr/local/bin/headroom", args: ["wrap", "codex"], wrapped: true }

  # The raw args flow through AFTER `wrap <provider>` — headroom runs the provider as its child with the
  # provider's own args underneath.
  Scenario: non-empty raw args flow through after wrap provider
    Given a project config '{ "work": { "headroom": { "enabled": true, "providers": ["claude"] } } }'
    And the provider is "claude"
    And the raw provider launch is bin "/usr/bin/claude" and args ["--foo"]
    When resolveHeadroomLaunch is called
    Then the result is { bin: "/usr/local/bin/headroom", args: ["wrap", "claude", "--foo"], wrapped: true }

  # ADR-003: providers defaulting — an enabled block with NO providers key wraps both claude and codex.
  Scenario: an enabled block with no providers key wraps claude (default subset)
    Given a project config '{ "work": { "headroom": { "enabled": true } } }'
    And the provider is "claude"
    And the raw provider launch is bin "/usr/bin/claude" and args []
    When resolveHeadroomLaunch is called
    Then the result is { bin: "/usr/local/bin/headroom", args: ["wrap", "claude"], wrapped: true }

  Scenario: an enabled block with no providers key wraps codex (default subset)
    Given a project config '{ "work": { "headroom": { "enabled": true } } }'
    And the provider is "codex"
    And the raw provider launch is bin "/usr/bin/codex" and args []
    When resolveHeadroomLaunch is called
    Then the result is { bin: "/usr/local/bin/headroom", args: ["wrap", "codex"], wrapped: true }

  # Branch 4 over the provider × rawArgs matrix. headroom is on PATH at "/usr/local/bin/headroom" (the
  # Background). The result bin is always the resolved headroom path; the result args are always
  # ["wrap", <provider>] followed by the raw args verbatim; wrapped is always true.
  Scenario Outline: enabled + routable + headroom on PATH wraps to headroom wrap <provider> ...rawArgs
    Given a project config <config>
    And the provider is <provider>
    And the raw provider launch is bin <rawBin> and args <rawArgs>
    When resolveHeadroomLaunch is called
    Then the result is { bin: "/usr/local/bin/headroom", args: <wrappedArgs>, wrapped: true }

    Examples: empty raw args — wrap <provider> only
      | config                                                                  | provider | rawBin            | rawArgs | wrappedArgs            |
      | { "work": { "headroom": { "enabled": true, "providers": ["claude", "codex"] } } } | "claude" | "/usr/bin/claude" | []      | ["wrap", "claude"]     |
      | { "work": { "headroom": { "enabled": true, "providers": ["claude", "codex"] } } } | "codex"  | "/usr/bin/codex"  | []      | ["wrap", "codex"]      |

    Examples: non-empty raw args flow through after wrap <provider>
      | config                                                                  | provider | rawBin            | rawArgs               | wrappedArgs                          |
      | { "work": { "headroom": { "enabled": true, "providers": ["claude"] } } } | "claude" | "/usr/bin/claude" | ["--foo"]             | ["wrap", "claude", "--foo"]          |
      | { "work": { "headroom": { "enabled": true, "providers": ["codex"] } } }  | "codex"  | "/usr/bin/codex"  | ["--bar", "baz"]     | ["wrap", "codex", "--bar", "baz"]    |

    Examples: absent providers key defaults to both routable providers (each wraps)
      | config                                              | provider | rawBin            | rawArgs | wrappedArgs        |
      | { "work": { "headroom": { "enabled": true } } }    | "claude" | "/usr/bin/claude" | []      | ["wrap", "claude"] |
      | { "work": { "headroom": { "enabled": true } } }    | "codex"  | "/usr/bin/codex"  | []      | ["wrap", "codex"]  |
