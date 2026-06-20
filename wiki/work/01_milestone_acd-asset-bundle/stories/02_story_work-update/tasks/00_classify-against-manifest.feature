@cli @assets @distribution @executable
Feature: Classify each bundle member against the install manifest and disk
  In order to receive upstream ACD changes safely
  the system must re-render the bundle and report, per member, whether it is up-to-date, changed, or new — writing only what changed.

  Background:
    Given a repo previously installed with "aof work init", carrying ".aof/aof.work.lock.json" and its matching files on disk

  Scenario: nothing changed since install — every member is up-to-date and no file is written
    Given the installed files are unmodified and the shipped bundle is identical to the recorded release
    When I run "aof work update"
    Then every member is reported as up-to-date
    And no file under the managed paths is written or changed

  Scenario: a member changed upstream and the on-disk file is unmodified — update rewrites it
    Given the shipped bundle's content for "aof-architect" differs from the recorded release
    And the on-disk "aof-architect" file still matches the manifest hash
    When I run "aof work update"
    Then "aof-architect" is reported as updated
    And the file on disk now matches the new bundle content

  # "fixture-added-member" is a synthesized test-bundle member, not a shipped ACD actor.
  Scenario: the bundle adds a new member — update creates it
    Given the shipped bundle declares a member "fixture-added-member" not present in the manifest
    When I run "aof work update"
    Then "fixture-added-member" is reported as created
    And the new file exists on disk with the new bundle content

  Scenario: --dry-run reports the classification and writes nothing
    Given the shipped bundle changes one member, adds one member, and leaves the rest identical
    When I run "aof work update --dry-run"
    Then the report lists the changed member as update, the added member as create, and the unchanged members as skip
    And no file under the managed paths is written, created, or deleted

  Scenario: update with no install manifest refuses and points to init
    Given the repo has no ".aof/aof.work.lock.json"
    When I run "aof work update"
    Then the command exits non-zero
    And it reports that the repo is not initialized and directs the user to run "aof work init"

  # The three content-addressed points update compares: the shipped bundle, the recorded manifest,
  # and the on-disk file. A member's classification is a function of (does the bundle differ from
  # the manifest) and (does the disk still match the manifest). Drift and delete are owned by tasks
  # 01 and 02; this matrix covers create / update / skip only.
  Scenario Outline: a member is classified from the bundle-vs-manifest and disk-vs-manifest comparison
    Given the bundle-vs-manifest state for a member is "<bundle>"
    And the disk-vs-manifest state for that member is "<disk>"
    When I run "aof work update"
    Then the member is reported as "<class>"

    Examples:
      | bundle              | disk                  | class  |
      | unchanged           | unmodified            | skip   |
      | content differs     | unmodified            | update |
      | new member          | absent                | create |
