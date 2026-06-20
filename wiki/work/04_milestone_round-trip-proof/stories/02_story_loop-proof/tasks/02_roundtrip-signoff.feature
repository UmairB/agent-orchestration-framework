@cli @work @round-trip @uat
Feature: the bundled actors drive the sample milestone to done
  In order to prove the methodology and tooling compose end-to-end (the round-trip the ROADMAP calls for)
  a person must drive refine to continue to verify on the seeded milestone with the BUNDLED actors and reach done.

  # ONE @uat lane (inherited at feature level; no per-scenario verification tag, to avoid double-counting).
  # The outcome is determined by AGENT REASONING (ARCHITECTURE ADR-003) — what the bundled actors author
  # and build — so it CANNOT be a CI assertion: a person runs each step and confirms it. The full
  # procedure, environment, captured evidence (transcript + resulting work-stream state), and sign-off
  # live in the milestone UAT.md, which points back here with `verifies →`. As deterministic seams
  # emerge, parts of this lane migrate down to @manual/@executable and their UAT row is deleted.
  #
  # CONSUMES the CI-proven spine, does NOT re-prove it: `aof work find/list/validate/next` are already
  # green via story 02's @executable tasks (00_validate-gates, 01_next-orders) — this lane USES `next`
  # only as a done-probe and asserts no spine behaviour of its own. It invents NO automated assertion
  # over agent-authored content (no green-forever check of the stories the actors write or the code they
  # build); the only judge of that content is the person.

  Background:
    Given a fresh isolated repo with the bundle installed and the sample milestone seeded (via the harness)
    And the bundled "/aof" commands and "aof-*" agents are the actors available in the repo

  Scenario: refine breaks the sample milestone into stories with the bundled actors
    When a person runs "/aof:refine" on the seeded milestone in the repo
    Then the sample milestone gains broken-down story records authored by the bundled actors
    And a person confirms the breakdown is faithful to the sample SPEC

  Scenario: continue builds the sample stories with the bundled actors
    When a person runs "/aof:continue" on the seeded milestone in the repo
    Then the bundled actors author the tasks and build code to satisfy them
    And a person confirms the build satisfies the authored task contracts

  Scenario: verify accepts the sample milestone and the loop reaches done
    When a person runs "/aof:verify" on the seeded milestone in the repo
    Then a person confirms the bundled actors accept the milestone
    And, consuming the CI-proven spine as a done-probe, "aof work next" over the seeded span reports done
    And a person records the captured evidence and signs off in the milestone UAT.md
