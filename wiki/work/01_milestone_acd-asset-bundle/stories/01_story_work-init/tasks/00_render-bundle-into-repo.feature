@cli @assets @distribution @executable
Feature: aof work init renders the ACD bundle into a repo
  In order to adopt ACD in one command
  the system must render every supported bundle member onto disk under the target repo's runtime root.

  Background:
    Given an empty repo with no existing ACD install

  Scenario: init renders the bundle members onto disk under the runtime root
    When I run "aof work init"
    Then the command exits 0
    And under the runtime root the bundle's "aof-*" agent files exist
    And under the runtime root the command member files exist under the runtime's "commands/aof/" namespace directory
    And under the bundle template location the milestone template files exist

  Scenario: a named agent member lands at its conventional path
    When I run "aof work init"
    Then the file ".claude/agents/aof-architect.md" exists

  # Command members preserve ACD's "/aof:" invocation namespace (ADR-007): they render
  # under the "commands/aof/" subdirectory and carry the namespaced aof-invocation.
  Scenario: command members are namespaced under aof and invoked with the aof: prefix
    When I run "aof work init"
    Then the file ".claude/commands/aof/refine.md" exists
    And its frontmatter "aof-invocation" equals "/aof:refine"
    And no command file is written flat at ".claude/commands/refine.md"

  Scenario: --dry-run reports the planned writes but writes nothing
    When I run "aof work init --dry-run"
    Then the output reports the files it would write
    And the runtime root contains no files
    And the file ".aof/aof.work.lock.json" does not exist
    And the command exits 0

  Scenario: init targets the given directory, not the CLI's own cwd
    Given a target directory "consumer" distinct from the CLI's working directory
    When I run "aof work init consumer"
    Then the rendered files appear under "consumer" and its runtime root
    And no ACD files are written under the CLI's own working directory

  # The output location of each member kind under the selected runtime root,
  # using the established render conventions. <root> is the runtime root
  # (".claude" for the default runtime). Template members render to the fixed
  # bundle template location rather than under a runtime root.
  Scenario Outline: a bundle member of a given kind lands at its conventional location
    When I run "aof work init"
    Then a "<kind>" member with id "<id>" is written to "<location>"

    Examples:
      | kind     | id            | location                              |
      | agent    | aof-architect | .claude/agents/aof-architect.md       |
      | command  | refine        | .claude/commands/aof/refine.md        |
      | template | (milestone)   | the fixed bundle template location    |
