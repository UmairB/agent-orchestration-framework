@cli @planning @scaffold @manual
Feature: the inference lane recovers the intent the mechanical scan honestly marked not recoverable
  In order that a migrated item starts life with a real objective instead of absence markers a
  developer must backfill by hand, the agent lane grounds intent from the source docs the mechanical
  scan cannot read as such — a PRD, a .planning/ tree, an ARCHITECTURE.md-by-name — and writes it
  into the produced item, tracing every line to real source content.

  # F29-1 / F29-2 territory (story 29's deferred findings ARE this task's acceptance ground):
  #   F29-2 — recoverArbitraryIntent reads only a README; a PRD-holding repo recovers intent=null.
  #   F29-1 — the decision scan misses .planning/** and a plain ARCHITECTURE.md-by-name.
  # The lane covers both BY INFERENCE — the mechanical engine itself stays untouched (whether it
  # ALSO grows those scans later is separate backlog, not this story). The non-fabrication rule is
  # absolute: if even inference finds nothing, honest absence stands.
  #
  # Every scenario here is an agent-run pass over a real or fixture source folder, judged on what
  # the produced item's SPEC/STATE carry afterwards — so the whole feature is @manual (feature-level).

  Scenario: a PRD recovers genuine intent where the scan recovered none
    Given a source folder holding a PRD that states what the work set out to do, and no README
    And the mechanical CLI produced a SPEC whose objective and scope are the not-recoverable markers
    When the inference lane runs over the produced item
    Then the produced SPEC's objective states the intent the PRD actually states
    And the scope reflects what the PRD holds in and out
    And the SPEC names the source document the intent was grounded from

  Scenario: planning-tree and by-name architecture prose surfaces as grounded content
    Given a source folder carrying real architecture prose under ".planning/**" or a plain "ARCHITECTURE.md"
    And the mechanical scan recovered no decisions from it
    When the inference lane runs over the produced item
    Then the substance of that prose surfaces in the produced item as grounded content
    And the gap-derived "no decisions captured" impression is corrected to what the source actually holds

  Scenario: every inference-written line traces to real source content
    Given a produced item the inference lane has enriched
    When each enriched line is checked against the source folder
    Then every objective, scope, story, and task line traces to content actually present in the source
    And no line states what the source never stated

  Scenario: honest absence survives inference
    Given a source folder where neither the scan nor inference finds any stated intent
    When the /aof:migrate command completes
    Then the produced SPEC keeps the honest not-recoverable markers
    And the produced item records that the inference pass ran and found nothing, rather than an invented objective

  # QA case design (QA-owned matrix): one row per real-world source shape — story 29's real repo
  # (feynman-diagrams: docs/*prd*.md + .planning/PROJECT.md + .planning/research/ARCHITECTURE.md,
  # no README, 686 commits) is the exemplar the fixture shapes are cut from. Block 1 pins that
  # intent-bearing shapes the scan cannot read ARE recovered and grounded; block 2 pins the two
  # boundaries inference must never cross: rewriting recovered content, and dressing up absence.
  # Fixture precondition (developer feasibility): every no-README shape must carry commit history
  # (recovered outcomes) so the CLI scaffolds and hands off — a source recovering literally nothing
  # is refused before any lane runs (task 00's terminality axis), leaving no item to enrich.
  # Rows run agent-side over local fixtures — the matrix inherits the feature-level @manual.
  Scenario Outline: what the produced record carries follows where the source states its intent
    Given a fixture source folder shaped as <source-shape>
    And the mechanical CLI has produced its item over it
    When the inference lane runs over the produced item
    Then <produced-record-outcome>

    Examples: intent-bearing shapes the scan cannot read are recovered and grounded
      | source-shape                                                                                | produced-record-outcome                                                                                                                  |
      | a PRD under docs/ stating intent AND in/out scope, no README (the F29-2 shape)              | no "_Not recoverable_" marker remains in the SPEC — objective and scope state what the PRD states, naming the PRD as the grounding source |
      | a .planning/ tree (PROJECT.md + research/ARCHITECTURE.md), no README (the story-29 shape)   | the planning tree's stated intent and architecture substance surface in the produced item, each line traceable to a .planning file       |
      | a plain ARCHITECTURE.md by name at the root, no ADR-style dir (the F29-1 shape)             | its architecture substance surfaces as grounded content, correcting the gap-derived "no decisions captured" impression                   |

    Examples: recovered content is never rewritten; absence is never dressed up
      | source-shape                                                                                | produced-record-outcome                                                                                                                  |
      | a README the scan recovered AND a PRD restating the same intent                             | the README-recovered objective stands byte-verbatim after the lane — nothing is rewritten and no duplicate restatement appears           |
      | a README the scan recovered AND a PRD stating scope the README does not                     | the scope gains the PRD-stated additions while the recovered objective stands verbatim                                                   |
      | a PRD file present but stating nothing (placeholder headings, no content)                   | the honest not-recoverable markers stand — no objective is authored from a document that states nothing                                  |
      | no intent-bearing document anywhere (bare code, no docs)                                    | the SPEC's objective and scope are byte-identical to the CLI's honest markers, and the item records that inference ran and found nothing |
