@cli @assets @distribution @executable
Feature: Every init output is stamped and recorded in the install manifest
  In order for a later update to tell aof-managed files from a user's edits
  the system must stamp every written file and record each one in a lock-v2 install manifest.

  Background:
    Given an empty repo with no existing ACD install
    And I have run "aof work init"

  Scenario: every rendered resource file carries the frontmatter stamp
    Then the file ".claude/agents/aof-architect.md" has frontmatter containing "aof-generated: true"
    And every written agent and command file has frontmatter containing "aof-generated: true"

  Scenario: every rendered template file carries the comment-form stamp
    Then every written milestone template file begins with the marker "<!-- aof-generated: bundle -->"

  Scenario: the install manifest is a lock-v2 record at the fixed path
    Then the file ".aof/aof.work.lock.json" exists
    And it is JSON with "version" equal to 2
    And it records the installed bundle release under "bundle.version"
    And its "runtimes" lists the runtimes that were rendered

  Scenario: the manifest has one content-addressed entry per written file
    Then "files" in ".aof/aof.work.lock.json" has one entry for each file init wrote
    And each entry carries the file's repo-relative "path" with forward slashes
    And each entry carries a "hash" beginning with "sha256:"
    And each entry's "resource" carries an "id" and a "kind"

  Scenario: init writes only the work manifest, never the consumer's own lock
    Then the file ".aof/aof.work.lock.json" exists
    And the file ".aof/aof.lock.json" does not exist

  # The two canonical stamp forms, keyed by whether the member's file format
  # admits YAML frontmatter. Exactly one form appears on each written file.
  Scenario Outline: a written file of a given class carries its stamp form
    When I inspect a written "<file-class>" file
    Then its stamp is "<stamp form>"

    Examples:
      | file-class | stamp form                              |
      | agent      | frontmatter key aof-generated: true     |
      | command    | frontmatter key aof-generated: true     |
      | template   | comment marker <!-- aof-generated: bundle --> |
