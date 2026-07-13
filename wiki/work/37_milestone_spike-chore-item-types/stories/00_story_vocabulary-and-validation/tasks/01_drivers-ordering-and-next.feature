<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — what is observably true when spike/chore participate in the depends ordering graph
# as top-level drivers, surfaced by `aof work next` the uat way (the item IS the work).
# Litmus: every Then reads off `aof work next --json` — { state, ref, type, slug, status, path, waitingOn }.
# Invariants (isDriver true, the candidacy-guarded uat-shaped ready-return) are FF-3702/FF-3705 — NOT here.

@cli @work @work-stream @executable
Feature: spike and chore participate in the depends ordering graph as top-level drivers
  In order to gate and sequence a build on an investigation or a housekeeping step
  the system must treat a spike/chore as a depends target and surface a ready one as the actionable item itself

  Background:
    Given a work stream whose top-level drivers include milestones, a spike, and a chore, each carrying `depends`

  # Headline: a milestone that depends on a not-done spike is BLOCKED, waiting on that spike.
  Scenario: aof work next reports a milestone blocked on a not-done spike
    Given a spike at slot <spike-num> with status "in-progress" (not done)
    And a milestone at slot <ms-num> with `depends: [<spike-num>]` and status "not-started"
    And every driver numbered below <ms-num> is done
    When I run `aof work next <ms-num> --json`
    Then the result `state` is "blocked"
    And the result `ref` is the milestone's number
    And the result `waitingOn` array contains "<spike-num>"

  # Headline: a ready spike is surfaced as the actionable item ITSELF — never drilled into stories,
  # never labelled "needs break-down". Same for a chore. This is the uat-shaped item-is-the-work return.
  Scenario Outline: aof work next surfaces a ready <type> as the actionable item itself
    Given a <type> at slot <num> with status "not-started" and all its `depends` resolved to done drivers
    And no lower-numbered driver is actionable
    When I run `aof work next <num> --json`
    Then the result `state` is "ready"
    And the result `type` is "<type>"
    And the result `ref` is the <type>'s number
    And the result `path` ends with the <type> folder's name
    And the result carries no `waitingOn` field

    Examples:
      | type  |
      | spike |
      | chore |

  # A chore is a valid `depends` target of another driver — the edge resolves, so validate raises
  # no "does not resolve" finding and next can gate on it (observable: a dependent stays blocked
  # until the chore is done, then becomes ready — proving the edge was honoured, not dropped).
  Scenario: a chore is an honoured depends target that gates and then unblocks a dependent driver
    Given a chore at slot <chore-num> and a milestone at slot <ms-num> with `depends: [<chore-num>]`
    And every driver below <ms-num> other than the chore is done
    When the chore's status is "not-started" and I run `aof work next <ms-num> --json`
    Then the result `state` is "blocked" with `waitingOn` containing "<chore-num>"
    When the chore's status is then set to "done" and I run `aof work next <ms-num> --json`
    Then the result `state` is "ready" and the result `ref` is the milestone's number

  # Walk order respects the numeric slot among the drivers: with all deps satisfied, `next` (no scope)
  # returns the lowest-numbered not-done driver, whatever its type (spike/chore compete on number).
  Scenario Outline: aof work next walks drivers in numeric slot order across types
    Given the only not-done drivers are <lower> and <higher>, both actionable, and <lower> < <higher>
    When I run `aof work next --json`
    Then the result `ref` is <lower>'s number
    And the result `type` is "<lower-type>"

    Examples:
      | lower | lower-type | higher | higher-type |
      | spike | spike      | ms     | milestone   |
      | ms    | milestone  | chore  | chore       |
      | chore | chore      | spike  | spike       |
