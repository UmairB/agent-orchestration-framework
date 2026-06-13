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
    When I run `boards create delivery --title Delivery --objective "Validate stale index"`
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
    When I run `boards create delivery --title Delivery --objective "Validate malformed state"`
    Then the command should succeed
    When I replace file `.aof/boards/delivery/BOARD.json` with `{`
    And I run `boards validate`
    Then the command should fail
    And stdout should contain `BOARD_MALFORMED_JSON`

  Scenario: Remove a board from disk
    Given an empty project
    When I run `boards create cleanup --title Cleanup --objective "Clean up board files"`
    Then the command should succeed
    And file `.aof/boards/cleanup/BOARD.json` should exist
    When I run `boards remove cleanup --dry-run`
    Then the command should succeed
    And stdout should contain `Would remove board cleanup`
    And file `.aof/boards/cleanup/BOARD.json` should exist
    When I run `boards remove cleanup`
    Then the command should succeed
    And stdout should contain `Removed board cleanup`
    And file `.aof/boards/cleanup/BOARD.json` should not exist

  Scenario: Review an objective breakdown before applying tasks to a board
    Given an empty project
    When I run `boards create delivery --title Delivery --objective "Review objective breakdown"`
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

  Scenario: GSD-backed boards sync tasks from roadmap phases
    Given a project with GSD board execution
    When I run `boards create delivery --title Delivery --objective "Ship board state" --execution-runtime claude` with GSD runtime status `waiting_for_user` and output `What do you want to build next?`
    Then the command should succeed
    And stdout should contain `execution: gsd runtime=claude`
    And stdout should contain `continue: $gsd-new-milestone Ship board state`
    And stdout should contain `milestone: waiting_for_user`
    And file `.aof/boards/delivery/BOARD.json` should contain `"defaultExecutionRuntime": "claude"`
    And file `.aof/boards/delivery/BOARD.json` should contain `"status": "waiting_for_user"`
    When I run `boards task add delivery manual --title "Manual"`
    Then the command should fail
    And stderr should contain `cannot accept tasks until its milestone roadmap is synced`
    When I run `boards sync delivery`
    Then the command should fail
    And stderr should contain `--milestone <milestone-id>`
    When I run `boards repair delivery`
    Then the command should succeed
    And stdout should contain `already has a GSD milestone in progress`
    When I run `boards milestone status delivery`
    Then the command should succeed
    And stdout should contain `milestone: waiting_for_user`
    And stdout should contain `next: $gsd-new-milestone Ship board state`
    And stdout should not contain `next: aof boards milestone answer delivery --text "<answer>"`
    When I run `boards milestone answer delivery --text "1"` with GSD runtime status `waiting_for_user` and output `Confirm milestone?`
    Then the command should succeed
    And stdout should contain `milestone: waiting_for_user`
    And stdout should contain `Confirm milestone?`
    When I run `boards milestone attach delivery --milestone v1-7 --roadmap .planning/ROADMAP.md`
    Then the command should succeed
    And stdout should contain `Attached board delivery to milestone v1-7`
    When I run `boards sync delivery --milestone v1-7`
    Then the command should succeed
    And stdout should contain `Synced board delivery with GSD roadmap`
    And stdout should contain `created: 2`
    And file `.aof/boards/delivery/tasks/phase-30.json` should contain `"phase": "30"`
    When I run `boards task add delivery manual --title "Manual"`
    Then the command should fail
    And stderr should contain `Add tasks with $gsd-phase add`

  Scenario: SDK fixture boards sync tasks from roadmap phases
    Given a project with GSD board execution using SDK fixture "v17-active"
    When I run `boards create delivery --title Delivery --objective "Ship board state" --execution-runtime claude` with GSD runtime status `waiting_for_user` and output `What do you want to build next?`
    Then the command should succeed
    And stdout should contain `execution: gsd runtime=claude`
    When I run `boards milestone attach delivery --milestone v1-7 --roadmap .planning/ROADMAP.md`
    Then the command should succeed
    And stdout should contain `Attached board delivery to milestone v1-7`
    And file `.aof/boards/delivery/BOARD.json` should contain `"status": "attached"`
    And file `.aof/boards/delivery/BOARD.json` should contain `"sdkVersion": "0.1.0"`
    When I run `boards sync delivery --milestone v1-7`
    Then the command should succeed
    And stdout should contain `Synced board delivery with GSD roadmap`
    And stdout should contain `created: 2`
    And file `.aof/boards/delivery/BOARD.json` should contain `"status": "synced"`
    And file `.aof/boards/delivery/tasks/phase-30.json` should contain `"phase": "30"`
    When I run `boards doctor delivery`
    Then the command should succeed
    And stdout should contain `doctor: healthy`
    And stdout should contain `PASS BOARD_TASKS_MATCH_ROADMAP board=delivery`
    And stdout should contain `WARN SDK_VERSION_DRIFT`
    When I run `boards doctor delivery --json`
    Then the command should succeed
    And stdout should contain `"ok": true`
    And stdout should contain `"code": "BOARD_TASKS_MATCH_ROADMAP"`
    And stdout should contain `"code": "SDK_VERSION_DRIFT"`

  Scenario: SDK fixture v1.6 board repair auto-binds then syncs
    Given a project with v1.6 GSD board fixture using SDK fixture "v17-active"
    When I run `boards repair legacy`
    Then the command should succeed
    And stdout should contain `Board legacy attached to milestone v1.7.`
    And stdout should contain `binding: attached`
    And file `.aof/boards/legacy/BOARD.json` should contain `"id": "v1.7"`
    And file `.aof/boards/legacy/BOARD.json` should contain `"syncCommand": "aof boards sync legacy --milestone v1.7"`
    When I run `boards sync legacy --milestone v1.7`
    Then the command should succeed
    And stdout should contain `Synced board legacy with GSD roadmap`
    And stdout should contain `created: 0`
    And file `.aof/boards/legacy/BOARD.json` should contain `"status": "synced"`
    And file `.aof/boards/legacy/tasks/phase-30.json` should contain `"phase": "30"`

  Scenario: SDK fixture v1.6 board repair refuses ambiguous milestones
    Given a project with ambiguous v1.6 GSD board fixture using SDK fixture "v17-active"
    When I run `boards repair legacy`
    Then the command should succeed
    And stdout should contain `Board legacy needs manual milestone attachment before sync.`
    And stdout should contain `continue: aof boards milestone attach legacy --milestone <milestone-id> --roadmap docs/v1-6-roadmap.md`
    And file `.aof/boards/legacy/BOARD.json` should not contain `"id": "v1-7"`

  Scenario: SDK fixture board doctor reports v1.6 migration hints
    Given a project with v1.6 GSD board fixture using SDK fixture "v17-active"
    When I run `boards doctor legacy`
    Then the command should succeed
    And stdout should contain `WARN BOARD_MILESTONE_ID_MISSING board=legacy`
    And stdout should contain `next: aof boards milestone attach legacy --milestone v1.7 --roadmap docs/v1-6-roadmap.md`
    When I run `boards doctor legacy --json`
    Then the command should succeed
    And stdout should contain `"code": "BOARD_MILESTONE_ID_MISSING"`
    And stdout should contain `"next": "aof boards milestone attach legacy --milestone v1.7 --roadmap docs/v1-6-roadmap.md"`

  Scenario: Refreshed breakdowns do not silently overwrite existing tasks
    Given an empty project
    When I run `boards create delivery --title Delivery --objective "Refresh objective breakdown"`
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

  Scenario: Assign a synced phase task to a configured agent and start GSD execution
    Given a project with GSD board execution
    When I run `boards create delivery --title Delivery --objective "Assign synced phase tasks"`
    Then the command should succeed
    When I run `boards milestone attach delivery --milestone v1-7 --roadmap .planning/ROADMAP.md`
    And I run `boards sync delivery --milestone v1-7`
    Then the command should succeed
    When I run `boards agents`
    Then stdout should contain `builder`
    When I run `boards task assign delivery phase-30 builder`
    Then the command should succeed
    And stdout should contain `Started gsd execution status=complete phase=30`
    And stdout should contain `$gsd-discuss-phase 30`
    And file `.aof/boards/delivery/executions/phase-30.json` should contain `"status": "complete"`
    When I run `boards execution update delivery phase-30 --status waiting_for_user --message "Need input"`
    Then the command should succeed
    And stdout should contain `Task status: in_progress`
    And file `.aof/boards/delivery/tasks/phase-30.json` should contain `"waiting_for_user"`

  Scenario: SDK fixture assigns a synced phase task to a configured agent
    Given a project with GSD board execution using SDK fixture "v17-active"
    When I run `boards create delivery --title Delivery --objective "Assign synced phase tasks"`
    Then the command should succeed
    When I run `boards milestone attach delivery --milestone v1-7 --roadmap .planning/ROADMAP.md`
    And I run `boards sync delivery --milestone v1-7`
    Then the command should succeed
    When I run `boards task assign delivery phase-30 builder`
    Then the command should succeed
    And stdout should contain `Started gsd execution status=complete phase=30`
    And file `.aof/boards/delivery/executions/phase-30.json` should contain `"status": "complete"`

  Scenario: Reject assignments for unknown agents or tasks without GSD phase refs
    Given a project with GSD board execution
    When I run `boards create delivery --title Delivery --objective "Reject unknown agents"`
    Then the command should succeed
    When I run `boards milestone attach delivery --milestone v1-7 --roadmap .planning/ROADMAP.md`
    And I run `boards sync delivery --milestone v1-7`
    Then the command should succeed
    When I run `boards task assign delivery phase-30 missing-agent`
    Then the command should fail
    And stderr should contain `Unknown agent "missing-agent"`
    When I run `boards task assign delivery phase-30 missing-agent --json`
    Then the command should fail
    And stdout should contain `"code": "BOARD_AGENT_NOT_FOUND"`
    And stdout should contain `"next": "aof boards agents"`

  Scenario: Reject assignments for tasks without GSD phase refs
    Given a project with a board execution agent
    When I run `boards create manual --title Manual --objective "Reject missing phase refs"`
    Then the command should succeed
    When I run `boards task add manual missing-phase --title "Missing Phase"`
    Then the command should succeed
    When I run `boards task assign manual missing-phase builder`
    Then the command should fail
    And stderr should contain `without refs.phase`
    When I run `boards task assign manual missing-phase builder --json`
    Then the command should fail
    And stdout should contain `"code": "BOARD_TASK_PHASE_REF_MISSING"`
    And stdout should contain `"next": "aof boards sync manual --milestone <milestone-id>"`

  Scenario: Board JSON failures include structured remediation hints
    Given a project with GSD board execution
    When I run `boards create delivery --title Delivery --objective "Structured errors"`
    Then the command should succeed
    When I run `boards sync delivery --json`
    Then the command should fail
    And stdout should contain `"code": "MILESTONE_MISSING_ARG"`
    And stdout should contain `"next": "aof boards sync delivery --milestone <milestone-id>"`
    When I run `boards execution show delivery phase-30 --json`
    Then the command should fail
    And stdout should contain `"code": "TASK_EXECUTION_NOT_FOUND"`
    And stdout should contain `"next": "aof boards task assign delivery phase-30 <agent-id>"`
