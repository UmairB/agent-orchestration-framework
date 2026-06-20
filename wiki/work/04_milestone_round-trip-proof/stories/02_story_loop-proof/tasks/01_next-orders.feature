@cli @work @round-trip @executable
Feature: aof work next returns the dependency-ready item
  In order for the loop to walk work in the right order
  next must return the first dependency-ready actionable item as the seeded stream advances, and report blocked or done at the edges.

  # The loop's traversal: as the seeded sample advances, `aof work next` must name the right next item.
  # Each row sets the seeded stream to a state (a fixture edit: a status in frontmatter, or an unmet
  # `depends` edge) and asserts what the shipped `nextWork` returns — its { state, ref } pair. Covers
  # the four "ready" walks (first story, skip-to-next-story, all-stories-done-accept-the-milestone,
  # no-stories-break-down), the BLOCKED edge (a driver held on an unmet depends), and the DONE edge
  # (the span exhausted). Black-box: the result is a function of files-on-disk, not of traversal internals.

  Background:
    Given a fresh isolated repo with the sample milestone seeded

  Scenario: a not-started milestone drills to its first not-done story
    Given the seeded milestone and all its stories are not-started
    When "aof work next" is run in the repo
    Then it returns state "ready" for the milestone's first story

  Scenario: a held milestone reports blocked with what it waits on
    Given the seeded milestone depends on a driver that is not done
    When "aof work next" is run in the repo
    Then it returns state "blocked" for the seeded milestone
    And it names the unmet dependency among what it is waiting on

  # The case matrix — the { state, ref } the shipped `nextWork` returns across seeded states.
  # "ready" reports the DRILLED item: a story ref while the milestone has an unfinished story, the
  # milestone's OWN ref once every story is done (it needs accepting) or when it has no stories yet
  # (it needs breaking down). "blocked" reports the held driver's own ref. "done" reports no ref —
  # the scoped span is exhausted.
  Scenario Outline: next returns the correct { state, ref } for a seeded state
    Given the seeded stream is advanced to state "<state>"
    When "aof work next" is run in the repo
    Then it returns state "<result-state>" for "<result-ref>"

    Examples:
      | state                                                  | result-state | result-ref                   |
      | all items not-started                                  | ready        | the milestone's first story  |
      | the first story is done, the rest not-started          | ready        | the milestone's second story |
      | every story under the milestone is done                | ready        | the milestone (to accept)    |
      | the milestone is not-started and has no stories yet     | ready        | the milestone (to break down)|
      | the milestone depends on a driver that is not done      | blocked      | the milestone (held)         |
      | the milestone is done and nothing else is in the span   | done         | nothing (span exhausted)     |
