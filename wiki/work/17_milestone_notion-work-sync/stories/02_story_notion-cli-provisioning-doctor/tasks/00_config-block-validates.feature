@cli @adapter @validate @executable
Feature: the aof schema validates a work.integrations.notion config block and rejects a malformed one
  In order that an operator opts into Notion sync through a config the validator vouches for, never a half-trusted block
  schemas/aof.schema.json gains work.integrations.notion (dataSourceId, tokenEnv, statusProperty, statusMap, relationProperty) and the compiled schema accepts a well-formed block and rejects a malformed one naming the offending field,
  so that a complete, correctly-typed block passes, a missing-field / wrong-type / unknown-property block fails with a pointer to what is wrong, and no field anywhere in the block holds a token value — only the env-var NAME.

  # ADR-004: work.integrations.notion is the opt-in config block — PRESENT ⇒ all binding lives
  # here, ABSENT ⇒ the command's no-op gate fires (the no-op behaviour is story 00's, NOT asserted
  # here; this feature is the SCHEMA acceptance/rejection surface only). The block is added to
  # schemas/aof.schema.json $defs.work (currently NO integrations key, line 350). The acceptance
  # authority for the block's SHAPE is the schema itself, proven by compiling aof.schema.json with
  # Ajv-2020 in-process (the milestone-06 idiom — test/arch/acd-headroom-config-schema.test.mjs —
  # since validateConfig at config-inspect.mjs:140 is hand-rolled per-key and does no work.* subtree
  # validation today; ADR-004's "validateConfig reads it" is satisfied by the schema being the
  # validator the config is checked against). The frozen shape (ADR-004): { dataSourceId, tokenEnv
  # (default "NOTION_API_TOKEN"), statusProperty, statusMap:{not-started,in-progress,in-review,done
  # → board option NAMES}, relationProperty }. The token is NEVER in config — only tokenEnv, the
  # env-var NAME (RESEARCH §A2). Hermetic: the schema is compiled in-process and the fixture config
  # validated against it, so the whole feature is @executable (the verification tag is on the
  # Feature line — every scenario inherits it).
  #
  # NOTE: the STRUCTURAL guarantee "the config carries only an env-var ref, never a committed
  # secret" is the story-03 arch-test acd-notion-auth-env-ref (ADR-005 inv. 4) — it greps the
  # schema for the absence of any secret-bearing field. This feature asserts only the OBSERVABLE
  # schema verdict (a block with a token-VALUE field is rejected as an unknown property).
  Background:
    Given the aof config schema compiled in-process and a fixture aof config

  # A complete, correctly-typed block — the data-source id, the env-var NAME, the status property,
  # the four-status map (the aof statuses → board option names), and the relation property — passes
  # validation. This is the frozen ADR-004 shape an operator authors to opt in.
  Scenario: a well-formed work.integrations.notion block validates
    Given a config whose work.integrations.notion has dataSourceId, tokenEnv, statusProperty, a statusMap covering not-started/in-progress/in-review/done, and relationProperty
    When the config is validated against the schema
    Then the config is reported valid
    And no validation error is raised against work.integrations.notion

  # The statusMap MUST cover all four aof statuses (RESEARCH §A4: each aof status maps to an
  # EXISTING board option name, and in-review has no Notion default so the operator MUST supply it).
  # A statusMap missing the in-review entry is rejected naming that gap.
  Scenario: a statusMap missing an aof status is rejected
    Given a config whose work.integrations.notion statusMap omits the in-review entry
    When the config is validated against the schema
    Then the config is reported invalid
    And the validation error names the missing statusMap entry for in-review

  # The block holds the env-var NAME (tokenEnv), never the secret (RESEARCH §A2 / ADR-004). A block
  # that tries to carry a literal token value does so under a property the schema does not define,
  # so it is rejected as an unknown additional property — the OBSERVABLE consequence of the
  # no-committed-secret design (the structural grep is the story-03 arch-test, see header note).
  Scenario: a block carrying a token-value field is rejected as an unknown property
    Given a config whose work.integrations.notion adds a "token" field holding a literal secret value
    When the config is validated against the schema
    Then the config is reported invalid
    And the validation error names "token" as an unknown property on work.integrations.notion
    And no schema-defined field of work.integrations.notion holds a token value — only tokenEnv, the env-var NAME

  # The accept/reject matrix over the block's shape: the well-formed block, then each malformed
  # shape — a missing required field, a wrong-typed field, and an unknown additional property. Each
  # rejection names the offending field, so the operator learns exactly what to fix. (in-review is
  # spelled out as its own scenario above; this outline covers the structural shapes.)
  Scenario Outline: the block validates only when well-formed, else rejected naming the offending field
    Given a config whose work.integrations.notion is "<shape>"
    When the config is validated against the schema
    Then the validation outcome is "<outcome>"
    And the error "<offending>"

    Examples:
      | shape                                          | outcome  | offending                                              |
      | well-formed (all fields, four-status map)      | accepted | (none — the block is valid)                            |
      | missing dataSourceId                           | rejected | names the missing required dataSourceId                |
      | missing statusProperty                         | rejected | names the missing required statusProperty              |
      | missing statusMap                              | rejected | names the missing required statusMap                   |
      | missing relationProperty                       | rejected | names the missing required relationProperty            |
      | dataSourceId is a number, not a string         | rejected | names dataSourceId as the wrong type                   |
      | statusMap is a string, not an object           | rejected | names statusMap as the wrong type                      |
      | statusMap value is a number, not a board name  | rejected | names the statusMap entry as the wrong type            |
      | adds an unknown "databaseId" property           | rejected | names "databaseId" as an unknown additional property   |
      | adds a "token" property holding a secret value | rejected | names "token" as an unknown additional property        |
