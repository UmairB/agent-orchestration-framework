@cli @work @validate @executable
Feature: a work.headroom config block validates only when it is the frozen v0 shape
  In order to opt into the headroom plugin against one contract instead of guessing what the schema accepts
  the system must validate a work.headroom block of { enabled, mode:"wrap", providers⊆{claude,codex} }
  against schemas/aof.schema.json, treat an absent block as valid (absent ≡ off), and reject mode:"proxy",
  any other mode, an unknown key inside the block, or "gemini" listed as a provider.

  # ADR-001/002: work.headroom is a new OPTIONAL object under $defs/work, peer to work.ui, carrying
  # additionalProperties:false. The locked v0 block (frozen 2026-06-20):
  #
  #   {
  #     "work": {
  #       "headroom": {
  #         "enabled": true,                  // bool — the master switch (absent block OR false ≡ off)
  #         "mode": "wrap",                   // enum: "wrap" ONLY in v0; "proxy" is REJECTED (ADR-002)
  #         "providers": ["claude", "codex"]  // OPTIONAL subset of routable providers; "gemini" never valid
  #       }
  #     }
  #   }
  #
  # `enabled` is the only required-by-meaning key. `mode` is OPTIONAL at the schema (ADR-001: an enabled
  # block with no `mode` defaults to "wrap" AT RUNTIME — the resolver's default, ADR-003 branch 4 — so a
  # `mode`-less enabled block is schema-VALID). `port`/`stateless` are deliberately absent from v0.
  #
  # These are OBSERVABLE behaviours: whether a given config validates or is rejected, and which keyword the
  # rejection cites. The STRUCTURAL claim that the block is "closed (additionalProperties:false) and
  # OPTIONAL" is the arch-test's (acd-headroom-config-schema), not a scenario here — the scenarios below
  # only assert the validate/reject outcomes that claim produces.

  Scenario: the full frozen block validates
    Given a project config '{ "work": { "headroom": { "enabled": true, "mode": "wrap", "providers": ["claude", "codex"] } } }'
    When the config is validated against the schema
    Then validation succeeds

  Scenario: a config with no work.headroom key validates (absent ≡ off)
    Given a project config with no "work.headroom" key
    When the config is validated against the schema
    Then validation succeeds

  Scenario: an enabled block with no mode key validates (mode defaults to wrap at runtime)
    Given a project config '{ "work": { "headroom": { "enabled": true } } }'
    When the config is validated against the schema
    Then validation succeeds

  # ADR-002: proxy is a different runtime topology, rejected AT the schema (not accept-and-degrade) so a
  # developer cannot assert a capability the runtime does not have. The failure points at the mode enum.
  Scenario: mode "proxy" is rejected by the schema mode enum
    Given a project config '{ "work": { "headroom": { "enabled": true, "mode": "proxy" } } }'
    When the config is validated against the schema
    Then validation fails
    And the failure cites the "work.headroom.mode" enum

  Scenario: any mode outside the v0 enum is rejected by the schema mode enum
    Given a project config '{ "work": { "headroom": { "enabled": true, "mode": "turbo" } } }'
    When the config is validated against the schema
    Then validation fails
    And the failure cites the "work.headroom.mode" enum

  # ADR-001: additionalProperties:false — an unknown key inside the block fails validation.
  Scenario: an unknown key inside work.headroom is rejected
    Given a project config '{ "work": { "headroom": { "enabled": true, "port": 8080 } } }'
    When the config is validated against the schema
    Then validation fails
    And the failure cites the "work.headroom" additionalProperties keyword

  # ADR-001/003: gemini is NEVER a valid routable member — rejected at the schema, not silently dropped.
  Scenario: "gemini" listed in providers is rejected by the schema
    Given a project config '{ "work": { "headroom": { "enabled": true, "providers": ["gemini"] } } }'
    When the config is validated against the schema
    Then validation fails
    And the failure cites the "work.headroom.providers" items enum

  # A config "work.headroom" value -> whether it validates. "absent" = no work.headroom key;
  # "(valid)" = validation succeeds; "(rejected)" = validation fails on the cited keyword.
  Scenario Outline: a work.headroom block validates only when it matches the frozen v0 shape
    Given a project config <config>
    When the config is validated against the schema
    Then the validation outcome is <outcome>

    Examples: the frozen shape and an absent block both validate
      | config                                                                            | outcome  |
      | { "work": { "headroom": { "enabled": true, "mode": "wrap", "providers": ["claude", "codex"] } } } | (valid)  |
      | { "work": { "headroom": { "enabled": true } } }                                   | (valid)  |
      | absent                                                                             | (valid)  |

    Examples: a non-wrap mode, an unknown key, or gemini is rejected at the schema
      | config                                                                | outcome     |
      | { "work": { "headroom": { "enabled": true, "mode": "proxy" } } }       | (rejected)  |
      | { "work": { "headroom": { "enabled": true, "mode": "turbo" } } }       | (rejected)  |
      | { "work": { "headroom": { "enabled": true, "port": 8080 } } }          | (rejected)  |
      | { "work": { "headroom": { "enabled": true, "providers": ["gemini"] } } } | (rejected) |
