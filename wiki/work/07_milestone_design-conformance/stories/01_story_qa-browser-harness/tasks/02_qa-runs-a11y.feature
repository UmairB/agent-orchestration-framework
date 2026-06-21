@cli @assets @design
Feature: QA runs the opt-in a11y check, and absence of the opt-in is the decision
  In order to verify accessibility where it belongs and stay silent where it does not
  the QA contract must run an axe-core-via-Playwright check ONLY when the a11y lane is opted in, log
  violations as findings at the recorded level, and run nothing when the lane is off.

  # ADR-004. The lane is opt-in via work.tags.domains containing "a11y" (absent ≡ off). When on, QA (it
  # has Bash) injects axe-core through Playwright as part of its harness and logs violations as findings
  # against work.ui.a11y.level (default WCAG 2.1 AA); the designer never runs it (no Bash). Grep target =
  # the BUNDLED QA agent (ADR-005), read by acd-design-role-split (QA slice) / acd-design-conformance-bundled.
  #
  # LITMUS: that the CONTRACT assigns the a11y run to QA and gates it on the opt-in is confirmable by
  # reading the bundled asset → @executable. The actual run + what it finds (the browser + the served
  # app) → @manual. The on/off MATRIX is split by altitude: the CONTRACT gate (who owns it, what gates it)
  # is @executable; the RUNTIME effect (a real axe-core pass / silence) is @manual.

  @executable
  Scenario: the a11y run is assigned to QA, gated on the opt-in domain
    Given the bundled agents "src/bundle/agents/aof-qa.md" and "src/bundle/agents/aof-designer.md"
    When their bodies are read
    Then the QA contract assigns the a11y check to QA (axe-core via Playwright)
    And it gates the check on the a11y lane being opted in via work.tags.domains
    And it references the conformance level from work.ui.a11y (default WCAG 2.1 AA)
    And the designer contract does not own or run the a11y check

  # The opt-in state -> which party (if any) the contract assigns the a11y run to. This is the CONTRACT-level
  # matrix (who owns it under each lane state), confirmable by reading the bundled QA + designer agents —
  # NOT a real run. "QA (gated on)" = the lane is on and the contract puts the run on QA; "no one (off)" =
  # the contract runs nothing when the opt-in is absent. The designer is never the assignee in any row.
  @executable
  Scenario Outline: the a11y run lands on QA only when the lane is opted in — never on the designer
    Given the bundled agents "src/bundle/agents/aof-qa.md" and "src/bundle/agents/aof-designer.md"
    And the a11y lane opt-in is <lane-state>
    When the contract's a11y ownership is read
    Then the a11y run is assigned to <assignee>
    And the designer contract never owns the a11y run

    Examples: opted in vs absent
      | lane-state                                | assignee        |
      | present ("a11y" in work.tags.domains)     | QA (gated on)   |
      | absent (no "a11y" in work.tags.domains)   | no one (off)    |

  @manual
  Scenario: with the lane on, QA runs axe-core and logs violations as findings
    Given a project whose work.tags.domains contains "a11y"
    And the app served at the design-review base URL
    When QA runs its harness for a surface
    Then it executes the axe-core a11y check against the rendered surface at the recorded level
    And any violations are logged as findings

  @manual
  Scenario: with the lane off, no a11y check runs
    Given a project whose work.tags.domains does not contain "a11y"
    When QA runs its harness for a surface
    Then no a11y check is executed
    And no a11y findings are produced
