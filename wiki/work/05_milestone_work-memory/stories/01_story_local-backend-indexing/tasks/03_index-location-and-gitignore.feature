@cli @work @memory @executable
Feature: The derived index is written only to the fixed path and is git-ignored
  In order to keep the derived index from ever being committed as an authoritative copy
  reindex must write the index only to ".aof/aof.memory.index.json" and ensure that path is
  git-ignored, adding the .gitignore entry when it is absent.

  # Scope: the index location + .gitignore deliverable (ADR-001/005). ".aof/" is currently tracked in
  # this repo, so adding the ignore entry is a real outcome, not implicit. These are observable
  # file-outcome scenarios: which path is written, and what .gitignore contains afterwards. The
  # "written ONLY to the fixed path / each record matches the frozen shape" invariant is also the
  # acd-memory-index-location fitness function; here we assert the concrete create/idempotent
  # behaviour of the .gitignore entry, not the universal shape guarantee.

  Background:
    Given a project root holding a tracked ".aof/" directory

  Scenario: reindex writes the index only to the fixed path under .aof/
    Given no memory index exists yet
    When I run "aof work memory reindex"
    Then the file ".aof/aof.memory.index.json" exists
    And no other memory index file is written elsewhere in the project

  Scenario: reindex adds the index path to .gitignore when it is absent
    Given ".gitignore" does not yet ignore ".aof/aof.memory.index.json"
    When I run "aof work memory reindex"
    Then ".gitignore" contains an entry that ignores ".aof/aof.memory.index.json"

  Scenario: reindex does not duplicate an existing .gitignore entry
    Given ".gitignore" already ignores ".aof/aof.memory.index.json"
    When I run "aof work memory reindex"
    Then ".gitignore" still ignores ".aof/aof.memory.index.json" with no duplicate entry

  Scenario: the written index path is itself git-ignored after reindex
    Given a project with no ".gitignore" entry for the memory index
    When I run "aof work memory reindex"
    Then git treats ".aof/aof.memory.index.json" as ignored
