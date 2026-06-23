@cli @assets @design
Feature: the bundled designer is a read-only fidelity judge that never runs the browser
  In order to make "the designer judges, the harness runs" a real, enforceable split
  the bundled aof-designer agent must carry no Bash, judge a screenshot it is handed, and — handed no
  screenshot — return INCONCLUSIVE rather than guess from code.

  # ADR-001 (responsibility-split contract): the designer's TOOL BOUNDARY is the seam. Its tools list is
  # `Read, Grep, Glob, Write, WebSearch, WebFetch` — NO `Bash` — so it is structurally incapable of
  # running a browser; the orchestration renders and HANDS it the screenshot (story 03). This story owns
  # exactly one bundled file: src/bundle/agents/aof-designer.md. The grep/parse targets below are the
  # BUNDLED asset (src/bundle/…), not .claude/ (ADR-005).
  #
  # LITMUS: "the designer carries no Bash" / "the body assigns rendering to the orchestration" are
  # confirmable by parsing the bundled asset (the artifact under test) — @executable via
  # acd-design-role-split (designer slice). The asset IS the artifact under test, so greping it is
  # black-box, not a requiring-grep into production source. "Handed no screenshot, returns INCONCLUSIVE"
  # is a runtime behaviour an operator observes → @manual. The structural CLAIM "the split is enforced by
  # a tool boundary" is an ADR-001 invariant / fitness function, not restated as a scenario here.

  @executable
  Scenario: the bundled designer agent carries no Bash tool
    Given the bundled agent "src/bundle/agents/aof-designer.md"
    When its frontmatter "tools" list is parsed
    Then it contains "Read", "Grep", "Glob", "Write", "WebSearch", and "WebFetch"
    And it does not contain "Bash"

  # The tool roster is a matrix: each required tool MUST be present (the read-only judge needs them);
  # Bash MUST be absent (the structural read-only guarantee). One row per tool keeps the boundary
  # enumerated and the regression obvious — if a future edit drops a needed tool or smuggles in Bash,
  # the offending row fails by name. "present" = the token appears in the frontmatter `tools` list;
  # "absent" = it does not.
  @executable
  Scenario Outline: the designer's tool roster admits the read-only judge tools and excludes Bash
    Given the bundled agent "src/bundle/agents/aof-designer.md"
    When its frontmatter "tools" list is parsed
    Then the tool "<tool>" is <presence>

    Examples: the read-only judge tools are present
      | tool      | presence |
      | Read      | present  |
      | Grep      | present  |
      | Glob      | present  |
      | Write     | present  |
      | WebSearch | present  |
      | WebFetch  | present  |

    Examples: the browser-capable tool is absent (the structural read-only guarantee)
      | tool | presence |
      | Bash | absent   |

  @executable
  Scenario: the designer contract assigns rendering to the orchestration, not to itself
    Given the bundled agent "src/bundle/agents/aof-designer.md"
    When its body is read
    Then it states the designer judges a screenshot it is HANDED (provided to it)
    And it states the designer does not run the browser / Playwright itself
    And no instruction tells the designer to invoke a browser or a render command

  # The browser-execution markers are QA/orchestration territory, never the designer's. The designer body
  # MUST NOT claim ownership of running Playwright or owning the toHaveScreenshot regression (ADR-001:
  # those live in QA's and the orchestration's contracts). One forbidding row per marker — pattern-ABSENT
  # in the designer body — is the sound direction of the grep (a present-in-QA assertion belongs to story
  # 02's slice of acd-design-role-split, not here). "absent from the designer body" = the marker does not
  # appear as something the designer does/owns.
  @executable
  Scenario Outline: the designer body never claims a browser-execution responsibility
    Given the bundled agent "src/bundle/agents/aof-designer.md"
    When its body is read
    Then the responsibility "<marker>" is absent from the designer's own duties

    Examples: harness / browser-run ownership stays out of the designer contract
      | marker                                            |
      | running the Playwright harness / a browser itself |
      | invoking an npx playwright render command          |
      | owning the toHaveScreenshot visual regression     |

  @manual
  Scenario: handed no screenshot, the designer returns INCONCLUSIVE rather than infer from code
    Given the designer is spawned to judge a surface
    And no rendered screenshot is provided to it
    When the designer produces its verdict
    Then the verdict is "INCONCLUSIVE"
    And it names the missing render/baseline as the gap to close
    And it does not return CONFORMS or GAPS inferred from the component code
