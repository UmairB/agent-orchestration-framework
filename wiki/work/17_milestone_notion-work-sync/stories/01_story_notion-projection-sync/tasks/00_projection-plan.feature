@cli @adapter @work-stream
Feature: projectMilestone projects an on-disk milestone into a per-item Notion SyncPlan
  In order to know exactly what the sync would push to the board before any Notion call, the pure
  projection must turn the on-disk traversal + the config + the sidecar mapping into a SyncPlan: one op
  per aof item in traversal order (milestone first, then its stories), each op carrying the board page
  title, the statusMap'd board option, the story→milestone self-relation, and a create/patch/noop/skip
  decision taken entirely from the local sidecar lookup + the status match.

  # ADR-003: src/notion/projection.mjs is PURE — projectMilestone({ items, config, mapping }) → SyncPlan
  # { dataSourceId, ops: [Op] }, computed with ZERO Notion calls. The create/patch decision is the local
  # sidecar lookup (ADR-001 resolvePageId: HIT → patch, null → create), so the projection is exact, not an
  # estimate. statusOption is a BOARD OPTION NAME via the MANDATORY config statusMap (§A4); the story op
  # carries relation { property, parentPageId } = the milestone page id (§A3 self-relation, same data-source).
  # These rows run @executable in-process over a fixture milestone — no Notion spawn, no live token.
  #
  # These are OBSERVABLE shapes of the returned plan. The STRUCTURAL invariants (the plan is the sole
  # preview / no resolve-by-query / one-way) are story-03 arch-tests (ADR-005 inv. 1/2/7) — referenced in
  # comments, never asserted as a Then.

  Background:
    Given a fixture milestone "17" with stories "17/01" and "17/02" read via listItems/readMeta
    And a configured work.integrations.notion with a dataSourceId and a complete statusMap

  @executable
  Scenario: the plan is addressed by the configured data_source_id with ops in traversal order
    Given a sidecar with no recorded page ids
    When projectMilestone runs over the fixture
    Then the SyncPlan dataSourceId equals the configured data_source_id
    And the plan's ops are in traversal order: the milestone "17" first, then "17/01", then "17/02"

  @executable
  Scenario: the milestone op carries its title and the statusMap'd board option name
    Given a sidecar with no recorded page ids
    When projectMilestone runs over the fixture
    Then the op for "17" has properties.title equal to the milestone's on-disk title
    And the op for "17" has properties.statusOption equal to the board option the statusMap assigns its status

  @executable
  Scenario: a story op carries a self-relation to the milestone page id in the same data-source
    Given a sidecar that records page id "page-M" for ref "17"
    When projectMilestone runs over the fixture
    Then the op for "17/01" has relation.property equal to the configured relationProperty
    And the op for "17/01" has relation.parentPageId equal to "page-M"
    And the op for "17/01" is addressed in the same dataSourceId as the milestone op

  @executable
  Scenario: an item with no sidecar page id is a create op; a sidecar HIT is a patch op
    Given a sidecar that records page id "page-M" for ref "17" and nothing for "17/01"
    When projectMilestone runs over the fixture
    Then the op for "17" has op "patch" with pageId "page-M"
    And the op for "17/01" has op "create" with pageId null

  # The op decision is a pure function of three local facts — a sidecar page id present?, the status
  # mapped?, the mapped option already equal to the sidecar's recorded lastStatus? — never a Notion read.
  # (no-map → skip dominates; then no page id → create; then status already current → noop; else patch.)
  @executable
  Scenario Outline: the op is decided from the sidecar lookup and the local status match alone
    Given a sidecar where ref "17/01" "<sidecar>" and its lastStatus is "<lastStatus>"
    And the statusMap "<mapped>" the on-disk status of "17/01"
    When projectMilestone runs over the fixture
    Then the op for "17/01" is "<op>"

    Examples:
      | sidecar         | lastStatus  | mapped       | op     |
      | has no page id  | -           | maps         | create |
      | has a page id   | differs     | maps         | patch  |
      | has a page id   | equals      | maps         | noop   |
      | has no page id  | -           | omits        | skip   |
      | has a page id   | differs     | omits        | skip   |
