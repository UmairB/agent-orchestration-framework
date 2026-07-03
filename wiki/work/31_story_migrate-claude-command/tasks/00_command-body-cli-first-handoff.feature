@cli @work @work-stream
Feature: /aof:migrate runs the mechanical CLI first and fills only the seam it hands off
  In order to enrich a migrated item by inference without ever growing inference into the CLI
  the /aof:migrate command must run "aof migrate" (the mechanical floor) as its first act, take the
  CLI's honest-absence markers as the hand-off seam, and confine every write to the produced item.

  # The division of labour is THE load-bearing contrast (STORY.md): the CLI recovers what
  # pattern-matching can recover and marks the rest "_Not recoverable_"; the command's agent lane
  # fills exactly that seam. These scenarios pin the ORCHESTRATION contract — CLI first, refusal
  # respected, write-boundary held — not the inference quality (tasks 01/02) nor the shipping
  # mechanics (task 03).
  #
  # Two lanes of verification here:
  #   @executable — content/shape pins over the AUTHORED body `src/bundle/commands/migrate.md`
  #                 (the deliverable IS a doc; its stated contract is the black-box observable).
  #   @manual     — agent-run passes of the whole command over a local fixture source folder,
  #                 judged on what lands (and does not land) on disk.
  # The structural invariant "the mechanical CLI grows no inference" is pinned by task 03's
  # non-regression scenario (story-29 suite untouched) — do not restate it as a Then here.

  @executable
  Scenario: the shipped command body encodes the CLI-first division of labour
    Given the authored command body "src/bundle/commands/migrate.md"
    Then its frontmatter carries a description and an argument-hint naming the source folder
    And its process runs "aof migrate" (the CLI) as the FIRST act, before any agent pass
    And it consumes the CLI's --json result to resolve the produced item it will enrich
    And it states the agent lane fills what the CLI marked not recoverable — never re-doing the mechanical floor

  @executable
  Scenario: the shipped command body pins the write boundary and the non-fabrication rule
    Given the authored command body "src/bundle/commands/migrate.md"
    Then it confines every agent write to the produced item's folder under work.dir
    And it states the source folder stays byte-untouched (the CLI's read-only source rule survives into the lane)
    And it states everything the agent writes must trace to real source content, honest absence standing when inference finds nothing

  @manual
  Scenario: running the command enriches only the produced item and leaves the source untouched
    Given a local fixture source folder whose intent the mechanical scan cannot recover
    When the /aof:migrate command is run over it
    Then the mechanical CLI runs first and reports the managed item it produced
    And every file the agent lane wrote sits under that produced item's folder in work.dir
    And the source folder is byte-for-byte unchanged after the whole command
    And the produced item still passes "aof work validate" after enrichment

  @manual
  Scenario: the CLI's refusal ends the command — inference never resurrects an empty source
    Given a source folder the mechanical CLI refuses (nothing recoverable at all)
    When the /aof:migrate command is run over it
    Then the command surfaces the CLI's refusal and stops
    And no agent pass runs and nothing is written under work.dir

  # QA case design (QA-owned matrix): two load-bearing axes plus one targeting row.
  #   Axis 1 — the SEAM: what the CLI marked absent is exactly what the lane may fill; recovered
  #            content is inviolable even when the lane holds material it could "improve" it with
  #            (the README+PRD row is the must-not-overwrite edge).
  #   Axis 2 — TERMINALITY: the CLI's refusal / error / preview outcomes end the command before
  #            any lane runs.
  #   Targeting — the CLI's --json result is the only way the lane finds the produced item.
  # Every row is an agent-run pass over a LOCAL fixture, so the whole matrix is @manual.
  @manual
  Scenario Outline: what the CLI hands off determines what the agent lane does
    Given a fixture source folder where <source-condition>
    When the /aof:migrate command is run over it
    Then <agent-lane-outcome>

    Examples: the CLI's markers are the seam — the lane fills gaps, never recovered content
      | source-condition                                                   | agent-lane-outcome                                                                                        |
      | the scan recovers intent (a README states it), scope stays marked  | the recovered objective stands verbatim and the lane fills only the parts still carrying absence markers |
      | a README the scan recovered AND a PRD sit side by side             | the README-recovered objective stands byte-verbatim — the lane does not rewrite it from the PRD          |
      | the scan recovers no intent (commits still scaffold it) but a PRD holds real intent | the not-recoverable markers are replaced with intent grounded in that PRD                |
      | the scan and inference both find no intent anywhere                | the honest not-recoverable markers stand in the produced SPEC, unfabricated                               |

    Examples: the CLI's terminal outcomes end the command — no lane runs
      | source-condition                                                   | agent-lane-outcome                                                                                        |
      | the source is empty (the CLI refuses, non-zero)                    | the command surfaces the refusal and stops; no agent pass runs, nothing lands under work.dir              |
      | the source path does not exist (the CLI errors)                    | the command surfaces the CLI error and stops; nothing lands under work.dir                                |
      | the run is --dry-run (the CLI previews, writes nothing)            | the command reports what WOULD be produced; no agent pass writes anything                                 |

    Examples: the CLI's --json result is how the lane finds its target
      | source-condition                                                   | agent-lane-outcome                                                                                        |
      | the work stream already holds managed items (next free slot lands) | every lane write sits under the dir the CLI's --json result named; no pre-existing managed item changes  |
