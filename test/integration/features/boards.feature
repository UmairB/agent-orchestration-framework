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

  Scenario: Review an objective breakdown before applying tasks to a board
    Given an empty project
    When I run `boards create delivery --title Delivery`
    Then the command should succeed
    When I run `boards breakdown delivery --objective "Board API" --id api-proposal`
    Then the command should succeed
    And stdout should contain `proposal: api-proposal`
    And file `.aof/boards/delivery/proposals/api-proposal.json` should contain `"status": "proposed"`
    When I run `boards show delivery`
    Then stdout should contain `tasks: 0`
    When I run `boards breakdown apply delivery api-proposal`
    Then the command should succeed
    And stdout should contain `Applied proposal api-proposal`
    When I run `boards show delivery`
    Then stdout should contain `board-api-implementation status=backlog`

  Scenario: Refreshed breakdowns do not silently overwrite existing tasks
    Given an empty project
    When I run `boards create delivery --title Delivery`
    Then the command should succeed
    When I run `boards breakdown delivery --objective "Board API" --id api-proposal`
    Then the command should succeed
    When I run `boards breakdown apply delivery api-proposal`
    Then the command should succeed
    When I run `boards breakdown refresh delivery api-proposal --id api-proposal-2`
    Then the command should succeed
    And stdout should contain `refreshOf: api-proposal`
    When I run `boards breakdown apply delivery api-proposal-2`
    Then the command should fail
    And stderr should contain `conflicts with existing tasks`

  Scenario: Assign a phase-linked task to a configured agent and start GSD execution
    Given a project with a board execution agent
    When I run `boards create delivery --title Delivery`
    Then the command should succeed
    When I run `boards task add delivery phase-30 --title "Phase 30" --refs '{"phase":"30"}'`
    Then the command should succeed
    When I run `boards agents`
    Then stdout should contain `builder`
    When I run `boards task assign delivery phase-30 builder`
    Then the command should succeed
    And stdout should contain `Started gsd execution status=running phase=30`
    And stdout should contain `$gsd-discuss-phase 30`
    And file `.aof/boards/delivery/executions/phase-30.json` should contain `"status": "running"`
    When I run `boards execution update delivery phase-30 --status waiting_for_user --message "Need input"`
    Then the command should succeed
    And stdout should contain `Task status: in_progress`
    And file `.aof/boards/delivery/tasks/phase-30.json` should contain `"waiting_for_user"`

  Scenario: Reject assignments for unknown agents or tasks without GSD phase refs
    Given a project with a board execution agent
    When I run `boards create delivery --title Delivery`
    Then the command should succeed
    When I run `boards task add delivery phase-30 --title "Phase 30" --refs '{"phase":"30"}'`
    Then the command should succeed
    When I run `boards task assign delivery phase-30 missing-agent`
    Then the command should fail
    And stderr should contain `Unknown agent "missing-agent"`
    When I run `boards task add delivery missing-phase --title "Missing Phase"`
    Then the command should succeed
    When I run `boards task assign delivery missing-phase builder`
    Then the command should fail
    And stderr should contain `without refs.phase`
