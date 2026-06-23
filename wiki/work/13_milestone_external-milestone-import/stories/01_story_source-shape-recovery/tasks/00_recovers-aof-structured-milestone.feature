@cli @adapter @memory @executable
Feature: recovery turns an aof-structured source milestone into the frozen materialize artifact set
  In order to ground the agents' recalled precedent in what a milestone ACTUALLY did — not a fiction
  recovery over an aof-structured source (its own SPEC / ARCHITECTURE / RETROSPECTIVE) must carry the
  source's recovered intent into the materialized SPEC.md, its "## ADR-NNN" decisions into the
  materialized ARCHITECTURE.md (same heading shape), and its "## R<n>" entries into the materialized
  RETROSPECTIVE.md — so the EXISTING parseArchitecture / parseRetrospective would yield adr / lesson
  records — with every recovered record traceable to recovered source content.

  # ADR-001: an import materializes a PAIR — a legible SPEC.md (recovered intent: Objective + Scope,
  # never an index record source) + an ARCHITECTURE.md / RETROSPECTIVE.md-shaped knowledge artifact that
  # REUSES the 05 heading conventions ("## ADR-NNN" -> adr, "## R<n>" -> lesson) so the EXISTING
  # parseArchitecture / parseRetrospective index it with NO new parser. For an aof-structured source the
  # source IS an aof milestone folder, so its own SPEC / ARCHITECTURE / RETROSPECTIVE are recovered
  # largely as-is into the materialized pair. ADR-005: recovery recovers only what is PRESENT and never
  # fabricates — every recovered record traces to recovered source content.
  #
  # These run OFFLINE against a LOCAL fixture aof-structured source repo read in place (the read-only
  # source-access seam mirrors src/planning-init.mjs's AOF_PLANNING_* / resolveInjectedSha injection
  # idiom), behind story 00's FROZEN materialize signature, so the lane is @executable. They assert the
  # OBSERVABLE outcome: the materialized .md carries the recovered Objective / ADR block / R-entry, and
  # the existing parsers would yield records from it.
  #
  # The STRUCTURAL floor is NOT a Then here: "no record is produced that the materialized .md does not
  # contain, every record's source:line resolves, a re-import reproduces the identical set" is story 03's
  # acd-import-derived-index arch-test (ARCHITECTURE.md §Fitness). The "every recovered record traces to
  # recovered source content" scenario below is the BEHAVIOURAL face of no-fabrication over a fixture —
  # the structural universal is the arch-test. Comment-only — do not restate the arch-test as a Then.

  Background:
    Given a local fixture aof-structured source milestone with its own SPEC.md, ARCHITECTURE.md, and RETROSPECTIVE.md
    And I recover it through story 00's frozen materialize signature

  Scenario: the recovered SPEC.md carries the source SPEC's Objective and Scope
    Given the source SPEC.md states an Objective and a Scope
    When recovery materializes the artifact set
    Then the materialized SPEC.md carries the recovered Objective from the source
    And the materialized SPEC.md carries the recovered Scope from the source

  # The source's own "## ADR-NNN" blocks land in the materialized ARCHITECTURE.md in the SAME heading
  # shape, so the EXISTING parseArchitecture yields adr records (area "architecture", a Status line).
  Scenario: the source's ADR decisions appear in the materialized ARCHITECTURE.md as adr records
    Given the source ARCHITECTURE.md contains "## ADR-001" and "## ADR-002" decision blocks
    When recovery materializes the artifact set
    Then the materialized ARCHITECTURE.md contains a "## ADR-001" block and a "## ADR-002" block
    And parsing the materialized ARCHITECTURE.md with the existing parseArchitecture yields an "adr" record per block
    And each yielded adr record's title is the recovered ADR title from the source

  # The source's "## R<n>" entries land in the materialized RETROSPECTIVE.md in the SAME heading shape,
  # so the EXISTING parseRetrospective yields lesson records.
  Scenario: the source's retro entries appear in the materialized RETROSPECTIVE.md as lesson records
    Given the source RETROSPECTIVE.md contains "## R1" and "## R2" entries
    When recovery materializes the artifact set
    Then the materialized RETROSPECTIVE.md contains a "## R1" entry and a "## R2" entry
    And parsing the materialized RETROSPECTIVE.md with the existing parseRetrospective yields a "lesson" record per entry

  # The behavioural face of no-fabrication (ADR-005): every recovered record corresponds to source
  # content. (The structural universal — no record absent from the materialized .md, source:line
  # resolves — is story 03's acd-import-derived-index arch-test, NOT a Then here.)
  Scenario: every recovered record traces back to recovered source content
    Given the source contains exactly 2 ADR blocks and exactly 3 R-entries
    When recovery materializes the artifact set
    Then the materialized ARCHITECTURE.md yields exactly 2 adr records
    And the materialized RETROSPECTIVE.md yields exactly 3 lesson records
    And no recovered adr or lesson record is present that the source did not contain

  # Section-present -> artifact-present mapping over an aof-structured source. Each row varies WHICH of
  # the source's three docs is present; the outcome is which materialized artifact carries records vs
  # records the absence (the absence rows are the bridge to task 02's matrix — here they confirm a
  # present section is recovered and a missing one is not invented).
  # "spec-section" column: the Objective the materialized SPEC.md carries (or "not recoverable" when the
  # source SPEC is absent — ADR-005). "arch-records" / "retro-records": records the existing parsers yield
  # from the materialized artifact (0 when that source doc was absent).
  Scenario Outline: a present source section is recovered; a missing one is not invented
    Given an aof-structured source with <source-docs>
    When recovery materializes the artifact set
    Then the materialized SPEC.md <spec-result>
    And the existing parseArchitecture over the materialized ARCHITECTURE.md yields <arch-records> adr records
    And the existing parseRetrospective over the materialized RETROSPECTIVE.md yields <retro-records> lesson records

    Examples: all three source docs present
      | source-docs                                  | spec-result                       | arch-records | retro-records |
      | SPEC + ARCHITECTURE (2 ADRs) + RETROSPECTIVE (3 R) | carries the recovered Objective   | 2            | 3             |

    Examples: only the SPEC is present
      | source-docs                                  | spec-result                       | arch-records | retro-records |
      | SPEC only                                    | carries the recovered Objective   | 0            | 0             |

    Examples: SPEC absent, ARCHITECTURE and RETROSPECTIVE present
      | source-docs                                  | spec-result                       | arch-records | retro-records |
      | ARCHITECTURE (1 ADR) + RETROSPECTIVE (1 R)   | records the intent as not recoverable | 1        | 1             |
