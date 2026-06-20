@cli @planning
Feature: aof planning init records provenance in the unified project lock, not a per-vertical file
  In order to keep ONE authoritative lock for all of a project's pinned dependencies and state
  (a single source of truth — not a lock file per vertical)
  `aof planning init` must record its provenance as a `planning` section inside the shared
  `.aof/aof.lock.json`, never a separate `.aof/aof.planning.lock.json`, and must preserve the sections
  it does not own (asset `files`, `packages`, `frameworks`, `frameworkInstallAttempts`).

  # PO decision (2026-06-19): `.aof/aof.lock.json` is the single unified lock; per-vertical lock files
  # are eliminated. This SUPERSEDES ADR-003's separate-file decision — provenance moves to a `planning`
  # section of aof.lock.json — and changes the `acd-planning-lock-isolation` fitness function from
  # FILE-isolation ("touch only aof.planning.lock.json") to SECTION-isolation ("write only the
  # `planning` section; never clobber the asset/package/framework sections"). The architect re-records
  # ADR-003 and revises the fitness function at build. Sibling task 01 does the same for the work lock.

  @executable
  Scenario: provenance is written to the planning section of the unified lock
    When "aof planning init --runtime claude" completes a successful install
    Then the provenance is recorded under a "planning" section of ".aof/aof.lock.json"
    And no separate ".aof/aof.planning.lock.json" file is written
    And the planning section carries the frozen schema (source, marketplaceName, marketplaceVersion, sha, runtime, plugins, codex)

  @executable
  Scenario: writing planning provenance preserves the other lock sections
    Given an ".aof/aof.lock.json" that already records asset files, packages, frameworks and framework install attempts
    When "aof planning init --runtime claude" writes its planning provenance
    Then the pre-existing asset/package/framework sections are preserved unchanged
    And only the "planning" section is added or updated

  @executable
  Scenario: the asset-lock writer preserves the planning section
    Given an ".aof/aof.lock.json" that already has a "planning" section
    When "aof assets apply" rewrites the lock from the render plan
    Then the "planning" section is carried through unchanged
    And the asset sections reflect the new render plan

  @executable
  Scenario: the re-run guard keys off the planning section, not a separate file
    Given ".aof/aof.lock.json" already has a "planning" section
    When "aof planning init" is run again without "--force"
    Then it refuses (guarded) and writes nothing
    And re-running with "--force" re-pins the planning section while preserving the other sections

  @manual
  Scenario: a real planning init plus assets apply leaves one lock with both states intact
    Given a project where "aof assets apply" has written ".aof/aof.lock.json"
    When "aof planning init --runtime claude" runs to completion and then "aof assets apply" runs again
    Then ".aof/aof.lock.json" is the only lock file in ".aof/"
    And it contains both the asset/framework state and the planning section, each intact
