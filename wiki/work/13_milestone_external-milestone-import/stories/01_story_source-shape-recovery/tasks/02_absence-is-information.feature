@cli @adapter @memory @executable
Feature: absence is information — recovery marks what the source lacks and fabricates nothing
  In order to keep the precedent the agents recall honest — because a fabricated precedent is worse
  than none, it grounds the agents in fiction
  recovery over a thin source must RECORD what is absent (an explicit "not recoverable" marker in the
  materialized SPEC.md; no ADR records when there are no decisions to recover; no lesson records when
  there are no outcomes to recover) and emit NO record not grounded in recovered source content — a
  thin or empty source yields zero index records, never invented ones.

  # ADR-005 ("absence is information"): recovery recovers only what is PRESENT and NEVER fabricates a
  # SPEC Objective, an ADR, or a lesson the source never had. A missing intent is RECORDED as missing
  # (the materialized SPEC.md carries an explicit "not recoverable" marker — it does not invent an
  # Objective); a missing decision set yields NO "## ADR-NNN" blocks (the materialized ARCHITECTURE.md is
  # absent or explicitly empty of records); a missing outcome set yields NO "## R<n>" entries. ADR-001:
  # SPEC.md is legible intent, never an index record source — so its "not recoverable" marker is a
  # legible note, not a record.
  #
  # These run OFFLINE against THIN local fixture source repos (an empty repo; a repo with only a README;
  # a repo with only design docs; a repo with only a commit history) read in place behind story 00's
  # frozen materialize signature, so the lane is @executable. They assert the OBSERVABLE: a thin source
  # yields the absence-marker and ZERO records of the kind the source lacked.
  #
  # The STRUCTURAL floor is NOT a Then here: "no record is produced that the materialized .md does not
  # contain — the same source:line-resolves discipline that catches fabrication" is story 03's
  # acd-import-derived-index arch-test (ARCHITECTURE.md §Fitness, ADR-005). This feature is the
  # BEHAVIOURAL face of that floor — recovery RECORDS the absence — over a thin fixture; the structural
  # universal is the arch-test. Comment-only — do not restate the arch-test as a Then.

  Background:
    Given I recover a thin local fixture source repo through story 00's frozen materialize signature

  Scenario: a source with no recoverable intent records the absence and invents no Objective
    Given a source with no README and no SPEC — no recoverable intent
    When recovery materializes the artifact set
    Then the materialized SPEC.md records the intent as explicitly "not recoverable"
    And the materialized SPEC.md states no Objective the source did not contain

  Scenario: a source with no recoverable decisions emits no fabricated ADR record
    Given a source with no docs/, no ADR files, and no architecture decisions to recover
    When recovery materializes the artifact set
    Then the materialized ARCHITECTURE.md is absent or carries no "## ADR-NNN" block
    And the existing parseArchitecture over the materialized artifact set yields 0 adr records

  Scenario: a source with no recoverable outcomes emits no fabricated lesson record
    Given a source with no commit history and no retrospective to recover
    When recovery materializes the artifact set
    Then the materialized RETROSPECTIVE.md is absent or carries no "## R<n>" entry
    And the existing parseRetrospective over the materialized artifact set yields 0 lesson records

  # The whole-source floor (behavioural face of ADR-005): a thin/empty source grounds zero records.
  Scenario: a thin source yields zero index records, not invented ones
    Given an essentially empty source with no recoverable intent, decisions, or outcomes
    When recovery materializes the artifact set
    Then the existing parsers over the materialized artifact set yield 0 records in total
    And the materialized SPEC.md records the intent as explicitly "not recoverable"

  # THE KEY MATRIX for this story: present/absent each of {intent, decisions, outcomes} -> which
  # materialized artifact carries records vs records the absence. The full 2^3 truth table. A PRESENT
  # signal is recovered (its parser yields >0 records / the SPEC carries an Objective); an ABSENT signal
  # is MARKED, never invented (0 records of that kind / the SPEC's "not recoverable" marker). The
  # all-absent row is the no-fabrication floor; the all-present row is the full recovery of task 00/01.
  # "spec" column: "Objective" = the materialized SPEC.md carries the recovered Objective; "absent-marker"
  # = it records the intent as "not recoverable". "adr-records" / "lesson-records": records the existing
  # parseArchitecture / parseRetrospective yield from the materialized artifact set (0 = the absence).
  Scenario Outline: present is recovered, absent is marked — the no-fabrication truth table
    Given a source where intent is <intent>, decisions are <decisions>, and outcomes are <outcomes>
    When recovery materializes the artifact set
    Then the materialized SPEC.md carries <spec>
    And the existing parseArchitecture over the materialized artifact set yields <adr-records> adr records
    And the existing parseRetrospective over the materialized artifact set yields <lesson-records> lesson records

    Examples: all three present -> all recovered
      | intent  | decisions | outcomes | spec          | adr-records | lesson-records |
      | present | present   | present  | Objective     | >0          | >0             |

    Examples: one absent -> that kind is marked, the rest recovered
      | intent  | decisions | outcomes | spec          | adr-records | lesson-records |
      | absent  | present   | present  | absent-marker | >0          | >0             |
      | present | absent    | present  | Objective     | 0           | >0             |
      | present | present   | absent   | Objective     | >0          | 0              |

    Examples: two absent -> only the present kind is recovered
      | intent  | decisions | outcomes | spec          | adr-records | lesson-records |
      | present | absent    | absent   | Objective     | 0           | 0              |
      | absent  | present   | absent   | absent-marker | >0          | 0              |
      | absent  | absent    | present  | absent-marker | 0           | >0             |

    Examples: all three absent -> nothing recovered, everything marked (the no-fabrication floor)
      | intent  | decisions | outcomes | spec          | adr-records | lesson-records |
      | absent  | absent    | absent   | absent-marker | 0           | 0              |
