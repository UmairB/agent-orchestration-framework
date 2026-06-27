@cli @work @work-stream @validate @executable
Feature: The status-coherence check-group surfaces cross-item status contradictions validate is blind to
  In order to catch the incoherence a per-file validate cannot see — a parent that lies about a child's status, or a driver running ahead of its gate
  the doctor's status-coherence group reads each item's frontmatter status (and a driver's depends) across the whole snapshot and emits a coded, severity-tagged finding anchored on the item the contradiction is ABOUT,
  so that a stream that passes `aof work validate` but hides a done-over-not-done parent, a not-started-over-started parent, a done story under a not-started milestone, or a depends-blocked yet in-progress driver now surfaces each as a `work:doctor` finding.

  # This is the OBSERVABLE behaviour of the status-coherence check-GROUP (ADR-003:
  # a pure (snapshot, ctx) => Finding[] appended to story 00's registry). It reads
  # ONLY per-item frontmatter `status` and a driver's `depends` from the snapshot —
  # no mtimes, no folder-name scanning (that is story 02). Each finding is the
  # frozen envelope { code, severity, path, message } (ADR-001): we assert the
  # observable code + severity + the anchor path, never how the group computes them.
  # The envelope SHAPE itself (four keys, severity ∈ {warn,error}, raw-absolute path)
  # is story 00's arch-test, NOT asserted here.
  #
  # The code -> severity contract this group OWNS (the QA judgment, fixed at Contract):
  #   lying-parent                 -> error  (architect-fixed, ADR-001: a done parent
  #                                            over a non-done child is a hard claim of
  #                                            completion that is false)
  #   story-done-under-not-started -> error  (same class as lying-parent inverted: a
  #                                            COMPLETED child under a parent claiming
  #                                            work has not even begun — a hard
  #                                            contradiction, not a process lag)
  #   depends-blocked-in-progress  -> error  (an ordering violation: depends is the
  #                                            gate; a driver working ahead of an
  #                                            unmet dependency breaks next/gating)
  #   stale-parent                 -> warn   (softer process advisory: the child is
  #                                            ahead of the parent — the parent forgot
  #                                            to advance; nothing CLAIMS a false
  #                                            completion, so advisory, not blocking)
  Background:
    Given a work-stream fixture the doctor engine can build a snapshot over
    And the status-coherence check-group registered in the doctor engine

  # The headline contradiction (PO outcome): a milestone marked done while a child
  # story is not done. The parent LIES about completion — the architect fixed this
  # as `error`. The finding anchors on the lying parent (its SPEC.md / folder), and
  # the message names the cross-item fact (which parent, which non-done child).
  Scenario Outline: a status contradiction across items is reported with its code and severity
    Given the fixtured stream contains "<fixture>"
    When I run the doctor over the stream
    Then a finding is reported with code "<code>" and severity "<severity>"
    And that finding's path anchors on the item the contradiction is about
    And that finding's message names the cross-item status fact

    # Each fixture is the MINIMAL deterministic shape that triggers exactly one
    # contradiction. The `code` and `severity` are the observable contract.
    Examples:
      | fixture                                                                                  | code                         | severity |
      | a milestone status:done with a child story status:in-progress                            | lying-parent                 | error    |
      | a milestone status:done with a child story status:blocked                                | lying-parent                 | error    |
      | a milestone status:not-started with a child story status:in-progress                     | stale-parent                 | warn     |
      | a milestone status:not-started with a child story status:done                            | stale-parent                 | warn     |
      | a story status:done under a milestone status:not-started                                 | story-done-under-not-started | error    |
      | a driver status:in-progress whose depends names a driver that is not yet done            | depends-blocked-in-progress  | error    |

  # The negative case the whole group exists to stay silent on: a coherent stream —
  # a parent whose status is consistent with its children, and a driver whose
  # depends are all satisfied — produces NONE of this group's codes. An empty
  # findings set is the healthy signal (ADR-001: silent when well).
  Scenario: a coherent stream emits no status-coherence finding
    Given the fixtured stream has a milestone status:in-progress with a child story status:in-progress
    And the same stream has a milestone status:done whose every child story is status:done
    And the same stream has a driver status:in-progress whose every depends-named driver is status:done
    When I run the doctor over the stream
    Then no finding with code "lying-parent" is reported
    And no finding with code "stale-parent" is reported
    And no finding with code "story-done-under-not-started" is reported
    And no finding with code "depends-blocked-in-progress" is reported

  # A done parent over an all-done set of children is the canonical CLEAN parent —
  # the inverse of lying-parent — and must NOT fire, proving the check keys on a
  # NON-done child specifically, not merely on a done parent.
  Scenario: a done milestone whose every child story is done is not a lying parent
    Given the fixtured stream has a milestone status:done with two child stories both status:done
    When I run the doctor over the stream
    Then no finding with code "lying-parent" is reported

  # The gate is satisfied: a driver in-progress whose depends-named driver IS done
  # must NOT fire depends-blocked-in-progress — proving the check keys on the
  # dependency NOT being done, not merely on the presence of a depends edge.
  Scenario: an in-progress driver whose dependency is done is not depends-blocked
    Given the fixtured stream has a driver status:in-progress whose depends names a driver that is status:done
    When I run the doctor over the stream
    Then no finding with code "depends-blocked-in-progress" is reported
