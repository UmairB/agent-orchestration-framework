@executable @cli @work @memory
Feature: an OUTCOME.md Delivered/Gaps block becomes a capability or gap MemoryRecord
  In order to recall what a completed item now provides — and whether a field has a producer or I am about to invent one
  the local backend must turn each OUTCOME "### " heading under "## Delivered" into a capability record and each
  under "## Gaps" into a gap record, the same frozen MemoryRecord fields populated and a source that resolves to the heading line.

  # Scope: the parseOutcome parser only (39/ADR-001/ADR-002 — "### " under "## Delivered" -> capability,
  # "### " under "## Gaps" -> gap). Field values are grounded in the pinned OUTCOME.md section grammar
  # (milestone SPEC "## Stories"): "# NN · <Title> — Outcome", then "## Delivered"/"## Assumptions"/"## Gaps",
  # each capability/gap a "### <heading>" with a one-line statement, a gap carrying a "- **Status:**" line and
  # a "- **Discharge condition:**" line. Per 39/ADR-001: area is ALWAYS "delivery"; the lesson-only fields
  # (stage/kind/owner) are present as ""; a capability's status is "" (a standing fact); a gap's status is the
  # reused open|discharged token. Per 39/ADR-002: an Assumptions bullet folds into its capability's searchable
  # text and is NOT an independent record. Parsed against a FIXTURE OUTCOME.md here (not the live verify
  # authoring path) so this story is independent of story 01's code. The frozen-shape / single-seam / lockstep
  # INVARIANTS are the acd-outcome-record-frozen-shape and acd-outcome-single-index-seam fitness functions, NOT
  # a scenario here; these scenarios pin the OBSERVABLE field mapping on representative headings.

  Background:
    Given a milestone "39" (slug "39_milestone_delivery-memory-outcome") whose OUTCOME.md holds:
      """
      # 39 · Delivery Memory — Outcome

      ## Delivered
      ### OUTCOME records reach recall
      parseOutcome emits capability and gap records into buildRecords, so recall answers what the product provides.

      ### area delivery hard pre-filter
      recall --area delivery returns only product records and excludes the architecture ADRs entirely.

      ## Assumptions
      - **OUTCOME.md is authored at Accept** — the delivery records exist only once aof:verify writes the doc.

      ## Gaps
      ### warnings_delivered field
      - **Status:** open
      - **Discharge condition:** a production code path assigns warnings_delivered.
      warnings_delivered is written only by test fixtures; no production path populates it.

      ### per-story OUTCOME authoring
      - **Status:** discharged
      - **Discharge condition:** a story-level OUTCOME.md is scaffolded and parsed by parseOutcome.
      A story's delivery rolls up into its milestone OUTCOME; there is no per-story record yet.
      """

  # 39/ADR-001 field mapping for a capability. The id is a stable slug of the "### " heading (the parseAof
  # idiom the grammar reuses). The chosen capability is the nearest-preceding one to the Assumptions section,
  # so its searchable text carries the folded assumption (39/ADR-002).
  Scenario: a Delivered "### " heading becomes a capability record with its delivery fields populated
    When parseOutcome indexes the milestone "39" OUTCOME.md
    Then a record exists with recordType "capability" and id "area-delivery-hard-pre-filter"
    And its item is "39" and its itemSlug is "39_milestone_delivery-memory-outcome"
    And its title is "area delivery hard pre-filter"
    And its area is "delivery"
    And its stage is "", its kind is "", and its owner is ""
    And its status is "" because a capability is a standing fact, not a lifecycle token
    And its summary is the one-line delivered statement under the heading
    And its text is the searchable blob covering the capability title, its delivered statement, and its folded assumption
    And its source resolves to "39_milestone_delivery-memory-outcome/OUTCOME.md" at the line of the "### area delivery hard pre-filter" heading

  # 39/ADR-001: area is hard-fixed "delivery" for every capability, and the lesson-only fields AND the
  # capability's status are present-as-"", never omitted (the frozen-shape convention, 05/ADR-005).
  Scenario: a capability record fixes area to "delivery" and carries stage/kind/owner and status as empty strings
    When parseOutcome indexes the milestone "39" OUTCOME.md
    Then the record with id "outcome-records-reach-recall" has area "delivery"
    And the record with id "outcome-records-reach-recall" has stage "", kind "", owner "", and status "" all present, none omitted

  # 39/ADR-001 field mapping for a gap. status comes from the "- **Status:**" line (read as parseArchitecture
  # reads "**Status:**"); the discharge condition folds into the searchable text.
  Scenario: a Gaps "### " heading becomes a gap record carrying its Status and discharge condition
    When parseOutcome indexes the milestone "39" OUTCOME.md
    Then a record exists with recordType "gap" and id "warnings-delivered-field"
    And its item is "39" and its itemSlug is "39_milestone_delivery-memory-outcome"
    And its title is "warnings_delivered field"
    And its area is "delivery"
    And its stage is "", its kind is "", and its owner is ""
    And its status is "open"
    And its summary is the gap statement together with its discharge-condition gist
    And its text is the searchable blob covering the gap title, its gap statement, and its discharge condition
    And its source resolves to "39_milestone_delivery-memory-outcome/OUTCOME.md" at the line of the "### warnings_delivered field" heading

  # 39/ADR-002: an assumption qualifies a delivery, it is not independently recallable debt — it folds into
  # the nearest-preceding capability's searchable text and never becomes its own record.
  Scenario: an Assumptions bullet folds into its capability's searchable text and never becomes its own record
    When parseOutcome indexes the milestone "39" OUTCOME.md
    Then no record has recordType "assumption"
    And no record's title is "OUTCOME.md is authored at Accept"
    And the capability record "area-delivery-hard-pre-filter" has the assumption statement folded into its searchable text

  # Mirrors the twin's "one record per heading": every "### " under Delivered or Gaps yields exactly one
  # record and nothing else does (the h1 title, the "## " section headings and the Assumptions bullet do not).
  Scenario: every "### " heading under Delivered or Gaps produces exactly one record, and nothing else does
    When parseOutcome indexes the milestone "39" OUTCOME.md
    Then it produces 4 delivery records, one per "### " heading
    And exactly 2 are capability records from "## Delivered" and 2 are gap records from "## Gaps"
    And no record is produced for the "# 39 · Delivery Memory — Outcome" title, the "## " section headings, or the Assumptions bullet

  # 39/ADR-002: parseOutcome is composed into buildRecords exactly as parseAof was (14/ADR-001), and
  # buildRecords is the single record-source both backends consume — local via reindex→buildIndex→buildRecords,
  # graphify via its direct buildRecords import — so the delivery records reach BOTH with one edit. (The
  # structural single-seam invariant is acd-outcome-single-index-seam; here it is the observable record set.)
  Scenario: the delivery records reach both the local and graphify backends through the shared buildRecords
    Given the milestone "39" OUTCOME.md is part of the work stream
    When the record set is built for the local backend and for the graphify backend
    Then both record sets contain the capability record "area-delivery-hard-pre-filter"
    And both record sets contain the gap record "warnings-delivered-field"

  # A gap's status is read from its "- **Status:**" line into the REUSED status field (39/ADR-001), and a gap
  # with no Status line defaults to open (the grammar's default). The arch-test pins status ∈ {"",open,discharged};
  # this outline pins the read AND the default-open rule the arch-test does not exercise.
  Scenario Outline: a gap's status comes from its Status line, defaulting to open when absent
    When parseOutcome indexes a "## Gaps" "### " heading whose body has "<statusLine>"
    Then a gap record for that heading has recordType "gap", area "delivery", stage "", kind "", owner "", and status "<status>"

    Examples: the two lifecycle tokens (39/ADR-001 — the reused status field)
      | statusLine                | status     |
      | - **Status:** open        | open       |
      | - **Status:** discharged  | discharged |

    Examples: default — a gap with no Status line is open (the grammar's stated default)
      | statusLine       | status |
      | (no Status line) | open   |
