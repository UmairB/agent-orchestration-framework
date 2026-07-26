@executable @cli @work @distribution
Feature: Global mesh paths derive from globalWorkspacePaths and honor AOF_GLOBAL_HOME
  In order to keep machine-wide mesh state relocatable and testable
  the global mesh store paths derive from the existing global AOF workspace seam
  so that no implementation hard-codes the operator's home directory or writes mesh state into a project .aof folder.

  Background:
    Given an environment where AOF_GLOBAL_HOME is set to a fixture directory
    And no project workspace is required to resolve global mesh paths

  Scenario: the global mesh root is under the relocated global AOF home
    When global mesh paths are resolved
    Then the mesh root is "<AOF_GLOBAL_HOME>/mesh"
    And the work projection root is "<AOF_GLOBAL_HOME>/mesh/work"
    And the node descriptor root is "<AOF_GLOBAL_HOME>/mesh/nodes"
    And the workspace descriptor root is "<AOF_GLOBAL_HOME>/mesh/workspaces"
    And the machine identity path is "<AOF_GLOBAL_HOME>/mesh/identity.json"
    And the SQLite projection path is under "<AOF_GLOBAL_HOME>/mesh/work"

  Scenario: global mesh path resolution is independent of the current project directory
    Given two different current working directories
    When global mesh paths are resolved from each directory with the same AOF_GLOBAL_HOME
    Then both resolutions return the same absolute global mesh paths
    And no ".aof" directory is created in either current working directory

  Scenario Outline: platform defaults use the user's global .aof folder
    Given AOF_GLOBAL_HOME is unset
    And the platform is "<platform>"
    And the home directory is "<home>"
    When global mesh paths are resolved
    Then the mesh root is under "<expected-global-home>/mesh"

    Examples:
      | platform | home              | expected-global-home      |
      | win32    | C:\Users\Operator | C:\Users\Operator\.aof  |
      | darwin   | /Users/operator   | /Users/operator/.aof      |
      | linux    | /home/operator    | /home/operator/.aof       |

  Scenario: project .aof and global .aof are distinct stores
    Given the current project root is "C:\work\repo"
    And AOF_GLOBAL_HOME is "C:\global-aof"
    When project workspace paths and global mesh paths are resolved
    Then the project config path is "C:\work\repo\.aof\aof.config.json"
    And the global mesh root is "C:\global-aof\mesh"
    And no global mesh path is nested under the project root