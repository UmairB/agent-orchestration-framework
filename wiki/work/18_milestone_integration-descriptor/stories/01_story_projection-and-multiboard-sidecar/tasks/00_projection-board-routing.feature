@cli @adapter @work-stream
Feature: the projection addresses each milestone's chosen board, falling back to the default with no regression
  In order to push a routed milestone to the board it actually belongs to while leaving an unrouted milestone exactly where m17 put it
  the pure aof→Notion projection must read each milestone's routing (story 00's resolver), produce a SyncPlan
  whose dataSourceId is the CHOSEN board's, scope the sidecar read to that board's data-source, and — when a
  milestone has NO descriptor — produce a plan byte-for-byte identical to the milestone-17 default-board plan,
  all with ZERO Notion calls.

  # ADR-003/005: projectMilestone consumes resolveNotionRouting to pick the board connection, so the plan's
  # dataSourceId is the routed board's (not a single flat config dataSourceId). The sidecar passed in is read
  # for THAT board's data-source (ADR-005 per-data-source bucket). The decision precedence (skip/create/noop/
  # patch from local facts only, 17/ADR-003) is UNCHANGED — only the board the plan addresses changes.
  #
  # These are OBSERVABLE behaviours of the PURE projection over fixtures (the live-Notion lane stays deferred,
  # finding NTN-V1) — @executable. STRUCTURAL — "board resolution + default fallback + absent-descriptor ⇒ m17
  # byte-for-byte" is FF-C, and "the projection imports no Notion spawn seam" is FF-D (both arch-tests authored
  # in story 02), NOT Thens here. Comment-only.

  Background:
    Given a config with boards "ops" and "growth", default "ops"
    And a milestone "18" with its stories on disk

  @executable
  Scenario: a milestone routed to a board produces a plan addressing that board
    Given milestone "18" has a descriptor naming board "growth"
    When I project the milestone
    Then the plan's dataSourceId is the "growth" board's dataSourceId

  @executable
  Scenario: a milestone with no descriptor addresses the default board
    Given milestone "18" has no ".integrations.json"
    When I project the milestone
    Then the plan's dataSourceId is the default "ops" board's dataSourceId

  # The no-regression invariant: an unrouted milestone (and ITS STORIES) projects byte-for-byte as under the
  # flat m17 config — the WHOLE plan, not just the milestone op.
  @executable
  Scenario: an unrouted milestone and its stories project byte-for-byte as milestone 17
    Given an equivalent FLAT m17 config and the SAME milestone (with stories) and no descriptor
    When I project the milestone under both the boards config and the flat m17 config
    Then the two SyncPlans are deep-equal — same dataSourceId, same ops in the same order
    And each op is identical in op, pageId, properties (title/statusOption/relation), and reason
    And the ops are in traversal order with the milestone first
    And the milestone op carries no parent relation
    And every story op carries its §A3 self-relation to the milestone exactly as under m17

  # The sidecar read is scoped to the ROUTED board's data-source — a binding under the other board must not
  # decide create/patch for this one (sets up the multi-board coexistence verified in task 02).
  @executable
  Scenario: the sidecar lookup for the plan is scoped to the routed board's data-source
    Given milestone "18" routes to board "growth"
    And the sidecar holds a binding for "18" only under the "ops" board's data-source
    When I project the milestone
    Then the milestone op is "create"
    And the plan does not reuse the "ops"-scoped page id

  # The op-decision precedence is unchanged by routing — a sidecar HIT under the routed board still patches.
  @executable
  Scenario: a sidecar hit under the routed board still decides patch
    Given milestone "18" routes to board "growth"
    And the sidecar holds a binding for "18" under the "growth" board's data-source
    When I project the milestone
    Then the milestone op is "patch"
    And the op's pageId is the "growth"-scoped page id

  # SKIP is the new equivalence class routing introduces: each board carries its OWN statusMap (ADR-002), so a
  # status mapped on the default board but ABSENT from the routed board's statusMap must skip — proving the
  # statusMap consulted is the ROUTED board's, not the default/flat one.
  @executable
  Scenario: a status unmapped on the routed board skips, naming the routed board's missing mapping
    Given the milestone's status is mapped on the default "ops" board but absent from the "growth" board's statusMap
    And milestone "18" routes to board "growth"
    When I project the milestone
    Then the milestone op is "skip"
    And the op carries no statusOption
    And the reason names the missing status mapping on the routed board

  # NOOP under routing: a routed sidecar hit whose recorded lastStatus equals the routed board's mapped option.
  @executable
  Scenario: a routed sidecar hit already at the mapped option decides noop
    Given milestone "18" routes to board "growth"
    And the sidecar holds a binding for "18" under "growth" whose lastStatus equals the "growth"-mapped option
    When I project the milestone
    Then the milestone op is "noop"

  # The flat m17 config (implicit default board) is the literal no-regression substrate — projecting over it
  # addresses the flat block's dataSourceId, the same op the default board produces.
  @executable
  Scenario: projecting over a flat m17 config addresses the flat block's data-source
    Given an equivalent FLAT m17 config and milestone "18" with no descriptor
    When I project the milestone
    Then the plan's dataSourceId is the flat block's dataSourceId
