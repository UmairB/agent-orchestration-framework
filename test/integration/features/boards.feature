Feature: Board and task state

  Scenario: Create a board, add a linked task, move it, and rebuild the index
    Given an empty project
    When I run `boards create delivery --title Delivery --objective "Ship board state"`
    Then the command should succeed
    And file `.aof/boards/delivery/BOARD.json` should exist
    When I run `boards task add delivery wire-api --title "Wire API" --status ready --priority high --deliverable "Board foundation" --refs '{"phase":"28"}'`
    Then the command should succeed
    And file `.aof/boards/delivery/tasks/wire-api.json` should contain `"phase": "28"`
    When I run `boards task move delivery wire-api in_progress`
    Then the command should succeed
    When I run `boards show delivery`
    Then stdout should contain `wire-api status=in_progress`
    When I run `boards index`
    Then the command should succeed
    And file `.aof/cache/boards/index.json` should contain `"taskCount": 1`

  Scenario: Validate warns when the generated board index is stale
    Given an empty project
    When I run `boards create delivery --title Delivery`
    Then the command should succeed
    When I run `boards index`
    Then the command should succeed
    When I run `boards task add delivery second --title Second`
    Then the command should succeed
    When I run `boards validate`
    Then the command should succeed
    And stdout should contain `BOARD_INDEX_STALE`

  Scenario: Validate fails malformed canonical board state
    Given an empty project
    When I run `boards create delivery --title Delivery`
    Then the command should succeed
    When I replace file `.aof/boards/delivery/BOARD.json` with `{`
    And I run `boards validate`
    Then the command should fail
    And stdout should contain `BOARD_MALFORMED_JSON`
