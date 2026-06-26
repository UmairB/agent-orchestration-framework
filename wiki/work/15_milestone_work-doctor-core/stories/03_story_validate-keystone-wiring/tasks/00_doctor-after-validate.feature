@docs @assets @validate @work-stream @executable
Feature: the /aof:validate skill runs work:doctor after work:validate, lane-grouped, as the advisory floor
  In order that the lint keystone gains a deterministic HEALTH floor without aof work validate ever ceasing to be the gate
  the shipped /aof:validate skill must invoke `aof work doctor $ARGUMENTS` AFTER its `aof work validate $ARGUMENTS` step (same scope),
  report both lanes grouped (validity / health) beneath the existing agent-only layer, and keep validate the hard gate while doctor stays advisory,
  so that doctor is ADDED beneath the keystone, never substituted for it.

  # ──────────────────────────────────────────────────────────────────────────
  # VERIFICATION TAG: @executable. (QA seat — the choice, with the reasoning.)
  #
  # The contract this story pins is entirely STATIC TEXT in a shipped doc: the
  # body of src/bundle/commands/validate.md must, after this story's build, carry
  # an `aof work doctor $ARGUMENTS` invocation positioned AFTER its existing
  # `aof work validate $ARGUMENTS` step, with the lane-grouped + advisory framing.
  # Every Then below is a grep-able fact about that shipped doc body — no human
  # judgement, no engine run, no render. The house already proves a doc-content
  # assertion over src/bundle/commands/*.md is feasible and idiomatic: ADR-005's
  # `acd-design-conformance-bundled` arch-test (task 07/02/03) source-greps the
  # bundled verify/continue/refine command docs for contract markers, and
  # `acd-bundle-membership` deterministically asserts shipped-bundle content. A
  # NEW marker-presence + ordering arch-test in that same house
  # (acd-doctor-keystone-wiring, source-greps validate.md, asserts the doctor
  # invocation appears AFTER the validate invocation by character offset) carries
  # this. @manual was the alternative (a human runs the skill and records evidence)
  # — rejected: a deterministic doc-content + ordering check is stronger, needs no
  # human, and matches the precedent exactly. So @executable.
  #
  # SCOPE GUARD (this is a contract for a DOCS/BUNDLE edit): the Thens assert what
  # the shipped validate.md BODY contains and the order of its steps — observable
  # text, never the runtime behaviour of `aof work doctor` itself (that is stories
  # 00/01/02's check-BEHAVIOUR contracts) and never implementation of the engine.
  # ──────────────────────────────────────────────────────────────────────────

  Background:
    Given the shipped lint-skill doc "src/bundle/commands/validate.md"

  # ── Order + scope passthrough ──────────────────────────────────────────────
  # The keystone (aof work validate) already exists in step 1 today; this story
  # adds the doctor step AFTER it. "After" is observable as relative position in
  # the doc body (the doctor invocation's offset is greater than the validate
  # invocation's). Same scope = both carry the SAME `$ARGUMENTS` token (one item
  # ref, or omitted for the whole stream), so doctor inherits validate's scope.
  Scenario: the skill invokes aof work doctor after aof work validate with the same scope
    When the skill body is read
    Then it contains an "aof work validate $ARGUMENTS" invocation
    And it contains an "aof work doctor $ARGUMENTS" invocation
    And the "aof work doctor $ARGUMENTS" invocation appears after the "aof work validate $ARGUMENTS" invocation in the body
    And both invocations carry the same "$ARGUMENTS" scope token

  # ── Lane-grouped reporting ─────────────────────────────────────────────────
  # The combined report groups findings by lane: a VALIDITY lane (from aof work
  # validate) and a HEALTH lane (from aof work doctor), each labelled — and both
  # sit BENEATH the skill's existing agent-only layer (traceability / UAT-gate /
  # litmus), which the doc still describes. "labelled" = the doc body names the
  # two lanes; it does not re-derive findings by hand.
  Scenario: the combined report groups findings by lane, validity and health, beneath the agent-only layer
    When the skill body is read
    Then it labels a validity lane sourced from "aof work validate"
    And it labels a health lane sourced from "aof work doctor"
    And the health lane is reported beneath the agent-only layer (traceability / UAT-gate integrity / litmus)
    And the doctor findings are reported verbatim, not re-derived by the agent

  # ── Validate stays the gate; doctor is advisory ────────────────────────────
  # PASS still requires aof work validate to exit 0 (the hard keystone). A doctor
  # result with only warn-level health findings does NOT fail the skill — doctor
  # is the advisory floor (ADR-002: a warn-only doctor run exits 0 by default).
  # Both are facts the doc body states about the PASS condition; the scenario
  # asserts the doc PINS them, not that it re-implements the exit logic.
  Scenario: validate stays the hard gate and a warn-only doctor result does not fail the skill
    When the skill body is read
    Then it states PASS requires "aof work validate" to exit 0 (the hard keystone)
    And it states a warn-only "aof work doctor" result does not fail the skill (doctor is advisory)
    And it does not make doctor's exit a precondition of PASS

  # ── Added, not substituted ─────────────────────────────────────────────────
  # The pre-existing structural keystone (aof work validate) and the agent-only
  # layer (traceability / UAT-gate / litmus) MUST remain in the doc — doctor is an
  # ADDITIONAL deterministic floor appended beneath, never a replacement for
  # either. The Examples enumerate each pre-existing marker that must survive the
  # edit (the regression this guards: a build that swaps validate for doctor, or
  # drops the agent layer). "present" = the marker still appears in the shipped
  # validate.md body after the wiring lands.
  Scenario Outline: the pre-existing keystone and agent-only layer survive the doctor addition
    When the skill body is read
    Then the marker "<marker>" is present in the shipped doc body

    Examples: the structural keystone is retained, not replaced
      | marker                                        |
      | aof work validate $ARGUMENTS                  |
      | the structural keystone (aof work validate)   |

    Examples: the agent-only layer is retained beneath, not dropped
      | marker                                        |
      | traceability                                  |
      | UAT-gate integrity                            |
      | litmus                                        |

    Examples: doctor is the added deterministic floor, not a substitute
      | marker                                        |
      | aof work doctor $ARGUMENTS                    |
      | added beneath, never replacing, validate      |
