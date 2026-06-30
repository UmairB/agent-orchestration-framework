Feature: migrate tolerates any source shape, reusing import's recovery, never demanding aof's layout
  In order to adopt work delivered in a folder that never knew aof's conventions
  the system must read and normalise whatever shape the source presents — reusing import's recovery where
  it fits — and never require a wiki/work layout, NN_milestone_ naming, or any aof doc to exist.

  # STORY.md hint 4 + the project principle (import ingests foreign knowledge AS-IS, never demanding aof
  # folder structure): migrate's source-reading must be as tolerant as import's. It reuses import's
  # recovery seam (resolveImportSource read-only access + recoverMilestone's recovery, including the
  # arbitrary-source lane: a README's overview -> intent, docs/ADR-style files -> decisions, history ->
  # outcomes) so an aof-shaped source, a foreign-tool-shaped source, and a bare README+code folder all
  # migrate without the source being reshaped first. Absence is information: a thin source recovers a thin
  # item, never a fabricated one; an empty/unrecoverable source is refused cleanly, never half-written.
  #
  # MIXED lanes, so per-scenario tags:
  #   @executable -> runs offline against small LOCAL fixture folders of varied shape, read in place
  #                  behind the read-only source seam; the source is never mutated (no git write verb).
  #   @manual     -> migrate over a REAL-WORLD arbitrary folder the user supplies at build (aof:continue),
  #                  which needs a real external shape so it cannot run in CI; procedure in the UAT.md.
  #
  # "migrate constructs no git write verb against the source" is a story arch-test (read-only source),
  # NOT a Then here — these scenarios assert the OBSERVABLE: varied shapes migrate, thin shapes degrade.

  Background:
    Given local fixture source folders under this story's "fixtures/" dir of varied shape
    And each is read in place through import's read-only source-access seam

  @executable
  Scenario: a non-aof folder (a README and code, no aof docs) migrates without error
    Given a fixture folder with a README and source code but no SPEC.md / ARCHITECTURE.md / wiki/work
    When I run "aof migrate <fixture-folder>"
    Then the command exits 0 and produces a managed item
    And the README's overview is recovered as the produced SPEC.md's objective

  @executable
  Scenario: migrate never requires the source to be reshaped into aof's layout first
    Given a fixture folder that uses neither a wiki/work tree nor NN_milestone_ naming
    When I run "aof migrate <fixture-folder>"
    Then it migrates the folder as-is
    And it does not error asking the source to be restructured into aof's folder conventions

  @executable
  Scenario: a thin source recovers a thin item — present signals only, nothing fabricated
    Given a fixture folder that presents only an overview and no decisions or delivered work
    When I run "aof migrate <fixture-folder>"
    Then the produced item recovers the overview as its objective
    And it records the missing decisions and outcomes as not recoverable, never inventing them

  @executable
  Scenario: an empty or unrecoverable source is refused cleanly, leaving nothing half-written
    Given a fixture folder with no recoverable intent, decisions, or work
    When I run "aof migrate <fixture-folder>"
    Then the command exits non-zero stating nothing was recoverable to migrate
    And no partial milestone folder is left under work.dir

  @executable
  Scenario: migrate reads the source read-only — the source folder is unchanged after migrating
    When I run "aof migrate <fixture-folder>"
    Then the source folder's contents are byte-for-byte unchanged

  # The source-shape matrix — which shape the source presents maps to what migrate recovers. Mirrors
  # import's arbitrary-source recovery so the tolerance is identical at the source-reading seam.
  #
  # The rows walk the shape axis from fully aof-structured -> foreign-tool-shaped -> bare README+code ->
  # thin -> empty, and pin the single observable a tester reads: did it exit 0 with a managed item (and
  # what intent did the SPEC.md recover), or did it refuse cleanly with nothing left under work.dir? The
  # rule the matrix encodes: every shape that carries a recoverable signal migrates as-is, never demanding
  # aof's layout; what is present is recovered, what is absent is marked not recoverable (never invented);
  # only a source with NO recoverable signal is refused, and a refusal leaves nothing half-written.
  # "outcome" is that single black-box observable (exit + what does/does not appear under work.dir).
  @executable
  Scenario Outline: the source shape determines what is recovered, never demanding aof's layout
    Given a fixture folder shaped as <shape>
    When I run "aof migrate <fixture-folder>"
    Then it produces <outcome>

    Examples: an aof-structured source recovers its SPEC and substructure
      | shape                                    | outcome                                                       |
      | an aof-structured milestone              | a managed item carrying the recovered SPEC + stories and tasks|

    Examples: a foreign-tool-shaped source migrates as-is, never reshaped first
      | shape                                    | outcome                                                       |
      | a GSD/.planning-style tree               | a managed item recovered from its plan docs, source unreshaped|
      | a docs/ + ADR-style decision tree        | a managed item recovering those decisions, source unreshaped  |

    Examples: a bare README+code source recovers the README as intent
      | shape                                    | outcome                                                       |
      | a bare README and code, no aof docs      | a managed item with the README recovered as its objective     |

    Examples: a thin source recovers a thin item, marking absence not fabricating it
      | shape                                    | outcome                                                       |
      | only an overview, no decisions or work   | a thin managed item, missing decisions/outcomes marked absent |

    Examples: an empty / unrecoverable source is refused cleanly, nothing half-written
      | shape                                    | outcome                                                       |
      | an empty folder, no recoverable signal   | a non-zero refusal stating nothing was recoverable, work.dir untouched |

  # The real-world lane: migrate over a REAL arbitrary folder the user supplies at build. @manual — it
  # needs a real external shape, so it cannot run in CI; the procedure lives in the milestone UAT.md.
  @manual
  Scenario: migrate over a real-world arbitrary folder produces a legible, non-fabricated managed item
    Given a real-world arbitrary folder supplied at build
    When I run "aof migrate <real-folder>"
    Then the produced SPEC / stories / tasks are legible and grounded in the real source content
    And no objective, story, or task is present that the real source did not warrant
