@cli @adapter @memory @executable
Feature: an intent-only import emits a recallable AOF.md digest, so a zero-record import is no longer invisible to recall
  In order for an imported milestone that recovered only intent (no decisions, no outcomes) to ground
  the ACD agents through `aof work memory recall` — instead of contributing zero records — the import
  must ALSO materialize an AOF.md digest (the milestone-14 doc type), whose every "## " section the
  EXISTING parseAof indexes as one frozen `summary` record resolving within the import store.

  # ADR-006: the import emits an AOF.md digest ONLY for the zero-record case (intent recovered, but no
  # decisions and no outcomes). It reuses milestone-14's digest doc shape verbatim — "## Intent" <- the
  # recovered objective, "## Scope" <- the recovered scope — so the EXISTING parseAof turns each section
  # into one `summary` MemoryRecord. NO new parser, NO new record shape (ADR-001 holds: the import is a
  # PRODUCER of .md the existing parsers read). scanImportStore (ADR-003's extended scan) reads AOF.md
  # alongside ARCHITECTURE.md/RETROSPECTIVE.md, same leg-aware source base, same namespaced import item.
  # ADR-005: absence is information — a section is emitted only for an intent half the source carried; an
  # unrecoverable intent emits no digest. A re-import is a byte-identical one-time snapshot.
  #
  # These scenarios run OFFLINE against a fixture import store materialized via materializeImport with a
  # FIXED `recovered` (no recovery engine, no binary). The STRUCTURAL invariant — "the digest reuses the
  # existing parseAof; the import side adds no new parser/record shape; an ADR/retro import emits none" —
  # is the arch-test acd-import-digest-recallable, NOT a scenario here. Comment-only; do not restate it.

  Background:
    Given a project with a local memory backend and an empty work stream
    And an aof-structured source milestone whose SPEC carries a "## Goal" and "## Scope" but no ARCHITECTURE/RETROSPECTIVE

  Scenario: an intent-only import materializes an AOF.md digest, one "## " section per recovered half
    When I import that milestone
    Then the import store holds an "AOF.md" digest
    And the digest carries a "## Intent" section recovered from the objective
    And the digest carries a "## Scope" section recovered from the scope
    And the reported record count is the number of digest sections

  Scenario: reindex indexes the digest into frozen summary records that resolve in the import store
    When I import that milestone
    And I run "aof work memory reindex"
    Then the rebuilt index contains a "summary" record per digest section
    And every digest "summary" record is a frozen MemoryRecord
    And every digest "summary" record's "source" resolves to its "## " heading line within the import store

  Scenario: the digest makes the imported intent recall-able through the unchanged verb
    When I import that milestone
    And I run "aof work memory reindex"
    And I run "aof work memory recall" for a phrase from the recovered intent
    Then an imported "summary" digest record is among the hits

  # ADR-006: the digest is the FALLBACK for the zero-record case. A milestone that recovered ADR/retro
  # records already grounds recall, so it emits no digest and its materialized artifact set is unchanged.
  Scenario: an import that recovered decisions/outcomes emits NO digest
    Given an aof-structured source milestone carrying ADR decisions and retrospective outcomes
    When I import that milestone
    Then the import store holds NO "AOF.md" digest
    And the index carries the imported "adr" and "lesson" records but no "summary" records

  # ADR-005: absence is information — no fabricated digest section.
  Scenario: an import whose intent is not recoverable fabricates no digest
    Given a source milestone with no recoverable intent
    When I import that milestone
    Then the import store holds NO "AOF.md" digest
    And the import contributes zero records

  # ADR-005: a one-time snapshot — a re-import re-materializes byte-identically (no timestamp, no accretion).
  Scenario: a re-import yields a byte-identical digest
    When I import that milestone twice over the same source
    Then the second AOF.md digest is byte-identical to the first
