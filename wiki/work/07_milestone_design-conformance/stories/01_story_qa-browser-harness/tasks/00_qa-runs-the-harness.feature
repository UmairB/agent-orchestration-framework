@cli @assets @design
Feature: the bundled QA agent runs the browser harness and owns the regression
  In order to put "running the browser" with the role that has the tools to run it
  the bundled aof-qa agent must carry Bash, own the Playwright harness and the toHaveScreenshot
  regression + functional checks, while the designer owns none of them.

  # ADR-001 (responsibility-split contract), QA half. QA's tools include `Bash` (it runs Playwright); the
  # designer's do not (story 00 / the designer-fidelity-judge story). The toHaveScreenshot visual-regression
  # locks the designer-APPROVED baseline — the SEAM is defined here; building baselines out as a hard gate is
  # a QA-owned follow-on (SPEC out-of-scope). Owns src/bundle/agents/aof-qa.md. Grep targets are the BUNDLED
  # assets (ADR-005), read by acd-design-role-split (QA slice).
  #
  # LITMUS: the tool boundary + each ownership claim are confirmable by parsing the bundled assets →
  # @executable. The STRUCTURAL "tools list cannot run a browser" invariant is the arch-test's; the scenarios
  # assert the observable contract content (carries Bash; owns harness/regression; designer owns neither).
  # A real harness run against a served app needs the browser → @manual.

  @executable
  Scenario: the bundled QA agent carries Bash
    Given the bundled agent "src/bundle/agents/aof-qa.md"
    When its frontmatter "tools" list is parsed
    Then it contains "Bash"

  @executable
  Scenario: the bundled designer agent carries no Bash (it cannot run the browser)
    Given the bundled agent "src/bundle/agents/aof-designer.md"
    When its frontmatter "tools" list is parsed
    Then it does not contain "Bash"

  @executable
  Scenario: QA owns running the Playwright browser harness
    Given the bundled agents "src/bundle/agents/aof-qa.md" and "src/bundle/agents/aof-designer.md"
    When their bodies are read
    Then the QA contract owns running the Playwright browser harness
    And running the browser/Playwright does not appear as the designer's responsibility

  @executable
  Scenario: QA owns the toHaveScreenshot visual-regression that locks the designer-approved baseline
    Given the bundled agents "src/bundle/agents/aof-qa.md" and "src/bundle/agents/aof-designer.md"
    When their bodies are read
    Then the QA contract owns the "toHaveScreenshot" visual-regression that locks the designer-approved baseline
    And "toHaveScreenshot" does not appear as the designer's responsibility

  @executable
  Scenario: QA owns the functional / behavioural checks
    Given the bundled agent "src/bundle/agents/aof-qa.md"
    When its body is read
    Then the QA contract owns the functional / behavioural checks

  @manual
  Scenario: QA runs the harness against a served surface and produces a regression result
    Given a project app already served at the design-review base URL
    And a designer-approved baseline for a surface
    When QA runs the browser harness for that surface
    Then it renders the surface and compares it to the baseline via toHaveScreenshot
    And it reports a pass or a concrete visual-regression diff
