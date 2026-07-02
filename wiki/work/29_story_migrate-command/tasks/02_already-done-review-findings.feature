Feature: migrate reconciles already-delivered work into an honest starting state
  In order to bring in-flight work under aof without pretending it is greenfield
  the system must detect what the source has already delivered, have the architect review it, and record
  developer-actionable findings — so the produced item's status reflects reality, not a blank slate.

  # STORY.md hint 3: already-done work is RECONCILED, not re-run. When the source carries delivered work
  # (code, tests, "done" markers), migrate must (a) detect it so the produced item's status / its stories'
  # status reflect what is actually done rather than a uniform "not-started", and (b) run the architect
  # over what was delivered and record the issues a developer can then pick up as findings. migrate NEVER
  # stamps "done" — "done" is earned only via aof:verify, so the honest ceiling it records is "in-review".
  #
  # This feature MIXES lanes, so the verification tag is per-scenario (no feature-level lane to inherit):
  #   @executable -> the OBSERVABLE skeleton of reconciliation: a source with delivered work produces an
  #                  item whose status is not a blank "not-started", a findings record is written, and a
  #                  source with NO delivered work produces a clean not-started item with no spurious
  #                  findings. Runs offline against local fixtures behind the read-only source seam.
  #   @manual     -> the architect's review itself is agent behaviour: that the recorded findings are real
  #                  structural issues grounded in the delivered work (and that none are fabricated) is
  #                  judged by procedure in the milestone UAT.md (which points back here with `verifies ->`),
  #                  not asserted as if migrate's CLI code produced the judgement.
  #
  # Where findings land (a findings record vs STATE/SPEC section) is the developer/architect's call; these
  # scenarios assert that findings EXIST and are developer-actionable, not the file they live in.

  Background:
    Given a local fixture source folder under this story's "fixtures/" dir
    And the fixture can present either delivered work or no delivered work

  @executable
  Scenario: a source with delivered work produces an item whose status reflects what is done
    Given the fixture folder carries work that has already been delivered
    When I run "aof migrate <fixture-folder>"
    Then the produced item's status reflects that work was delivered, not a uniform "not-started"

  @executable
  Scenario: reconciliation records developer-actionable findings for the delivered work
    Given the fixture folder carries delivered work the architect reviews
    When I run "aof migrate <fixture-folder>"
    Then a findings record is written that a developer can pick up at "aof:continue"
    And each finding names what to act on, not just that something is wrong

  @executable
  Scenario: a source with no delivered work produces a clean not-started item with no spurious findings
    Given the fixture folder states intent but has delivered no work yet
    When I run "aof migrate <fixture-folder>"
    Then the produced item is "not-started"
    And no findings are recorded for it

  # The reconciliation matrix — what the source presents maps to {status, findings present?}. The
  # absence case is information: no delivered work => no findings, never an invented one.
  #
  # The rows walk the delivery axis from nothing -> partial-with-gaps -> fully delivered, and pin the two
  # observables a tester reads off the produced item without inspecting source: its status, and whether a
  # findings record exists. The rule the matrix encodes: status tracks how much was delivered; findings
  # are present IFF the delivered work has gaps. migrate NEVER stamps "done" — "done" is earned only via
  # aof:verify, so the honest ceiling migrate can record is "in-review" (ready for the verify gate) when
  # work is fully and cleanly delivered with no findings; fully delivered but with gaps stays in-progress
  # and carries findings. "status" is the produced item's recorded status; "findings" is none (no
  # findings record) or present (a developer-actionable findings record exists).
  @executable
  Scenario Outline: what the source has delivered determines the produced status and whether findings exist
    Given the fixture folder presents <delivered>
    When I run "aof migrate <fixture-folder>"
    Then the produced status is <status> and findings are <findings>

    Examples: no delivered work -> not-started, no findings (absence is information)
      | delivered                          | status        | findings  |
      | no delivered work                  | not-started   | none      |

    Examples: partially delivered with gaps -> in-progress, findings present
      | delivered                          | status        | findings  |
      | some work delivered with gaps      | in-progress   | present   |
      | most work delivered, a few gaps    | in-progress   | present   |

    Examples: fully delivered, gaps remain -> in-progress, findings present (never "done" — verify earns that)
      | delivered                          | status        | findings  |
      | all work delivered but with gaps   | in-progress   | present   |

    Examples: fully delivered, no gaps -> in-review (ready for the verify gate), no findings
      | delivered                          | status        | findings  |
      | all work delivered, no gaps        | in-review     | none      |

  # The architect's review is agent behaviour: @manual, verified by procedure in the milestone UAT.md.
  @manual
  Scenario: the architect's findings are real structural issues grounded in the delivered work
    Given a fixture (or real) source whose delivered work has genuine structural gaps
    When migrate runs the architect over what was delivered
    Then the recorded findings each trace to a real gap in the delivered work
    And no finding is recorded that the delivered work does not actually exhibit
