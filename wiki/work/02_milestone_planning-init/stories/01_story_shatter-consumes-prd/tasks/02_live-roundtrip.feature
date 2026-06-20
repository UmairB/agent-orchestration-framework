@cli @adapter @round-trip @uat
Feature: Live create-prd to shatter round-trip
  In order to prove the seam end-to-end with a real producer, not just a fixture
  a live create-prd must write a PRD-*.md the shatter step then discovers and shatters into framed milestone SPECs.

  # The seam's real proof (RESEARCH A9): a checked-in fixture pins the contract, but only a live
  # producer run shows create-prd actually writes a PRD discovery finds. This is judgment-dependent —
  # a human confirms the produced PRD is well-formed and that discovery found it — so the whole feature
  # is one @uat lane (inherited; no per-scenario lane to avoid double-counting). Procedure, environment,
  # and sign-off live in the milestone UAT.md, which points back with `verifies →`. When this no longer
  # needs a person, it migrates down to @manual / @executable.

  Background:
    Given a live runtime with the pm-skills "pm-execution" planner available
    And a clean workspace with no pre-existing "PRD-*.md"

  Scenario: a live create-prd writes a discoverable PRD-*.md
    When a person runs create-prd (pm-execution) to author a PRD for a sample initiative
    Then a "PRD-*.md" is written to the workspace
    And a person confirms the produced PRD is well-formed (objective, scope, milestone-sized chunks)

  Scenario: shatter discovers and shatters the live PRD into framed milestones
    Given a live create-prd has written a "PRD-*.md" to the workspace
    When "aof:shatter" is run with no explicit path
    Then it discovers that "PRD-*.md" without being given a path
    And it produces a framed milestone "SPEC.md" per identified chunk
    And each SPEC stamps "origin" back to the produced PRD
    And a person confirms discovery found the right PRD and the framing is faithful to it
