@cli @assets @distribution @executable
Feature: After updating, the install manifest reflects the new state
  In order to keep an accurate record of what is installed for the next update
  the system must rewrite ".aof/aof.work.lock.json" to the new bundle release and the hashes of the files it actually wrote, leaving the consumer's own lock untouched.

  Background:
    Given a repo previously installed with "aof work init", carrying ".aof/aof.work.lock.json" and its matching files on disk
    And a newer bundle release whose member content differs from the recorded release

  Scenario: the rewritten manifest records the new release and the freshly written hashes
    When I run "aof work update"
    Then ".aof/aof.work.lock.json" records the new release under "bundle.version"
    And each updated and created member's "files[]" hash matches the file freshly written to disk

  Scenario: a drift-warned member keeps its previous manifest entry rather than being dropped
    Given a managed file was edited locally and is reported as drifted, not overwritten
    When I run "aof work update"
    Then that member's entry in ".aof/aof.work.lock.json" is unchanged from before the update
    And the entry is not dropped from the manifest

  Scenario: the rewrite stays a valid lock-v2 manifest and does not touch the consumer's own lock
    Given the consumer's own ".aof/aof.lock.json" is present with its own contents
    When I run "aof work update"
    Then ".aof/aof.work.lock.json" is a valid lock-v2 manifest with "version" 2 at that fixed path
    And ".aof/aof.lock.json" is byte-for-byte unchanged

  # Each post-update file class produces a specific manifest-entry outcome: an updated file gets a
  # new hash, a created file a new entry, a drift-warned file keeps its prior entry, and a deleted
  # file is absent from the rewritten manifest.
  Scenario Outline: each post-update file class maps to its manifest-entry outcome
    Given a member ended the update as "<file-class>"
    When I inspect ".aof/aof.work.lock.json" after the update
    Then the member's manifest entry is "<entry-outcome>"

    Examples:
      | file-class   | entry-outcome           |
      | updated      | new hash                |
      | created      | new entry               |
      | drift-warned | prior entry preserved   |
      | deleted      | absent                  |
