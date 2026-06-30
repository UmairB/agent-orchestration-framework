@cli @work @distribution @executable
Feature: aof mesh identity / aof mesh status render the node face and emit a stable --json envelope
  In order to let a human and a CI step publish a node's identity and read the fleet roster through the CLI face
  the aof mesh identity / aof mesh status commands map argv to the registered command's input, render a human line, and under --json emit one parseable envelope,
  so that the same capabilities mesh:identity / mesh:status produce are surfaced through the CLI with the milestone-08 face discipline — thin argv -> invoke -> render/--json, one envelope per call.

  # The CLI is a thin FACE over the registered mesh:* commands (ADR-001), added as additive
  # dispatch branches in story 00's meshCommand skeleton (the workListCommand / graphVerbCommand
  # idiom). This feature asserts the FACE: argv mapping, the human render, the --json single
  # envelope (success OR a structured error). Node records carry node-keyed data, not absolute
  # paths, so there is no path-projection adapter here. The bijection (cli adapter + dispatch +
  # --json clean) is the acd-mesh-command-cli-bijection ARCH-TEST (fitness #3), not a scenario.
  Background:
    Given an initialised aof project whose work stream is a fixture I control

  # aof mesh identity publishes this node and renders a confirmation; --json emits the record.
  Scenario: aof mesh identity publishes this node and renders a confirmation
    When I run "aof mesh identity"
    Then the output confirms this node's identity was published, naming its node id
    When I run "aof mesh identity --json"
    Then the JSON is a node record carrying the complete frozen schema

  # aof mesh identity <id> reads a named node's record (the read path on the face). The read
  # tolerates the exact id; an id present in the tree returns that node's record.
  Scenario: aof mesh identity with an id reads that node's record
    Given a peer node record for "umair-mbp" exists in the synced tree
    When I run "aof mesh identity umair-mbp --json"
    Then the JSON node record "nodeId" is "umair-mbp"

  # aof mesh status renders the roster; --json emits the stable { nodes:[...] } shape.
  Scenario: aof mesh status renders the node roster
    Given node records for "umair-desktop" and "umair-mbp" exist in the tree
    When I run "aof mesh status --json"
    Then the JSON has a "nodes" array carrying both nodes with their ids and capabilities
    When I run "aof mesh status"
    Then the output lists each node with its id and capabilities

  # The error envelope (08/ADR-003 discipline): every failure the face can emit renders ONE
  # structured { ok:false, error, code } envelope under --json and exits non-zero. The matrix
  # enumerates EVERY code the identity/status face surfaces:
  #   - node-not-found : reading an id with no record in the tree (the absent-read on the READ
  #                      path is an error on the face, distinct from the command-level absent);
  #   - invalid-input  : an unknown flag on either sub; an empty-string id argument
  #                      (identity "" is not a readable id); a positional arg to status (status
  #                      takes no id — a stray positional is rejected, not silently ignored).
  # QA: covers the empty-string id and the stray-positional boundaries the PO under-specified,
  # alongside the unknown-flag and absent-peer cases.
  Scenario Outline: a bad invocation emits one structured error envelope and exits non-zero
    Given <precondition>
    When I run "aof mesh <invocation> --json"
    Then stdout is a single parseable JSON envelope "{ ok:false, error, code:<code> }"
    And the process exits non-zero

    Examples:
      | precondition                          | invocation              | code           |
      | the tree has no record for that id    | identity never-synced   | node-not-found |
      | the tree has a record for "umair-mbp" | identity ""             | invalid-input  |
      | the tree has a record for "umair-mbp" | identity --bogus-flag   | invalid-input  |
      | node records exist in the tree        | status --bogus-flag     | invalid-input  |
      | node records exist in the tree        | status umair-mbp        | invalid-input  |

  # The single-envelope discipline: --json prints exactly one parseable JSON document on stdout
  # for every command (success and error alike) — never a human line plus JSON.
  Scenario: every --json invocation prints exactly one parseable JSON document
    When I run any "aof mesh ... --json" command
    Then stdout parses as exactly one JSON document
    And no human-rendered line precedes or follows it
