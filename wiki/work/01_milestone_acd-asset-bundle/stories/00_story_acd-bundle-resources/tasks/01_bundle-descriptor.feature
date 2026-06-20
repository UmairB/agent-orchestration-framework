@cli @assets @distribution @executable
Feature: A declarative descriptor enumerates every bundle member as a typed resource
  In order to give the bundle a known, queryable membership rather than whatever happens to be in a folder
  the system must declare each member with an id, a kind, and its target runtime(s).

  Background:
    Given the bundle descriptor

  Scenario: the descriptor declares one typed entry per bundle member
    When I read the descriptor's members
    Then every member carries an "id" and a "kind"
    And the descriptor declares all 8 agents as kind "agent"
    And the descriptor declares all 14 commands as kind "command"
    And the descriptor declares the milestone, story, task, and uat templates as kind "template"

  Scenario: every declared resource member names at least one target runtime
    When I read the descriptor's resource members
    Then each agent and command member declares one or more target runtimes

  # The kind and runtime(s) each resource member declares — runtimes follow the capability
  # matrix: agents are supported on claude+codex, commands are claude-only.
  Scenario Outline: a descriptor resource entry declares its kind and target runtime(s)
    When I read the descriptor entry for "<id>"
    Then its kind is "<kind>"
    And its declared target runtimes are "<runtimes>"

    Examples:
      | id                | kind    | runtimes      |
      | aof-architect     | agent   | claude, codex |
      | aof-product-owner | agent   | claude, codex |
      | aof-qa            | agent   | claude, codex |
      | aof-developer     | agent   | claude, codex |
      | add-milestone     | command | claude        |
      | refine            | command | claude        |
      | verify            | command | claude        |
      | retrospective     | command | claude        |

  # The template members are declared by id and kind; they are plain markdown docs, not
  # runtime-targeted resources.
  Scenario Outline: a template member is declared with id and kind "template"
    When I read the descriptor entry for "<id>"
    Then its kind is "template"

    Examples:
      | id        |
      | milestone |
      | story     |
      | task      |
      | uat       |
