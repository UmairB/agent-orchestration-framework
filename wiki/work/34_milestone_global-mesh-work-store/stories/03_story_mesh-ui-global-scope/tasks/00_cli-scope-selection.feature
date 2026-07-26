@executable @cli @work @distribution
Feature: The mesh UI CLI selects global scope by default and local scope explicitly
  In order to make machine-wide mesh visibility the default operator path
  the `aof mesh ui` command passes an explicit scope to the serve face
  so that global mode and current-workspace local mode are chosen deliberately.

  Background:
    Given the mesh UI serve face is injected so CLI calls can be observed
    And the UI build is present

  Scenario: `aof mesh ui` starts the global mesh view by default
    When the operator runs `aof mesh ui --port 0`
    Then the CLI calls serveMeshUi with scope "global"
    And the CLI does not require the current directory to be a mesh-enabled workspace before starting
    And stdout prints "AOF mesh ui is running locally."
    And stdout prints a browser URL containing "mode=fleet" and "scope=global"

  Scenario: `aof mesh ui --local` starts the current-workspace filtered view
    Given the current directory is "C:\repos\alpha"
    When the operator runs `aof mesh ui --local --port 0`
    Then the CLI calls serveMeshUi with scope "local"
    And the CLI passes projectDir "C:\repos\alpha"
    And stdout prints a browser URL containing "mode=fleet" and "scope=local"
    And stdout prints "Project: C:\repos\alpha"

  Scenario: `--local` preserves existing friendly UI startup failures
    Given the UI build is missing
    When the operator runs `aof mesh ui --local`
    Then the command exits 1
    And stderr contains "The fleet UI build is missing"
    And stderr does not contain a stack trace

  Scenario: an unrecognized mesh UI flag is rejected before serving
    When the operator runs `aof mesh ui --workspace alpha`
    Then the command exits 1
    And stderr explains the unknown option "--workspace"
    And serveMeshUi is not called

