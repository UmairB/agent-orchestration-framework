@executable @cli @work @distribution
Feature: A session is LIVE only while its lastPingAt is within the TTL — reusing the ONE shared staleness predicate
  In order that a crashed assistant (SIGKILL, lid close, lost network — which never fires `end`, RESEARCH.md §2:
  no crash guarantee) never leaves a node stuck `working`, session liveness self-expires on a TTL computed with
  the SAME `isStale` predicate the whole mesh already shares — never a second, hand-rolled staleness rule.

  # ARCHITECTURE 38/ADR-002. A session is live iff `!isStale(record, nowMs, ttlMs)` where `isStale` is IMPORTED
  # from mesh-presence.mjs / run-store.mjs (strict `>`; a session AT the TTL is STILL live — 60 > 60 is false),
  # reading record.lastPingAt. The TTL default resolves from `config.mesh.session.ttlSeconds` via the raw
  # optional-chain idiom (NOT the config-editor whitelist — the 22/story-01 lesson), falling back to ONE
  # documented named constant (indicative 120s — above the UserPromptSubmit ping cadence's headroom; the Three
  # Amigos pin the exact number). `now`/`ttl` are INJECTED (the inject-the-clock discipline) — no wall clock.
  # STRUCTURAL: no parallel `Date.parse(...) - ... >` in the session path → acd-session-ttl-reuses-isstale;
  # behavioural self-expiry → acd-session-ttl-self-expires.
  #
  # @qa: complete the Examples — at-TTL (still live, strict >), just-past-TTL (expired), fresh (live),
  # config value present vs absent/malformed/negative/null → documented-default fallback, zero-TTL honoured.

  Background:
    Given the session TTL is resolved to a known number of seconds
    And the current instant is injected (no wall clock is read)

  Scenario Outline: a session is live at or before the TTL and expired strictly past it
    # Boundary is the strict `>` of the shared isStale predicate: age == TTL is STILL live (TTL > TTL is false),
    # age == TTL + any positive epsilon is expired. Ages are expressed relative to the resolved TTL so the row
    # is exact regardless of the number the Three Amigos pin.
    Given a session record whose lastPingAt is <age> before now
    Then the session reads <liveness>

    Examples:
      | age              | liveness |
      | 0s (just pinged) | live     |
      | 1s               | live     |
      | TTL - 1s         | live     |
      | exactly TTL      | live     |
      | TTL + 1ms        | expired  |
      | TTL + 1s         | expired  |
      | 10 x TTL         | expired  |

  Scenario Outline: the TTL default resolves from config, falling back to the one documented constant
    # Mirrors resolveStalenessSeconds EXACTLY: a finite number >= 0 is honoured (so 0 is a valid, if aggressive,
    # TTL); absent / NaN / negative / null / wrong-type all fall back to the ONE documented default
    # (DEFAULT_SESSION_TTL_SECONDS — indicative 120s; the constant, not a literal, is the assertion source).
    Given config.mesh.session.ttlSeconds is <configured>
    Then the resolved TTL seconds is <resolved>

    Examples:
      | configured     | resolved                    |
      | 90             | 90                          |
      | 300            | 300                         |
      | 0              | 0 (honoured — not a fallback) |
      | (absent key)   | DEFAULT_SESSION_TTL_SECONDS |
      | null           | DEFAULT_SESSION_TTL_SECONDS |
      | NaN            | DEFAULT_SESSION_TTL_SECONDS |
      | -1             | DEFAULT_SESSION_TTL_SECONDS |
      | "120"          | DEFAULT_SESSION_TTL_SECONDS |
      | Infinity       | DEFAULT_SESSION_TTL_SECONDS |

  Scenario: a session at exactly the TTL is still live, one epsilon past it is expired (the strict-> pin)
    # the load-bearing boundary made explicit alongside the Outline, so acd-session-ttl-self-expires has a
    # named behavioural anchor: same predicate, same strict `>`, no session-local staleness rule.
    Given a session record whose lastPingAt is exactly TTL seconds before now
    Then the session reads live
    When the injected now advances by 1 more millisecond
    Then the same session reads expired
    And liveness was decided by the imported isStale predicate, not a session-local comparison
