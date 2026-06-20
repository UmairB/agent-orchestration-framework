@cli @work @memory @executable
Feature: status reports the derived store and never throws on an absent one
  In order to see at a glance what memory holds without rebuilding it
  status must report the backend, the record count, the store location, and the lesson/adr split —
  and report a zero/absent store gracefully before any reindex has run.

  # Scope: the local backend's status method (ADR-003 — "{ backend, recordCount, ... }; never throws
  # on an absent store"). These are observable read-only reports over the on-disk index. The
  # lesson/adr split keeps the ADR-heavy-early corpus reality visible (ADR-007, FINDINGS §3).

  Background:
    Given a work stream with a local memory backend selected

  Scenario: status before any reindex reports an absent store with zero counts, without throwing
    Given no memory index exists yet
    When I run "aof work memory status"
    Then the command exits 0
    And it reports backend "local" and recordCount 0
    And it reports the store as absent
    And it does not error

  Scenario: status after reindex reports the record count and store location
    Given I have run "aof work memory reindex" over a stream with sources
    When I run "aof work memory status"
    Then the command exits 0
    And it reports backend "local"
    And it reports a recordCount equal to the number of records in the index
    And it reports the store location ".aof/aof.memory.index.json"

  Scenario: status reports the lesson/adr split of the indexed records
    Given I have run "aof work memory reindex" over a stream holding RETROSPECTIVE lessons and ARCHITECTURE adrs
    When I run "aof work memory status"
    Then it reports how many records are lessons and how many are adrs
    And the lesson count plus the adr count equals the reported recordCount
