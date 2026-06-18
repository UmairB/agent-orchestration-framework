@cli @assets @distribution @executable
Feature: The ACD actor set lives in one tracked, shippable bundle root
  In order to have a single source of truth for ACD that travels in the published package
  the system must keep the full ACD actor set in a tracked bundle root, free of legacy and unmanaged files.

  Background:
    Given the built-in ACD bundle root

  Scenario: the bundle root holds the complete ACD actor set
    When I list the bundle root's members
    Then it contains all 8 ACD agents
    And it contains all 14 ACD commands
    And it contains the milestone, story, task, and uat templates

  Scenario: the bundle root ships with the published package
    When I inspect whether the bundle root is tracked by git
    Then the bundle root is tracked
    And the bundle root is not matched by any git-ignore rule

  # Representative members the bundle MUST contain — one row per actor class.
  Scenario Outline: a declared ACD member is present in the bundle root
    When I look up "<id>" in the bundle root
    Then the member "<id>" is present

    Examples:
      | id                |
      | aof-architect     |
      | aof-product-owner |
      | aof-qa            |
      | aof-security      |
      | add-milestone     |
      | refine            |
      | shatter           |
      | verify            |

  # Legacy and unmanaged actors the bundle MUST NOT contain — these stayed behind in the loose runtime.
  Scenario Outline: a legacy or unmanaged actor is absent from the bundle root
    When I look up "<id>" in the bundle root
    Then the member "<id>" is absent

    Examples:
      | id                |
      | code-reviewer     |
      | gsd-planner       |
      | gsd-executor      |
      | gsd-verifier      |
      | gsd-roadmapper    |
