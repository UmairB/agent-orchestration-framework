@cli @adapter @validate
Feature: the superseded frontmatter+central-parents mechanism carries no meaning and its config shape is rejected
  In order to leave none of the prior milestone-18 design half-standing
  the system must treat a milestone's frontmatter as a NON-routing source — a stray "notion: { parent: … }" in
  frontmatter (with no .integrations.json) routes nothing and the milestone projects top-level — and the central
  config must no longer expose a notion-top-level "parents" peer to the boards registry: a config written in the
  prior-m18 shape (a global notion.parents beside boards) is rejected at the Ajv-2020 compile seam, while parents
  declared PER BOARD remain valid.

  # ADR-001/002/007: the central global "parents" block is removed from the notion top level — parents now live
  # per board (boards.<k>.parents, or the flat back-compat arm's own parents). Frontmatter is no longer read for
  # routing (story 02 task 00 removed the parser branch; nothing reads notion.parent). The schema's notion block
  # stays a closed oneOf (flat m17 arm | boards arm); a notion-top-level "parents" peer to "boards" is not a
  # member of either arm and is rejected.
  #
  # The projection arm is an OBSERVABLE behaviour over a fixture (@executable); the schema arm compiles
  # aof.schema.json with Ajv-2020 (@executable, the acd-notion-parents-schema idiom). The full closedness /
  # boards-schema invariant is FF-F (authored in this story); these Thens assert the observable
  # accept/reject + projection result, not the test wiring.
  #
  # CROSS-STORY DEPENDENCY (build-order 00 → 01 → 02): the boards `oneOf` arm these Thens validate is PROMOTED
  # in story 00 (which owns the schema `boards` block, ADR-002); the projection that ignores the stray
  # frontmatter `notion.parent` is rewritten in story 01 (ADR-003). THIS task only REMOVES the notion-top-level
  # `parents` peer and locks the post-removal accept/reject surface — so its validate-true Thens are satisfiable
  # only after 00+01 land (which the build-order guarantees). Build note: with Ajv `allErrors:true` a rejected
  # config reports a CLUSTER at instancePath `/work/integrations/notion` (a `oneOf` failure + the arms'
  # additionalProperties/required errors); the step-def matches "some error at `/work/integrations/notion`" (the
  # acd-notion-parents-schema idiom), NOT "exactly one additionalProperties error".

  @executable
  Scenario: a milestone with a stray notion.parent in frontmatter (and no descriptor) routes nothing
    Given a milestone whose SPEC.md frontmatter still carries "notion: { parent: p1 }"
    And the milestone has no ".integrations.json"
    When I project the milestone
    Then the milestone op carries no parent relation
    And the milestone projects top-level

  @executable
  Scenario: a parents map declared per board remains valid at the Ajv seam
    Given a config whose boards registry declares board "ops" with a parents map binding "p1" to "page-P1"
    When I compile aof.schema.json with Ajv-2020 and validate the config
    Then the config validates

  # The removal: the prior-m18 global notion.parents (a peer of boards / a top-level notion peer) is gone.
  @executable
  Scenario: a notion-top-level parents peer to the boards registry is rejected
    Given a config whose work.integrations.notion carries both a "boards" registry and a top-level "parents" map
    When I compile aof.schema.json with Ajv-2020 and validate the config
    Then the config is rejected
    And the failure is on the closed notion block

  @executable
  Scenario Outline: the notion config block accepts only the two supported arms
    Given a config whose work.integrations.notion is <shape>
    When I compile aof.schema.json with Ajv-2020 and validate the config
    Then the config <verdict>

    Examples: the supported arms validate (incl. each arm keeping its own per-board / flat parents)
      | shape                                                   | verdict   |
      | a flat milestone-17 block (back-compat)                 | validates |
      | a flat milestone-17 block with its own parents map      | validates |
      | a { default, boards } registry                          | validates |
      | a { default, boards } registry with per-board parents   | validates |

    Examples: the superseded / malformed / non-closed shapes are rejected
      | shape                                                   | verdict     |
      | a { default, boards } registry plus a top-level parents | is rejected |
      | a boards registry with a board missing its dataSourceId | is rejected |
      | a boards registry with an unknown peer on a board entry | is rejected |
      | a notion block carrying an unknown peer key             | is rejected |
