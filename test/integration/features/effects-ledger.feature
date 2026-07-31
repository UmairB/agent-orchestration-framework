Feature: Effects ledger — consequences are declared, not remembered
  Mutations write facts and raise durable events (m42 wave (d) leg d2): the run
  store's transition seam appends run.completed to the per-node journal, and one
  executable table (src/effects/table.mjs) owns every consequence. A failed completion
  rolls the item back and publishes the projection because the LEDGER says so —
  no call site remembers it. A crashed process leaves pending steps, not lost
  cascades: the next CLI invocation pays them.

  Scenario: a failed completion pays its declared cascade in order
    Given a work stream with milestone "03" titled "Board"
    And story "03/01" titled "Board UI" with status "in-progress"
    And a running run on "03/01"
    When I run `work run-complete 03/01 --outcome failed --reason timeout --json`
    Then the command should succeed
    And the JSON result field "state" should be "failed"
    And the JSON result field "failureReason" should be "timeout"
    And the reactor "rollback-status" should report "done"
    And the reactor "publish-projection" should report "done"
    And item "03/01" should list with status "not-started"

  Scenario: a clean completion runs the same cascade without rolling back
    Given a work stream with milestone "03" titled "Board"
    And story "03/01" titled "Board UI" with status "in-progress"
    And a running run on "03/01"
    When I run `work run-complete 03/01 --outcome done --json`
    Then the command should succeed
    And the reactor "rollback-status" should report "done"
    And the reactor "publish-projection" should report "done"
    And item "03/01" should list with status "in-progress"

  Scenario: the cascade is journaled durably beside the fact
    Given a work stream with milestone "03" titled "Board"
    And story "03/01" titled "Board UI" with status "in-progress"
    And a running run on "03/01"
    When I run `work run-complete 03/01 --outcome failed --json`
    Then the command should succeed
    And the journal should hold a "run.completed" event
    And every journaled step of that event should be terminal

  Scenario: minting a run raises its declared event — publishing is no longer the verb's own import
    Given a work stream with milestone "03" titled "Board"
    And story "03/01" titled "Board UI" with status "in-progress"
    When I run `work run-start 03/01 --json`
    Then the command should succeed
    And the JSON result field "state" should be "running"
    And the journal should hold a "run.started" event
    And the journaled event should carry "ref" as "03/01"
    And the journaled step "publish-projection" should be "done"
    And every journaled step of that event should be terminal

  Scenario: recording feedback raises its declared event beside the record-doc write
    Given a work stream with milestone "03" titled "Board"
    And story "03/01" titled "Board UI" with status "in-progress"
    When I run `work feedback 03/01 --note "the dock lost its scrollback" --actor qa --json`
    Then the command should succeed
    And the JSON result field "ok" should be true
    And item "03/01" STATE.md should contain "the dock lost its scrollback"
    And the journal should hold a "feedback.recorded" event
    And the journaled event should carry "ref" as "03/01"
    And the journaled step "publish-projection" should be "done"
    And every journaled step of that event should be terminal

  Scenario: a crashed cascade is paid by the next CLI invocation
    Given a work stream with milestone "03" titled "Board"
    And story "03/01" titled "Board UI" with status "in-progress"
    And a journaled "run.completed" event with pending steps for a failed run on "03/01"
    When I run `work tasks 03/01`
    Then the command should succeed
    And the journal should hold no pending steps
    And item "03/01" should list with status "not-started"
