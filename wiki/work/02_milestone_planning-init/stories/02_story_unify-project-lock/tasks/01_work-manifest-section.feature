@cli @work
Feature: aof work init/update records the bundle manifest in the unified project lock, not a per-vertical file
  In order to keep ONE authoritative lock for all of a project's pinned dependencies and state
  `aof work init` and `aof work update` must record the ACD bundle install manifest as a `work` section
  inside the shared `.aof/aof.lock.json`, never a separate `.aof/aof.work.lock.json`, preserving the
  sections they do not own (asset/package/framework state and the `planning` section), and the bundle
  drift-check must read the `work` section of that unified lock.

  # PO decision (2026-06-19): the work-bundle lock is the OTHER per-vertical lock; the user chose to fold
  # it into the unified aof.lock.json as part of this milestone. This SUPERSEDES milestone 01's
  # separate-`aof.work.lock.json` decision (m01-ADR-004; its install-manifest ADR + the `acd-install-manifest-contract`
  # fitness function are re-recorded for the `work` section). The drift-warning behaviour (a tracked file
  # modified since install is not overwritten without --force) is unchanged in meaning — only the manifest's
  # storage location moves into the `work` section.

  @executable
  Scenario: the work bundle manifest is written to the work section of the unified lock
    When "aof work init" renders the ACD bundle into a repo
    Then the install manifest is recorded under a "work" section of ".aof/aof.lock.json"
    And no separate ".aof/aof.work.lock.json" file is written

  @executable
  Scenario: writing the work section preserves the other lock sections
    Given an ".aof/aof.lock.json" that already has asset/framework sections and a "planning" section
    When "aof work update" re-renders the bundle and rewrites its manifest
    Then the asset/framework sections and the "planning" section are preserved unchanged
    And only the "work" section is added or updated

  @executable
  Scenario: the bundle drift-check reads the work section
    Given an ".aof/aof.lock.json" whose "work" section records a tracked bundle file's install hash
    When that file has been modified and "aof work update" runs without "--force"
    Then the drift-warning fires from the "work" section's recorded hash (the file is not overwritten)

  @manual
  Scenario: work init then planning init then assets apply leave one lock holding all three states
    Given a clean repo
    When "aof work init", then "aof planning init --runtime claude", then "aof assets apply" each run to completion
    Then ".aof/aof.lock.json" is the only lock file in ".aof/"
    And it carries the "work", "planning", and asset/framework sections, each intact
