@cli @work @work-stream @executable
Feature: Report blocked items and scope by range
  In order to surface what a held item waits on, and to focus on a span of the stream
  the system must report a blocked item with its unmet dependencies and honour a range scope.

  Background:
    Given a work stream with "depends" edges between drivers

  Scenario: a scoped item whose dependency is unmet is reported blocked
    Given milestone "00" is in progress and milestone "01" depends on "00"
    When I run "aof work next 01"
    Then it returns state "blocked" for ref "01"
    And it names "00" among what it is waiting on

  Scenario: a blocked driver lists every unmet dependency in waitingOn
    Given milestone "02" depends on "00" and "01", and both "00" and "01" are not done
    When I run "aof work next 02"
    Then it returns state "blocked" for ref "02"
    And waitingOn is exactly "00" and "01"

  Scenario: waitingOn names only the unmet dependencies, not the satisfied ones
    Given milestone "02" depends on "00" and "01", with "00" done and "01" not done
    When I run "aof work next 02"
    Then it returns state "blocked" for ref "02"
    And waitingOn is exactly "01"

  Scenario: a dependency outside the scope is still checked when reporting blocked
    Given milestone "00" is in progress and milestone "01" (depends on "00") is not started
    When I run "aof work next 01"
    Then it returns state "blocked" for ref "01"
    And it names "00" among what it is waiting on

  Scenario: a range that contains only done work reports done
    Given milestones "00" and "01" are both done
    When I run "aof work next 00-01"
    Then it returns state "done"

  Scenario: a range whose only in-scope item is blocked reports blocked
    Given milestone "00" is in progress and milestone "01" depends on "00"
    When I run "aof work next 01-01"
    Then it returns state "blocked" for ref "01"

  # The case matrix — exact inRange semantics from the source: a bare NN considers only
  # the driver numbered NN; an inclusive NN-MM considers lo..hi; no scope considers all.
  # The range gates the top-level driver number; a drilled story still reports its NN/SS ref.
  Scenario Outline: a range scope limits which drivers are considered
    Given milestones numbered 00 through 04, where 00 is done and 01 through 04 are not started with deps done
    When I run "aof work next <range>"
    Then it returns state <state> for ref <ref>

    Examples:
      | range | state | ref |
      | 02    | ready | 02  |
      | 04    | ready | 04  |
      | 01-03 | ready | 01  |
      | 00    | done  | -   |
      | 00-00 | done  | -   |
