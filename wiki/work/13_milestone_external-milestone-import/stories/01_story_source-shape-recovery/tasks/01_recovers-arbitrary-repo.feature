@cli @adapter @memory
Feature: recovery turns an arbitrary repo into the frozen materialize artifact set, written into the 05 shapes
  In order to learn from a milestone delivered in a repo that never knew aof's conventions
  recovery over an arbitrary source (a README, a docs/ tree, ADR-style files, commit history) must
  recover the intent from the README/overview into the materialized SPEC.md, the decisions from
  docs/ADRs into the materialized ARCHITECTURE.md shape, and the outcomes/lessons from history into the
  materialized RETROSPECTIVE.md shape — written INTO the 05 heading conventions so the EXISTING
  parseArchitecture / parseRetrospective index them — recovering what is present and never fabricating.

  # ADR-001: an arbitrary source has no aof docs, so recovery READS its arbitrary signals (README /
  # docs/ / ADR files / git log) and WRITES the recovered knowledge INTO the same 05 doc shapes the two
  # existing parsers already read ("## ADR-NNN" -> adr, "## R<n>" -> lesson), so they index it with NO
  # new parser. The recovered intent (README/overview) becomes the materialized SPEC.md's Objective/Scope
  # (legible, never an index record source). ADR-005: recovery recovers only what the arbitrary source
  # PRESENTS — a thin signal is recovered, an absent one is marked absent (task 02), never invented.
  #
  # The @executable rows run OFFLINE against a SMALL LOCAL arbitrary-shaped fixture repo (a README, a
  # docs/ tree, ADR-style files, and — see the developer feasibility note in STATE — a fixture commit
  # history created on disk by the harness or stubbed through the read-only-source injection seam), read
  # in place behind story 00's frozen materialize signature. The @manual row is recovery over a
  # REAL-WORLD arbitrary repo the user supplies at build (aof:continue 13/01) — it needs a real external
  # repo so it cannot run in CI.
  #
  # The STRUCTURAL floor is NOT a Then here: "no record absent from the materialized .md, source:line
  # resolves, a re-import reproduces the identical set" is story 03's acd-import-derived-index arch-test
  # (ARCHITECTURE.md §Fitness). These scenarios assert only the OBSERVABLE: the materialized .md recovers
  # the present signal in the 05 shape, and the existing parsers would yield records from it.

  Background:
    Given a small local arbitrary-shaped fixture source repo (no aof SPEC / ARCHITECTURE / RETROSPECTIVE)
    And I recover it through story 00's frozen materialize signature

  @executable
  Scenario: a README's overview is recovered into the materialized SPEC.md intent
    Given the fixture repo has a README whose overview states what the project set out to do
    When recovery materializes the artifact set
    Then the materialized SPEC.md recovers that intent as its Objective
    And the materialized SPEC.md is legible intent, not an index record source

  # docs/ or ADR-style files -> the ARCHITECTURE.md shape, so the EXISTING parseArchitecture yields adr
  # records (the recovered decisions written into "## ADR-NNN" blocks with a Status line).
  @executable
  Scenario: decisions in docs/ or ADR-style files are recovered into the materialized ARCHITECTURE.md shape
    Given the fixture repo has a docs/ tree or ADR-style files recording design decisions
    When recovery materializes the artifact set
    Then the materialized ARCHITECTURE.md contains the recovered decisions as "## ADR-NNN" blocks
    And parsing the materialized ARCHITECTURE.md with the existing parseArchitecture yields an "adr" record per recovered decision

  # commit history -> the RETROSPECTIVE.md shape, so the EXISTING parseRetrospective yields lesson
  # records (recovered outcomes/lessons written into "## R<n>" entries).
  @executable
  Scenario: outcomes in the commit history are recovered into the materialized RETROSPECTIVE.md shape
    Given the fixture repo has a commit history recording what was delivered
    When recovery materializes the artifact set
    Then the materialized RETROSPECTIVE.md contains the recovered outcomes as "## R<n>" entries
    And parsing the materialized RETROSPECTIVE.md with the existing parseRetrospective yields a "lesson" record per recovered outcome

  # The point of writing INTO the 05 shapes: the existing parsers index the materialized artifacts with
  # no new parser. Observable: parse the materialized .md with the EXISTING parsers and get records.
  @executable
  Scenario: the recovered artifacts use the 05 heading conventions so the existing parsers index them
    Given the fixture repo presents a README, design docs, and a commit history
    When recovery materializes the artifact set
    Then the existing parseArchitecture over the materialized ARCHITECTURE.md yields at least one adr record
    And the existing parseRetrospective over the materialized RETROSPECTIVE.md yields at least one lesson record
    And every yielded record matches the frozen MemoryRecord shape

  # Arbitrary-source-signals -> recovered-artifact matrix. Each row varies WHICH arbitrary signals the
  # fixture presents; the outcome is which materialized artifact carries records and which records the
  # absence (the bridge to task 02 — a present signal is recovered, an absent one is marked, never
  # invented). "spec" column: what the materialized SPEC.md carries. "arch" / "retro": >0 = the existing
  # parser yields records from that artifact; 0 = absent / records the absence.
  @executable
  Scenario Outline: which arbitrary signals are present determines which artifacts carry records
    Given an arbitrary fixture repo with <signals>
    When recovery materializes the artifact set
    Then the materialized SPEC.md <spec-result>
    And the existing parseArchitecture over the materialized ARCHITECTURE.md yields <arch> adr records
    And the existing parseRetrospective over the materialized RETROSPECTIVE.md yields <retro> lesson records

    Examples: README only -> intent recovered, no decisions or outcomes
      | signals                                   | spec-result                           | arch | retro |
      | a README overview                         | recovers the intent as Objective      | 0    | 0     |

    Examples: docs/ADRs only -> decisions recovered, no stated intent
      | signals                                   | spec-result                           | arch | retro |
      | docs/ and ADR-style files                 | records the intent as not recoverable | >0   | 0     |

    Examples: git log only -> outcomes recovered, no stated intent
      | signals                                   | spec-result                           | arch | retro |
      | a commit history                          | records the intent as not recoverable | 0    | >0    |

    Examples: README + docs + git log -> all three recovered
      | signals                                   | spec-result                           | arch | retro |
      | a README, docs/ADRs, and a commit history | recovers the intent as Objective      | >0   | >0    |

  # The real-world lane (ADR-002: live external repo). Recovery over a REAL arbitrary repo the user
  # supplies at build (aof:continue 13/01) must produce a LEGIBLE, NON-FABRICATED artifact set — the
  # final judgement that the offline-fixture heuristics hold on a real shape. @manual: it needs a real
  # external repo, so it cannot run in CI.
  @manual
  Scenario: recovery over a real-world arbitrary repo recovers a legible, non-fabricated artifact set
    Given a real-world arbitrary example repo supplied at build
    When I run "aof import milestone <real-repo> <selector>"
    Then the materialized SPEC.md / ARCHITECTURE.md / RETROSPECTIVE.md are legible
    And the recovered records the existing parsers yield are each grounded in real source content
    And no Objective, decision, or lesson is present that the real source did not contain
