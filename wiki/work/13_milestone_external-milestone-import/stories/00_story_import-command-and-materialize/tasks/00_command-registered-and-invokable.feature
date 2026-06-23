@cli @adapter @memory @executable
Feature: import:milestone is a registered command and aof import milestone dispatches through it
  In order to turn "a milestone in another repo" into local knowledge through one safe seam
  the system must register "import:milestone" in the frozen Command core with the
  { id, input, run, cli } shape, dispatch "aof import milestone <repo> <selector>" through it via
  invoke, project the result as --json, and fail cleanly on a missing arg or an unknown sub-noun.

  # ADR-002: the command is the registered "import:milestone" Command in the frozen core
  # (src/command-core.mjs, { id, input, run, cli }, invoked via invoke(id, input, {workspace})), and
  # the CLI "aof import milestone …" is a thin argv -> invoke -> render / --json face — exactly as the
  # graph verbs are. The import unit is a milestone (SPEC §Scope): "milestone" is the only sub-noun in
  # v0, so an unknown sub-noun fails citing it. These scenarios run OFFLINE against a LOCAL fixture
  # aof-structured repo read in place (the read-only source-access seam mirrors src/planning-init.mjs's
  # AOF_PLANNING_* / resolveInjectedSha injection idiom) and behind a fixed/stubbed recovery input
  # (recovery heuristics are story 01), so the lane is @executable.
  #
  # These are OBSERVABLE behaviours: the command resolves from the registry with a callable cli adapter;
  # a run exits 0 and reports what it imported; --json projects the materialized paths + a record-count
  # summary; a missing/unknown arg exits non-zero with a usage/citation message. The STRUCTURAL
  # invariants are story-03 arch-tests, NOT scenarios here: "import:milestone is the only new command,
  # frozen { id, input, run, cli }, source access is read-only — no git write verb / no shell-string
  # spawn ever constructed" is acd-import-read-only-source; "the import imports no src/graphify.mjs and
  # writes no index JSON directly" is acd-import-indexer-extends-scan / acd-import-no-graphify-spawn.
  # Comment-only — do not restate them as Thens.

  Background:
    Given a local fixture aof-structured source repo with a recoverable milestone "00"

  Scenario: import:milestone is registered in the Command core with the frozen shape
    Given the command registered as "import:milestone"
    Then its keys are exactly "id", "input", "run", and "cli"
    And "id" is "import:milestone"
    And "run" is callable
    And its "cli" adapter is present and callable

  Scenario: aof import milestone over a local fixture repo exits 0 and reports what it imported
    When I run "aof import milestone <fixture-repo> 00"
    Then the command exits 0
    And stdout reports the milestone it imported

  # --json is the structured face (ADR-002): the materialized artifact paths + a record-count summary.
  Scenario: --json projects the materialized artifact paths and a record-count summary
    When I run "aof import milestone <fixture-repo> 00 --json"
    Then the command exits 0
    And the JSON result lists the materialized artifact paths
    And the JSON result reports a record-count summary

  Scenario: a missing <repo> fails cleanly with a usage message
    When I run "aof import milestone"
    Then the command exits non-zero
    And stderr shows a usage message for "import milestone <repo> <selector>"
    And nothing is materialized

  # SPEC §Scope: the unit of import is a milestone, not arbitrary content — "milestone" is the only
  # supported sub-noun in v0, so an unknown sub-noun fails citing the supported unit.
  Scenario: an unknown sub-noun fails cleanly citing the supported unit
    When I run "aof import widget <fixture-repo> 00"
    Then the command exits non-zero
    And stderr states the supported import unit is "milestone"
    And nothing is materialized

  # The arg-shape matrix. DEFAULT FOR A MISSING SELECTOR (decided here, documented for story 01): a
  # missing <selector> is NOT a usage error — when the source contains exactly one recoverable
  # milestone the command imports that one (the unambiguous case, exit 0); when the source is ambiguous
  # (more than one recoverable milestone) it exits non-zero asking which milestone to import. Both are
  # over the local fixture + the offline injection seam, so the whole matrix is @executable.
  # "exit" column: 0 = imported; usage = non-zero + usage message; unit = non-zero citing unit
  # "milestone"; ambiguous = non-zero asking which milestone.
  Scenario Outline: the import argument shape determines the outcome
    When I run "aof import milestone <args>" against the fixture
    Then the command <exit-result>

    Examples: a well-formed invocation imports
      | args                            | exit-result                                  |
      | <one-milestone-repo> 00         | exits 0 and reports the imported milestone   |
      | <one-milestone-repo>            | exits 0 and imports the sole milestone       |

    Examples: a missing or ambiguous required arg fails cleanly
      | args                            | exit-result                                  |
      |                                 | exits non-zero with a usage message          |
      | <many-milestone-repo>           | exits non-zero asking which milestone        |

    Examples: an unknown sub-noun is rejected
      | args                            | exit-result                                  |
      | widget <one-milestone-repo> 00  | exits non-zero citing the unit "milestone"   |
