@cli @assets @design @executable
Feature: a work.ui.a11y config block validates only as an additive, closed, optional shape
  In order to opt into the a11y lane against one contract instead of guessing what the schema accepts
  the system must validate a work.ui.a11y block of { level ∈ A|AA|AAA } against schemas/aof.schema.json,
  treat an absent block as valid (absent ≡ default/off), accept "a11y" as a plain work.tags.domains entry,
  and reject an unknown key inside the block, a level outside the enum, or a level of the wrong type.

  # ADR-004 (optional a11y lane). work.ui.a11y is a NEW optional object, peer to work.ui.baseUrl, carrying
  # additionalProperties:false (the work.headroom / acd-headroom-config-schema precedent). The lane opts in
  # via work.tags.domains CONTAINING "a11y" — already a free string array, so no schema change enables it;
  # work.ui.a11y only records the LEVEL (default WCAG 2.1 AA). Enforced by acd-a11y-config-schema (Ajv-2020,
  # mirroring acd-headroom-config-schema: the keyword-citing assertions below map to e.keyword ===
  # "additionalProperties" / "enum" / "type" + an instancePath check, exactly as the headroom test does).
  #
  # LITMUS: whether a given config validates or is rejected, and which keyword the rejection cites, are
  # observable outcomes. The STRUCTURAL claim that the block is closed + optional (additionalProperties:false,
  # not required) is the arch-test's, NOT a scenario here — the scenarios assert the validate/reject outcomes
  # that claim produces. `level` is the ONLY property; A/AA/AAA is the ADR-004 documented enum, AA the default.

  Scenario: a work.ui.a11y block with a valid level validates
    Given a project config '{ "work": { "ui": { "a11y": { "level": "AA" } } } }'
    When the config is validated against the schema
    Then validation succeeds

  Scenario: a config with no work.ui.a11y key validates (absent ≡ default/off)
    Given a project config with no "work.ui.a11y" key
    When the config is validated against the schema
    Then validation succeeds

  Scenario: an empty work.ui.a11y block validates (level optional; absent level ≡ default AA)
    Given a project config '{ "work": { "ui": { "a11y": {} } } }'
    When the config is validated against the schema
    Then validation succeeds

  Scenario: a baseUrl-only work.ui block still validates (the block stays peer-additive)
    Given a project config '{ "work": { "ui": { "baseUrl": "http://localhost:5173" } } }'
    When the config is validated against the schema
    Then validation succeeds

  Scenario: baseUrl and a11y together under work.ui validate (a11y is a peer, not a replacement)
    Given a project config '{ "work": { "ui": { "baseUrl": "http://localhost:5173", "a11y": { "level": "AAA" } } } }'
    When the config is validated against the schema
    Then validation succeeds

  Scenario: "a11y" as a work.tags.domains entry validates with no schema change (this is the lane opt-in)
    Given a project config '{ "work": { "tags": { "domains": ["@board", "a11y"] } } }'
    When the config is validated against the schema
    Then validation succeeds

  # ADR-004: additionalProperties:false — an unknown key inside the block fails, pinned to the block subtree.
  Scenario: an unknown key inside work.ui.a11y is rejected
    Given a project config '{ "work": { "ui": { "a11y": { "level": "AA", "tool": "axe" } } } }'
    When the config is validated against the schema
    Then validation fails
    And the failure cites the "work.ui.a11y" additionalProperties keyword

  # ADR-004: the level enum is exactly A / AA / AAA — a value outside it fails on the level enum.
  Scenario: a level outside the enum is rejected
    Given a project config '{ "work": { "ui": { "a11y": { "level": "AAAA" } } } }'
    When the config is validated against the schema
    Then validation fails
    And the failure cites the "work.ui.a11y.level" enum

  # A non-string level is rejected too — the enum is a closed set of string tokens, so a number is invalid.
  # `level` is enum-only ({ enum: ["A","AA","AAA"] }, the work.headroom.mode precedent — no separate
  # "type":"string"), so Ajv rejects 2 on the level ENUM. This scenario stays keyword-agnostic ("pinned to the
  # level property") on purpose: the value is rejected at work.ui.a11y.level regardless of which keyword fires.
  Scenario: a level of the wrong type is rejected
    Given a project config '{ "work": { "ui": { "a11y": { "level": 2 } } } }'
    When the config is validated against the schema
    Then validation fails
    And the failure is pinned to the "work.ui.a11y.level" property

  # A config "work.ui.a11y" value -> whether it validates. "absent" = no work.ui.a11y key;
  # "(valid)" = validation succeeds; "(rejected)" = validation fails on the cited keyword (asserted by the
  # keyword-citing scenarios above; the outline enumerates the boundary, the scenarios pin the keyword).
  Scenario Outline: a work.ui.a11y block validates only when it matches the additive closed shape
    Given a project config <config>
    When the config is validated against the schema
    Then the validation outcome is <outcome>

    Examples: an absent block, an empty block, each valid level, and baseUrl+a11y together validate
      | config                                                                              | outcome  |
      | absent                                                                              | (valid)  |
      | { "work": { "ui": { "a11y": {} } } }                                               | (valid)  |
      | { "work": { "ui": { "a11y": { "level": "A" } } } }                                 | (valid)  |
      | { "work": { "ui": { "a11y": { "level": "AA" } } } }                                | (valid)  |
      | { "work": { "ui": { "a11y": { "level": "AAA" } } } }                               | (valid)  |
      | { "work": { "ui": { "baseUrl": "http://localhost:5173", "a11y": { "level": "AA" } } } } | (valid) |
      | { "work": { "tags": { "domains": ["a11y"] } } }                                    | (valid)  |

    Examples: an out-of-enum level, a wrong-type level, or an unknown key is rejected at the schema
      | config                                                                | outcome     |
      | { "work": { "ui": { "a11y": { "level": "AAAA" } } } }                  | (rejected)  |
      | { "work": { "ui": { "a11y": { "level": "aa" } } } }                    | (rejected)  |
      | { "work": { "ui": { "a11y": { "level": 2 } } } }                       | (rejected)  |
      | { "work": { "ui": { "a11y": { "level": "AA", "tool": "axe" } } } }     | (rejected)  |
      | { "work": { "ui": { "a11y": { "bogus": true } } } }                    | (rejected)  |
