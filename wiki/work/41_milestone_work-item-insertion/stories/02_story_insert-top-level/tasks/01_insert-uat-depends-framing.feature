<!-- aof-generated: refine (Three Amigos — PO headline Scenarios, QA Examples + litmus) -->

# Task feature — insert-uat's `depends:` framing (STORY.md AC2): a uat session is a
# gate over the milestones it accepts, so insert-uat authors `depends:` the same way
# add-uat does today — the placement axis (ADR-002/005) changes only WHERE the new
# item lands, never how its framing content is produced.
# LITMUS: `depends` is NOT surfaced by find/list/validate (find returns only
# ref/type/slug/status/title/parent), so the ONLY black-box channel for the authored
# value is the insert-uat --json envelope echoing the created item. These Thens
# assume that envelope carries the created item's `depends` (see residual-concern
# note to the PO — this is a required envelope contract for black-box verifiability).
# validate-green is the second, independent channel: an authored depends that fails
# to resolve to a real driver post-shift would flag.

@cli @work @work-stream @executable
Feature: insert-uat authors depends the same way add-uat does, independent of where it is placed
  In order that a uat session inserted mid-stream is still a real acceptance gate over the milestones it names
  aof work insert-uat must accept the same depends-framing input add-uat does and write it into the new item's record doc regardless of the target position P

  Background:
    Given a fixture work stream with milestones "00", "01", and "02"

  # Headline: depends framing is authored on the newly-scaffolded item exactly as
  # add-uat would author it, whatever position it lands at. Inserting the uat at
  # slot 1 shifts every milestone >= 1 up by one: milestone "01" -> 2, milestone
  # "02" -> 3, milestone "00" unchanged. The operator names milestones 0 and 2 (their
  # current numbers); framed against post-shift numbers that is depends [0, 3].
  Scenario: insert-uat authors the given depends list, rewritten to post-shift numbers, into the new item
    When I run `aof work insert-uat "release-gate" --at 1 --depends 0,2 --json`
    Then the insert-uat --json envelope reports the new uat's depends as [0, 3]
    And a fresh `aof work validate --json` reports zero findings for the new item's depends

  # A depends target that itself shifts as a consequence of the insert is framed
  # against its NEW number, not its pre-insert number — the operator names the
  # milestone they mean, not a number that is about to become stale. Milestone "01"
  # shifts to 2 when the uat opens slot 1, so the authored depends becomes [2].
  Scenario: a named depends target that shifts as a consequence of the same insert is framed against its new number
    When I run `aof work insert-uat "release-gate" --at 1 --depends 1 --json`
    Then the insert-uat --json envelope reports a depends value equal to the new number of the milestone that was "01"
    And a fresh `aof work validate --json` reports zero findings for the new item's depends

  # insert-milestone carries no depends-framing concept (framing parity with
  # add-milestone, which authors no depends either) — the concern is specific to uat.
  Scenario: insert-milestone accepts no depends framing
    When I run `aof work insert-milestone "widget-support" --at 1 --json`
    Then the insert-milestone --json envelope reports no depends for the new item
    And a fresh `aof work find 1 --json` resolves a milestone with slug "widget-support"
