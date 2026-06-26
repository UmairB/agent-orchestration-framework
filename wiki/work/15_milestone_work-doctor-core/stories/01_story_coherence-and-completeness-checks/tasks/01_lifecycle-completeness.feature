@cli @work @work-stream @validate @executable
Feature: The lifecycle-completeness check-group surfaces the close-convention docs a given status implies are missing
  In order to catch a milestone or story whose status promises a deliverable the convention requires but whose folder does not carry it
  the doctor's lifecycle-completeness group reads each item's frontmatter status and the presence (and non-emptiness) of its convention docs / stories / tasks across the snapshot and emits a coded finding anchored on the item the deliverable is missing FROM,
  so that a stream that passes `aof work validate` but hides a done milestone with no VERIFICATION/RETROSPECTIVE, a started milestone with no stories, a started story with no tasks, or a milestone with stories but no ARCHITECTURE now surfaces each as a `work:doctor` finding.

  # This is the OBSERVABLE behaviour of the lifecycle-completeness check-GROUP
  # (ADR-003: a pure (snapshot, ctx) => Finding[] appended to story 00's registry).
  # It reads ONLY per-item frontmatter `status` and doc/stories/tasks PRESENCE from
  # the snapshot — no mtimes, no folder-name scanning (story 02). Each finding is the
  # frozen envelope { code, severity, path, message } (ADR-001): we assert the
  # observable code + severity + the anchor path, never how the group computes them.
  # "Present" for VERIFICATION.md means present AND non-empty (an empty stub is a
  # missing deliverable — mirrors SPEC's "non-empty VERIFICATION.md").
  #
  # The code -> severity contract this group OWNS (the QA judgment, fixed at Contract):
  #   missing-verification    -> warn   close-convention / completeness advisory
  #   missing-retrospective   -> warn   close-convention / completeness advisory
  #   milestone-no-stories    -> warn   completeness advisory (a started milestone
  #                                      with no break-down is a process gap, not a
  #                                      coherence contradiction)
  #   started-story-no-tasks  -> warn   completeness advisory (a started story with an
  #                                      empty tasks/ has no acceptance contract yet)
  #   missing-architecture    -> warn   completeness advisory (stories exist but the
  #                                      structural-decision doc is absent)
  # ALL warn: none of these is a status LIE (story 00's coherence group owns the
  # hard contradictions). These are missing-deliverable reminders — advisory by
  # design; only `--strict` (story 00, ADR-002) promotes them to a gate.
  Background:
    Given a work-stream fixture the doctor engine can build a snapshot over
    And the lifecycle-completeness check-group registered in the doctor engine

  # The headline cases (PO outcomes): a status that the convention says REQUIRES a
  # deliverable, with that deliverable absent. Each finding anchors on the item the
  # deliverable is missing from (its own folder) and names the missing convention.
  Scenario Outline: a status whose required deliverable is absent is reported with its code and severity
    Given the fixtured stream contains "<fixture>"
    When I run the doctor over the stream
    Then a finding is reported with code "<code>" and severity "<severity>"
    And that finding's path anchors on the item the deliverable is missing from
    And that finding's message names the missing deliverable

    # Minimal deterministic fixtures: each triggers exactly one missing-deliverable
    # finding. `in-review` and `done` both require VERIFICATION; only `done` requires
    # RETROSPECTIVE. "past not-started" means any started status (in-progress/done).
    Examples:
      | fixture                                                                                  | code                  | severity |
      | a milestone status:in-review with no VERIFICATION.md                                     | missing-verification  | warn     |
      | a milestone status:done with no VERIFICATION.md                                          | missing-verification  | warn     |
      | a milestone status:in-review with an empty VERIFICATION.md                               | missing-verification  | warn     |
      | a milestone status:done with no RETROSPECTIVE.md                                         | missing-retrospective | warn     |
      | a milestone status:in-progress with zero stories                                         | milestone-no-stories  | warn     |
      | a milestone status:done with zero stories                                                | milestone-no-stories  | warn     |
      | a story status:in-progress with an empty tasks/                                          | started-story-no-tasks| warn     |
      | a milestone that has at least one story but no ARCHITECTURE.md                           | missing-architecture  | warn     |

  # The negative case: a milestone complete FOR ITS STATUS — a done milestone that
  # carries a non-empty VERIFICATION.md AND a RETROSPECTIVE.md, with stories and an
  # ARCHITECTURE.md — emits none of this group's codes. Silent when well (ADR-001).
  Scenario: a milestone complete for its status emits no lifecycle-completeness finding
    Given the fixtured stream has a milestone status:done with a non-empty VERIFICATION.md and a RETROSPECTIVE.md
    And that milestone has at least one story and an ARCHITECTURE.md
    And that milestone's started story has a non-empty tasks/
    When I run the doctor over the stream
    Then no finding with code "missing-verification" is reported
    And no finding with code "missing-retrospective" is reported
    And no finding with code "milestone-no-stories" is reported
    And no finding with code "started-story-no-tasks" is reported
    And no finding with code "missing-architecture" is reported

  # A not-started milestone has reached no status that REQUIRES any of these
  # deliverables — so an empty not-started milestone (no stories, no VERIFICATION,
  # no RETROSPECTIVE, no ARCHITECTURE) must stay silent. The checks key on the
  # status threshold, not on mere absence.
  Scenario: a not-started milestone with no deliverables yet emits no lifecycle-completeness finding
    Given the fixtured stream has a milestone status:not-started with no stories and no convention docs
    When I run the doctor over the stream
    Then no finding with code "missing-verification" is reported
    And no finding with code "missing-retrospective" is reported
    And no finding with code "milestone-no-stories" is reported
    And no finding with code "missing-architecture" is reported

  # The VERIFICATION boundary: a status BELOW the in-review threshold (in-progress)
  # does not yet require VERIFICATION, so it must NOT fire missing-verification —
  # proving the check keys on the in-review/done threshold, not on absence alone.
  Scenario: an in-progress milestone without VERIFICATION is not missing-verification
    Given the fixtured stream has a milestone status:in-progress with stories and an ARCHITECTURE.md but no VERIFICATION.md
    When I run the doctor over the stream
    Then no finding with code "missing-verification" is reported
