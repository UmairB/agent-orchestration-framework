@cli @adapter @memory
Feature: reindex rebuilds the 05 records AND (re)builds the work-stream graph via the 09 command
  In order to keep the graphify backend a fully derived index — records that trace to live source
  and a graph rebuilt from the same .md stream, never an authoritative second copy
  reindex must reconstruct the same frozen MemoryRecords the local backend produces (REUSING the 05
  parsers) and, where the live binary is present, drive a real work-stream graph build through the
  registered graph:build command — never by spawning graphify itself.

  # ADR-001/002/006: reindex does two things. (1) It rebuilds the derived RECORDS by REUSING
  # buildRecords / parseRetrospective / parseArchitecture from src/memory/local-indexing.mjs — the
  # exact same RETROSPECTIVE R-entries + ARCHITECTURE ADRs the local backend indexes (05/ADR-007),
  # each a frozen MemoryRecord with a resolving source:line. (2) It (re)builds the work-stream graph
  # by calling invoke("graph:build", { path: workDir, backend }, { workspace }) over wiki/work/**
  # (ADR-006 scope = work stream only). The graph is a derived artifact under graphify-out/.
  #
  # The records half is OBSERVABLE with no binary (@executable). The graph-build half needs the LIVE
  # graphify binary — it cannot run in CI (provisioned separately, RESEARCH §AA5) — so it is @manual,
  # and asserts only the OBSERVABLE outcome: a graph.json artifact exists and the build was driven
  # through the command. The structural invariants are the arch-tests' (story 03), NOT scenarios
  # here: "graphify is reached ONLY via invoke('graph:build'), never a direct spawn / never importing
  # src/graphify.mjs" is acd-graphify-backend-via-command; "the records reproduce identically across
  # runs, every source:line resolves, and graphify-out/ is git-ignored / derived" is
  # acd-graphify-derived-index. Comment-only here — do not restate them as Thens.

  Background:
    Given the graphify backend is selected
    And a work stream whose milestone folders each carry RETROSPECTIVE.md and/or ARCHITECTURE.md sources

  @executable
  Scenario: reindex rebuilds the derived records from the work stream
    When I run "aof work memory reindex"
    Then the command exits 0
    And the rebuilt record store is non-empty
    And every record in the store is a frozen MemoryRecord
    And every record's "source" resolves to live text at its "path:line"

  @executable
  Scenario: the graphify backend's records match the records the local backend produces from the same stream
    When I rebuild the records under backend "graphify"
    And I rebuild the records under backend "local" from the same work stream
    Then the two record sets are the same set of frozen MemoryRecords

  @executable
  Scenario: --item scopes the record rebuild to one milestone
    Given milestones "00" and "01" both hold RETROSPECTIVE or ARCHITECTURE sources
    When I run "aof work memory reindex --item 01"
    Then every record in the store has item "01"
    And no record sourced from milestone "00" is present

  # ADR-003 / 05/ADR-003: ingest is an ALIAS of reindex (the graphify backend, like local, has no
  # separate write path), so ingest --all rebuilds the same record set.
  @executable
  Scenario: ingest produces the same records as reindex
    When I run "aof work memory reindex"
    And I capture the resulting record set
    And I run "aof work memory ingest --all"
    Then the resulting record set is the same set as the captured reindex records

  # The records are rebuilt from the .md files each run — nothing accretes. (The deeper "identical
  # record set + every source resolves" universal invariant is the arch-test acd-graphify-derived-
  # index; here we assert only the observable: a re-run from unchanged sources does not grow the store.)
  @executable
  Scenario: reindexing twice from unchanged sources does not grow the record store
    When I run "aof work memory reindex"
    And I note the rebuilt record count
    And I run "aof work memory reindex" again with the sources unchanged
    Then the rebuilt record count is unchanged

  # The graph-build half needs the LIVE graphify binary, so it is @manual (cannot run in CI —
  # the binary is provisioned separately, RESEARCH §AA5). It asserts the OBSERVABLE outcome only:
  # a derived graph.json was produced over the work stream and the build was driven through the
  # graph:build command (not internals of how the driver spawned it — that is 09's concern, and the
  # "via the command, never a direct spawn" structural invariant is acd-graphify-backend-via-command).
  @manual
  Scenario: reindex builds a real work-stream graph through the graph:build command
    Given the graphify binary is installed and a logged-in extraction backend is available
    When I run "aof work memory reindex"
    Then the command exits 0
    And a graph.json artifact exists under "graphify-out/" over the work stream
    And the records are rebuilt alongside the graph
