@executable @cli @work @memory
Feature: a gap is lifecycle-bearing debt — an open/discharged status and a discharge condition, filterable by status
  In order to choose the debt still owed without wading through debt already discharged
  a gap record must carry an open|discharged status and its discharge condition in recallable text,
  and "aof work memory recall --status open" must return ONLY the gaps still open.

  # ADR-001: a gap reuses the frozen MemoryRecord's existing `status` field (open|discharged) — the same
  # slot an adr uses for Accepted/Superseded — and folds its discharge condition into the searchable
  # `text`. `applyScope` substring-matches a scope field, so a `--status` filter selects debt by its
  # lifecycle token. These scenarios read a hand-authored FIXTURE INDEX of gap records (the frozen ADR-005
  # shape), so they exercise RETRIEVAL alone — the `## Gaps` authoring/parse is stories 01/02's contract,
  # not this story's. The discharge-condition column is folded into each record's `text` (ADR-001), not a
  # new field: no field is added, the shape stays frozen.
  Background:
    Given a fixture index of these MemoryRecords:
      | id      | recordType | area         | title                       | status     | discharge condition (folded into text)          |
      | G1      | gap        | delivery     | warnings_delivered field    | open       | a production path writes warnings_delivered     |
      | G2      | gap        | delivery     | legacy_flag field           | discharged | the legacy_flag reader was removed              |
      | G3      | gap        | delivery     | audit_trail field           | open       | an emitter populates audit_trail on every write |
      | ADR-007 | adr        | architecture | seal discipline is additive | Accepted   |                                                 |

  Scenario: a gap record's open/discharged lifecycle lives in the reused status field
    Then the gap "warnings_delivered field" has status "open"
    And the gap "legacy_flag field" has status "discharged"

  Scenario: a gap record carries its discharge condition in its recallable text
    When I run "aof work memory recall \"warnings_delivered\""
    Then the recalled "warnings_delivered field" gap states the discharge condition "a production path writes warnings_delivered"

  # "returns ONLY open debt": a --status filter selects by the status token, so a discharged gap is
  # excluded and an adr (whose status is "Accepted") is never open debt — filtering is on the status value,
  # orthogonal to recordType.
  Scenario: recall --status open returns only the still-open gaps and excludes discharged debt
    When I run "aof work memory recall --status open"
    Then the recalled record ids are "G1, G3"
    And the gap "legacy_flag field" is not recalled
    And the adr "ADR-007" is not recalled

  # The status filter is symmetric across the lifecycle vocabulary: each token returns exactly the debt in
  # that state and excludes the other.
  Scenario Outline: recall --status <status> returns only the debt in that lifecycle state
    When I run "aof work memory recall --status <status>"
    Then the recalled record ids are "<present>"
    And the record ids "<excluded>" are not recalled

    Examples: the open|discharged lifecycle vocabulary (ADR-001)
      | status     | present | excluded |
      | open       | G1, G3  | G2       |
      | discharged | G2      | G1, G3   |
