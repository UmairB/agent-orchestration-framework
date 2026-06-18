@cli @assets @distribution @executable
Feature: A member dropped from the bundle is cleaned up safely
  In order to keep a repo free of files the bundle no longer ships
  the system must delete a stale managed file on update — unless the developer edited it, in which case it is preserved and reported as drifted.

  # "fixture-dropped-member" is a synthesized test-bundle member, not a shipped ACD actor.
  Background:
    Given a repo previously installed with "aof work init", carrying ".aof/aof.work.lock.json" and its matching files on disk
    And a newer bundle that no longer declares the member "fixture-dropped-member" that the prior install wrote

  Scenario: a stale member's unmodified file is deleted
    Given the on-disk "fixture-dropped-member" file still matches the manifest hash
    When I run "aof work update"
    Then "fixture-dropped-member" is reported as deleted
    And the file no longer exists on disk

  Scenario: a stale member that was edited locally is preserved and reported as drifted
    Given the on-disk "fixture-dropped-member" file was edited locally so its content no longer matches the manifest hash
    When I run "aof work update"
    Then "fixture-dropped-member" is reported as drifted with a drift warning, not deleted
    And the file still exists on disk with its local-edit content unchanged

  # A stale member is one in the manifest but no longer in the bundle. Whether it is removed depends
  # only on whether the on-disk file still matches the recorded hash: an untouched managed file is
  # safe to delete; a hand-edited one is preserved.
  Scenario Outline: a stale member's outcome depends on whether its file was edited locally
    Given the on-disk stale file is "<file-state>"
    When I run "aof work update"
    Then the stale member's outcome is "<outcome>"

    Examples:
      | file-state       | outcome                |
      | unmodified       | deleted                |
      | locally-modified | drift-warn, preserved  |
