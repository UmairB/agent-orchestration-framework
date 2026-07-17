@executable @cli @work @scaffold
Feature: a declared gap is promotable into a chore whose Definition of Done is its discharge condition
  In order for a declared gap to appear where work is chosen, not only where someone thinks to query
  a declared open gap must be promotable into a top-level chore whose Definition of Done is seeded from
  the gap's discharge condition and which traces back to the originating gap, born not-started for aof:verify to close.

  # STORY/ADR-001: a gap's discharge condition IS the chore's close criterion — mechanically checkable, not
  # a judgement. The promotion REUSES the existing chore scaffold (the `.aof/templates/work/chore/CHORE.md`
  # template — a `## Definition of Done` checkbox list, frontmatter `status: not-started`), NOT a bespoke
  # writer. A chore is a top-level DRIVER (milestone 37): it groups no stories and carries no `.feature`;
  # its whole deliverable is a ticked checklist, closed later by `aof:verify <chore-ref>` (every box ticked
  # AND validate green). These scenarios assert the OBSERVABLE outcome of a promotion — a chore item exists,
  # its DoD carries the discharge condition, it links back to the gap, and it is born not-started (never
  # hand-ticked at creation). The exact promote verb/flag is the developer's to define; the behaviour is fixed here.
  Background:
    Given an open gap "warnings_delivered field" whose discharge condition is "a production path writes warnings_delivered"

  Scenario: promoting an open gap creates a top-level chore seeded from its discharge condition
    When the gap is promoted to a chore
    Then a top-level chore work item is created
    And the chore's "## Definition of Done" contains "a production path writes warnings_delivered"
    And the chore records the originating gap "warnings_delivered field" it was promoted from

  # The chore is born not-started with an unticked checklist — "done" is earned later by aof:verify against
  # a fully-ticked Definition of Done, never asserted at creation (the same discipline as any chore).
  Scenario: the promoted chore is born not-started, never hand-ticked done at creation
    When the gap is promoted to a chore
    Then the created chore's status is "not-started"
    And no "## Definition of Done" box on the created chore is ticked

  # The discharge condition seeds the DoD for ANY gap — the seed is the gap's own close criterion, not a
  # hardcoded string — and the chore always links back to the gap it discharges.
  Scenario Outline: an open gap's discharge condition seeds the promoted chore's Definition of Done
    Given an open gap "<gap>" whose discharge condition is "<discharge condition>"
    When the gap is promoted to a chore
    Then a top-level chore work item is created
    And the chore's "## Definition of Done" contains "<discharge condition>"
    And the chore records the originating gap "<gap>" it was promoted from
    And the created chore's status is "not-started"

    Examples: each gap's discharge condition becomes its chore's close criterion
      | gap                      | discharge condition                             |
      | warnings_delivered field | a production path writes warnings_delivered      |
      | audit_trail field        | an emitter populates audit_trail on every write  |
      | retry_count field        | the scheduler increments retry_count on retry    |

  # Boundary (QA-enumerated): only OPEN debt is schedulable. A gap already `discharged` has no debt left to
  # schedule, so promoting it creates no chore — the promotion is refused rather than scheduling closed work.
  Scenario: promoting an already-discharged gap creates no chore
    Given a gap "legacy_flag field" with status "discharged"
    When the gap is promoted to a chore
    Then no chore work item is created
    And the promotion reports that the gap is already discharged
