@cli @adapter @work-stream @executable
Feature: migrate's outcome is managed work, not a read-only import digest
  In order to keep the load-bearing distinction that justifies a new command alongside import
  the system must make "aof migrate" produce a MANAGED work item in the stream — never a co-located
  AOF.md knowledge digest and never an entry in the import store — while "aof import" is unchanged.

  # The load-bearing contrast (STORY.md, flagged "must survive into refinement"):
  #   - import  -> SUMMARISES a foreign folder into an AOF.md digest. Read-only on the source, one-time
  #               snapshot, co-located beside the source, NEVER becomes managed work (knowledge only).
  #   - migrate -> CONVERTS a folder INTO managed work in the stream — refinable / continuable /
  #               verifiable. The work BECOMES the item, not a digest of it.
  # This feature pins the OBSERVABLE differences so a future change can't quietly collapse migrate back
  # into import: migrate writes a managed milestone (SPEC.md + STATE.md) under work.dir, writes NO AOF.md
  # digest, writes NOTHING under .aof/imports/, and leaves import's own behaviour untouched. Whether the
  # source folder is relocated under work.dir or its work is re-expressed into a fresh scaffold is an
  # open architectural question (see STORY.md Notes) — these scenarios assert the end-state, not the mechanism.
  #
  # All rows run OFFLINE against local fixture folders read in place behind import's read-only
  # source-access seam. "migrate registers exactly one new command and import is not modified" is a
  # story arch-test (the command-CLI bijection), NOT a Then here.

  Background:
    Given a local fixture source folder under this story's "fixtures/" dir holding existing work

  Scenario: migrate produces a managed item, not an AOF.md digest
    When I run "aof migrate <fixture-folder>"
    Then a managed milestone item with a SPEC.md and a STATE.md is created under work.dir
    And no AOF.md knowledge digest is written for the source

  Scenario: migrate writes nothing into the import store
    When I run "aof migrate <fixture-folder>"
    Then nothing is written under ".aof/imports/"

  Scenario: the produced item is managed — it is visible to the lifecycle commands
    When I run "aof migrate <fixture-folder>"
    Then "aof work list" includes the produced milestone
    And "aof work next" can select it as actionable work

  Scenario: import's outcome remains a read-only co-located digest, distinct from migrate
    When I run "aof import milestone <fixture-folder>"
    Then an AOF.md digest is materialised for the source
    And no managed milestone item is created under work.dir for it

  Scenario: migrate and import are distinct commands that do not alter each other
    When I run "aof migrate <fixture-folder>"
    And I then run "aof import milestone <fixture-folder>"
    Then the migrate-produced managed item under work.dir is unchanged by the import
    And the import-produced digest is not a managed work item

  # QA: author the matrix below — for each command over the same source, pin WHAT lands WHERE:
  # a managed item under work.dir, an AOF.md digest co-located with the source, or the import store.
  # The contrast is the contract; every row must show migrate and import diverging at the outcome.
  #
  # The matrix runs the SAME fixture source under each command and pins, per command, three independently
  # observable locations a tester checks: (a) is there a managed item under work.dir? (b) is there an
  # AOF.md digest co-located beside the source? (c) is anything written under .aof/imports/? migrate is
  # yes/no/no; import is no/yes/no. The divergence shows on every row — no input maps both commands to
  # the same triple. "managed-item", "co-located AOF.md", and "import-store" are each a present/absent
  # observable, read off the filesystem without inspecting any source.
  Scenario Outline: the same source yields managed work under migrate and a digest under import
    When I run "<command> <fixture-folder>"
    Then a managed item under work.dir is <managed-item>
    And a co-located AOF.md digest beside the source is <co-located>
    And anything under ".aof/imports/" is <import-store>

    Examples: migrate lands managed work under work.dir and writes no digest
      | command              | managed-item | co-located | import-store |
      | aof migrate          | present      | absent     | absent       |

    Examples: import lands a co-located digest and no managed item
      | command              | managed-item | co-located | import-store |
      | aof import milestone | absent       | present    | absent       |

  # The non-interference matrix: running one command does not perturb the other's prior output. Whichever
  # ran first, its artifact survives the second command untouched — migrate's managed item is not turned
  # into a digest, and import's digest is not promoted into managed work. Each row pins what is observable
  # about the FIRST command's artifact AFTER the second command runs over the same source.
  Scenario Outline: running one command leaves the other's prior output untouched
    Given I have already run "<first>" over the fixture
    When I then run "<second>" over the same fixture
    Then the artifact produced by "<first>" <persistence>

    Examples: import after migrate leaves the managed item intact
      | first                | second               | persistence                                            |
      | aof migrate          | aof import milestone | remains a managed milestone under work.dir, not a digest|

    Examples: migrate after import leaves the digest intact and unpromoted
      | first                | second               | persistence                                            |
      | aof import milestone | aof migrate          | remains a co-located AOF.md digest, not a managed item  |
