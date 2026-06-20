@cli @work @memory @executable
Feature: reindex reconstructs the derived index in the frozen format
  In order to keep memory a rebuildable index rather than an authoritative second copy
  reindex must reconstruct the whole index document in the frozen format from the work stream's
  .md files, scanning every milestone folder — and ingest must behave as its alias.

  # Scope: the reindex/ingest write path producing the frozen index document (ADR-005 index format:
  # backend, version, generatedAt, workDir, recordCount, records[]) at .aof/aof.memory.index.json.
  # The two parsers feed it (tasks 00/01); this feature asserts the OBSERVABLE document shape, the
  # full-vs-scoped scan, and that ingest aliases reindex (ADR-003, FINDINGS §4). The universal
  # guarantee that a second reindex reproduces an identical record set AND every source resolves to
  # live text is the acd-memory-derived-index fitness function — NOT restated as a scenario here.

  Background:
    Given a work stream whose milestone folders each carry RETROSPECTIVE.md and/or ARCHITECTURE.md sources

  Scenario: reindex writes an index document in the frozen format
    When I run "aof work memory reindex"
    Then the file ".aof/aof.memory.index.json" exists
    And its top-level keys are exactly "backend", "version", "generatedAt", "workDir", "recordCount", and "records"
    And "backend" is "local" and "version" is the index-format version
    And "generatedAt" is an ISO-8601 timestamp and "workDir" is the absolute work directory
    And "recordCount" equals the length of the "records" array
    And every entry in "records" is a frozen MemoryRecord

  Scenario: a full reindex scans every milestone folder in the stream
    Given milestones "00", "01", and "04" each hold at least one RETROSPECTIVE or ARCHITECTURE source
    When I run "aof work memory reindex"
    Then the index contains records sourced from each of milestones "00", "01", and "04"

  Scenario: --item scopes the rebuild to one milestone
    Given milestones "00" and "01" both hold sources
    When I run "aof work memory reindex --item 01"
    Then every record in the index has item "01"
    And no record sourced from milestone "00" is present

  # ADR-003 / FINDINGS §4: the local backend has no separate write path, so ingest maps to reindex.
  Scenario: ingest produces the same index document as reindex
    When I run "aof work memory reindex"
    And I capture the resulting index records
    And I run "aof work memory ingest --all"
    Then the resulting index records are the same set as the captured reindex records

  # The store is rebuilt from the .md files each run — nothing accretes across runs. (The deeper
  # "identical record set + live-source resolution" invariant is the arch-test; here we assert only
  # the observable: a re-run from the same sources yields the same recordCount, no growth.)
  Scenario: reindexing twice from the same sources does not grow the store
    When I run "aof work memory reindex"
    And I note the index "recordCount"
    And I run "aof work memory reindex" again with the sources unchanged
    Then the index "recordCount" is unchanged
