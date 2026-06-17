@cli @work @work-stream @executable
Feature: Pick the next actionable item in dependency order
  In order to always work the right item next
  the system must return the first not-done driver whose dependencies are all done, drilled to its first unfinished story.

  Background:
    Given a work stream ordered by number, with "depends" edges between drivers

  Scenario: the next item is the first not-done milestone whose dependency is done
    Given milestone "00" is done and milestone "01" (depends on "00") is not started
    When I run "aof work next"
    Then it returns state "ready" for ref "01"

  Scenario: a not-done milestone is drilled into its first not-done story
    Given milestone "00" is in progress with story "00/00" not done
    When I run "aof work next"
    Then it returns state "ready" for ref "00/00" of type "story"

  Scenario: a milestone is drilled to its first not-done story, skipping done ones
    Given milestone "00" is in progress with story "00/00" done and story "00/01" not done
    When I run "aof work next"
    Then it returns state "ready" for ref "00/01" of type "story"

  Scenario: a milestone whose stories are all done is itself actionable, to accept
    Given milestone "00" is in review and every story under it is done
    When I run "aof work next"
    Then it returns state "ready" for ref "00" of type "milestone"

  Scenario: a not-done milestone that has no stories is itself actionable, to break down
    Given milestone "00" is not started and has no stories
    When I run "aof work next"
    Then it returns state "ready" for ref "00" of type "milestone"

  Scenario: a ready uat session is itself the actionable item
    Given every milestone a uat session depends on is done
    When I run "aof work next"
    Then it returns state "ready" for the uat session, not drilled into stories

  Scenario: selection is strictly by number — an earlier not-done driver is chosen over a later one
    Given milestone "00" and milestone "01" are both not started with their dependencies done
    When I run "aof work next"
    Then it returns state "ready" for ref "00"

  Scenario: a done driver is skipped and the next not-done driver is selected
    Given milestone "00" is done and milestone "01" is in progress with its dependencies done
    When I run "aof work next"
    Then it returns state "ready" for ref "01"

  Scenario: the stream is done when every driver is done
    Given every milestone and uat session is done
    When I run "aof work next"
    Then it returns state "done"

  # The case matrix — the verdict across stream states, drilling included.
  # "ready" reports the drilled item (a story ref when a milestone has an unfinished story,
  # the driver's own ref when it is a uat session, has no stories, or has all stories done).
  Scenario Outline: the verdict and reported ref follow the selection rule
    Given a stream in state <stream-state>
    When I run "aof work next"
    Then it returns state <state> for ref <ref> of type <type>

    Examples:
      | stream-state                                        | state | ref   | type      |
      | m00 done, m01 not-started (deps done)               | ready | 01    | milestone |
      | m00 in-progress, story 00/00 not done               | ready | 00/00 | story     |
      | m00 in-progress, 00/00 done, 00/01 not done         | ready | 00/01 | story     |
      | m00 in-review, all its stories done                 | ready | 00    | milestone |
      | m00 not-started, no stories                         | ready | 00    | milestone |
      | uat 02 ready, the milestones it accepts done        | ready | 02    | uat       |
      | every driver done                                   | done  | -     | -         |
