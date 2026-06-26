@cli @adapter @work-stream
Feature: aof status projects to its mapped board option, or an honest skip when no mapping exists
  In order to never push a board value Notion would reject and never half-write a page, the projection must
  turn an aof status with a statusMap entry into that board option name, and an aof status with NO entry
  (e.g. in-review on a board that omits it) into an honest skip carrying a reason that names the missing
  mapping — the skip computed BEFORE any write, with no create/patch op emitted for that item.

  # ADR-003 (§A4): the board's status options are board-defined and the API can only set an EXISTING option
  # — aof's four statuses map to existing option names via the MANDATORY config statusMap. A status with no
  # map entry is an honest per-item failure: its op is "skip" with a reason naming the missing mapping, and
  # NO create/patch op is emitted for it (never-half-write at the projection level — the skip is computed
  # before any Notion write; RESEARCH §A6 has no atomic txn, so the per-item op is the unit of honesty).
  # These rows run @executable over the pure projection — no Notion spawn, no live token.
  #
  # The LIVE configured-but-unreachable honest-failure (token absent/invalid, a 429 storm) is @manual
  # (RESEARCH §A2/A6 — no token on the dev host). The STRUCTURAL never-half-write invariant is story-03's
  # arch-test acd-notion-fail-honestly (ADR-005 inv. 7) — referenced, never asserted as a Then here.

  Background:
    Given a fixture milestone "17" with stories "17/01" and "17/02"
    And a configured work.integrations.notion whose statusMap maps not-started, in-progress, and done but OMITS in-review

  @executable
  Scenario: an aof status with a statusMap entry projects to that board option name
    Given the on-disk status of "17/01" is "in-progress"
    When projectMilestone runs over the fixture
    Then the op for "17/01" has properties.statusOption equal to the board option statusMap assigns "in-progress"
    And the op for "17/01" is not a skip

  @executable
  Scenario: an aof status with no statusMap entry is an honest skip naming the missing mapping
    Given the on-disk status of "17/01" is "in-review"
    When projectMilestone runs over the fixture
    Then the op for "17/01" is "skip"
    And the op for "17/01" carries a reason that names the missing in-review mapping
    And no create or patch op is emitted for "17/01"

  # never-half-write at the projection level: the skip is decided BEFORE any write, so the item's op is
  # "skip" — never a page op carrying a fabricated or absent status value.
  @executable
  Scenario: the skip is computed before any write, never a page op with a fabricated value
    Given the on-disk status of "17/01" is "in-review"
    When projectMilestone runs over the fixture
    Then the op for "17/01" is "skip" with no properties.statusOption value to write
    And the plan contains no create or patch op for "17/01"

  # The full status matrix against the fixture's partial statusMap: each of the four aof statuses either
  # maps to its board option (a non-skip op) or — when the statusMap omits it — becomes an honest skip.
  @executable
  Scenario Outline: each aof status maps to its board option or becomes an honest skip
    Given the on-disk status of "17/01" is "<aofStatus>"
    When projectMilestone runs over the fixture
    Then the op for "17/01" is "<outcome>"

    Examples:
      | aofStatus    | outcome  |
      | not-started  | mapped   |
      | in-progress  | mapped   |
      | in-review    | skip     |
      | done         | mapped   |
