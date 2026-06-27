@cli @work @work-stream @executable @validate
Feature: The structural-integrity check-group reports folder-first numbering, duplicate, and orphan faults
  In order to catch a stream whose folder layout hides a typo'd directory, a duplicate driver number, or a gap nothing else reports
  the structural-integrity check-group reads the raw workDir listing + the listItems set against ITEM_RE, emits a coded { numbering-gap | duplicate-driver-number | orphan-folder } finding folder-first, and keeps the ROADMAP-folder cross-reference an honest no-op until a structured milestone index exists,
  so that an operator gets a deterministic, reproducible-in-CI finding for a structural fault the per-file validate lane cannot see — with zero dependency on any ROADMAP shape today.

  # ADR-004 (folder-FIRST). The folder-only invariants ALWAYS run — they read only
  # the raw workDir directory listing + the listItems set + ITEM_RE
  # (^(\d+)_(milestone|story|task|uat)_…), no ROADMAP, no doc parse:
  #   numbering-gap            warn   (a gap in the top-level driver sequence;
  #                                    gaps are usually intentional reservations)
  #   duplicate-driver-number  error  (two top-level drivers — milestone/uat, via
  #                                    isDriver — sharing a number; breaks
  #                                    findWork/nextWork number resolution)
  #   orphan-folder            warn   (a dir not matching ITEM_RE that listItems
  #                                    silently drops — a real artifact nothing
  #                                    else reports)
  # The ROADMAP↔folder cross-reference (roadmap-folder-mismatch) is OPT-IN: it
  # emits NOTHING unless a structured, machine-parseable milestone index is
  # present/configured. With only a prose/backlog ROADMAP or none — THE STATE OF
  # THIS REPO — it is an honest no-op. The no-op is the PRIMARY scenario below; the
  # active scenario uses a clearly opt-in structured-index fixture.
  # ADR-001: the envelope is { code, severity, path, message }; severity ∈
  # {warn, error}; an empty findings array means healthy. The severities above are
  # architect-fixed (numbering-gap = warn, duplicate-driver-number = error,
  # orphan-folder = warn). LITMUS: every Then asserts a finding present/absent over
  # a fixed folder fixture — never a folder-traversal implementation detail.

  Background:
    Given a work stream whose top-level driver folders and milestone stories/ subfolders are read as a raw directory listing

  # The clean baseline: a contiguous, duplicate-free, orphan-free stream where
  # every folder matches ITEM_RE emits no structural finding. Silent when well.
  Scenario: a well-numbered, gap-free, orphan-free stream produces no structural findings
    Given top-level driver folders numbered "07", "08", "09" with no duplicates and every folder matching the item-name pattern
    And no structured milestone-index ROADMAP is present or configured
    When the structural-integrity check-group runs
    Then no structural finding is reported

  # numbering-gap (warn): a missing number in the top-level driver sequence. 07,
  # 08, 10 with no 09 ⇒ a gap. A contiguous sequence ⇒ nothing. Gaps are advisory
  # (intentional reservations), so this is warn, never error.
  Scenario Outline: a gap in the top-level driver number sequence is reported as a warn
    Given top-level driver folders numbered "<numbers>"
    When the structural-integrity check-group runs
    Then the finding outcome is "<finding>"

    Examples: top-level driver sequences
      | numbers       | finding             | # note
      | 07, 08, 10    | numbering-gap / warn | # 09 is missing → one gap
      | 07, 08, 11    | numbering-gap / warn | # 09 and 10 missing → a gap run
      | 07, 08, 09    | (none)               | # contiguous → no gap
      | 00, 01, 02    | (none)               | # contiguous from zero → no gap

  # duplicate-driver-number (error): two TOP-LEVEL drivers (milestone/uat, via
  # isDriver) sharing a number is an error — findWork/nextWork resolve a driver by
  # number and a duplicate makes that ambiguous. A milestone and a uat at the same
  # number collide too (both are drivers).
  Scenario Outline: two top-level drivers sharing a number are reported as an error
    Given top-level driver folders "<folders>"
    When the structural-integrity check-group runs
    Then the finding outcome is "<finding>"

    Examples: top-level driver folder sets
      | folders                                                          | finding                         | # note
      | 07_milestone_alpha, 07_milestone_beta                            | duplicate-driver-number / error | # two milestones at 07
      | 07_milestone_alpha, 07_uat_alpha-signoff                         | duplicate-driver-number / error | # a milestone and a uat collide at 07 (both drivers)
      | 07_milestone_alpha, 08_milestone_beta                            | (none)                          | # distinct numbers → no collision

  # orphan-folder (warn): a directory that does NOT match ITEM_RE is silently
  # dropped by listItems today, so a typo'd folder vanishes from every command.
  # The check reads the raw listing and reports the orphan — both directly under
  # workDir AND under a milestone's stories/. A matching folder is never an orphan.
  Scenario Outline: a directory not matching the item-name pattern is reported as an orphan
    Given a directory named "<folder>" located "<location>"
    When the structural-integrity check-group runs
    Then the finding outcome is "<finding>"

    Examples: directly under the work dir
      | folder                  | location                    | finding              | # note
      | 07_mileston_typo        | directly under the work dir | orphan-folder / warn | # "mileston" misspelled → no ITEM_RE match
      | notes                   | directly under the work dir | orphan-folder / warn | # an unnumbered scratch dir
      | 07-milestone-dashes     | directly under the work dir | orphan-folder / warn | # dashes not underscores → no match
      | 07_milestone_valid      | directly under the work dir | (none)               | # matches ITEM_RE → a real item, not an orphan

    Examples: under a milestone's stories/ subfolder
      | folder                  | location                       | finding              | # note
      | 00_storry_typo          | under a milestone's stories/   | orphan-folder / warn | # "storry" misspelled → no match
      | drafts                  | under a milestone's stories/   | orphan-folder / warn | # an unnumbered subfolder
      | 00_story_valid          | under a milestone's stories/   | (none)               | # matches ITEM_RE → a real story

  # ADR-004, the PRIMARY ROADMAP scenario: with no structured milestone-index
  # ROADMAP — only a prose/backlog ROADMAP, or none (THE STATE OF THIS REPO) — the
  # cross-reference emits NOTHING even when a folder is "missing" relative to the
  # prose. The no-op is the documented default; it asserts nothing rather than
  # fabricating a diff against a narrative it cannot parse.
  Scenario: with no structured milestone-index ROADMAP the cross-reference is an honest no-op
    Given a stream whose only ROADMAP is prose/backlog (no structured milestone index)
    And the folders and the prose ROADMAP do not line up
    When the structural-integrity check-group runs
    Then no roadmap-folder-mismatch finding is reported

  Scenario: with no ROADMAP file at all the cross-reference still emits nothing
    Given a stream with no ROADMAP file present and no structured index configured
    When the structural-integrity check-group runs
    Then no roadmap-folder-mismatch finding is reported

  # ADR-004, the OPT-IN ACTIVE scenario: only when a structured, machine-parseable
  # milestone-index ROADMAP fixture is present/configured does the cross-reference
  # fire — when the index lists a milestone no folder backs (or vice-versa).
  Scenario Outline: with a structured milestone-index fixture a mismatch is reported
    Given a structured milestone-index ROADMAP fixture is configured
    And the index and the folders relate as "<relation>"
    When the structural-integrity check-group runs
    Then the finding outcome is "<finding>"

    Examples: structured index ↔ folder relation
      | relation                                            | finding                       | # note
      | the index lists milestone 09 but no 09 folder exists | roadmap-folder-mismatch / warn | # indexed-but-absent
      | a milestone 09 folder exists but the index omits it  | roadmap-folder-mismatch / warn | # on-disk-but-unindexed
      | the index and the folders agree exactly              | (none)                        | # matched → no mismatch
