@cli @work @work-stream @manual
Feature: the architect reviews delivered work at migrate time, grounding the findings a developer picks up
  In order that the findings a developer meets at "aof:continue" are architect-grounded structural
  issues rather than only mechanical gap markers, the /aof:migrate command orchestrates the
  architect's review of the source's delivered work as part of the migrate flow itself.

  # Story 29 pinned this review as an @manual lane run AFTER migrate; this story moves it INTO the
  # command's flow (per work.agents.mode) — the produced item is born reviewed. The CLI's
  # gap-derived findings (recovery-signal gaps, written mechanically to STATE.md ## Findings) are
  # the FLOOR the architect builds on: upgraded and extended into grounded structural findings,
  # never duplicated, never contradicted by fabrication. The story-29 CONFORMS discipline carries
  # over verbatim: no finding the delivered work does not actually exhibit.
  #
  # Every scenario is an agent-run pass (the review IS agent judgement) — @manual feature-level.

  Scenario: delivered work is architect-reviewed within the command flow
    Given a source folder whose work is partly delivered (the CLI produced a non-not-started item with gap-derived findings)
    When the /aof:migrate command completes
    Then the produced STATE.md ## Findings holds structural findings grounded in the delivered work itself
    And the architect's rows upgrade or extend the gap-derived rows rather than duplicating them

  Scenario: the recorded findings are developer-actionable
    Given the produced item's ## Findings after the architect's review
    Then each finding names what is wrong, where in the delivered work it shows, and what addressing it entails
    And a developer picking the item up at "aof:continue" can act on each finding without re-deriving the review

  Scenario: no fabricated finding
    Given the produced item's ## Findings after the architect's review
    When each finding is checked against the source's delivered work
    Then every finding traces to something the delivered work actually exhibits
    And no finding is recorded that the delivered work does not show

  Scenario: no delivered work means no review lane and nothing fabricated
    Given a source folder with stated intent but no delivered work (the CLI produced a clean not-started item)
    When the /aof:migrate command completes
    Then no architect review runs over absent work
    And the produced item carries no findings section invented to look reviewed

  # QA case design (QA-owned matrix): the delivery axis decides WHAT ## Findings holds; the agents
  # mode — work.agents.mode "orchestrated" (aof-architect spawned) vs "solo" (the main session
  # plays the role inline) — may change WHO authors the review, never what the record carries.
  # Block 1 walks the delivery axis under orchestration; block 2 pins mode-invariance by re-running
  # the same fixtures solo and comparing the produced record — compared as a semantic finding SET
  # (same issues, same delivered-work grounding, none duplicated or fabricated), never byte-equality
  # between two independently worded agent passes. The absent×solo cell is deliberately
  # omitted: no review lane runs either way, so the cross adds no information there.
  # Rows run agent-side over local fixtures — the matrix inherits the feature-level @manual.
  Scenario Outline: the produced ## Findings follows the delivered work, whatever the agents mode
    Given a fixture source folder whose delivered work is <delivered-condition>
    And work.agents.mode is "<agents-mode>"
    When the /aof:migrate command completes
    Then <findings-outcome>

    Examples: the delivery axis decides what the findings hold
      | delivered-condition                                                            | agents-mode  | findings-outcome                                                                                          |
      | delivered with real structural gaps (commits present, gaps the work exhibits)  | orchestrated | ## Findings holds grounded structural rows that upgrade or extend the gap-derived rows — none duplicated  |
      | fully delivered and clean (no structural gap to find)                          | orchestrated | the review adds no row — ## Findings carries nothing the delivered work does not exhibit                  |
      | absent (stated intent, nothing delivered — a clean not-started item)           | orchestrated | no review runs and the item carries no findings section invented to look reviewed                         |

    Examples: the agents mode changes who authors the review, never the record
      | delivered-condition                                                            | agents-mode  | findings-outcome                                                                                          |
      | delivered with real structural gaps (the same fixture as above)                | solo         | ## Findings carries the same grounded, non-duplicated rows the orchestrated run produced over that fixture |
      | fully delivered and clean (the same fixture as above)                          | solo         | ## Findings is as empty after the solo run as after the orchestrated one — the mode adds no row           |
