@cli @work @memory @validate
Feature: aof:verify authors OUTCOME.md at Accept as product state, and recordDoc never adopts it
  In order that the store gains somewhere to say what the product now IS — so the next agent can ask
  "what provides X?" instead of inventing a producer —
  the aof:verify Accept path (the sole owner of record docs) must instantiate and fill each completed
  item's OUTCOME.md stating product state, never motive,
  while OUTCOME.md stays an ADDITIONAL artifact that the item's primary record-doc resolution never
  returns.

  # Scope: WHO authors OUTCOME.md and WHEN, WHAT kind of statement it admits, and that it is NOT the
  # primary record doc. It does NOT cover the template's on-disk shape (00_outcome-template.feature) nor
  # indexing/recall (story 02). ADR-004 is the contract: aof:verify owns record docs; recordDoc feeds
  # validate/rollback/readMeta across 38 dependents and requires the identity frontmatter an OUTCOME.md
  # does not carry. ADR-006: driver-level, milestone at minimum. This file MIXES @manual (agent-run
  # authoring) and @executable (the recordDoc/validate behaviour), so each scenario carries its own
  # verification tag.

  Background:
    Given the aof:verify Accept path — the only party that authors an item's record docs (ADR-004)

  @manual
  Scenario: OUTCOME.md is authored at Accept, never at insert
    Given a milestone freshly opened in the stream with no OUTCOME.md in its folder
    When aof:verify accepts the milestone, all its stories done
    Then an OUTCOME.md now exists in the milestone folder, filled from the Delivered/Assumptions/Gaps template
    And it was written at the same Accept juncture that compacts STATE, triggers RETROSPECTIVE, and runs memory ingest
    And no residual `<…>` angle-bracket placeholder remains in any of its three sections

  # THE discriminating rule: an OUTCOME entry states what the system now IS (product state); the WHY it
  # was wanted (motive/reasoning) belongs in RETROSPECTIVE. "For testing purposes" is the reasoning that
  # produced the `warnings_delivered` fiction — it is not an outcome.
  @manual
  Scenario Outline: a Delivered or Gap entry is admitted only when it states product state, not motive
    When aof:verify considers a "<section>" entry reading "<statement>"
    Then the entry is <disposition>
    And the discriminator is that it states <kind>

    Examples: product state — recorded in OUTCOME (what the system now IS)
      | section   | statement                                                                              | disposition         | kind          |
      | Delivered | `warnings_delivered` is written only by test fixtures; no production path populates it  | recorded in OUTCOME  | product state |
      | Delivered | the CLI now emits a machine-readable `--json` envelope on every command                | recorded in OUTCOME  | product state |
      | Gaps      | no production path populates `warnings_delivered`; discharged once a writer assigns it  | recorded in OUTCOME  | product state |

    Examples: motive / reasoning — kept OUT of OUTCOME (belongs in RETROSPECTIVE)
      | section   | statement                                                        | disposition          | kind      |
      | Delivered | `warnings_delivered` was added for testing purposes              | kept out of OUTCOME   | motive    |
      | Delivered | we chose a JSON envelope so downstream tools could parse it      | kept out of OUTCOME   | reasoning |
      | Gaps      | we ran out of time to wire the `warnings_delivered` producer     | kept out of OUTCOME   | motive    |

  # Observable behaviour, not the fitness function's mechanics: which file the system treats as an item's
  # record doc. OUTCOME.md is an additional artifact, so it is never any type's primary record doc.
  @executable
  Scenario Outline: an item's primary record doc is its identity doc — never OUTCOME.md
    When the primary record doc is resolved for a "<type>" item
    Then it resolves to "<record doc>"
    And it does not resolve to "OUTCOME.md"

    Examples: the primary record doc per type (unchanged by this milestone — ADR-004)
      | type      | record doc |
      | milestone | SPEC.md    |
      | story     | STORY.md   |
      | uat       | SESSION.md |
      | spike     | SPIKE.md   |
      | chore     | CHORE.md   |

  # The downstream proof: were OUTCOME.md ever wired in as the record doc, validate would demand identity
  # frontmatter it does not carry and fail. A co-present OUTCOME.md is inert to validate.
  @executable
  Scenario: a milestone carrying an OUTCOME.md still validates on its identity record doc
    Given a milestone folder containing both a valid SPEC.md and an OUTCOME.md that carries no identity frontmatter
    When `aof work validate` runs over the stream
    Then the milestone is validated on its SPEC.md
    And validate never reports the OUTCOME.md as a missing or empty record doc
