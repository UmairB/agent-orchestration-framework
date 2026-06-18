@cli @assets @distribution @executable
Feature: The installed CLI loads the bundle regardless of where it runs
  In order to ship ACD to any repo without depending on the consumer's cwd or config
  the system must locate and load the bundle relative to the installed CLI, then render its members.

  Background:
    Given the installed aof CLI

  Scenario: the loader returns the full member set faithful to the descriptor
    When the CLI loads the bundle
    Then the loaded member set equals the descriptor's member set by count
    And the loaded member set equals the descriptor's member set by id

  Scenario: the loaded bundle renders its members to runtime files
    When the CLI loads the bundle and renders it for runtime "claude"
    Then it produces one rendered output per claude-supported member
    And each rendered output's content is non-empty

  # The bundle is found relative to the installed CLI, not the cwd — the same member set
  # resolves no matter where the CLI is invoked from.
  Scenario Outline: the bundle loads identically from any working directory
    Given the CLI is invoked from <cwd>
    When the CLI loads the bundle
    Then the loaded member set equals the descriptor's member set

    Examples:
      | cwd                            |
      | the aof repo root              |
      | an unrelated temp directory    |
      | a nested subdirectory          |
