@cli @assets @distribution @executable
Feature: A locally-edited managed file is never silently overwritten
  In order to keep a developer's own edits safe across updates
  the system must leave a hand-edited managed file in place and report it as drifted, overwriting it only when --force is given.

  Background:
    Given a repo previously installed with "aof work init", carrying ".aof/aof.work.lock.json" and its matching files on disk
    And a newer bundle whose content for "aof-architect" differs from the recorded release

  Scenario: a file edited locally and also changed upstream is preserved and reported as drifted
    Given the on-disk "aof-architect" file was edited locally so its content no longer matches the manifest hash
    When I run "aof work update"
    Then "aof-architect" is reported as drifted with a drift warning, not overwritten
    And the file content on disk is unchanged from the local edit

  Scenario: a locally-edited managed file is recognised as user-modified
    Given the on-disk "aof-architect" file was edited locally
    When I run "aof work update"
    Then the command reports that the file no longer matches the manifest hash
    And that mismatch is what triggers the no-clobber protection

  Scenario: --force overwrites the locally-edited file with the new bundle content
    Given the on-disk "aof-architect" file was edited locally
    When I run "aof work update --force"
    Then "aof-architect" is reported as updated
    And the file content on disk now matches the new bundle content

  # The protection is a function of the on-disk file's state and whether --force is given. A file
  # whose content still matches the manifest hash is safe to rewrite; one that diverges is a user
  # edit and is preserved unless --force is supplied.
  Scenario Outline: a changed-upstream member's outcome depends on local edits and --force
    Given the on-disk file is "<file-state>"
    And I run update with --force "<force>"
    Then the member's outcome is "<outcome>"

    Examples:
      | file-state       | force | outcome              |
      | unmodified       | no    | update               |
      | locally-modified | no    | drift-warn, preserve |
      | locally-modified | yes   | force-overwrite      |
